#!/usr/bin/env python3
"""Turn data/raw.json (every tab as a grid) into what the site loads.

Outputs:
  data/entries.json        -> structured compendium entries (search + build planner)
  data/sheets/<src>.json   -> cleaned grids for the "original layout" viewer
  data/tables.json         -> boss damage / health tables with real headers
  data/meta.json           -> credits, tab list, fetch date

Each sheet in the Compendium has its own layout, so there's one small parser
per layout. If a tab changes shape upstream, its parser is the only thing
to fix; the raw sheet viewer keeps working regardless.
"""
import json
import re
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SOURCES = json.loads((ROOT / "tools" / "sources.json").read_text())

ELEMENTS = ["Arc", "Solar", "Void", "Stasis", "Strand", "Prismatic"]
CLASS_ALIASES = {"hunter": "Hunter", "hunters": "Hunter", "titan": "Titan", "titans": "Titan",
                 "warlock": "Warlock", "warlocks": "Warlock"}

# ---------------------------------------------------------------- keywords
# Synergy is keyword based: each entry gets the verbs/buffs it mentions, and
# I guess whether it PRODUCES them (grants, inflicts, creates...) or USES them
# (while X, on X kill, against X'd targets). Group/element drive the colors.
KEYWORDS = [
    # name, element/group, regex
    ("Jolt", "Arc", r"jolt(?:ed|s|ing)?"),
    ("Blind", "Arc", r"blind(?:ed|s|ing)?"),
    ("Amplified", "Arc", r"amplified"),
    ("Bolt Charge", "Arc", r"bolt charges?"),
    ("Ionic Trace", "Arc", r"ionic traces?"),
    ("Scorch", "Solar", r"scorch(?:ed|es|ing)?"),
    ("Ignition", "Solar", r"ignit(?:ion|ions|e|es|ed)"),
    ("Radiant", "Solar", r"radiant"),
    ("Restoration", "Solar", r"restoration"),
    ("Cure", "Solar", r"cure[ds]?"),
    ("Firesprite", "Solar", r"firesprites?"),
    ("Sunspot", "Solar", r"sunspots?"),
    ("Volatile", "Void", r"volatile"),
    ("Weaken", "Void", r"weaken(?:ed|s|ing)?"),
    ("Suppression", "Void", r"suppress(?:ed|es|ion|ing)?"),
    ("Devour", "Void", r"devour(?:ed|ing)?"),
    ("Invisibility", "Void", r"invisib(?:ility|le)"),
    ("Overshield", "Void", r"(?:void )?overshields?"),
    ("Void Breach", "Void", r"void breach(?:es)?"),
    ("Slow", "Stasis", r"slow(?:ed|s)?(?! down)"),
    ("Freeze", "Stasis", r"freez(?:e|es|ing)|frozen"),
    ("Shatter", "Stasis", r"shatter(?:ed|s|ing)?"),
    ("Stasis Crystal", "Stasis", r"(?:stasis )?crystals?"),
    ("Frost Armor", "Stasis", r"frost armou?r"),
    ("Stasis Shard", "Stasis", r"stasis shards?"),
    ("Sever", "Strand", r"sever(?:ed|s)?"),
    ("Suspend", "Strand", r"suspen(?:d|ds|ded|sion)"),
    ("Unravel", "Strand", r"unravel(?:ing|ed|s)?"),
    ("Tangle", "Strand", r"tangles?"),
    ("Woven Mail", "Strand", r"woven mail"),
    ("Threadling", "Strand", r"threadlings?"),
    ("Transcendence", "Prismatic", r"transcend(?:ence|ent)"),
    ("Orb of Power", "General", r"orbs? of power"),
    ("Armor Charge", "General", r"armou?r charges?"),
    ("Elemental Pickup", "General", r"elemental pickups?"),
    ("Elemental Buff", "General", r"elemental buffs?"),
    ("Elemental Debuff", "General", r"elemental debuffs?|elementally[- ]debuffed"),
    ("Finisher", "General", r"finishers?"),
    ("Precision", "General", r"precision (?:hits?|kills?|damage)"),
    ("Champion", "General", r"champions?"),
    ("Healing", "General", r"restores? \d+\s*(?:\[\d+\]\s*)?(?:hp|health)|health regeneration"),
    ("Damage Resist", "General", r"damage resist(?:ance)?"),
    ("Super Energy", "Ability", r"super (?:ability )?energy"),
    ("Grenade", "Ability", r"grenades?(?! launchers?)"),
    ("Melee", "Ability", r"(?:powered )?melees?"),
    ("Class Ability", "Ability", r"class abilit(?:y|ies)|barricade|rift|dodge|thruster"),
    ("Auto Rifle", "Weapon", r"auto rifles?"),
    ("Bow", "Weapon", r"bows?"),
    ("Fusion Rifle", "Weapon", r"(?<!linear )fusion rifles?"),
    ("Glaive", "Weapon", r"glaives?"),
    ("Grenade Launcher", "Weapon", r"grenade launchers?"),
    ("Hand Cannon", "Weapon", r"hand cannons?"),
    ("Linear Fusion Rifle", "Weapon", r"linear fusion rifles?"),
    ("Machine Gun", "Weapon", r"machine guns?"),
    ("Pulse Rifle", "Weapon", r"pulse rifles?"),
    ("Rocket Launcher", "Weapon", r"rocket launchers?"),
    ("Scout Rifle", "Weapon", r"scout rifles?"),
    ("Shotgun", "Weapon", r"shotguns?"),
    ("Sidearm", "Weapon", r"sidearms?"),
    ("Sniper Rifle", "Weapon", r"sniper rifles?"),
    ("Submachine Gun", "Weapon", r"submachine guns?|smgs?"),
    ("Sword", "Weapon", r"swords?"),
    ("Trace Rifle", "Weapon", r"trace rifles?"),
]
KW_RE = [(name, grp, re.compile(r"\b(?:" + rx + r")\b", re.I)) for name, grp, rx in KEYWORDS]

PRODUCE_RE = re.compile(
    r"\b(grant|grants|granting|granted|inflict|inflicts|inflicting|create|creates|creating|spawn|spawns|spawning|"
    r"appl(?:y|ies|ying)|become|becomes|cause|causes|release|releases|summon|summons|generate|generates|"
    r"trigger|triggers|make|makes|gain|gains|refund|refunds|convert|converts|turns? into|"
    r"jolts|scorches|blinds|weakens|suppresses|slows|freezes|severs|suspends|unravels|ignites|restores|"
    r"drops?|overflows?|refills?|regeneration rate|ability energy)\b", re.I)
USE_RE = re.compile(
    r"\b(while|against|on|upon|after|killing|kills?|defeating|damaging|hitting|picking up|pickup|"
    r"affected by|standing in|inside|within|consum(?:e|es|ing)|when|whenever|if|during|with)\b", re.I)


def classify_keywords(text):
    """Return {keyword: set('produce'|'use'|'mention')} for a description."""
    found = {}
    prev_condition = False
    for line in re.split(r"\n+", text):
        stripped = line.strip()
        if not stripped:
            continue
        is_condition = stripped.endswith(":")
        # "Orb of Power:" / "Reserve Overshield:" are definition headers, not triggers
        is_header = is_condition and len(stripped[:-1].split()) <= 4 and not USE_RE.search(stripped)
        for name, grp, rx in KW_RE:
            for m in rx.finditer(stripped):
                before = stripped[: m.start()]
                after = stripped[m.end(): m.end() + 25]
                roles = found.setdefault(name, set())
                if is_header:
                    roles.add("mention")
                    continue
                if is_condition:
                    roles.add("use")
                    continue
                if prev_condition and m.start() <= 2:
                    # "Upon X:\nVolatile Rounds for 9 seconds." -> the effect is granted
                    roles.add("produce")
                    continue
                # "...Debuffed Enemies", "Jolted targets", "X Kill" => uses
                if re.match(r"[\w\- ]{0,3}(?:enem|target|combatant|kill|hit|damage|final blow)", after, re.I) and \
                        not PRODUCE_RE.search(before[-40:]):
                    roles.add("use")
                elif PRODUCE_RE.search(before[-60:]):
                    roles.add("produce")
                elif USE_RE.search(before[-30:]):
                    roles.add("use")
                else:
                    roles.add("mention")
        prev_condition = is_condition and not is_header
    return found


# ---------------------------------------------------------------- helpers
def clean(text):
    text = (text or "").replace("\r", "")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def first_line(text):
    return clean(text).split("\n", 1)[0].strip()


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def unwrap_link(href, sheet_id):
    if not href:
        return href
    if "google.com/url" in href:
        q = parse_qs(urlparse(href).query).get("q")
        if q:
            href = unquote(q[0])
    # in-sheet jumps: "#gid=..." (raw) or a resolved htmlview URL of the wrong book
    if href.startswith("#gid=") or href.startswith("#rangeid="):
        return f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit{href}"
    m = re.match(r"https://docs\.google\.com/spreadsheets/d/[^/]+/htmlview(#.*)", href)
    if m:
        return f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit{m.group(1)}"
    return href


def cell(grid, r, c):
    if r < len(grid) and c < len(grid[r]):
        return grid[r][c]
    return ""


class Collector:
    def __init__(self):
        self.entries = []
        self.ids = set()

    def add(self, cat, name, desc, sheet, **extra):
        name = clean(name)
        desc = clean(desc)
        if not name or name in ("-",):
            return None
        base = slug(f"{cat}-{extra.get('cls') or ''}-{extra.get('el') or ''}-{name}")
        eid, n = base, 2
        while eid in self.ids:
            eid, n = f"{base}-{n}", n + 1
        self.ids.add(eid)
        entry = {"id": eid, "cat": cat, "name": name, "desc": desc, "sheet": sheet}
        for k, v in extra.items():
            if v not in (None, "", [], {}):
                entry[k] = v
        self.entries.append(entry)
        return entry


# ---------------------------------------------------------------- parsers
def parse_weapon_perks(sh, out):
    grid = sh["grid"]
    sections = {"Weapon Traits": "weapon-trait", "Weapon Mods": "weapon-mod",
                "Intrinsic Traits": "intrinsic", "Origin Traits": "origin-trait",
                "Heavy Crossbow Information": "weapon-info", "Glaive Information": "weapon-info",
                "Sword Guard Information": "weapon-info"}
    cat, group = None, None
    for r in range(5, len(grid)):
        name, desc = cell(grid, r, 0), cell(grid, r, 2)
        if name.strip() in sections and not desc:
            cat, group = sections[name.strip()], name.strip()
            continue
        if not cat or not name.strip():
            continue
        parts = [p.strip() for p in name.split("\n") if p.strip()]
        title, extra = parts[0], {}
        if cat == "origin-trait" and len(parts) > 1:
            extra["source"] = " · ".join(parts[1:])
        elif len(parts) > 1:
            # "Adaptive Frame / (Rocket Launchers)"
            title = parts[0] + " " + " ".join(parts[1:])
        if cat == "weapon-info":
            extra["group"] = group.replace(" Information", "")
        out.add(cat, title, desc, sh["name"], **extra)


def parse_armor_sets(sh, out):
    grid = sh["grid"]
    current = None
    for r in range(3, len(grid)):
        name, piece = cell(grid, r, 0), cell(grid, r, 2)
        if name.strip():
            parts = [p.strip() for p in name.split("\n") if p.strip()]
            current = out.add("armor-set", parts[0], "", sh["name"], source=" · ".join(parts[1:]))
            if current is not None:
                current["pieces"] = []
        if current is not None and piece.strip():
            head, _, body = piece.partition("\n")
            label, _, perk = head.partition("|")
            current["pieces"].append({"count": label.strip(), "name": perk.strip(), "desc": clean(body)})
    for e in out.entries:
        if e["cat"] == "armor-set" and not e["desc"]:
            e["desc"] = "\n\n".join(f"{p['count']} | {p['name']}\n{p['desc']}" for p in e.get("pieces", []))


def parse_armor_mods(sh, out):
    grid = sh["grid"]
    header = grid[0]
    # name col -> desc col pairs by slot
    pairs = []
    for c, label in enumerate(header):
        label = label.strip()
        if label and label not in ("Effect", "w", "LEGACY"):
            desc_c = next((d for d in range(c + 1, min(c + 4, len(header))) if header[d].strip() == "Effect"), None)
            if desc_c is not None:
                pairs.append((label, c, desc_c))
    for slot, nc, dc in pairs:
        group = None
        for r in range(2, len(grid)):
            name, desc = cell(grid, r, nc), cell(grid, r, dc)
            if not name.strip():
                continue
            if not desc.strip():
                group = first_line(name)  # raid / activity sub-heading
                continue
            parts = [p.strip() for p in name.split("\n") if p.strip()]
            cost = next((p.strip("[]") for p in parts[1:] if "Energy" in p), None)
            out.add("armor-mod", parts[0], desc, sh["name"], slot=slot, group=group, cost=cost)


def parse_artifacts(sh, out):
    grid = sh["grid"]
    artifact, tags = None, None
    r = 6
    while r < len(grid):
        row = grid[r]
        filled = [(c, v) for c, v in enumerate(row) if v.strip()]
        if len(filled) == 1 and filled[0][0] == 3:
            text = filled[0][1].strip()
            if "⯁" in text or "|" in text:
                tags = text
            else:
                artifact, tags = text, None
            r += 1
            continue
        names = {c: v for c, v in filled if c in (2, 5, 8)}
        if names and artifact:
            descs = grid[r + 1] if r + 1 < len(grid) else []
            for c, nm in names.items():
                desc = cell(grid, r + 1, c - 1)
                out.add("artifact-perk", nm, desc, sh["name"], artifact=artifact,
                        column={2: 1, 5: 2, 8: 3}[c], tags=tags)
            r += 2
            continue
        r += 1


SUBCLASS_SECTIONS = {
    "glossary": "verb", "fragments": "fragment", "grenade abilities": "grenade",
    "melee abilities": "melee", "super abilities": "super", "aspect": "aspect", "aspects": "aspect",
    "class abilities": "class-ability", "movement abilities": "movement",
}


def parse_subclass(sh, out):
    grid = sh["grid"]
    element = sh["name"]
    cls, section, last = None, None, None
    shared = {}
    for r in range(4, len(grid)):
        row = grid[r]
        c0, c1, c3, c13 = cell(grid, r, 0), cell(grid, r, 1), cell(grid, r, 3), cell(grid, r, 13)
        c6 = cell(grid, r, 6)
        marker = next((v.strip().lower() for v in (c0, c6) if v.strip().lower() in CLASS_ALIASES), None)
        if marker and c3.strip() in ("", "-"):
            cls, section, last = CLASS_ALIASES[marker], None, None
            continue
        head = first_line(c1).lower()
        if head in SUBCLASS_SECTIONS and (not c3.strip() or c3.strip() in ("Information",)):
            section = SUBCLASS_SECTIONS[head]
            continue
        if head.startswith("shared abilities"):
            section = "shared"
            continue
        if section == "shared" and not c1.strip():
            names = [v.strip() for c, v in enumerate(row) if c >= 3 and v.strip()]
            if names:
                shared.setdefault(cls, []).append(names)
            continue
        if not c1.strip() or not c3.strip():
            continue
        if head.startswith("numbers in"):
            continue
        sec = section
        if element == "Prismatic" and sec in (None, "shared") and "grenade" in first_line(c3).lower():
            sec = "grenade"
        if sec is None:
            continue
        name = first_line(c1)
        # grenade / ability modifiers (e.g. Touch of Thunder rows) -> fold into the previous entry
        if last is not None and sec in ("grenade",) and name in ("Touch of Thunder", "Touch of Flame",
                                                                 "Touch of Winter", "Spark of Magnitude",
                                                                 "Chaos Accelerant", "Mindspun Invocation"):
            last["desc"] += f"\n\n▸ With {name}:\n{clean(c3)}"
            last.setdefault("mods", []).append(name)
            continue
        extra = {"el": element, "cls": cls if sec not in ("verb", "fragment") else None}
        if sec in ("verb", "fragment"):
            extra["cls"] = None
        if c13.strip() and c13.strip() != "-":
            extra["stats" if sec == "fragment" else "note"] = clean(c13)
        if sec == "grenade":
            extra["cls"] = cls  # Arc etc list grenades before classes -> None (shared)
        last = out.add(sec, name, c3, sh["name"], **extra)
    return shared


def parse_exotic_armor(sh, out):
    grid = sh["grid"]
    classes = {0: "Hunter", 3: "Titan", 6: "Warlock"}
    last = {}
    aeon = False
    for r in range(4, len(grid)):
        if first_line(cell(grid, r, 0)) == "Aeon Sects":
            aeon = True
            continue
        for c, cls in classes.items():
            name, desc = cell(grid, r, c), cell(grid, r, c + 2)
            if not name.strip():
                continue
            if desc.strip():
                parts = [p.strip() for p in name.split("\n") if p.strip()]
                if aeon:
                    last[c] = out.add("exotic-armor", parts[0], desc, sh["name"], cls=cls,
                                      perk=" ".join(parts[1:]), group="Aeon Sect")
                else:
                    last[c] = out.add("exotic-armor", parts[0], desc, sh["name"], cls=cls)
            elif last.get(c) is not None and "perk" not in last[c]:
                last[c]["perk"] = first_line(name)


def parse_exotic_weapons(sh, out):
    grid = sh["grid"]
    slot = None
    for r in range(5, len(grid)):
        name, desc = cell(grid, r, 0), cell(grid, r, 3)
        if name.strip() and not desc.strip():
            t = first_line(name)
            if "Weapons" in t:
                slot = t.replace(" Slot Weapons", "").replace(" Weapons", "")
            continue
        if not name.strip():
            continue
        lines = [l.strip() for l in name.split("\n")]
        title = lines[0]
        perks = [l for l in lines[1:] if l]
        frame = first_line(desc)
        els = [e for e in ["Kinetic", "Arc", "Solar", "Void", "Stasis", "Strand"] if re.search(rf"\b{e}\b", frame)]
        out.add("exotic-weapon", title, desc, sh["name"], slot=slot, perks=perks, frame=frame,
                weaponEls=els, el=els[0] if len(els) == 1 and els[0] != "Kinetic" else None)


def parse_exotic_class(sh, out):
    grid = sh["grid"]
    cls = None
    for r in range(3, len(grid)):
        c0 = first_line(cell(grid, r, 0))
        if c0.endswith("Perks") and not cell(grid, r, 2).strip():
            low = c0.lower()
            cls = next((v for k, v in CLASS_ALIASES.items() if low.startswith(k)), None)
            continue
        for nc, side in ((0, "Left"), (3, "Right")):
            name, desc = cell(grid, r, nc), cell(grid, r, nc + 2)
            if name.strip() and desc.strip():
                out.add("exotic-class", first_line(name), desc, sh["name"], cls=cls, column=side)


def parse_class_abilities(sh, out):
    grid = sh["grid"]
    cls = None
    for r in range(2, len(grid)):
        c0, c1, c3, c13 = (cell(grid, r, c) for c in (0, 1, 3, 13))
        if c0.strip().lower() in CLASS_ALIASES:
            cls = CLASS_ALIASES[c0.strip().lower()]
            continue
        if not c1.strip() and c3.strip() and cls:
            out.add("class-trait", f"{cls} intrinsic traits", c3, sh["name"], cls=cls)
            continue
        if c1.strip() and c3.strip():
            out.add("class-ability", first_line(c1), c3, sh["name"], cls=cls, note=clean(c13) if c13.strip() != "-" else None)


def parse_game_mechanics(sh, out):
    """Modifier-style rows (name in col 2, text in col 5) become entries; the
    rest of the tab is prose/tables that read better in the sheet viewer."""
    grid = sh["grid"]
    group = None
    start = next((r for r in range(len(grid)) if first_line(cell(grid, r, 2)) == "Activity Modifiers" and r > 10), None)
    if start is None:
        return
    for r in range(start + 1, len(grid)):
        if cell(grid, r, 1).strip():
            break  # next section of the tab (Armor Charges...) is prose/tables
        c2, c5 = cell(grid, r, 2), cell(grid, r, 5)
        if not re.search(r"[A-Za-z]{3}", first_line(c2)):
            continue
        if c2.strip() and not c5.strip():
            if "|" in first_line(c2) or len(c2) < 40:
                group = first_line(c2).split("|")[0].strip()
            continue
        if c2.strip() and c5.strip():
            parts = [p.strip() for p in c2.split("\n") if p.strip()]
            out.add("mechanic", parts[0], c5, sh["name"], group=group,
                    note=" ".join(parts[1:]) or None)


PARSERS = {
    "Weapon Perks": parse_weapon_perks,
    "Armor Perks": parse_armor_sets,
    "Armor Mods": parse_armor_mods,
    "Artifact Perks": parse_artifacts,
    "Exotic Armors": parse_exotic_armor,
    "Exotic Weapons": parse_exotic_weapons,
    "Exotic Class": parse_exotic_class,
    "Class Abilities": parse_class_abilities,
    "Game Mechanics": parse_game_mechanics,
}


# ---------------------------------------------------------------- tables
def table_from(sh, header_row, data_start, label_rows=None, drop_cols=()):
    grid = sh["grid"]
    header = list(grid[header_row]) if header_row < len(grid) else []
    if label_rows is not None:
        # merge group labels above ("INFORMATION", "VISUAL"...) into header names
        groups, current = [], ""
        top = grid[label_rows]
        for c in range(len(header)):
            if cell(grid, label_rows, c).strip():
                current = cell(grid, label_rows, c).strip()
            groups.append(current)
    width = max((len(r) for r in grid[data_start:]), default=0)
    width = max(width, len(header))
    cols = []
    for c in range(width):
        name = (header[c] if c < len(header) else "").replace("\n", " ").strip()
        if c in drop_cols:
            continue
        values = [cell(grid, r, c) for r in range(data_start, len(grid))]
        if not name and not any(v.strip() for v in values):
            continue
        if label_rows is not None and groups and c < len(groups) and groups[c] not in ("INFORMATION", "NAME", ""):
            name = f"{groups[c].title()} · {name}" if name else groups[c].title()
        cols.append((c, name or f"col {c + 1}"))
    rows = []
    for r in range(data_start, len(grid)):
        vals = [cell(grid, r, c).strip() for c, _ in cols]
        if any(v and v != "/" for v in vals):
            rows.append(vals)
    return {"columns": [n for _, n in cols], "rows": rows}


def build_tables(raw):
    bd = {s["name"]: s for s in raw["bossdamage"]["sheets"]}
    bh = {s["name"]: s for s in raw["bosshealth"]["sheets"]}
    tables = {}
    if "Weapons" in bd:
        tables["weapons"] = {"title": "Weapon damage vs. bosses", "source": "bossdamage", "tab": "Weapons",
                             **table_from(bd["Weapons"], 1, 3, label_rows=0, drop_cols=(0,))}
    if "Abilties" in bd:
        tables["abilities"] = {"title": "Ability damage vs. bosses", "source": "bossdamage", "tab": "Abilties",
                               **table_from(bd["Abilties"], 1, 3, label_rows=0, drop_cols=(0,))}
    if "Sustained" in bd:
        tables["sustained"] = {"title": "Sustained DPS (single source)", "source": "bossdamage", "tab": "Sustained",
                               **table_from(bd["Sustained"], 0, 2, drop_cols=(3, 4))}
    if "Swap" in bd:
        tables["swap"] = {"title": "Swap / burst DPS components", "source": "bossdamage", "tab": "Swap",
                          **table_from(bd["Swap"], 0, 2, drop_cols=(2, 3))}
    if "Bosses" in bd:
        tables["bosses"] = {"title": "Bosses: health & DPS considerations", "source": "bossdamage", "tab": "Bosses",
                            **table_from(bd["Bosses"], 1, 3)}
    if "Comparison" in bh:
        t = table_from(bh["Comparison"], 0, 2)
        # the Info / Graph columns are a single essay cell; keep it out of the table
        keep = [i for i, n in enumerate(t["columns"]) if n not in ("Info", "Graph")]
        t["columns"] = [t["columns"][i] for i in keep]
        t["rows"] = [[r[i] for i in keep] for r in t["rows"]]
        tables["health"] = {"title": "Boss health by power delta", "source": "bosshealth", "tab": "Comparison", **t}
    # per-encounter health breakdowns
    enc = {}
    for name, s in bh.items():
        if name == "Comparison":
            continue
        t = table_from(s, 0, 2)
        enc[name] = {"columns": t["columns"], "rows": t["rows"], "gid": s["gid"]}
    tables["encounters"] = enc
    return tables


# ---------------------------------------------------------------- sheets
def compact_sheet(sh, sheet_id):
    grid = [list(r) for r in sh["grid"]]
    # drop fully empty columns (lots of spacer columns in these books)
    width = max((len(r) for r in grid), default=0)
    covered = set()
    for r0, c0, rs, cs in sh["merges"]:
        for c in range(c0, c0 + cs):
            covered.add(c)
    used = [c for c in range(width) if any(c < len(r) and r[c].strip() for r in grid)]
    keep = sorted(set(used))
    remap = {c: i for i, c in enumerate(keep)}
    new_grid = [[r[c] if c < len(r) else "" for c in keep] for r in grid]
    for r in new_grid:
        while r and r[-1] == "":
            r.pop()
    merges = []
    for r0, c0, rs, cs in sh["merges"]:
        cols = [remap[c] for c in range(c0, c0 + cs) if c in remap]
        if c0 in remap and (rs > 1 or len(cols) > 1):
            merges.append([r0, remap[c0], rs, max(1, len(cols))])
    links = []
    for r, c, text, href in sh["links"]:
        if c in remap:
            links.append([r, remap[c], text, unwrap_link(href, sheet_id)])
    return {"name": sh["name"], "gid": sh["gid"], "grid": new_grid, "merges": merges, "links": links}


def main():
    raw_all = json.loads((DATA / "raw.json").read_text())
    raw = raw_all["sources"]
    out = Collector()
    shared_by_class = {}
    for sh in raw["compendium"]["sheets"]:
        if sh["name"] in ELEMENTS:
            shared = parse_subclass(sh, out)
            if sh["name"] == "Prismatic":
                shared_by_class = shared
        elif sh["name"] in PARSERS:
            PARSERS[sh["name"]](sh, out)

    for e in out.entries:
        text = e["desc"] + "\n" + "\n".join(p["desc"] for p in e.get("pieces", []))
        roles = classify_keywords(text)
        # an entry's own name counts as producing that keyword (e.g. "Jolt" glossary)
        for name, grp, rx in KW_RE:
            if rx.fullmatch(e["name"].strip()):
                roles.setdefault(name, set()).add("produce")
        e["kw"] = {k: sorted(v) for k, v in roles.items()}

    (DATA / "sheets").mkdir(parents=True, exist_ok=True)
    tabs = {}
    for key, src in raw.items():
        sheets = [compact_sheet(s, src["id"]) for s in src["sheets"]]
        (DATA / "sheets" / f"{key}.json").write_text(json.dumps(sheets, ensure_ascii=False, separators=(",", ":")))
        tabs[key] = [{"name": s["name"], "gid": s["gid"], "rows": len(s["grid"])} for s in src["sheets"]]

    tables = build_tables(raw)
    (DATA / "tables.json").write_text(json.dumps(tables, ensure_ascii=False, separators=(",", ":")))

    keyword_meta = [{"name": n, "group": g, "rx": rx} for n, g, rx in KEYWORDS]
    (DATA / "entries.json").write_text(json.dumps(
        {"entries": out.entries, "keywords": keyword_meta, "prismaticShared": shared_by_class},
        ensure_ascii=False, separators=(",", ":")))

    meta = {"fetched": raw_all.get("fetched"), "sources": {}}
    for key, src in raw.items():
        meta["sources"][key] = {**SOURCES[key], "id": src["id"], "title": src["title"], "tabs": tabs[key]}
    (DATA / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))

    counts = {}
    for e in out.entries:
        counts[e["cat"]] = counts.get(e["cat"], 0) + 1
    print(f"{len(out.entries)} entries", counts)


if __name__ == "__main__":
    main()
