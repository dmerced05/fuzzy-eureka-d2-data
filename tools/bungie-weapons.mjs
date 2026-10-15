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
  "DestinySandboxPerkDefinition", "DestinyObjectiveDefinition",
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
  // anything in a perk socket is a perk column except trackers, empty/crafting sockets and masterworks.
  // (a blocklist, so new column types like the bow rework's rails/bolts show up without code changes)
  const NOT_COLUMN = /trackers|empty|crafting|masterwork|shader|ornament|mod_/;

  const perks = {};
  const statNames = {};
  const keepPerk = (hash) => {
    const p = I[hash];
    if (!p) return false;
    if (!perks[hash]) {
      const stats = (p.investmentStats || []).filter((s) => s.value && !s.isConditionallyActive && ST[s.statTypeHash]?.displayProperties?.name)
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

  // stat groups: how invested stat points turn into the numbers the game shows (e.g. Magazine 65 -> 10 rounds)
  const statGroups = {};
  const keepGroup = (gh) => {
    const g = SG[gh];
    if (!g || statGroups[gh]) return;
    statGroups[gh] = {};
    (g.scaledStats || []).forEach((ss) => {
      statGroups[gh][ss.statHash] = { max: ss.maximumValue ?? 100, t: (ss.displayInterpolation || []).map((x) => [x.value, x.weight]) };
    });
  };
  // shared plug sets for weapon mods and masterworks, curated once and referenced by hash
  const plugSets = {};
  const modSet = (setHash) => {
    if (!setHash || plugSets[setHash]) return setHash;
    const out = [];
    const byName = new Map();
    (P[setHash]?.reusablePlugItems || []).forEach(({ plugItemHash: h }) => {
      const d = I[h];
      const name = d?.displayProperties?.name;
      if (!name || /^Empty/i.test(name) || /mod_empty/.test(d.plug?.plugCategoryIdentifier || "")) return;
      if (!byName.has(name)) { byName.set(name, [h]); out.push(byName.get(name)); }
      else if (byName.get(name).length === 1) byName.get(name).push(h); // second copy = the enhanced/adept version
      keepPerk(h);
    });
    out.forEach((pair) => { if (pair[1]) perks[pair[1]].e = 1; });
    plugSets[setHash] = out;
    return setHash;
  };
  const masterworkSet = (setHash) => {
    if (!setHash || plugSets[setHash]) return setHash;
    // one option per stat: the highest-tier plug ("Masterworked: Range" = +10)
    const best = new Map();
    (P[setHash]?.reusablePlugItems || []).forEach(({ plugItemHash: h }) => {
      const d = I[h];
      const cat = d?.plug?.plugCategoryIdentifier || "";
      if (!/masterworks\.stat\./.test(cat)) return;
      const total = (d.investmentStats || []).filter((x) => !x.isConditionallyActive).reduce((n, x) => n + x.value, 0);
      if (!best.has(cat) || total > best.get(cat).total) best.set(cat, { h, total });
    });
    plugSets[setHash] = [...best.values()].filter((x) => x.total > 0).map(({ h }) => { keepPerk(h); return [h]; });
    return setHash;
  };
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
        return def?.displayProperties?.name && cat && !NOT_COLUMN.test(cat) && !/^empty/i.test(def.displayProperties.name);
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

    // weapon mod and masterwork sockets
    let mods, mw;
    item.sockets.socketEntries.forEach((entry) => {
      const set = entry.reusablePlugSetHash || entry.randomizedPlugSetHash;
      const initCat = I[entry.singleInitialItemHash]?.plug?.plugCategoryIdentifier || "";
      const firstCat = I[P[set]?.reusablePlugItems?.[0]?.plugItemHash]?.plug?.plugCategoryIdentifier || "";
      if (/weapon\.mod_empty/.test(initCat) && P[set]) mods = modSet(set);
      else if (/masterworks\.stat\./.test(initCat + " " + firstCat) && P[set]) mw = masterworkSet(set);
    });
    keepGroup(item.stats?.statGroupHash);
    const inv = (item.investmentStats || []).filter((x) => x.value && !x.isConditionallyActive).map((x) => [x.statTypeHash, x.value]);

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
      inv, sg: item.stats?.statGroupHash,
      ...(mods ? { mods } : {}), ...(mw ? { mw } : {}),
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
  attachCatalysts(m, weapons, perks, statNames);

  // drop perks no kept weapon references
  const used = new Set();
  weapons.forEach((w) => { if (w.frameHash) used.add(w.frameHash); w.cols.forEach((c) => [...c.perks, ...(c.retired || [])].forEach((h) => used.add(h))); });
  Object.values(plugSets).forEach((list) => list.flat().forEach((h) => used.add(h)));
  const usedGroups = new Set(weapons.map((w) => String(w.sg)));
  for (const g of Object.keys(statGroups)) if (!usedGroups.has(g)) delete statGroups[g];
  for (const h of Object.keys(perks)) if (!used.has(+h)) delete perks[h];

  return { version, generated: new Date().toISOString(), statNames, statGroups, plugSets, perks, weapons };
}

// Exotic catalysts. Most live as their own "<Weapon> Catalyst" mod items (the weapon itself only has an
// empty catalyst socket); newer craftable-style exotics instead roll the catalyst perk in a perk column.
// Either way it ends up on w.catalyst, and a catalyst perk column is moved out of w.cols.
export function attachCatalysts(m, weapons, perks, statNames) {
  const I = m.DestinyInventoryItemDefinition;
  const SP = m.DestinySandboxPerkDefinition || {};
  const OB = m.DestinyObjectiveDefinition || {};
  const ST = m.DestinyStatDefinition;
  const key = (n) => (n || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/^the /, "").replace(/[^a-z0-9]+/g, "");
  const items = Object.values(I).filter((x) => x.itemType === 19 && !x.redacted && / Catalyst$/.test(x.displayProperties?.name || "") &&
    /masterwork/.test(x.plug?.plugCategoryIdentifier || ""));
  const fromItem = (c) => {
    const [, ...rest] = (c.displayProperties.description || "").split(/\n\n/);
    const stats = (c.investmentStats || []).filter((x) => x.value && !x.isConditionallyActive && ST[x.statTypeHash]?.displayProperties?.name)
      .map((x) => { statNames[x.statTypeHash] = ST[x.statTypeHash].displayProperties.name; return [x.statTypeHash, x.value]; });
    return {
      n: c.displayProperties.name,
      i: c.displayProperties.icon || "",
      perks: (c.perks || []).map((p) => SP[p.perkHash]?.displayProperties).filter((d) => d?.name)
        .map((d) => ({ n: d.name, d: d.description || "", i: d.icon || "" })),
      ...(stats.length ? { s: stats } : {}),
      ...(rest.join("\n\n").trim() ? { unlock: rest.join("\n\n").trim() } : {}),
      obj: (c.objectives?.objectiveHashes || []).map((h) => OB[h]).filter(Boolean)
        .map((o) => [o.progressDescription || "", o.completionValue || 0]),
    };
  };
  const byKey = items.map((c) => [key(c.displayProperties.name.replace(/ Catalyst$/, "")), c]);
  let n = 0;
  for (const w of weapons) {
    if (w.tier !== "Exotic") continue;
    const k = key(w.n);
    // exact name first, then a shortened one ("Whisper Catalyst" -> Whisper of the Worm), longest wins
    const hit = byKey.find(([ck]) => ck === k) || byKey.filter(([ck]) => ck.length >= 5 && k.includes(ck)).sort((a, b) => b[0].length - a[0].length)[0];
    const col = w.cols.find((c) => /catalyst/i.test(c.cat));
    if (hit) w.catalyst = fromItem(hit[1]);
    if (col) {
      const colPerks = col.perks.map((h) => perks[h]).filter((p) => p && !p.e);
      if (!w.catalyst) w.catalyst = { n: `${w.n} Catalyst`, i: colPerks[0]?.i || "", perks: [], obj: [] };
      const have = new Set(w.catalyst.perks.map((p) => key(p.n)));
      colPerks.forEach((p) => { if (!have.has(key(p.n))) w.catalyst.perks.push({ n: p.n, d: p.d, i: p.i }); });
      if (!hit) w.catalyst.inPerks = true; // rolls/crafts like a perk rather than unlocking through an objective
      w.cols = w.cols.filter((c) => c !== col);
    }
    if (w.catalyst) n++;
  }
  return n;
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
