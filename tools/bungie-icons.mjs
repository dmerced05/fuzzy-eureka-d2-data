#!/usr/bin/env node
// Pulls ability/aspect/exotic-armor icons and raid/dungeon artwork from Bungie's manifest
// into data/icons.json, so the boss tables can show pictures.
//
//   node tools/bungie-icons.mjs
//
// extractIcons() stays plain JS so I can also run it in a browser tab.

export const ICON_COMPONENTS = ["DestinyInventoryItemDefinition", "DestinyActivityDefinition"];

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
  return { version, generated: new Date().toISOString(), abilities, armor, activities };
}

// ---------------------------------------------------------------- CLI (Node only)
const isMain = typeof process !== "undefined" && process.argv?.[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const { writeFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const headers = process.env.BUNGIE_API_KEY ? { "X-API-Key": process.env.BUNGIE_API_KEY } : {};
  const manifest = await (await fetch("https://www.bungie.net/Platform/Destiny2/Manifest/", { headers })).json();
  const paths = manifest.Response.jsonWorldComponentContentPaths.en;
  const m = {};
  for (const k of ICON_COMPONENTS) m[k] = await (await fetch(`https://www.bungie.net${paths[k]}`)).json();
  const out = extractIcons(m, manifest.Response.version);
  writeFileSync(join(root, "data", "icons.json"), JSON.stringify(out));
  console.log(`${Object.keys(out.abilities).length} abilities, ${Object.keys(out.armor).length} armor, ${Object.keys(out.activities).length} activities`);
}
