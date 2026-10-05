/* Reads a project's files and drafts an Atlas system from what it finds:
   which apps exist, whether they talk to Supabase, whether there is a server,
   which outside services are called, and how the database gets changed. It
   never reads secret values, only which keys exist. Runs in the dev server
   (Node), for a local folder or a GitHub repository. */
import fs from "node:fs";
import path from "node:path";
import { tidy, type Block, type Kind, type Link, type System } from "./src/model";

export type Source = { name: string; list(): Promise<string[]>; read(p: string): Promise<string> };

const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", ".vercel", "out", "coverage", ".cache", "android", "ios", ".turbo", "public", "data"]);
const CODE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte)$/;
const MAX_FILES = 4000;

export async function localSource(root: string): Promise<Source> {
  const abs = path.resolve(root.replace(/^~/, process.env.HOME ?? ""));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`No folder at ${abs}`);
  const files: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 7 || files.length > MAX_FILES) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") && e.name !== ".env.example" && e.name !== ".env.local" && e.name !== ".vercel") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP.has(e.name) && e.name !== ".vercel") continue;
        if (e.name === ".vercel") {
          files.push(path.relative(abs, full) + "/");
          continue;
        }
        walk(full, depth + 1);
      } else files.push(path.relative(abs, full));
    }
  };
  walk(abs, 0);
  return {
    name: path.basename(abs),
    list: async () => files,
    read: async (p) => {
      const st = fs.statSync(path.join(abs, p));
      return st.size > 400_000 ? "" : fs.readFileSync(path.join(abs, p), "utf8");
    },
  };
}

export async function githubSource(repo: string, branch?: string, token?: string): Promise<Source> {
  const m = /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(repo.trim());
  if (!m) throw new Error("Give the repository as owner/name or its GitHub address.");
  const [, owner, name] = m;
  const h: Record<string, string> = { "user-agent": "atlas-scanner", accept: "application/vnd.github+json" };
  if (token) h.authorization = `Bearer ${token}`;
  const get = async (url: string) => {
    const r = await fetch(url, { headers: h });
    if (!r.ok) throw new Error(`GitHub said ${r.status} for ${url.replace("https://api.github.com", "")}${r.status === 404 ? ". Private repositories need a token." : ""}`);
    return r.json();
  };
  const info = (await get(`https://api.github.com/repos/${owner}/${name}`)) as { default_branch: string };
  const ref = branch || info.default_branch;
  const tree = (await get(`https://api.github.com/repos/${owner}/${name}/git/trees/${ref}?recursive=1`)) as { tree: { path: string; type: string; size?: number }[]; truncated: boolean };
  const files = tree.tree.filter((t) => t.type === "blob" && !t.path.split("/").some((seg) => SKIP.has(seg))).map((t) => t.path);
  const sizes = new Map(tree.tree.map((t) => [t.path, t.size ?? 0]));
  return {
    name,
    list: async () => files,
    read: async (p) => {
      if ((sizes.get(p) ?? 0) > 400_000) return "";
      const r = await fetch(`https://raw.githubusercontent.com/${owner}/${name}/${ref}/${p}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      return r.ok ? r.text() : "";
    },
  };
}

/* ---- what to look for ---------------------------------------------------- */

const OUTSIDE: [RegExp, string, string][] = [
  [/stripe|paystack|ozow|payfast|yoco|peach\.?payments|paygate|snapscan/i, "Payments", "takes the money"],
  [/twilio|clickatell|africastalking|vonage/i, "SMS", "sends text messages"],
  [/sendgrid|resend|mailgun|postmark|nodemailer|brevo/i, "Email", "sends email"],
  [/maptiler|mapbox|maplibre|openrouteservice|osrm|google.*maps|maps\.googleapis/i, "Maps", "map tiles and routes"],
  [/openai|anthropic|@google\/generative|gemini/i, "AI model", "answers questions and writes text"],
  [/thecourierguy|shiplogic|aramex|fastway|pudo|bobgo/i, "Courier", "quotes and books deliveries"],
  [/firebase|onesignal|expo-notifications|web-push/i, "Push notifications", "pings phones"],
  [/cloudinary|uploadthing|imgix|@aws-sdk\/client-s3/i, "File storage", "keeps uploaded files"],
  [/sentry|logrocket|datadog|posthog|mixpanel|amplitude|@vercel\/analytics/i, "Monitoring", "watches errors and usage"],
  [/whatsapp|graph\.facebook|instagram|twitter|x\.com\/i/i, "Social", "social media links"],
];

type Pkg = { dir: string; json: Record<string, unknown>; deps: Set<string>; files: string[] };

const depsOf = (json: Record<string, unknown>) => new Set(Object.keys({ ...(json.dependencies as object), ...(json.devDependencies as object) }));

function kindOf(p: Pkg): Kind {
  const has = (...names: string[]) => names.some((n) => [...p.deps].some((d) => d === n || d.startsWith(n + "/") || d.startsWith("@" + n + "/")));
  if (has("@capacitor/core", "react-native", "expo", "@ionic/react")) return "handset";
  if (has("electron", "@tauri-apps/api")) return "desktop";
  if (has("next", "react", "vite", "svelte", "astro", "vue", "nuxt", "remix", "@remix-run/react", "gatsby")) return "web";
  if (has("express", "fastify", "hono", "koa", "@nestjs/core")) return "service";
  return "service";
}

const label = (p: Pkg, root: boolean) => {
  const name = String(p.json.name ?? (root ? "app" : path.basename(p.dir)));
  return name.replace(/^@[^/]+\//, "").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

export async function scan(src: Source): Promise<System> {
  const files = await src.list();
  const pkgPaths = files.filter((f) => /(^|\/)package\.json$/.test(f) && f.split("/").length <= 3);
  const pkgs: Pkg[] = [];
  for (const pp of pkgPaths) {
    try {
      const json = JSON.parse(await src.read(pp)) as Record<string, unknown>;
      const dir = pp.includes("/") ? pp.slice(0, pp.lastIndexOf("/")) : "";
      const inDir = files.filter((f) => (dir ? f.startsWith(dir + "/") : true) && CODE.test(f));
      if (!json.dependencies && !json.devDependencies) continue;
      pkgs.push({ dir, json, deps: depsOf(json), files: inDir });
    } catch {
      /* a broken package.json is skipped */
    }
  }
  // A root package that only holds workspaces is not an app.
  const apps = pkgs.filter((p) => !(p.dir === "" && pkgs.length > 1 && (p.json.workspaces || [...p.deps].length === 0)));
  if (!apps.length) throw new Error("No package.json with dependencies found. Atlas reads JavaScript and TypeScript projects.");

  // Read the code once, capped, to spot Supabase clients, realtime, servers and outside calls.
  const code = new Map<string, string>();
  const codeFiles = files.filter((f) => CODE.test(f)).slice(0, 600);
  for (const f of codeFiles) code.set(f, await src.read(f));
  const grep = (dir: string, re: RegExp) => [...code.entries()].filter(([f, t]) => (dir ? f.startsWith(dir + "/") : true) && re.test(t)).map(([f]) => f);
  const envKeys = new Set<string>();
  for (const f of files.filter((f) => /(^|\/)\.env(\.example|\.local|\.sample)?$/.test(f))) {
    for (const line of (await src.read(f)).split("\n")) {
      const k = /^\s*([A-Z][A-Z0-9_]+)\s*=/.exec(line)?.[1];
      if (k) envKeys.add(k);
    }
  }
  const migrations = files.filter((f) => /supabase\/migrations\/.*\.sql$/.test(f) || /prisma\/migrations\//.test(f) || /drizzle\/.*\.sql$/.test(f));
  const anySupabase = apps.some((p) => p.deps.has("@supabase/supabase-js") || p.deps.has("@supabase/ssr")) || [...envKeys].some((k) => k.includes("SUPABASE"));
  const anyPg = apps.some((p) => p.deps.has("pg") || p.deps.has("postgres") || p.deps.has("@prisma/client") || p.deps.has("drizzle-orm"));
  const realtimeFiles = grep("", /\.channel\(|postgres_changes|\.on\(\s*["']postgres_changes/);
  const vercel = files.some((f) => /^(\.vercel\/|vercel\.json$)/.test(f)) || apps.some((p) => [...p.deps].some((d) => d.startsWith("@vercel/")));

  const blocks: Block[] = [];
  const links: Link[] = [];
  const id = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "b";
  const mk = (b: Omit<Block, "x" | "y" | "w" | "status" | "details"> & Partial<Block>): Block => {
    const block: Block = { x: 0, y: 0, w: 250, status: "wired", details: [], ...b };
    blocks.push(block);
    return block;
  };
  const wire = (from: string, to: string, labelText: string, mode: Link["mode"], why: string) => {
    if (!links.some((l) => l.from === from && l.to === to && l.mode === mode)) links.push({ id: `l-${id(from)}-${id(to)}-${mode}`, from, to, label: labelText, mode, why });
  };

  // Platform blocks
  const api = anySupabase ? mk({ id: "supabase-api", kind: "supabase", title: "Supabase API", sub: "the middle layer in front of the database", lines: ["answers reads and writes from the apps", [...envKeys].filter((k) => k.includes("SUPABASE")).join(", ") || "keys in the app config"] }) : null;
  const rt = anySupabase && realtimeFiles.length ? mk({ id: "supabase-realtime", kind: "supabase", title: "Realtime · live feed", sub: "pushes database changes out", lines: [`used in ${realtimeFiles.length} file${realtimeFiles.length === 1 ? "" : "s"}`, realtimeFiles.slice(0, 2).join(", ")] }) : null;
  const store = anySupabase || anyPg ? mk({ id: "postgres", kind: "store", title: "Postgres · the database", sub: "where the real data lives", lines: [migrations.length ? `${migrations.length} migration file${migrations.length === 1 ? "" : "s"}` : "no migration files found", anySupabase ? "inside the Supabase project" : "reached with a database password"] }) : null;
  const admin = migrations.length ? mk({ id: "admin-path", kind: "service", title: "Database changes", sub: "the admin path", lines: [`${migrations.length} SQL files in ${migrations[0].split("/").slice(0, -1).join("/")}`, "run by a script with the database password"] }) : null;
  const host = vercel ? mk({ id: "vercel", kind: "vercel", title: "Vercel", sub: "builds and hosts the site", lines: ["deploys on every push"] }) : null;
  if (api && store) wire(api.id, store.id, "reads and writes", "direct", "The Supabase API is the front door to the database; every app request ends up here.");
  if (store && rt) wire(store.id, rt.id, "changes", "direct", "Every change in the database is passed to the live feed so apps hear about it without asking.");
  if (admin && store) wire(admin.id, store.id, "migrations", "ddl", `The SQL files in the project change how the database is built. ${migrations.length} of them were found.`);

  // One block per app package
  for (const p of apps) {
    const kind = kindOf(p);
    const isRoot = p.dir === "";
    const title = label(p, isRoot);
    const serverFiles = kind === "web" ? p.files.filter((f) => /(^|\/)(app|src\/app)\/api\/.*route\.[jt]s$|(^|\/)pages\/api\//.test(f)) : [];
    const serverDeps = [...p.deps].filter((d) => ["express", "fastify", "hono", "koa"].includes(d));
    const server = serverFiles.length > 0 || serverDeps.length > 0;
    const fw = [...p.deps].find((d) => ["next", "vite", "react", "svelte", "astro", "vue", "nuxt", "remix", "expo", "react-native", "electron", "express", "fastify", "hono"].includes(d)) ?? "";
    const lines = [
      [fw, kind === "handset" ? "phone app" : kind === "desktop" ? "desktop app" : server ? "site with server routes" : kind === "web" ? "runs in the browser" : "server"].filter(Boolean).join(" · "),
      server ? `${serverFiles.length || serverDeps.length} server route${serverFiles.length === 1 ? "" : "s"}` : `${p.files.length} code files`,
      isRoot ? "" : p.dir,
    ].filter(Boolean);
    const b = mk({ id: id(`app-${title}`), kind, title, sub: String(p.json.description ?? "").slice(0, 60), lines, details: [{ label: "Folder", value: p.dir || "project root" }, { label: "Framework", value: fw || "plain" }] });
    const usesSb = p.deps.has("@supabase/supabase-js") || p.deps.has("@supabase/ssr");
    const clientFiles = grep(p.dir, /createClient\(|createBrowserClient\(|createServerClient\(/);
    if (usesSb && api) wire(b.id, api.id, "reads and writes", "https", `${title} lists @supabase/supabase-js in package.json${clientFiles.length ? ` and creates the client in ${clientFiles[0]}` : ""}.`);
    if (rt && grep(p.dir, /\.channel\(|postgres_changes/).length) wire(rt.id, b.id, "live updates", "ws", `${title} listens to the live feed, so it hears about changes without asking.`);
    if (server && store && (p.deps.has("pg") || p.deps.has("postgres") || p.deps.has("@prisma/client") || p.deps.has("drizzle-orm"))) wire(b.id, store.id, "server queries", "direct", `${title} has its own server code with a database library, so its routes talk to the database directly.`);
    if (host && kind === "web") wire(host.id, b.id, "deploys", "https", `${title} is a site and the project carries Vercel settings, so Vercel builds and serves it.`);
    // Outside services, from dependencies, code and env key names
    const seen = new Set<string>();
    const hay = [...p.deps].join(" ") + " " + [...envKeys].join(" ") + " " + grep(p.dir, /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i).slice(0, 80).map((f) => (code.get(f) ?? "").match(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi)?.join(" ") ?? "").join(" ");
    for (const [re, name, does] of OUTSIDE) {
      if (!re.test(hay) || seen.has(name)) continue;
      seen.add(name);
      const eid = id(`outside-${name}`);
      if (!blocks.some((x) => x.id === eid)) mk({ id: eid, kind: "external", title: name, sub: does, lines: ["outside service, someone else runs it"] });
      const evidence = [...p.deps].find((d) => re.test(d)) ?? [...envKeys].find((k) => re.test(k)) ?? "a web address in the code";
      wire(b.id, eid, does, "https", `${title} calls this outside service. Evidence: ${evidence}.`);
    }
  }
  if (!blocks.length) throw new Error("Nothing recognisable was found.");

  const sys: System = {
    id: id(`code-${src.name}`),
    name: src.name.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    tagline: "drafted from the code",
    snapshot: new Date().toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
    note: `Drafted by reading the project's files on ${new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}. Every wire says what it was found from. Check it, fix what the code cannot tell, and save.`,
    blocks,
    links,
  };
  sys.blocks = tidy(sys);
  return sys;
}
