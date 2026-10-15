// Copies only what the live site needs into dist/ (skips raw.json and the Python tools).
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const item of ["index.html", "assets", "data"]) {
  cpSync(join(root, item), join(dist, item), {
    recursive: true,
    filter: (src) => !/(raw(-[a-z]+)?|bungie-weapons)\.json$/.test(src),
  });
}
writeFileSync(join(dist, ".nojekyll"), "");

for (const needed of ["data/entries.json", "data/meta.json", "data/tables.json", "data/weapons.json"]) {
  if (!existsSync(join(dist, needed))) {
    console.error(`Missing ${needed}. Run "npm run data:rebuild" first.`);
    process.exit(1);
  }
}
// cache-busting: GitHub Pages tells browsers to keep files for 10 minutes, so stamp this build's
// content hash onto the script/style URLs and onto <html data-build> (app.js adds it to data fetches)
const hash = createHash("sha1");
for (const dir of ["assets", "data"]) {
  for (const f of readdirSync(join(dist, dir)).sort()) hash.update(f).update(readFileSync(join(dist, dir, f)));
}
const build = hash.digest("hex").slice(0, 10);
const indexPath = join(dist, "index.html");
const html = readFileSync(indexPath, "utf8")
  .replace(/<html([^>]*)>/, `<html$1 data-build="${build}">`)
  .replace(/(assets\/(?:app\.js|style\.css))"/g, `$1?v=${build}"`);
writeFileSync(indexPath, html);

const kb = (p) => Math.round(statSync(join(dist, p)).size / 1024);
console.log(`dist/ ready, build ${build} (entries ${kb("data/entries.json")} KB, tables ${kb("data/tables.json")} KB)`);
