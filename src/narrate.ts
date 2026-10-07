import { STATUS, isServer, type Block, type Link, type LinkMode, type Problem, type System } from "./model";

/* What the voice says. Plain words, short sentences, the way you would explain
   it to a smart seventeen-year-old: no acronyms, no database slang. Every line
   is built from the same model the panel shows, so voice and screen never
   disagree. The panel keeps the technical detail; George keeps it simple. */

const name = (s: System, id: string) => s.blocks.find((b) => b.id === id)?.title ?? "something that is gone";
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Technical words that turn up in notes, swapped for plain ones when spoken. */
const JARGON: [RegExp, string][] = [
  [/\bpostgres_changes\b/gi, "database change alerts"],
  [/\bsubscribes? to\b/gi, "listens for"],
  [/\bsubscription\b/gi, "listener"],
  [/\bpolls?\b|\bpolling\b/gi, "keeps asking"],
  [/\brefetch(es|ed)?\b/gi, "reloads"],
  [/\bre-renders?\b/gi, "redraws"],
  [/\bRLS\b/g, "row rules"],
  [/\brow[- ]level security\b/gi, "row rules"],
  [/\bpolic(y|ies)\b/gi, "access rules"],
  [/\bconnection string\b/gi, "database password"],
  [/\bschema\b/gi, "database layout"],
  [/\bmigrations?\b/gi, "database changes"],
  [/\bDDL\b/g, "database build commands"],
  [/\bpublishable key\b/gi, "public key"],
  [/\bservice[- ]role key\b/gi, "master key"],
  [/\bWebSockets?\b/gi, "live feed"],
  [/\bHTTPS?\b/g, "web request"],
  [/\bPostgREST\b/g, "the API"],
  [/\bPostgres\b/g, "the database"],
  [/\bendpoints?\b/gi, "address"],
  [/\bpayload\b/gi, "data"],
  [/\bJSON\b/g, "data"],
  [/\bRPC\b/g, "function call"],
  [/\bbundle\b/gi, "app code"],
  [/\bCapacitor\b/g, "the phone wrapper"],
  [/\bElectron\b/g, "the desktop wrapper"],
  [/\bpooler\b/gi, "database door"],
  [/\bupsert(s|ed)?\b/gi, "saves"],
  [/\binsert(s|ed)?\b/gi, "adds"],
  [/\bcron\b/gi, "timer"],
  [/\bwebhooks?\b/gi, "callback"],
  [/\bOAuth\b/g, "sign-in with another account"],
  [/\bJWT\b/g, "sign-in token"],
  [/\bCDN\b/g, "fast delivery network"],
  [/\bWAL\b/g, "change log"],
];
export function plain(text: string): string {
  let t = text;
  for (const [re, to] of JARGON) t = t.replace(re, to);
  return t.replace(/\s+/g, " ").replace(new RegExp("\\(([^)]*\\.(jsx?|tsx?|py|sql):\\d+)\\)", "g"), "").trim();
}
const first = (text: string) => plain(text).split(/(?<=[.!?])\s+/)[0] ?? "";

/** The kind of wire, in plain words. */
export const wireKind = (m: LinkMode): string =>
  ({
    https: "an ordinary web request, ask and get an answer",
    ws: "a live feed, a line that stays open so news arrives on its own",
    direct: "a direct line straight into the database",
    ddl: "the admin key, the only thing allowed to change how the database is built",
  })[m];

function role(b: Block): string {
  switch (b.kind) {
    case "handset": return "an app on a phone. It can ask for things, but nothing can call into it";
    case "desktop": return "an app on a computer. Same rule: it asks, it never gets called";
    case "web": return isServer(b) ? "a website with its own server, so it is allowed to keep the database password" : "a website that runs in the browser, so it is just another app asking for things";
    case "supabase": return "part of Supabase, the middle layer that sits in front of the database";
    case "vercel": return "the host that builds the website and puts it online";
    case "service": return "the admin path, the one door that can change how the database is built";
    case "store": return "the database, where the real data lives";
    case "external": return "an outside service that someone else runs";
    case "planned": return "planned, not built yet";
  }
}

export function describeBlock(s: System, b: Block, problems: Map<string, Problem>): string {
  const out = s.links.filter((l) => l.from === b.id);
  const inn = s.links.filter((l) => l.to === b.id);
  const parts: string[] = [];
  parts.push(`${b.title} is ${role(b)}.`);
  parts.push(`${b.sub ? `${plain(b.sub)}. ` : ""}${STATUS[b.status].hint}.`);
  if (b.lines.length) parts.push(plain(b.lines.slice(0, 2).join(". ")) + ".");
  if (out.length) parts.push(`It sends to ${out.map((l) => name(s, l.to)).join(" and ")}.`);
  if (inn.length) parts.push(`It gets things from ${inn.map((l) => name(s, l.from)).join(" and ")}.`);
  if (!out.length && !inn.length) parts.push("Nothing is wired to it yet.");
  const finding = b.details.find((d) => d.label.toLowerCase().startsWith("finding"));
  if (finding) parts.push(`Something to fix: ${first(finding.value)}`);
  const broken = [...out, ...inn].filter((l) => problems.get(l.id)?.level === "bad");
  if (broken.length) parts.push(`${n(broken.length, "wire")} on it cannot work.`);
  return parts.join(" ");
}

/** A wire in one breath: who, what, how, and the first sentence of why. */
export function describeLink(s: System, l: Link, p?: Problem): string {
  const what = l.label ? `sends "${l.label}" to` : "is wired to";
  const head = `${name(s, l.from)} ${what} ${name(s, l.to)}. This is ${wireKind(l.mode)}.`;
  const why = l.why ? first(l.why) : "Nobody has written down why yet.";
  const tail = p ? (p.level === "bad" ? ` This one cannot work. ${p.reason}` : ` One thing: ${p.reason}`) : "";
  return `${head} ${why}${tail}`;
}

export function describeProblem(p: Problem): string {
  return p.level === "bad" ? `No. ${p.reason}` : `Okay, but: ${p.reason}`;
}

/** Wires in the order data flows: apps first, then servers, the platform, the database, and outside. */
function flowOrder(s: System): Link[] {
  const rank = (b: Block | undefined) => {
    if (!b) return 9;
    if (b.kind === "handset" || b.kind === "desktop" || (b.kind === "web" && !isServer(b))) return 0;
    if (b.kind === "web" || b.kind === "vercel") return 1;
    if (b.kind === "supabase") return 2;
    if (b.kind === "store") return 3;
    if (b.kind === "service") return 4;
    return 5;
  };
  const by = new Map(s.blocks.map((b) => [b.id, b]));
  return [...s.links].sort((a, b) => rank(by.get(a.from)) - rank(by.get(b.from)) || rank(by.get(a.to)) - rank(by.get(b.to)));
}

export type Step = { sel: { type: "block" | "link"; id: string } | null; text: string };

/** The guided tour: what it is, the main pieces, every wire in the order things flow, then what needs fixing. */
export function tour(s: System, problems: Map<string, Problem>): Step[] {
  const steps: Step[] = [];
  const apps = s.blocks.filter((b) => ["web", "desktop", "handset"].includes(b.kind)).length;
  const bad = [...problems.values()].filter((p) => p.level === "bad").length;
  const attention = s.blocks.filter((b) => b.status === "warn");
  steps.push({
    sel: null,
    text: `This is ${s.name}. ${plain(s.tagline)}. ${plain(s.note)} It has ${n(apps, "app")}, ${n(s.blocks.length, "piece")} in all, and ${n(s.links.length, "wire")} between them${bad ? `, ${n(bad, "wire")} that cannot work` : ""}. I will go through the main pieces, then every wire.`,
  });
  const roles = s.blocks.filter((b) => b.kind !== "planned" && b.status !== "drawn");
  for (const b of roles.filter((b) => b.kind === "store" || b.kind === "supabase" || isServer(b))) {
    steps.push({ sel: { type: "block", id: b.id }, text: `${b.title} is ${role(b)}. ${plain(b.lines.slice(0, 2).join(". "))}.` });
  }
  steps.push({ sel: null, text: "Now the wires, in the order things happen." });
  for (const l of flowOrder(s)) steps.push({ sel: { type: "link", id: l.id }, text: describeLink(s, l, problems.get(l.id)) });
  if (attention.length) {
    steps.push({ sel: null, text: `Now, what needs fixing. ${n(attention.length, "piece")}.` });
    for (const b of attention) {
      const f = b.details.find((d) => d.label.toLowerCase().startsWith("finding"))?.value;
      steps.push({ sel: { type: "block", id: b.id }, text: `${b.title}: ${f ? first(f) : "flagged, but nobody has written down why yet."}` });
    }
  }
  const planned = s.blocks.filter((b) => b.kind === "planned" || b.status === "drawn");
  if (planned.length) steps.push({ sel: null, text: `Still just plans: ${planned.map((b) => b.title).join(", ")}. Nothing moves on their wires yet.` });
  steps.push({ sel: null, text: bad ? `That is the whole system. ${n(bad, "wire")} to fix before it all works.` : "That is the whole system. Every wire on it follows the rules." });
  return steps;
}

/** The same walk as the tour, cut into cards for the Story player: a short title per step, so you can go back and forward at your own pace. */
export type StoryStep = Step & { kicker: string; title: string };
export function story(s: System, problems: Map<string, Problem>): StoryStep[] {
  const out: StoryStep[] = [];
  const apps = s.blocks.filter((b) => ["web", "desktop", "handset"].includes(b.kind)).length;
  out.push({ sel: null, kicker: "Start", title: `This is ${s.name}`, text: `${plain(s.tagline)}. ${plain(s.note)} ${n(apps, "app")}, ${n(s.blocks.length, "piece")} and ${n(s.links.length, "wire")}. Press Next and we go through it one step at a time.` });
  const roles = s.blocks.filter((b) => b.kind !== "planned" && b.status !== "drawn");
  for (const b of roles.filter((b) => b.kind === "store" || b.kind === "supabase" || isServer(b))) {
    out.push({ sel: { type: "block", id: b.id }, kicker: "A main piece", title: b.title, text: `${b.title} is ${role(b)}. ${plain(b.lines.slice(0, 2).join(". "))}.` });
  }
  const wires = flowOrder(s);
  wires.forEach((l, i) => {
    const p = problems.get(l.id);
    out.push({ sel: { type: "link", id: l.id }, kicker: `Wire ${i + 1} of ${wires.length}`, title: `${name(s, l.from)} → ${name(s, l.to)}`, text: describeLink(s, l, p) });
  });
  const attention = s.blocks.filter((b) => b.status === "warn");
  for (const b of attention) {
    const f = b.details.find((d) => d.label.toLowerCase().startsWith("finding"))?.value;
    out.push({ sel: { type: "block", id: b.id }, kicker: "Needs fixing", title: b.title, text: f ? plain(f) : "Flagged, but nobody has written down why yet." });
  }
  const planned = s.blocks.filter((b) => b.kind === "planned" || b.status === "drawn");
  if (planned.length) out.push({ sel: null, kicker: "Still plans", title: `${n(planned.length, "piece")} not built yet`, text: `${planned.map((b) => b.title).join(", ")}. Nothing moves on their wires until they are built.` });
  const bad = [...problems.values()].filter((p) => p.level === "bad").length;
  out.push({ sel: null, kicker: "The end", title: bad ? `${n(bad, "wire")} to fix` : "Every wire follows the rules", text: bad ? "That is the whole system. Fix those wires and it all works." : "That is the whole system. You have seen every piece and every wire." });
  return out;
}

export const greeting = (s: System) => `Voice on. Click any piece or wire and I will tell you what it does, in plain words. Explain takes you round the whole of ${s.name}.`;

/** The suggestion in one breath: what kinds of wires are proposed, and that each waits for a yes. */
export function suggestSummary(s: System, list: Link[]): string {
  if (list.length === 0) return "Nothing to suggest. Every wire that makes sense is already on the board.";
  const by = new Map(s.blocks.map((b) => [b.id, b]));
  const kindOf = (l: Link): string => {
    const a = by.get(l.from);
    const b = by.get(l.to);
    if (!a || !b) return "other";
    if (l.mode === "ws") return "the live feed pushing news to apps";
    if (l.mode === "ddl") return "the admin path for database changes";
    if (a.kind === "vercel") return "putting the site online";
    if (b.kind === "external") return "calling out to outside services";
    if (a.kind === "external") return "outside services calling back";
    if (b.kind === "store") return a.kind === "supabase" ? "the API reading and writing the database" : "the server going straight into the database";
    if (a.kind === "store") return "the database feeding the live feed";
    if (b.kind === "supabase") return isServer(a) ? "the server talking to Supabase" : "apps asking the API";
    if (isServer(b)) return "apps asking the server";
    return "other";
  };
  const groups = new Map<string, number>();
  for (const l of list) groups.set(kindOf(l), (groups.get(kindOf(l)) ?? 0) + 1);
  const parts = [...groups.entries()].slice(0, 4).map(([k, c]) => `${c} for ${k}`);
  const more = groups.size > 4 ? ", and a few more" : "";
  return `${n(list.length, "wire")} suggested: ${parts.join(", ")}${more}. They stay dotted blue until you say yes, and each one still has to pass the rules. Let us go through them one by one.`;
}

/** One proposed wire, lit on the board. */
export const suggestStep = (s: System, l: Link, i: number, total: number) => `${i + 1} of ${total}. ${describeLink(s, l)}`;

export const suggestClose = (total: number) => `That is all ${total}. Say yes to each one in the panel, or to all of them at once.`;
