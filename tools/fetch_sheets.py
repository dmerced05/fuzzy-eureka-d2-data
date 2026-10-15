#!/usr/bin/env python3
"""Pull every tab of the source Google Sheets into data/raw.json.

I use the public "htmlview" pages (no API key needed) and rebuild each tab as a
grid of strings, keeping merges and links. Stdlib only so the GitHub Action
doesn't need any installs.

    python tools/fetch_sheets.py            # writes data/raw.json
"""
import html
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES_FILE = ROOT / "tools" / "sources.json"
OUT_FILE = ROOT / "data" / "raw.json"

UA = "Mozilla/5.0 (d2-data-compendium-mirror; +https://github.com)"


def fetch(url, tries=3):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception as err:  # flaky network, just retry a couple times
            if attempt == tries - 1:
                raise
            print(f"  retry {url} ({err})", file=sys.stderr)
            time.sleep(2 + attempt * 3)


def list_tabs(sheet_id):
    page = fetch(f"https://docs.google.com/spreadsheets/d/{sheet_id}/htmlview")
    title_match = re.search(r"<title>([^<]*)</title>", page)
    title = html.unescape(title_match.group(1)) if title_match else sheet_id
    title = title.replace(" - Google Drive", "").replace(" - Google Sheets", "")
    tabs = []
    for name, gid in re.findall(r'items\.push\(\{name: "([^"]+)"[^}]*gid: "(\d+)"', page):
        # names come out JS-escaped (\/ and \x27)
        name = name.replace("\\/", "/")
        name = re.sub(r"\\x([0-9a-fA-F]{2})", lambda m: chr(int(m.group(1), 16)), name)
        tabs.append((html.unescape(name), gid))
    return title, tabs


class GridParser(HTMLParser):
    """Turns the first <table> of an htmlview sheet into a 2D grid.

    Mirrors what the browser scrape did: <br> -> newline, rowspan/colspan are
    expanded (value only in the top-left cell), header <th> cells skipped.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.grid, self.links, self.merges = [], [], []
        self.in_table = self.done = False
        self.in_tbody = False
        self.row = -1
        self.col = 0
        self.cell = None  # list of text chunks while inside a <td>
        self.cell_pos = None
        self.link = None  # [href, text_chunks]
        self.skip_depth = 0  # inside <th>

    def _slot(self, r, c):
        while len(self.grid) <= r:
            self.grid.append({})
        return self.grid[r]

    def handle_starttag(self, tag, attrs):
        if self.done:
            return
        a = dict(attrs)
        if tag == "table" and not self.in_table:
            self.in_table = True
        elif not self.in_table:
            return
        elif tag == "tbody":
            self.in_tbody = True
        elif tag == "tr" and self.in_tbody:
            self.row += 1
            self.col = 0
            self._slot(self.row, 0)
        elif tag == "th":
            self.skip_depth += 1
        elif tag == "td" and self.in_tbody and not self.skip_depth:
            row = self._slot(self.row, 0)
            while self.col in row:
                self.col += 1
            rs = int(a.get("rowspan", 1) or 1)
            cs = int(a.get("colspan", 1) or 1)
            for dr in range(rs):
                target = self._slot(self.row + dr, 0)
                for dc in range(cs):
                    target[self.col + dc] = ""
            if rs > 1 or cs > 1:
                self.merges.append([self.row, self.col, rs, cs])
            self.cell = []
            self.cell_pos = (self.row, self.col, cs)
        elif tag == "br" and self.cell is not None:
            self.cell.append("\n")
            if self.link:
                self.link[1].append("\n")
        elif tag == "a" and self.cell is not None:
            self.link = [a.get("href", ""), []]

    def handle_startendtag(self, tag, attrs):
        if tag == "br":
            self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if self.done or not self.in_table:
            return
        if tag == "th":
            self.skip_depth = max(0, self.skip_depth - 1)
        elif tag == "a" and self.link is not None:
            r, c, _ = self.cell_pos
            self.links.append([r, c, "".join(self.link[1]), self.link[0]])
            self.link = None
        elif tag == "td" and self.cell is not None:
            r, c, cs = self.cell_pos
            text = "".join(self.cell).replace(" ", " ").rstrip()
            self.grid[r][c] = text
            self.col = c + cs
            self.cell = None
        elif tag == "table":
            self.done = True

    def handle_data(self, data):
        if self.cell is not None and not self.skip_depth:
            self.cell.append(data)
            if self.link:
                self.link[1].append(data)

    def result(self):
        out = []
        for row in self.grid:
            width = (max(row) + 1) if row else 0
            cells = [row.get(i, "") for i in range(width)]
            while cells and cells[-1] == "":
                cells.pop()
            out.append(cells)
        while out and not out[-1]:
            out.pop()
        return {"grid": out, "links": self.links, "merges": self.merges}


def parse_sheet_html(page):
    parser = GridParser()
    parser.feed(page)
    return parser.result()


def main():
    sources = json.loads(SOURCES_FILE.read_text())
    dump = {}
    for key, meta in sources.items():
        sheet_id = meta["id"]
        title, tabs = list_tabs(sheet_id)
        print(f"{key}: {title} ({len(tabs)} tabs)")
        sheets = []
        for name, gid in tabs:
            page = fetch(f"https://docs.google.com/spreadsheets/d/{sheet_id}/htmlview/sheet?headers=false&gid={gid}")
            parsed = parse_sheet_html(page)
            print(f"  {name}: {len(parsed['grid'])} rows")
            sheets.append({"name": name, "gid": gid, **parsed})
            time.sleep(0.3)  # be polite to Google
        dump[key] = {"id": sheet_id, "title": title, "sheets": sheets}
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {"fetched": datetime.now(timezone.utc).isoformat(), "sources": dump}
    OUT_FILE.write_text(json.dumps(payload, ensure_ascii=False))
    print(f"wrote {OUT_FILE} ({OUT_FILE.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
