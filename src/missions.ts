import { isServer, type Block, type Kind, type Problem, type System } from "./model";

/* Play mode: the game layer. Missions are small, concrete things to do on the
   map; each one teaches one idea about how the system works. Progress is kept
   per system in this browser. Nothing here edits the map itself. */

export type Progress = {
  seen: string[]; // pieces clicked
  wires: string[]; // wires clicked
  storyDone: boolean;
  tourDone: boolean;
  refusals: number; // wires Atlas said no to
  tidied: boolean;
  celebrated: string[]; // missions already cheered
};
export const FRESH: Progress = { seen: [], wires: [], storyDone: false, tourDone: false, refusals: 0, tidied: false, celebrated: [] };

export type Mission = {
  id: string;
  title: string;
  hint: string; // how to do it, in plain words
  teaches: string; // the idea behind it
  xp: number;
  build?: boolean; // needs Build mode
  done: boolean;
  progress?: string; // "2 / 3"
};

const client = (b: Block) => b.kind === "handset" || b.kind === "desktop" || (b.kind === "web" && !isServer(b));
const data = (b: Block) => b.kind === "store" || b.kind === "supabase";

export function missionsFor(s: System, problems: Map<string, Problem>, p: Progress): Mission[] {
  const seen = new Set(p.seen.filter((id) => s.blocks.some((b) => b.id === id)));
  const wires = new Set(p.wires.filter((id) => s.links.some((l) => l.id === id)));
  const by = new Map(s.blocks.map((b) => [b.id, b]));
  const troubled = new Set([...s.blocks.filter((b) => b.status === "warn").map((b) => b.id), ...[...problems.keys()]]);
  const pieces = Math.min(3, s.blocks.length);
  const out: Mission[] = [
    { id: "look", title: "Look around", hint: `Click ${pieces} different pieces. Each card tells you what that piece is for.`, teaches: "Every box on the map is one real thing: an app, a server, a database or an outside service.", xp: 20, done: s.blocks.length > 0 && seen.size >= pieces, progress: `${Math.min(seen.size, pieces)} / ${pieces}` },
    { id: "wire", title: "Follow a wire", hint: "Click any line between two pieces.", teaches: "A wire is a conversation. The arrow shows who asks and who answers.", xp: 15, done: wires.size >= 1 },
  ];
  if (s.blocks.some(data)) out.push({ id: "data", title: "Find where the data lives", hint: "Click the piece that keeps the real records.", teaches: "One place holds the truth. Everything else asks it or tells it.", xp: 20, done: [...seen].some((id) => data(by.get(id)!)) });
  if (s.blocks.some(client)) out.push({ id: "front", title: "Find what people touch", hint: "Click a phone, a desktop app or a website people use.", teaches: "Apps can only ask. Nothing on the internet can call into a phone.", xp: 15, done: [...seen].some((id) => client(by.get(id)!)) });
  out.push({ id: "story", title: "Watch the story", hint: "Press Play the story and go through every step to the end.", teaches: "Seen in order, the wires tell one story: a person taps, a request travels, data comes back.", xp: 40, done: p.storyDone });
  if (troubled.size) out.push({ id: "trouble", title: "Spot the trouble", hint: "Click a piece or wire marked red or amber.", teaches: "A map can show problems before they bite: wrong wires, missing keys, things not built yet.", xp: 25, done: [...seen, ...wires].some((id) => troubled.has(id)) });
  out.push({ id: "hear", title: "Hear it explained", hint: "Press Explain and let the voice walk the whole system to the end.", teaches: "If you can hear it told in plain words, you understand it.", xp: 30, done: p.tourDone });
  out.push({ id: "rule", title: "Break a rule", hint: "Switch to Build, click a piece, press Wire, then click a phone or desktop app. Atlas will refuse and say why.", teaches: "Some connections are impossible. Atlas knows the rules so you do not have to.", xp: 25, build: true, done: p.refusals >= 1 });
  out.push({ id: "tidy", title: "Tidy the board", hint: "Switch to Build and press Tidy.", teaches: "Pieces have lanes: people's apps, servers, platform, data, outside. Left to right is the direction things flow.", xp: 10, build: true, done: p.tidied });
  return out;
}

export const LEVELS = [
  { at: 0, name: "Newcomer" },
  { at: 40, name: "Explorer" },
  { at: 90, name: "Navigator" },
  { at: 150, name: "Engineer" },
  { at: 200, name: "Architect" },
];
export function score(missions: Mission[]) {
  const total = missions.reduce((n, m) => n + m.xp, 0);
  const xp = missions.filter((m) => m.done).reduce((n, m) => n + m.xp, 0);
  const idx = LEVELS.reduce((i, l, k) => (xp >= l.at ? k : i), 0);
  const level = LEVELS[idx];
  const next = LEVELS[idx + 1];
  return { xp, total, pct: total ? Math.round((xp / total) * 100) : 0, level: level.name, levelNo: idx + 1, next: next ? next.at - xp : 0 };
}

/** One line per kind, the way you would say it to someone new. */
export const KIND_PLAIN: Record<Kind, string> = {
  web: "A website. Runs in the browser, or on its own server.",
  desktop: "An app installed on a computer.",
  handset: "An app on a phone.",
  supabase: "The middle layer in front of the database. Checks who you are, passes requests through.",
  vercel: "The host. Builds the site and puts it online.",
  service: "The admin door. The only path allowed to change how the database is built.",
  store: "The database. Where the real records live.",
  external: "An outside service someone else runs, like maps or payments.",
  planned: "Not built yet. Just a plan.",
};

/** The piece's health in one word and colour. */
export function health(b: Block, problems: Map<string, Problem>, s: System): { tone: "good" | "warn" | "bad" | "info"; label: string; why?: string } {
  if (b.kind === "planned" || b.status === "drawn") return { tone: "info", label: "Planned", why: "Drawn on the map, not built yet. Nothing moves on its wires." };
  const broken = s.links.filter((l) => (l.from === b.id || l.to === b.id) && problems.get(l.id)?.level === "bad");
  if (broken.length) return { tone: "bad", label: "A wire cannot work", why: problems.get(broken[0].id)?.reason };
  const finding = b.details.find((d) => d.label.toLowerCase().startsWith("finding"))?.value;
  if (b.status === "warn") return { tone: "warn", label: "Needs attention", why: finding };
  return { tone: "good", label: "Working" };
}
