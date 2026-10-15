# fuzzy-eureka-d2-data

A static Destiny 2 wiki built from five community spreadsheets and Bungie's own item data, searchable and cross-referenced. The numbers belong to the original authors; this repo only re-arranges them.

## Credits

| Source | Author | Link |
| --- | --- | --- |
| Destiny Data Compendium | Destiny Data Compendium (Discord: destinydatacompendium) · [Patreon](https://www.patreon.com/DataCompendium) | [sheet](https://docs.google.com/spreadsheets/d/1WaxvbLx7UoSZaBqdFr1u32F2uWVLo-CJunJB4nlGUE4/edit) |
| Destiny 2: Endgame Analysis | TheAegisRelic (Discord: @theaegisrelic) | [sheet](https://docs.google.com/spreadsheets/d/1JM-0SlxVDAi-C6rGVlLxa-J1WGewEeL8Qvq4htWZHhY/edit) |
| Destiny 2: Boss Damage | TheAegisRelic (Discord: @theaegisrelic) | [sheet](https://docs.google.com/spreadsheets/d/1_5wtBjRYHHxuF4oJKDb_iOGZs-wTkzB6RYbnyNLbuz4/edit) |
| Destiny 2 Damage Buffs/Debuffs (stacking guide) | Court (@CourtProjects) · [Ko-fi](https://ko-fi.com/courtprojects) · [Patreon](https://www.patreon.com/c/CourtProjects) | [sheet](https://docs.google.com/spreadsheets/d/1i1KUwgVkd8qhwYj481gkV9sZNJQCE-C3Q-dpQutPCi4/edit) |
| Destiny 2 API item manifest | Bungie | [bungie.net](https://www.bungie.net/Platform/Destiny2/Manifest/) |
| Destiny 2: Boss Health (Monument of Triumph) | TheAegisRelic | [sheet](https://docs.google.com/spreadsheets/d/1bNyhSpJoFOV_yhGL45eFVs9MEzheqJ6Mk0cGyrwPufc/edit) |

Unofficial fan project, not affiliated with Bungie or the spreadsheet authors.

## What's in the site

- **Home**: search plus buttons into every section of the wiki.
- **Wiki pages**: every Compendium entry (exotic armor, aspects, fragments, abilities, mods, set bonuses, weapon traits…) has its own page with exact values, its Endgame Analysis rating where there is one, keywords, and links to related pages. Weapon trait pages list every weapon that can roll them. Each seasonal artifact has its own page with its perks by column.
- **Weapons**: every legendary and exotic weapon from Bungie's manifest, each with its own page showing every perk it can roll (like light.gg), base stats, the Endgame Analysis tier, suggested roll and Aegis's note on it, the matching archetype test results, and other strong perks it can roll.
- **Explore**: one searchable list of everything, filterable by element, class, category and effect keyword, with a preview panel that links to the full page.
- **Archetypes**: Endgame Analysis's archetype testing (damage, RPM, minor and boss DPS by frame) and every weapon type's full ranking list, laid out like the sheet. Each archetype shows an example weapon from Bungie's data and its intrinsic champion stun (Bungie's Barrier / Overload / Unstoppable icons).
- **Buff stacking**: Court's damage-stacking guide as one box per category (Global Debuffs, Empowering Buffs, Weapon Surges, Amplification, Exotic intrinsics, Weapon perks, World & Activity), every source with PvE/PvP values, and a stack calculator that multiplies your picks and keeps only the strongest Debuff, Empowering buff and Surge.
- **Boss data**: sortable boss health, weapon and ability damage, sustained and swap DPS tables, plus per-encounter health breakdowns.

## Layout

```
index.html, assets/        the site (vanilla JS, no build step)
data/raw.json              every tab as a grid (from the fetcher)
data/entries.json          structured entries + keyword list
data/tables.json           boss tables
data/bungie-weapons.json   weapons + perk pools from Bungie's manifest (tools/bungie-weapons.mjs)
data/weapons.json          Bungie weapons merged with Endgame tiers, rolls and summaries
data/raw-endgame.json      Endgame Analysis tabs (until the next full fetch puts them in raw.json)
data/meta.json             credits + tab list + fetch date
data/stacking.json         Court's stacking guide, parsed into categories and sources
data/raw-court.json        Court's guide as scraped (until the next full fetch puts it in raw.json)
tools/sources.json         which spreadsheets to pull, with author info
tools/archetype-stuns.json each archetype's champion stun (the sheet shows these as icons, which the text scrape can't read)
tools/fetch_sheets.py      pulls the public htmlview pages into data/raw.json
tools/build_data.py        raw.json -> everything else in data/
tools/build-dist.mjs       copies the live site into dist/ for deploys
tools/update-data.workflow.yml  weekly refresh workflow; move it to .github/workflows/ to enable
```

## npm scripts

```
npm install            # once
npm run dev            # http://localhost:5173, reloads the page when you edit files
npm start              # serve the site at http://localhost:8080
npm run data           # re-pull the Google Sheets and rebuild data/ (needs Python 3)
npm run data:rebuild   # rebuild data/ from the existing raw.json
npm run data:bungie    # re-pull weapons from Bungie's manifest, then rebuild
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

## Weapon notes

Each weapon's description is Aegis's own note from Endgame Analysis, unedited. "Why these perks" shows each suggested perk's Endgame rating with its trigger and effect, and "Other strong perks" lists anything else in the weapon's pool rated A or better.
