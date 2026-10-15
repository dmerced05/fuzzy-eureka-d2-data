# fuzzy-eureka-d2-data

A static site that makes four community Destiny 2 spreadsheets searchable and cross-referenced, with a build planner that shows which pieces feed each other. The numbers belong to the original authors; this repo only re-arranges them.

## Credits

| Source | Author | Link |
| --- | --- | --- |
| Destiny Data Compendium | Destiny Data Compendium (Discord: destinydatacompendium) · [Patreon](https://www.patreon.com/DataCompendium) | [sheet](https://docs.google.com/spreadsheets/d/1WaxvbLx7UoSZaBqdFr1u32F2uWVLo-CJunJB4nlGUE4/edit) |
| Destiny 2: Endgame Analysis | TheAegisRelic (Discord: @theaegisrelic) | [sheet](https://docs.google.com/spreadsheets/d/1JM-0SlxVDAi-C6rGVlLxa-J1WGewEeL8Qvq4htWZHhY/edit) |
| Destiny 2: Boss Damage | TheAegisRelic (Discord: @theaegisrelic) | [sheet](https://docs.google.com/spreadsheets/d/1_5wtBjRYHHxuF4oJKDb_iOGZs-wTkzB6RYbnyNLbuz4/edit) |
| Destiny 2: Boss Health (Monument of Triumph) | TheAegisRelic | [sheet](https://docs.google.com/spreadsheets/d/1bNyhSpJoFOV_yhGL45eFVs9MEzheqJ6Mk0cGyrwPufc/edit) |

Unofficial fan project, not affiliated with Bungie or the spreadsheet authors.

## What's in the site

- **Home**: search plus one-click buttons for exotic weapons, exotic armor, aspects, fragments, mods, legendary weapons, boss data and more.
- **Explore**: ~1,440 Compendium entries with filters by element, class, category and effect keyword (Jolt, Devour, Orbs of Power…). Where Endgame Analysis rates an entry, its tier, trigger, effect and notes show alongside the exact values.
- **Weapons**: all 748 legendary weapons from Endgame Analysis, ranked within each type with recommended perks and origin traits (perks link to their Compendium values), plus exotic weapon ratings.
- **Build**: pick class, subclass and gear; the synergy web lines up what each piece makes against what other pieces need. Builds save locally and share by link.
- **Boss data**: sortable boss health, weapon and ability damage, sustained and swap DPS tables, plus per-encounter health breakdowns.

## Layout

```
index.html, assets/        the site (vanilla JS, no build step)
data/raw.json              every tab as a grid (from the fetcher)
data/entries.json          structured entries + keyword list
data/tables.json           boss tables
data/weapons.json          legendary weapons + exotic ratings (Endgame Analysis)
data/raw-endgame.json      Endgame Analysis tabs (until the next full fetch puts them in raw.json)
data/meta.json             credits + tab list + fetch date
tools/sources.json         which spreadsheets to pull, with author info
tools/fetch_sheets.py      pulls the public htmlview pages into data/raw.json
tools/build_data.py        raw.json -> everything else in data/
tools/build-dist.mjs       copies the live site into dist/ for deploys
tools/update-data.workflow.yml  weekly refresh workflow; move it to .github/workflows/ to enable
```

## npm scripts

```
npm install            # once
npm start              # serve the site at http://localhost:8080
npm run data           # re-pull the Google Sheets and rebuild data/ (needs Python 3)
npm run data:rebuild   # rebuild data/ from the existing raw.json
npm run preview        # build dist/ and serve it the way Pages will
npm run deploy         # build dist/ and push it to the gh-pages branch
```

Opening `index.html` straight from disk won't work because the page fetches the JSON files.

## Publishing on GitHub Pages

1. `npm run deploy` (pushes `dist/` to the `gh-pages` branch with your normal git credentials).
2. First time only: Settings → Pages → Deploy from a branch → `gh-pages` / root.
3. The site appears at `https://<user>.github.io/fuzzy-eureka-d2-data/`.

## Updating the data

`npm run data`, then `npm run deploy`. Once `tools/update-data.workflow.yml` is moved to `.github/workflows/update-data.yml`, a GitHub Action also refreshes `data/` on `main` every Wednesday (run `npm run deploy` afterwards to publish it). If a tab changes shape upstream, its parser in `tools/build_data.py` is the one to fix.

## How keyword tagging works

Each entry is tagged with the effects it mentions (Jolt, Scorch, Devour, Orbs of Power, weapon types…). Whether it *makes* or *uses* an effect comes from Endgame Analysis's hand-written Trigger and Effect columns wherever that sheet covers the entry (weapon perks, origin traits, set bonuses, artifact perks, fragments, aspects). Everything else falls back to reading the Compendium text ("grants", "inflicts" vs "while", "on … kill"), which is good but not perfect.
