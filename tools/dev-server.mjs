// Tiny dev server: serves the repo on localhost and reloads the page when
// index.html, assets/ or data/ change. No extra packages needed.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { watch } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT) || 5173;
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
};
const clients = new Set();

// injected before </body> so the page reloads itself when files change
const reloadSnippet = `<script>new EventSource("/__reload").onmessage = () => location.reload();</script>`;

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/__reload") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  let file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    let body = await readFile(file);
    if (extname(file) === ".html") body = body.toString().replace("</body>", `${reloadSnippet}</body>`);
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}).listen(port, () => {
  const url = `http://localhost:${port}`;
  console.log(`Dev server running at ${url} (reloads on changes, Ctrl+C to stop)`);
  if (!process.argv.includes("--no-open")) {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    exec(`${cmd} ${url}`);
  }
});

let timer;
for (const dir of ["index.html", "assets", "data"]) {
  watch(join(root, dir), { recursive: true }, (_event, name) => {
    if (name && /raw.*\.json$/.test(name)) return; // the raw dumps aren't loaded by the page
    clearTimeout(timer);
    timer = setTimeout(() => clients.forEach((c) => c.write("data: reload\n\n")), 120);
  });
}
