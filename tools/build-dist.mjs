// Copies only what the live site needs into dist/ (skips raw.json and the Python tools).
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const item of ["index.html", "assets", "data"]) {
  cpSync(join(root, item), join(dist, item), {
    recursive: true,
    filter: (src) => !/raw(-[a-z]+)?\.json$/.test(src),
  });
}
writeFileSync(join(dist, ".nojekyll"), "");

for (const needed of ["data/entries.json", "data/meta.json", "data/tables.json", "data/weapons.json"]) {
  if (!existsSync(join(dist, needed))) {
    console.error(`Missing ${needed}. Run "npm run data:rebuild" first.`);
    process.exit(1);
  }
}
const kb = (p) => Math.round(statSync(join(dist, p)).size / 1024);
console.log(`dist/ ready (entries ${kb("data/entries.json")} KB, tables ${kb("data/tables.json")} KB)`);
