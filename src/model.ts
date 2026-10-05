/* Atlas data model. A System is a set of logic blocks (apps, clouds, stores,
   services) and the labelled wires between them. Everything the canvas draws
   and the panel edits lives here, so a system can be exported as one JSON. */

export type Kind =
  | "web"
  | "desktop"
  | "handset"
  | "supabase"
  | "vercel"
  | "service"
  | "store"
  | "external"
  | "planned";

export type Status = "wired" | "drawn" | "warn";

export type Detail = { label: string; value: string };

export type Block = {
  id: string;
  kind: Kind;
  title: string;
  sub: string;
  lines: string[];
  x: number;
  y: number;
  w: number;
  status: Status;
  details: Detail[];
};


export type LinkMode = "https" | "ws" | "direct" | "ddl";

export type Link = {
  id: string;
  from: string;
  to: string;
  label: string;
  mode: LinkMode;
  /** The reasoning behind this wire: why these two talk, and what travels. */
  why: string;
};

export type System = {
  id: string;
  name: string;
  tagline: string;
  snapshot: string;
  note: string;
  blocks: Block[];
  links: Link[];
  /** Set on maps drafted straight from a GitHub repository. */
  origin?: Origin;
};

export type Origin = "local" | "github" | "both";

/** Where a project lives, as shown in the system picker. */
export const ORIGINS: Record<Origin, { label: string; color: string }> = {
  local: { label: "On this computer", color: "#3ddc97" },
  github: { label: "GitHub repository", color: "#4f8cff" },
  both: { label: "On this computer and GitHub", color: "#a06bff" },
};

export type Tone = "good" | "warn" | "bad" | "info";
export type Change = { at: string; tone: Tone; text: string };

export const KINDS: Record<Kind, { label: string; color: string; symbol: string }> = {
  web: { label: "Site", color: "#4f8cff", symbol: "monitor" },
  desktop: { label: "Desktop", color: "#a06bff", symbol: "tower" },
  handset: { label: "Handset", color: "#2ec4b6", symbol: "phone" },
  supabase: { label: "Supabase", color: "#3ddc97", symbol: "server" },
  vercel: { label: "Vercel", color: "#e6e8eb", symbol: "triangle" },
  service: { label: "Service", color: "#f2b63c", symbol: "gear" },
  store: { label: "Database", color: "#5fd3a5", symbol: "disks" },
  external: { label: "Outside", color: "#c8cdd3", symbol: "globe" },
  planned: { label: "Planned", color: "#f2b63c", symbol: "ghost" },
};

export const STATUS: Record<Status, { label: string; hint: string }> = {
  wired: { label: "Wired", hint: "Real data moves here today" },
  drawn: { label: "Drawn", hint: "Drawn on the map, not connected" },
  warn: { label: "Needs attention", hint: "Working, but something needs fixing" },
};

export const MODES: Record<LinkMode, { label: string; dash: string }> = {
  https: { label: "Web request", dash: "" },
  ws: { label: "Live feed", dash: "6 5" },
  direct: { label: "Direct line", dash: "2 4" },
  ddl: { label: "Admin key", dash: "10 4 2 4" },
};

/** Block height is derived from content so wire anchors and layout agree. */
export function blockHeight(b: Block): number {
  return 46 + (b.sub ? 16 : 0) + b.lines.length * 17;
}

/** One board square in map units: the two views share coordinates through this. */
export const CW = 120;
export const CH = 110;

export function uid(prefix = "b"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ---- wiring rules -------------------------------------------------------
   The game part. A wire that breaks a rule is refused (bad) and buzzes; a
   wire that is legal but carries nothing yet is allowed and flagged (warn).
   Rules encode how these systems actually work: clients never hold a
   database connection, Postgres only pushes through Realtime, and so on. */

export type Problem = { level: "bad" | "warn"; reason: string };

const bad = (reason: string): Problem => ({ level: "bad", reason });
const warn = (reason: string): Problem => ({ level: "warn", reason });

export function checkLink(blocks: Map<string, Block>, l: Link, all: Link[]): Problem | null {
  const a = blocks.get(l.from);
  const b = blocks.get(l.to);
  if (!a || !b) return bad("One end of this wire is gone.");
  if (a.id === b.id) return bad("A piece cannot be wired to itself.");
  if (all.some((o) => o.id !== l.id && o.from === l.from && o.to === l.to && o.mode === l.mode)) {
    return bad(`That wire is already there: ${a.title} to ${b.title} as a ${MODES[l.mode].label.toLowerCase()}.`);
  }
  if (b.kind === "store" && !(a.kind === "supabase" || a.kind === "service" || (a.kind === "web" && l.mode === "direct"))) {
    return bad(`${a.title} cannot open the database on its own. Phones, computers and outside services have to ask the API, or listen to the live feed. Only a server that holds the database password, or the admin path, can go straight in.`);
  }
  if (a.kind === "store" && !(b.kind === "supabase" || b.kind === "service")) {
    return bad("The database never calls anyone. It answers when asked, and its changes go out through the live feed.");
  }
  if ((b.kind === "handset" || b.kind === "desktop") && l.mode !== "ws") {
    return bad(`${b.title} is an app on someone's device. Nothing can call into it; it can only call out. If it needs news, wire the live feed to it instead, or turn this wire around.`);
  }
  if ((a.kind === "handset" || a.kind === "desktop") && (b.kind === "handset" || b.kind === "desktop")) {
    return bad("Apps do not talk to each other directly. Both go through the middle: the server, the API, or the live feed.");
  }
  if (l.mode === "ws" && a.kind !== "supabase") {
    return bad("A live feed can only start at the live-feed piece in Supabase. Start the wire there, or make it a web request.");
  }
  if (l.mode === "ddl" && !(b.kind === "store" && a.kind === "service")) {
    return bad("Only the admin path can change how the database is built, and only straight into the database. That key never goes into an app.");
  }
  if (a.kind === "vercel" && b.kind !== "web") {
    return bad("Vercel's job is to put the website online. It does not call phones, computers or databases.");
  }
  if (a.kind === "external" && !(b.kind === "web" || b.kind === "service")) {
    return bad("An outside service can only call back to a server. Never straight into a phone or the database.");
  }
  if (a.kind === "planned" || b.kind === "planned" || a.status === "drawn" || b.status === "drawn") {
    return warn("One end is only a plan for now, so nothing moves on this wire yet.");
  }
  return null;
}

export function checkAll(system: System): Map<string, Problem> {
  const byId = new Map(system.blocks.map((b) => [b.id, b]));
  const out = new Map<string, Problem>();
  for (const l of system.links) {
    const p = checkLink(byId, l, system.links);
    if (p) out.set(l.id, p);
  }
  return out;
}

/* ---- suggestions --------------------------------------------------------
   Propose the best wiring for the blocks on the board. Each suggestion is a
   full Link with its reasoning; nothing is added until the user accepts it,
   and every acceptance still runs through checkLink. */

const has = (b: Block, ...words: string[]) => {
  const t = `${b.title} ${b.sub} ${b.lines.join(" ")}`.toLowerCase();
  return words.some((w) => t.includes(w));
};
/** A site that also runs server code: it may hold the connection string.
 *  "Next.js" alone is not enough, a static Next site is still a client. */
export const isServer = (b: Block) => b.kind === "web" && has(b, "api", "route", "server", "backend", "handler");

export function suggestLinks(system: System): Link[] {
  const bs = system.blocks.filter((b) => b.kind !== "planned" && b.status !== "drawn");
  const api = bs.filter((b) => b.kind === "supabase" && !has(b, "realtime", "websocket", "storage", "auth"));
  const realtime = bs.filter((b) => b.kind === "supabase" && has(b, "realtime", "websocket"));
  const storage = bs.filter((b) => b.kind === "supabase" && has(b, "storage", "bucket"));
  const stores = bs.filter((b) => b.kind === "store");
  const servers = bs.filter(isServer);
  const clients = bs.filter((b) => b.kind === "handset" || b.kind === "desktop" || (b.kind === "web" && !servers.includes(b)));
  const admins = bs.filter((b) => b.kind === "service");
  const hosts = bs.filter((b) => b.kind === "vercel");
  const outside = bs.filter((b) => b.kind === "external");
  const out: Link[] = [];
  const add = (from: Block, to: Block, mode: LinkMode, label: string, why: string) =>
    out.push({ id: uid("s"), from: from.id, to: to.id, label, mode, why });

  for (const c of clients) {
    for (const a of api) add(c, a, "https", "reads and writes", `${c.title} is a client. It holds only the publishable key, so everything it reads or writes goes through the API under row-level security.`);
    if (api.length === 0) for (const s of servers) add(c, s, "https", "calls the API", `${c.title} never holds a database connection. It calls the routes on ${s.title}, which is the one place with the connection string.`);
    for (const r of realtime) add(r, c, "ws", "row changes", `${c.title} should not poll. Realtime pushes each committed row change over one WebSocket so the screen re-renders within a second.`);
  }
  for (const s of servers) {
    if (api.length === 0) for (const st of stores) add(s, st, "direct", "SQL over the connection string", `${s.title} runs server-side, so it may open Postgres directly with DATABASE_URL. Keep that string out of every client bundle.`);
    for (const a of api) add(s, a, "https", "server-side calls", `${s.title} can also go through the API with a service key when it needs RLS bypassed for one route.`);
    for (const sg of storage) add(s, sg, "https", "uploads", `Files go to Storage from the server with the publishable key, so the client never needs a bucket credential.`);
    for (const o of outside) {
      add(s, o, "https", "calls out", `${s.title} starts the conversation with ${o.title}: checkout, lookups, sends.`);
      add(o, s, "https", "calls back", `${o.title} confirms server to server, into a route on ${s.title}. Nothing is marked done from a browser.`);
    }
    for (const h of hosts) add(h, s, "direct", "deploys", `${h.title} builds and hosts ${s.title} from its git repository.`);
  }
  for (const a of api) for (const st of stores) add(a, st, "direct", "SQL under RLS", `The API turns every HTTPS call into SQL and runs it under row-level security. This is the only door the clients have to Postgres.`);
  for (const st of stores) for (const r of realtime) add(st, r, "direct", "WAL changes", `Realtime reads the write-ahead log for published tables and broadcasts each change. Postgres never calls a client itself.`);
  for (const ad of admins) for (const st of stores) add(ad, st, "ddl", "DDL, migrations, seeds", `Schema changes never go through the app. ${ad.title} connects with the database password and runs migrations, policies and seeds.`);

  const byId = new Map(system.blocks.map((b) => [b.id, b]));
  const seen = new Set(system.links.map((l) => `${l.from}|${l.to}|${l.mode}`));
  return out.filter((l) => {
    const key = `${l.from}|${l.to}|${l.mode}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return checkLink(byId, l, system.links)?.level !== "bad";
  });
}

/* ---- tidy -----------------------------------------------------------------
   Lay the blocks out by role, left to right the way data flows: clients,
   then servers and hosts, then the platform, then stores and admin paths,
   then outside services. Within a lane, rows are ordered so wires cross as
   little as possible (each block sits near the average row of what it talks
   to, swept a few times in both directions). Planned and drawn-only blocks
   line the bottom. */
export const LANES = ["Clients", "Servers · hosting", "Platform", "Data · admin", "Outside"];
export function laneOf(b: Block): number {
  if (b.kind === "handset" || b.kind === "desktop" || (b.kind === "web" && !isServer(b))) return 0;
  if (b.kind === "web" || b.kind === "vercel") return 1;
  if (b.kind === "supabase") return 2;
  if (b.kind === "store" || b.kind === "service") return 3;
  return 4;
}
export function tidy(system: System): Block[] {
  const live = system.blocks.filter((b) => b.kind !== "planned" && b.status !== "drawn");
  const rest = system.blocks.filter((b) => !live.includes(b));
  const lanes: Block[][] = LANES.map(() => []);
  for (const b of [...live].sort((p, q) => p.y - q.y)) lanes[laneOf(b)].push(b);
  const row = new Map<string, number>();
  lanes.forEach((lane) => lane.forEach((b, i) => row.set(b.id, i)));
  const near = (b: Block, side: -1 | 1) =>
    system.links
      .filter((l) => (l.from === b.id || l.to === b.id) && row.has(l.from) && row.has(l.to))
      .map((l) => (l.from === b.id ? l.to : l.from))
      .filter((id) => Math.sign(laneOf(live.find((x) => x.id === id)!) - laneOf(b)) === side)
      .map((id) => row.get(id)!);
  const bary = (b: Block, side: -1 | 1) => {
    const ns = near(b, side);
    return ns.length ? ns.reduce((p, q) => p + q, 0) / ns.length : row.get(b.id)!;
  };
  for (let sweep = 0; sweep < 4; sweep++) {
    const dir: -1 | 1 = sweep % 2 === 0 ? -1 : 1; // look left on even sweeps, right on odd
    const order = dir === -1 ? lanes.map((_, i) => i).slice(1) : lanes.map((_, i) => i).slice(0, -1).reverse();
    for (const li of order) {
      const lane = lanes[li];
      const want = new Map(lane.map((b) => [b.id, bary(b, dir)]));
      lane.sort((p, q) => want.get(p.id)! - want.get(q.id)! || row.get(p.id)! - row.get(q.id)!);
      // keep the order, but let each block sit down at its neighbours' row when that row is free
      let next = 0;
      for (const b of lane) {
        const r = Math.max(next, Math.round(want.get(b.id)!));
        row.set(b.id, r);
        next = r + 1;
      }
    }
  }
  const placed = new Map<string, { x: number; y: number }>();
  let deepest = 0;
  lanes.forEach((lane, li) => lane.forEach((b) => {
    placed.set(b.id, { x: li * 3 * CW, y: row.get(b.id)! * 2 * CH });
    deepest = Math.max(deepest, row.get(b.id)!);
  }));
  const bottom = deepest * 2 + 3;
  rest.forEach((b, i) => placed.set(b.id, { x: i * 3 * CW, y: bottom * CH }));
  return system.blocks.map((b) => ({ ...b, ...placed.get(b.id)! }));
}
