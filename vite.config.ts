import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { githubSource, localSource, scan } from "./scanner";

/* Dev-only store: "Save to project" writes data/<system>.json beside the
   seeds, and the app reads those files back on load. Nothing here ships in a
   production build. */
function atlasStore(): Plugin {
  const dir = path.resolve("data");
  const ok = (id: string) => /^[a-z0-9-]{1,40}$/.test(id);
  return {
    name: "atlas-store",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__atlas", (req, res) => {
        res.setHeader("content-type", "application/json");
        if (req.method === "GET" && req.url === "/systems") {
          fs.mkdirSync(dir, { recursive: true });
          const files: Record<string, unknown> = {};
          for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
            try {
              files[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
            } catch {
              /* a half-written or hand-edited file is skipped, not fatal */
            }
          }
          res.end(JSON.stringify(files));
          return;
        }
        const m = req.method === "POST" && /^\/save\/([a-z0-9-]+)$/.exec(req.url ?? "");
        if (m && ok(m[1])) {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            try {
              const system = JSON.parse(body);
              if (!Array.isArray(system.blocks) || !Array.isArray(system.links)) throw new Error("not a system");
              const savedAt = new Date().toISOString();
              fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(path.join(dir, `${m[1]}.json`), JSON.stringify({ savedAt, system }, null, 2));
              res.end(JSON.stringify({ savedAt }));
            } catch (e) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: (e as Error).message }));
            }
          });
          return;
        }
        // Where each project lives: a folder here, a GitHub repository, or both.
        // Read from the folder and its .git/config only; nothing goes over the network.
        if (req.method === "GET" && req.url === "/origins") {
          const base = path.resolve("..");
          const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
          const folders: Record<string, string> = {};
          for (const e of fs.readdirSync(base, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith(".")) folders[slug(e.name)] = path.join(base, e.name);
          // Maps whose id is not their folder's name: data/origins.json, { "<id>": "<folder>" },
          // a path relative to the folder holding this project (or starting with ~).
          try {
            const own = JSON.parse(fs.readFileSync(path.join(dir, "origins.json"), "utf8")) as Record<string, string>;
            for (const [id, p] of Object.entries(own)) folders[id] = path.resolve(base, p.replace(/^~/, process.env.HOME ?? ""));
          } catch {
            /* no overrides */
          }
          const origins: Record<string, "local" | "github" | "both"> = {};
          for (const [id, dir] of Object.entries(folders)) {
            if (!fs.existsSync(dir)) continue;
            let git = "";
            try {
              let gitDir = path.join(dir, ".git");
              // A worktree's .git is a file pointing at the main repository.
              if (fs.statSync(gitDir).isFile()) {
                gitDir = path.resolve(dir, fs.readFileSync(gitDir, "utf8").replace(/^gitdir:\s*/, "").trim());
                const common = path.join(gitDir, "commondir");
                if (fs.existsSync(common)) gitDir = path.resolve(gitDir, fs.readFileSync(common, "utf8").trim());
              }
              git = fs.readFileSync(path.join(gitDir, "config"), "utf8");
            } catch {
              /* no git, or not a repository */
            }
            origins[id] = /github\.com[:/]/.test(git) ? "both" : "local";
          }
          res.end(JSON.stringify(origins));
          return;
        }
        // Folders to import from: the projects beside this one.
        const lm = req.method === "GET" && /^\/ls(\?path=(.*))?$/.exec(req.url ?? "");
        if (lm) {
          const base = lm[2] ? decodeURIComponent(lm[2]).replace(/^~/, process.env.HOME ?? "") : path.resolve("..");
          try {
            const dirs = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules").map((e) => e.name).sort();
            res.end(JSON.stringify({ base, dirs }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: (e as Error).message }));
          }
          return;
        }
        if (req.method === "POST" && req.url === "/scan") {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", async () => {
            try {
              const b = JSON.parse(body) as { source: "local" | "github"; path?: string; repo?: string; branch?: string; token?: string };
              // Atlas reads two kinds of source only: a folder on this computer, or GitHub.
              if (b.source !== "local" && b.source !== "github") throw new Error("Atlas reads a local folder or a GitHub repository, nothing else.");
              const src = b.source === "github" ? await githubSource(String(b.repo ?? ""), b.branch, b.token) : await localSource(String(b.path ?? ""));
              res.end(JSON.stringify({ system: await scan(src) }));
            } catch (e) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: (e as Error).message }));
            }
          });
          return;
        }
        res.statusCode = 404;
        res.end("{}");
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), atlasStore()],
  server: {
    port: 4520,
    strictPort: true,
    // George's voice: the local Kokoro server, reached through the dev server so the
    // browser needs no CORS. Without it the app falls back to the browser's own voices.
    proxy: { "/__kokoro": { target: "http://127.0.0.1:8880", changeOrigin: true, rewrite: (p) => p.replace(/^\/__kokoro/, "") } },
  },
});
