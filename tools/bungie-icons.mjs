#!/usr/bin/env node
// Pulls ability/aspect/exotic-armor icons and raid/dungeon artwork from Bungie's manifest
// into data/icons.json, so the boss tables can show pictures.
//
//   node tools/bungie-icons.mjs
//
// extractIcons() stays plain JS so I can also run it in a browser tab.

export const ICON_COMPONENTS = ["DestinyInventoryItemDefinition", "DestinyActivityDefinition",
  "DestinyEquipableItemSetDefinition", "DestinySandboxPerkDefinition"];

export function extractIcons(m, version) {
  const I = m.DestinyInventoryItemDefinition;
  const A = m.DestinyActivityDefinition;
  const KINDS = /\.(supers|grenades|melee|class_abilities|aspects|fragments|movement)$/;
  const abilities = {};
  const armor = {};
  for (const it of Object.values(I)) {
    const name = it.displayProperties?.name;
    const icon = it.displayProperties?.icon;
    if (!name || !icon || it.redacted) continue;
    const cat = it.plug?.plugCategoryIdentifier || "";
    if (KINDS.test(cat)) {
      if (!abilities[name]) abilities[name] = { i: icon, k: cat.split(".").pop() };
    } else if (it.itemType === 2 && it.inventory?.tierTypeName === "Exotic" && !armor[name]) {
      armor[name] = icon;
    }
  }
  // one picture per raid/dungeon: the first real pgcr image under its base name
  const activities = {};
  for (const a of Object.values(A)) {
    const name = (a.displayProperties?.name || a.originalDisplayProperties?.name || "").split(":")[0].trim();
    const img = a.pgcrImage || "";
    if (!name || !img || /missing|default|placeholder/i.test(img)) continue;
    if (!activities[name]) activities[name] = img;
  }
  // armor mods by name (current slot mods win over legacy/deprecated copies)
  const mods = {};
  const modRank = (t) => (/Legacy|Deprecated/.test(t) ? 2 : /Artifice/.test(t) ? 1 : 0);
  for (const it of Object.values(I)) {
    const name = it.displayProperties?.name, icon = it.displayProperties?.icon;
    if (it.itemType !== 19 || !icon || !name || /^Empty/.test(name) || !/^enhancements\./.test(it.plug?.plugCategoryIdentifier || "")) continue;
    const rank = modRank(it.itemTypeDisplayName || "");
    if (!mods[name] || rank < mods[name].r) mods[name] = { i: icon, r: rank };
  }
  Object.values(mods).forEach((x) => delete x.r);
  // armor sets: the 2-/4-piece perk icons and one chest piece per class
  const sets = {};
  const ES = m.DestinyEquipableItemSetDefinition || {};
  const SP = m.DestinySandboxPerkDefinition || {};
  const CLS = { 0: "Titan", 1: "Hunter", 2: "Warlock" };
  for (const st of Object.values(ES)) {
    const name = st.displayProperties?.name;
    if (!name) continue;
    const perks = {};
    (st.setPerks || []).forEach((p) => { const d = SP[p.sandboxPerkHash]?.displayProperties; if (d?.icon) perks[p.requiredSetCount] = { n: d.name, i: d.icon }; });
    const pieces = {};
    (st.setItems || []).map((h) => I[h]).filter(Boolean).forEach((it) => {
      const cls = CLS[it.classType];
      if (!cls || !it.displayProperties?.icon) return;
      // prefer the chest piece, otherwise whatever comes first
      if (!pieces[cls] || /Chest/i.test(it.itemTypeDisplayName || "")) pieces[cls] = { n: it.displayProperties.name, i: it.displayProperties.icon };
    });
    sets[name] = { perks, pieces };
  }
  return { version, generated: new Date().toISOString(), abilities, armor, activities, mods, sets };
}

// ---------------------------------------------------------------- CLI (Node only)
const isMain = typeof process !== "undefined" && process.argv?.[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const { writeFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  // pictures are nice-to-have: if Bungie says no, I keep the old icons.json and let `npm run data` carry on
  try {
    const headers = process.env.BUNGIE_API_KEY ? { "X-API-Key": process.env.BUNGIE_API_KEY } : {};
    const manifest = await (await fetch("https://www.bungie.net/Platform/Destiny2/Manifest/", { headers })).json();
    if (!manifest.Response) throw new Error(`manifest: ${manifest.ErrorStatus || "no response"} ${manifest.Message || ""}`);
    const paths = manifest.Response.jsonWorldComponentContentPaths.en;
    const m = {};
    for (const k of ICON_COMPONENTS) {
      process.stdout.write(`fetching ${k}… `);
      const r = await fetch(`https://www.bungie.net${paths[k]}`);
      if (!r.ok) throw new Error(`${k}: HTTP ${r.status}`);
      m[k] = await r.json();
      console.log(Object.keys(m[k]).length);
    }
    const out = extractIcons(m, manifest.Response.version);
    writeFileSync(join(root, "data", "icons.json"), JSON.stringify(out));
    console.log(`${Object.keys(out.abilities).length} abilities, ${Object.keys(out.armor).length} armor, ${Object.keys(out.activities).length} activities`);
  } catch (err) {
    console.warn(`bungie-icons: couldn't refresh icons (${err.message}); keeping the existing data/icons.json`);
  }
}
