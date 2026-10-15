#!/usr/bin/env node
// Pulls every legendary + exotic weapon (with full perk pools) from Bungie's public manifest
// into data/bungie-weapons.json. No API key needed for the manifest files.
//
//   node tools/bungie-weapons.mjs
//
// extractWeapons() is plain JS on purpose: I also run it in a browser tab when my
// shell can't reach bungie.net, so keep it free of Node-only APIs.

export const COMPONENTS = [
  "DestinyInventoryItemDefinition", "DestinyPlugSetDefinition", "DestinySocketCategoryDefinition",
  "DestinyDamageTypeDefinition", "DestinyStatDefinition", "DestinyStatGroupDefinition",
  "DestinyCollectibleDefinition", "DestinyEquipmentSlotDefinition",
];

export function extractWeapons(m, version) {
  const I = m.DestinyInventoryItemDefinition;
  const P = m.DestinyPlugSetDefinition;
  const SC = m.DestinySocketCategoryDefinition;
  const DMG = m.DestinyDamageTypeDefinition;
  const ST = m.DestinyStatDefinition;
  const SG = m.DestinyStatGroupDefinition;
  const COL = m.DestinyCollectibleDefinition;
  const SLOT = m.DestinyEquipmentSlotDefinition;
  const DUMMY = 3109687656;
  const AMMO = { 1: "Primary", 2: "Special", 3: "Heavy" };
  // which plug categories count as a "perk column" on a weapon page
  const COLUMN_CATS = /^(barrels|magazines|magazines_gl|frames|origins|scopes|arrows|bowstrings|batteries|blades|guards|hafts|stocks|tubes|grips|launcher.*|.*_barrels?|exotic\.catalysts?|catalysts|intrinsics)$/;

  const perks = {};
  const statNames = {};
  const keepPerk = (hash) => {
    const p = I[hash];
    if (!p) return false;
    if (!perks[hash]) {
      const stats = (p.investmentStats || []).filter((s) => s.value && ST[s.statTypeHash]?.displayProperties?.name)
        .map((s) => { statNames[s.statTypeHash] = ST[s.statTypeHash].displayProperties.name; return [s.statTypeHash, s.value]; });
      perks[hash] = {
        n: p.displayProperties?.name || "",
        d: p.displayProperties?.description || (p.perks || []).map((pk) => I[pk.perkHash]?.displayProperties?.description).filter(Boolean).join("\n") || "",
        i: p.displayProperties?.icon || "",
        t: p.itemTypeDisplayName || "",
        ...(stats.length ? { s: stats } : {}),
        ...(/enhanced/i.test(p.itemTypeDisplayName || "") || p.inventory?.tierType === 3 && /trait/i.test(p.itemTypeDisplayName || "") ? { e: 1 } : {}),
      };
    }
    return true;
  };

  const sockCatName = (h) => SC[h]?.displayProperties?.name || "";
  const all = [];
  for (const item of Object.values(I)) {
    if (item.itemType !== 3 || item.redacted || !item.displayProperties?.name) continue;
    const tier = item.inventory?.tierTypeName;
    if (tier !== "Legendary" && tier !== "Exotic") continue;
    if ((item.itemCategoryHashes || []).includes(DUMMY) || !item.sockets) continue;

    const cats = item.sockets.socketCategories || [];
    const perkIdx = new Set(cats.filter((c) => /WEAPON PERKS|INTRINSIC TRAITS/.test(sockCatName(c.socketCategoryHash))).flatMap((c) => c.socketIndexes));
    const columns = [];
    let frame = null;
    item.sockets.socketEntries.forEach((entry, idx) => {
      if (!perkIdx.has(idx)) return;
      const set = P[entry.randomizedPlugSetHash] || P[entry.reusablePlugSetHash];
      let plugs = (set?.reusablePlugItems || entry.reusablePlugItems || []).map((p) => ({ h: p.plugItemHash, ok: p.currentlyCanRoll !== false }));
      const init = I[entry.singleInitialItemHash];
      if (init && !plugs.some((p) => p.h === init.hash)) plugs.unshift({ h: init.hash, ok: true });
      plugs = plugs.filter((p) => {
        const def = I[p.h];
        const cat = def?.plug?.plugCategoryIdentifier || "";
        return def?.displayProperties?.name && COLUMN_CATS.test(cat) && !/^empty/i.test(def.displayProperties.name);
      });
      if (!plugs.length) return;
      const cat = I[plugs[0].h].plug.plugCategoryIdentifier;
      if (cat === "intrinsics") {
        frame = plugs[0].h;
        keepPerk(frame);
        return;
      }
      const seen = new Set();
      const live = [], retired = [];
      for (const p of plugs) {
        if (seen.has(p.h)) continue;
        seen.add(p.h);
        keepPerk(p.h);
        (p.ok ? live : retired).push(p.h);
      }
      const types = {};
      plugs.forEach((p) => { const t = I[p.h].itemTypeDisplayName || cat; types[t] = (types[t] || 0) + 1; });
      let label = Object.entries(types).sort((a, b) => b[1] - a[1])[0][0].replace(/^Enhanced /, "");
      if (/trait/i.test(label) && cat === "frames") label = "Trait";
      columns.push({ label, cat, perks: live, ...(retired.length ? { retired } : {}), random: !!entry.randomizedPlugSetHash });
    });
    let traitN = 0;
    columns.forEach((c) => { if (c.label === "Trait") c.label = `Trait ${++traitN}`; });

    // displayed stats, in the order the game shows them
    const group = SG[item.stats?.statGroupHash];
    const order = (group?.scaledStats || []).map((s) => s.statHash);
    const stats = order.map((h) => [h, item.stats?.stats?.[h]?.value]).filter(([h, v]) => v !== undefined && ST[h]?.displayProperties?.name);
    stats.forEach(([h]) => { statNames[h] = ST[h].displayProperties.name; });

    all.push({
      h: item.hash, idx: item.index,
      n: item.displayProperties.name,
      icon: item.displayProperties.icon || "",
      shot: item.screenshot || "",
      wm: item.iconWatermark || "",
      flavor: item.flavorText || "",
      type: item.itemTypeDisplayName || "",
      tier,
      el: DMG[item.defaultDamageTypeHash]?.displayProperties?.name || "",
      ammo: AMMO[item.equippingBlock?.ammoType] || "",
      slot: (SLOT[item.equippingBlock?.equipmentSlotTypeHash]?.displayProperties?.name || "").replace(/ Weapons$/, ""),
      frame: frame ? perks[frame].n : "",
      frameHash: frame || undefined,
      src: (COL[item.collectibleHash]?.sourceString || "").replace(/^Source:\s*/, ""),
      craftable: !!item.inventory?.recipeItemHash,
      adept: !!item.isAdept || /\((Adept|Timelost|Harrowed)\)/.test(item.displayProperties.name),
      stats,
      cols: columns,
    });
  }

  // one page per weapon name: prefer the non-adept version with the biggest live perk pool, then the newest
  const byName = new Map();
  for (const w of all) {
    const key = w.n.replace(/\s*\((Adept|Timelost|Harrowed|Baroque)\)\s*$/i, "").trim();
    (byName.get(key) || byName.set(key, []).get(key)).push(w);
  }
  const weapons = [];
  for (const [name, list] of byName) {
    const size = (w) => w.cols.reduce((n, c) => n + c.perks.length, 0);
    list.sort((a, b) => (a.adept - b.adept) || size(b) - size(a) || b.idx - a.idx);
    const main = { ...list[0], n: name };
    main.versions = list.length;
    if (list.some((w) => w.adept)) main.hasAdept = true;
    if (list.some((w) => w.craftable)) main.craftable = true;
    delete main.idx;
    if (!main.cols.length && !main.frame) continue;
    weapons.push(main);
  }
  weapons.sort((a, b) => a.n.localeCompare(b.n));

  // drop perks no kept weapon references
  const used = new Set();
  weapons.forEach((w) => { if (w.frameHash) used.add(w.frameHash); w.cols.forEach((c) => [...c.perks, ...(c.retired || [])].forEach((h) => used.add(h))); });
  for (const h of Object.keys(perks)) if (!used.has(+h)) delete perks[h];

  return { version, generated: new Date().toISOString(), statNames, perks, weapons };
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
  for (const k of COMPONENTS) {
    process.stdout.write(`fetching ${k}… `);
    m[k] = await (await fetch(`https://www.bungie.net${paths[k]}`)).json();
    console.log(Object.keys(m[k]).length);
  }
  const out = extractWeapons(m, manifest.Response.version);
  writeFileSync(join(root, "data", "bungie-weapons.json"), JSON.stringify(out));
  console.log(`${out.weapons.length} weapons, ${Object.keys(out.perks).length} perks`);
}
