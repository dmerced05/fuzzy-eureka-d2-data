# fuzzy-eureka-d2-data

A static site that makes three community Destiny 2 spreadsheets searchable and cross-referenced, with a build planner that shows which pieces feed each other. The numbers belong to the original authors; this repo only re-arranges them.

## Credits

| Source | Author | Link |
| --- | --- | --- |
| Destiny Data Compendium | Destiny Data Compendium (Discord: destinydatacompendium) · [Patreon](https://www.patreon.com/DataCompendium) | [sheet](https://docs.google.com/spreadsheets/d/1WaxvbLx7UoSZaBqdFr1u32F2uWVLo-CJunJB4nlGUE4/edit) |
| Destiny 2: Boss Damage | TheAegisRelic (Discord: @theaegisrelic) | [sheet](https://docs.google.com/spreadsheets/d/1_5wtBjRYHHxuF4oJKDb_iOGZs-wTkzB6RYbnyNLbuz4/edit) |
| Destiny 2: Boss Health (Monument of Triumph) | TheAegisRelic | [sheet](https://docs.google.com/spreadsheets/d/1bNyhSpJoFOV_yhGL45eFVs9MEzheqJ6Mk0cGyrwPufc/edit) |

Unofficial fan project, not affiliated with Bungie or the spreadsheet authors.

## What's in the site

- **Explore**: ~1,500 entries (subclass verbs, fragments, aspects, abilities, exotics, armor sets, mods, artifact perks, weapon traits, activity modifiers) with filters by element, class, category and keyword. Each entry lists what it makes/uses and what it works well with.
- **Build**: pick class, subclass and gear; the synergy web lines up producers (e.g. Shock → Jolt) against consumers (Ions, Blinding Jolts) and flags unmet needs. Builds save locally and share by link.
- **Boss data**: sortable/filterable boss health, weapon and ability damage, sustained and swap DPS tables, plus per-encounter health breakdowns.
- **Sheets**: every original tab rendered with its layout, for anything the structured views don't cover.

## Layout

```
index.html, assets/        the site (vanilla JS, no build step)
data/raw.json              every tab as a grid (from the fetcher)
data/entries.json          structured entries + keyword list
data/tables.json           boss tables
data/sheets/*.json         cleaned grids for the sheet viewer
data/meta.json             credits + tab list + fetch date
tools/sources.json         which spreadsheets to pull, with author info
tools/fetch_sheets.py      pulls the public htmlview pages into data/raw.json
tools/build_data.py        raw.json -> everything else in data/
tools/update-data.workflow.yml  weekly refresh workflow; move it to .github/workflows/ to enable
```

## Running locally

```
python -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` straight from disk won't work because the page fetches the JSON files.

## Updating the data

```
python tools/fetch_sheets.py   # needs internet access to docs.google.com
python tools/build_data.py
```

Once `tools/update-data.workflow.yml` is moved to `.github/workflows/update-data.yml`, a GitHub Action does the same every Wednesday and commits any changes; trigger it manually from the Actions tab after a big patch. If a tab changes shape upstream, its parser in `build_data.py` is the one to fix; the sheet viewer keeps working regardless.

## Publishing on GitHub Pages

Settings → Pages → Deploy from a branch → `main` / root.

## How keyword tagging works

`build_data.py` scans each description for effect keywords (Jolt, Scorch, Devour, Orbs of Power, weapon types…) and guesses from the surrounding words whether the entry makes the effect ("grants", "inflicts", "creates") or uses it ("while", "on … kill", "against … enemies"). It's a heuristic: good for spotting combos, not a substitute for reading the text.
