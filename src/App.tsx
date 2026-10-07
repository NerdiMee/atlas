import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Board from "./Board";
import Canvas, { type MovePhase, type Sel } from "./Canvas";
import Icon from "./Icons";
import Panel from "./Panel";
import { KINDS, ORIGINS, checkAll, checkLink, suggestLinks, tidy, uid, type Block, type Change, type Kind, type Link, type Origin, type Problem, type System, type Tone } from "./model";
import { describeBlock, describeLink, describeProblem, greeting, story as storyOf, suggestClose, suggestStep, suggestSummary, tour } from "./narrate";
import { onSpeech, prime, speak, stop as hush } from "./voice";
import ImportDialog from "./Import";
import type { Snap } from "./diff";
import { openReport, tourHtml } from "./report";
import { Coach, Confetti, Idle, Key, PieceCard, Quest, Story, WireCard, chime } from "./Play";
import { FRESH, missionsFor, type Progress } from "./missions";

const LS_SYS = (id: string) => `atlas.system.${id}`;
const LS_LOG = (id: string) => `atlas.changes.${id}`;
const LS_SNAPS = (id: string) => `atlas.snaps.${id}`;
const LS_PLAY = (id: string) => `atlas.play.${id}`;

type Saved = { savedAt: string; system: System };
type Store = { ok: boolean; files: Record<string, Saved> };
type Undo = { system: System; label: string };

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: edits live for this tab only */
  }
}
function isSystem(x: unknown): x is System {
  const s = x as System;
  return !!s && typeof s === "object" && Array.isArray(s.blocks) && Array.isArray(s.links) && typeof s.name === "string";
}
function stamp(d = new Date()) {
  return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
}
/** What "saved" compares: the map itself, not the log or the view. */
const essence = (s: System) => JSON.stringify({ b: s.blocks, l: s.links, n: s.note, t: s.tagline, p: s.snapshot });

/** The buzz. A low square wave for a refused move, a short blip for a warning. */
function buzz(level: Problem["level"]) {
  try {
    const ac = new AudioContext();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = level === "bad" ? "square" : "sine";
    o.frequency.value = level === "bad" ? 95 : 520;
    g.gain.value = level === "bad" ? 0.07 : 0.04;
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + (level === "bad" ? 0.2 : 0.09));
    o.onended = () => void ac.close();
  } catch {
    /* no audio output available */
  }
}

const params = new URLSearchParams(window.location.search);

/** What the stage shows before the user has any map of their own. */
const EMPTY: System = { id: "", name: "No map yet", tagline: "", snapshot: "", note: "", blocks: [], links: [] };
const validId = (id: string) => /^[a-z0-9-]{1,40}$/.test(id);

/** Where a project lives: green on this computer, blue on GitHub, violet both. */
function Dot({ origin }: { origin?: Origin }) {
  return <i className="odot" style={{ background: origin ? ORIGINS[origin].color : "transparent" }} title={origin ? ORIGINS[origin].label : undefined} />;
}

export default function App() {
  // Atlas ships with no maps: every system is one the user drafted from their own
  // code, or a map saved as a project file in data/, so a saved project always shows up.
  const [extra, setExtra] = useState<System[]>(() => read<System[]>("atlas.extra") ?? []);
  const [store, setStore] = useState<Store>({ ok: false, files: {} });
  const [origins, setOrigins] = useState<Record<string, Origin>>({});
  useEffect(() => {
    fetch("/__atlas/origins")
      .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? r.json() : {}))
      .then(setOrigins)
      .catch(() => {});
  }, []);
  const originOf = (s: System): Origin | undefined => origins[s.id] ?? s.origin;
  const ALL = useMemo(() => {
    const out: System[] = [];
    for (const [id, f] of Object.entries(store.files)) if (validId(id) && isSystem(f.system) && !out.some((s) => s.id === id)) out.push({ ...f.system, id });
    for (const s of extra) if (!out.some((o) => o.id === s.id)) out.push(s);
    return out;
  }, [extra, store]);
  const ids = useMemo(() => ALL.map((s) => s.id), [ALL]);
  const [sysId, setSysId] = useState(() => {
    const q = params.get("system");
    // A project-file map is not known until the files load, so a well-formed id is kept and checked then.
    return q && (ids.includes(q) || validId(q)) ? q : read<string>("atlas.current") ?? ids[0] ?? "";
  });
  const [view, setView] = useState<"board" | "map">(() => (params.get("view") === "map" ? "map" : params.get("view") === "board" ? "board" : read<"board" | "map">("atlas.view") ?? "board"));
  const [system, setSystem] = useState<System>(() => read<System>(LS_SYS(sysId)) ?? ALL.find((s) => s.id === sysId) ?? (sysId ? { ...EMPTY, id: sysId, name: "Loading…" } : EMPTY));
  const hadLocal = useRef(!!read<System>(LS_SYS(sysId)));
  const [changes, setChanges] = useState<Change[]>(() => read<Change[]>(LS_LOG(sysId)) ?? []);
  const [history, setHistory] = useState<Undo[]>([]);
  const [sel, setSel] = useState<Sel | null>(null);
  const [hidden, setHidden] = useState<Set<Kind>>(new Set());
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Link[] | null>(null);
  const [menu, setMenu] = useState<"system" | "add" | "more" | null>(null);
  const [toast, setToast] = useState<{ tone: Tone; text: string } | null>(null);
  const [shake, setShake] = useState<{ id: string; n: number } | null>(null);
  const [buzzed, setBuzzed] = useState(false);
  const [mute, setMute] = useState(() => read<boolean>("atlas.mute") ?? false);
  const [voice, setVoice] = useState(() => read<boolean>("atlas.voice") ?? false);
  const [caption, setCaption] = useState<string | null>(null);
  const [touring, setTouring] = useState(false);
  const [spot, setSpot] = useState<string | null>(null); // the suggested wire the walkthrough is on
  const tourRun = useRef(0);
  const [q, setQ] = useState("");
  const [logOpen, setLogOpen] = useState(false);
  const [present, setPresent] = useState(() => params.get("present") === "1");
  const [snaps, setSnaps] = useState<Snap[]>(() => read<Snap[]>(LS_SNAPS(sysId)) ?? []);
  const [panelMode, setPanelMode] = useState<"auto" | "versions">("auto");
  const [importing, setImporting] = useState(false);
  const [fitKey, setFitKey] = useState(0);
  const [newer, setNewer] = useState<Saved | null>(null);
  // Play mode: missions, the story player and plain cards sit on top of the same map.
  const [play, setPlay] = useState(() => (params.get("mode") === "build" ? false : params.get("mode") === "play" ? true : read<string>("atlas.mode") !== "build"));
  const [progress, setProgress] = useState<Progress>(() => ({ ...FRESH, ...(read<Partial<Progress>>(LS_PLAY(sysId)) ?? {}) }));
  const progFor = useRef(sysId);
  const [storyAt, setStoryAt] = useState<number | null>(null);
  const [storyAuto, setStoryAuto] = useState(false);
  const [coach, setCoach] = useState(() => !read<boolean>("atlas.coached"));
  const [cheer, setCheer] = useState(0);
  const bump = useCallback((patch: Partial<Progress> | ((p: Progress) => Progress)) => setProgress((p) => (typeof patch === "function" ? patch(p) : { ...p, ...patch })), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastEdit = useRef<{ key: string; at: number }>({ key: "", at: 0 });

  useEffect(() => {
    if (system.id) write(LS_SYS(system.id), system);
  }, [system]);
  useEffect(() => {
    if (system.id) write(LS_LOG(system.id), changes);
  }, [changes]);
  useEffect(() => write("atlas.current", sysId), [sysId]);
  useEffect(() => write("atlas.view", view), [view]);
  useEffect(() => {
    if (system.id) write(LS_SNAPS(system.id), snaps);
  }, [snaps, system.id]);
  useEffect(() => write("atlas.extra", extra), [extra]);
  useEffect(() => write("atlas.mute", mute), [mute]);
  useEffect(() => write("atlas.voice", voice), [voice]);
  useEffect(() => onSpeech(setCaption), []);
  useEffect(() => {
    if (!buzzed) return;
    const t = setTimeout(() => setBuzzed(false), 650);
    return () => clearTimeout(t);
  }, [buzzed]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  // Project files: saved maps in data/, served by the dev server only.
  useEffect(() => {
    let alive = true;
    // An id that names no map: drop what its placeholder stored and open the first map there is.
    const fallBack = (files: Record<string, Saved>) => {
      try {
        for (const k of [LS_SYS(sysId), LS_LOG(sysId), LS_SNAPS(sysId)]) localStorage.removeItem(k);
      } catch {}
      const first = Object.entries(files).find(([id, f]) => validId(id) && isSystem(f.system));
      if (first) switchSystem(first[0], { ...first[1].system, id: first[0] });
      else if (extra[0]) switchSystem(extra[0].id, extra[0]);
      else switchSystem("", EMPTY);
    };
    fetch("/__atlas/systems")
      .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? r.json() : Promise.reject(new Error("no store"))))
      .then((files: Record<string, Saved>) => {
        if (!alive) return;
        setStore({ ok: true, files });
        const f = files[sysId];
        if (f && isSystem(f.system)) {
          if (!hadLocal.current) setSystem({ ...f.system, id: sysId });
          else setSystem((cur) => {
            if (essence(cur) !== essence(f.system)) setNewer(f);
            return cur;
          });
        } else if (!ids.includes(sysId)) fallBack(files);
      })
      .catch(() => {
        if (!alive) return;
        setStore({ ok: false, files: {} });
        if (!ids.includes(sysId)) fallBack({});
      });
    return () => {
      alive = false;
    };
    // The current system is only read on mount on purpose: a later switch loads its file itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const problems = useMemo(() => checkAll(system), [system]);
  const byId = useMemo(() => new Map(system.blocks.map((b) => [b.id, b])), [system.blocks]);

  // Whatever is picked is explained aloud, unless the tour picked it.
  useEffect(() => {
    if (!voice || touring || storyAt !== null || !sel) return;
    if (sel.type === "block") {
      const b = byId.get(sel.id);
      if (b) void speak(describeBlock(system, b, problems));
    } else {
      const l = system.links.find((x) => x.id === sel.id);
      if (l) void speak(describeLink(system, l, problems.get(l.id)));
    }
    // Only a change of selection should start a line, not every edit to the selected thing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  /** Resting on something: get the opening sentence ready so a click speaks at once. */
  const onHint = useCallback(
    (h: { block?: string; link?: string; ghost?: boolean }) => {
      if (!voice) return;
      if (h.block) {
        const b = byId.get(h.block);
        if (b) prime(describeBlock(system, b, problems));
      } else if (h.link && !h.ghost) {
        const l = system.links.find((x) => x.id === h.link);
        if (l) prime(describeLink(system, l, problems.get(l.id)));
      }
    },
    [voice, byId, system, problems],
  );

  const stopTour = useCallback(() => {
    tourRun.current += 1;
    setTouring(false);
    setSpot(null);
    hush();
  }, []);

  const explain = async () => {
    if (touring) return stopTour();
    if (storyAt !== null) closeStory(storyAt >= steps.length - 1);
    if (!voice) setVoice(true);
    const id = ++tourRun.current;
    setTouring(true);
    setSuggestions(null);
    log("info", `Walking through ${system.name}`);
    for (const step of tour(system, problems)) {
      if (tourRun.current !== id) return;
      setSel(step.sel);
      await speak(step.text);
    }
    if (tourRun.current === id) {
      setTouring(false);
      bump({ tourDone: true });
    }
  };

  const toggleVoice = () => {
    if (voice) {
      stopTour();
      setVoice(false);
      log("info", "Voice off");
    } else {
      setVoice(true);
      log("info", "Voice on: what you select is explained aloud");
      void speak(greeting(system));
    }
  };
  const saved = store.files[sysId];
  const dirty = !saved || essence(saved.system) !== essence(system);
  const focus = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return null;
    return new Set(system.blocks.filter((b) => `${b.title} ${b.sub} ${b.lines.join(" ")} ${KINDS[b.kind].label}`.toLowerCase().includes(t)).map((b) => b.id));
  }, [q, system.blocks]);

  /* ---- Play mode ---- */
  const missions = useMemo(() => missionsFor(system, problems, progress), [system, problems, progress]);
  const steps = useMemo(() => storyOf(system, problems), [system, problems]);
  useEffect(() => write("atlas.mode", play ? "play" : "build"), [play]);
  useEffect(() => {
    if (sysId && progFor.current === sysId) write(LS_PLAY(sysId), progress);
  }, [progress, sysId]);
  useEffect(() => {
    progFor.current = sysId;
    setProgress({ ...FRESH, ...(read<Partial<Progress>>(LS_PLAY(sysId)) ?? {}) });
    setStoryAt(null);
  }, [sysId]);
  // What you click counts, unless the story or the tour clicked it for you.
  useEffect(() => {
    if (!sel || touring || storyAt !== null) return;
    bump((p) => (sel.type === "block" ? (p.seen.includes(sel.id) ? p : { ...p, seen: [...p.seen, sel.id] }) : p.wires.includes(sel.id) ? p : { ...p, wires: [...p.wires, sel.id] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);
  // A mission just finished: cheer once.
  useEffect(() => {
    if (!play || !system.id || system.blocks.length === 0) return;
    const fresh = missions.filter((m) => m.done && !progress.celebrated.includes(m.id));
    if (!fresh.length) return;
    bump((p) => ({ ...p, celebrated: [...p.celebrated, ...fresh.map((m) => m.id)] }));
    if (!mute) chime();
    setCheer(Date.now());
    setToast({ tone: "good", text: `Mission complete: ${fresh.map((m) => m.title).join(", ")} · +${fresh.reduce((n, m) => n + m.xp, 0)} XP` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missions, play]);
  const storyStep = storyAt === null || !steps.length ? null : steps[Math.min(storyAt, steps.length - 1)];
  const closeStory = (finished: boolean) => {
    if (finished) bump({ storyDone: true });
    setStoryAt(null);
    setSel(null);
    hush();
  };
  // Each step lights its piece or wire and speaks once if the voice is on.
  const [spoken, setSpoken] = useState<number | null>(null);
  useEffect(() => {
    if (!storyStep) return;
    stopTour();
    setSuggestions(null);
    setSel(storyStep.sel);
    setSpoken(null);
    let cancelled = false;
    if (voice) void speak(storyStep.text).then(() => { if (!cancelled) setSpoken(storyAt); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyAt]);
  // Auto moves on by itself: a moment after the voice finishes, or every few seconds without it.
  useEffect(() => {
    if (!storyStep || !storyAuto || storyAt === null) return;
    if (voice && spoken !== storyAt) return;
    const timer = window.setTimeout(() => setStoryAt((i) => (i !== null && i < steps.length - 1 ? i + 1 : i)), voice ? 700 : 5500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyAt, storyAuto, spoken]);
  const storyFocus = useMemo(() => {
    if (!storyStep?.sel) return null;
    if (storyStep.sel.type === "block") return new Set([storyStep.sel.id]);
    const id = storyStep.sel.id;
    const l = system.links.find((x) => x.id === id);
    return l ? new Set([l.from, l.to]) : null;
  }, [storyStep, system.links]);

  const log = useCallback((tone: Tone, text: string) => {
    setChanges((c) => [{ at: stamp(), tone, text }, ...c].slice(0, 60));
  }, []);

  /** A refused or flagged move: sound, shake the block, say why. */
  const refuse = useCallback(
    (p: Problem, blockId?: string) => {
      if (!mute) buzz(p.level);
      setToast({ tone: p.level, text: p.reason });
      if (p.level === "bad") {
        setBuzzed(true);
        if (blockId) setShake({ id: blockId, n: Date.now() });
        bump((q) => ({ ...q, refusals: q.refusals + 1 }));
      }
      log(p.level, p.level === "bad" ? `Refused: ${p.reason}` : `Flagged: ${p.reason}`);
      if (voice) void speak(describeProblem(p));
    },
    [log, mute, voice, bump],
  );

  /** Snapshot for undo, named after what is about to happen. Rapid edits to the same field share one. */
  const remember = useCallback(
    (key: string, label: string) => {
      const now = Date.now();
      if (lastEdit.current.key === key && now - lastEdit.current.at < 1500) {
        lastEdit.current.at = now;
        return;
      }
      lastEdit.current = { key, at: now };
      setHistory((h) => [...h.slice(-49), { system, label }]);
    },
    [system],
  );

  const title = (id: string) => byId.get(id)?.title ?? "block";
  const baseFor = (id: string) => store.files[id]?.system ?? ALL.find((s) => s.id === id);

  const loadSaved = () => {
    if (!newer) return;
    setHistory((h) => [...h.slice(-49), { system, label: "Loaded the project file" }]);
    setSystem({ ...newer.system, id: sysId });
    setSel(null);
    setSuggestions(null);
    setNewer(null);
    setFitKey((k) => k + 1);
    log("good", `Loaded the project file saved at ${stamp(new Date(newer.savedAt))}`);
  };

  const switchSystem = (id: string, base: System | undefined = baseFor(id)) => {
    if (!base) return;
    setSysId(id);
    setNewer(null);
    const local = read<System>(LS_SYS(id));
    const file = store.files[id];
    setSystem(local ?? { ...base, id });
    if (local && file && essence(local) !== essence(file.system)) setNewer(file);
    setChanges(read<Change[]>(LS_LOG(id)) ?? []);
    setSnaps(read<Snap[]>(LS_SNAPS(id)) ?? []);
    setPanelMode("auto");
    setHistory([]);
    setSel(null);
    setLinkFrom(null);
    setSuggestions(null);
    setQ("");
    setFitKey((k) => k + 1);
  };

  const onMove = (id: string, x: number, y: number, phase: MovePhase) => {
    if (phase === "start") {
      setHistory((h) => [...h.slice(-49), { system, label: `Moved ${title(id)}` }]);
      return;
    }
    setSystem((s) => ({ ...s, blocks: s.blocks.map((b) => (b.id === id ? { ...b, x, y } : b)) }));
    if (phase === "end") log("info", `Moved ${title(id)}`);
  };

  const onBlock = (id: string, patch: Partial<Block>) => {
    remember(`block:${id}:${Object.keys(patch).join(",")}`, `Edited ${title(id)}`);
    const next = { ...system, blocks: system.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) };
    setSystem(next);
    if ("status" in patch || "kind" in patch) {
      const what = patch.status ?? KINDS[patch.kind as Kind].label;
      log("warn", `Changed ${title(id)} to ${what}`);
      // A block that changes role can leave its wires impossible. Say so, loudly, but keep the change.
      const after = checkAll(next);
      const broke = system.links.filter((l) => (l.from === id || l.to === id) && after.get(l.id)?.level === "bad" && problems.get(l.id)?.level !== "bad").length;
      if (broke) refuse({ level: "bad", reason: `Making ${title(id)} ${what} leaves ${broke} wire${broke === 1 ? "" : "s"} impossible. ${broke === 1 ? "It is" : "They are"} red now: rewire, or undo.` }, id);
    }
  };

  /** Wire edits run through the rules; an impossible transport or direction is refused. */
  const onLink = (id: string, patch: Partial<Link>) => {
    const cur = system.links.find((l) => l.id === id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    if ("mode" in patch || "from" in patch || "to" in patch) {
      const p = checkLink(byId, next, system.links);
      if (p?.level === "bad") {
        refuse(p, next.to);
        return;
      }
      if (p) refuse(p);
    }
    remember(`link:${id}:${Object.keys(patch).join(",")}`, `Edited wire ${title(cur.from)} → ${title(cur.to)}`);
    setSystem((s) => ({ ...s, links: s.links.map((l) => (l.id === id ? next : l)) }));
  };

  const addBlock = (kind: Kind) => {
    const n = system.blocks.length;
    const b: Block = {
      id: uid(),
      kind,
      title: `New ${KINDS[kind].label.toLowerCase()}`,
      sub: "",
      lines: ["describe it"],
      x: 60 + (n % 6) * 30,
      y: 60 + (n % 6) * 30,
      w: 240,
      status: kind === "planned" ? "drawn" : "wired",
      details: [],
    };
    remember(`add:${b.id}`, `Added ${b.title}`);
    setSystem((s) => ({ ...s, blocks: [...s.blocks, b] }));
    setSel({ type: "block", id: b.id });
    setMenu(null);
    log("good", `Added ${b.title}`);
  };

  const duplicate = (id: string) => {
    const src = byId.get(id);
    if (!src) return;
    const b: Block = { ...src, id: uid(), x: src.x + 30, y: src.y + 30, details: src.details.map((d) => ({ ...d })), lines: [...src.lines] };
    remember(`dup:${b.id}`, `Duplicated ${src.title}`);
    setSystem((s) => ({ ...s, blocks: [...s.blocks, b] }));
    setSel({ type: "block", id: b.id });
    log("good", `Duplicated ${src.title}`);
  };

  const deleteBlock = (id: string) => {
    const name = title(id);
    const wires = system.links.filter((l) => l.from === id || l.to === id).length;
    remember(`del:${id}:${uid()}`, `Deleted ${name}`);
    setSystem((s) => ({ ...s, blocks: s.blocks.filter((b) => b.id !== id), links: s.links.filter((l) => l.from !== id && l.to !== id) }));
    setSel(null);
    log("bad", wires ? `Deleted ${name} and its ${wires} wire${wires === 1 ? "" : "s"}` : `Deleted ${name}`);
  };

  const deleteLink = (id: string) => {
    const l = system.links.find((x) => x.id === id);
    if (!l) return;
    remember(`dell:${id}`, `Unwired ${title(l.from)} → ${title(l.to)}`);
    setSystem((s) => ({ ...s, links: s.links.filter((x) => x.id !== id) }));
    if (sel?.type === "link" && sel.id === id) setSel({ type: "block", id: l.from });
    log("bad", `Unwired ${title(l.from)} → ${title(l.to)}`);
  };

  const linkTarget = (to: string) => {
    if (!linkFrom) return;
    const l: Link = { id: uid("l"), from: linkFrom, to, label: "", mode: "https", why: "" };
    const p = checkLink(byId, l, system.links);
    if (p?.level === "bad") {
      refuse(p, to);
      setLinkFrom(null);
      return;
    }
    remember(`link:${l.id}`, `Wired ${title(linkFrom)} → ${title(to)}`);
    setSystem((s) => ({ ...s, links: [...s.links, l] }));
    setLinkFrom(null);
    setSel({ type: "link", id: l.id });
    log("good", `Wired ${title(linkFrom)} → ${title(to)}`);
    if (p) refuse(p);
  };

  /** Suggest is a walkthrough: the whole proposal in a breath, then each wire lit and explained. */
  const suggest = async () => {
    const list = suggestLinks(system);
    setSuggestions(list);
    setSel(null);
    log("info", list.length ? `Suggested ${list.length} wire${list.length === 1 ? "" : "s"}, waiting for your say` : "Nothing to suggest: every sensible wire is already there");
    if (!voice) setVoice(true);
    const id = ++tourRun.current;
    setTouring(true);
    await speak(suggestSummary(system, list));
    for (let i = 0; i < list.length; i++) {
      if (tourRun.current !== id) return;
      setSpot(list[i].id);
      await speak(suggestStep(system, list[i], i, list.length));
    }
    if (tourRun.current !== id) return;
    setSpot(null);
    if (list.length) await speak(suggestClose(list.length));
    if (tourRun.current === id) setTouring(false);
  };
  const acceptSuggestion = (id: string) => {
    const l = suggestions?.find((x) => x.id === id);
    if (!l) return;
    const p = checkLink(byId, l, system.links);
    if (p?.level === "bad") {
      refuse(p, l.to);
      return;
    }
    remember(`accept:${id}`, `Accepted ${title(l.from)} → ${title(l.to)}`);
    setSystem((s) => ({ ...s, links: [...s.links, { ...l, id: uid("l") }] }));
    setSuggestions((list) => list?.filter((x) => x.id !== id) ?? null);
    log("good", `Accepted: ${title(l.from)} → ${title(l.to)}`);
    if (p) refuse(p);
  };
  const skipSuggestion = (id: string) => setSuggestions((list) => list?.filter((x) => x.id !== id) ?? null);
  const acceptAll = () => {
    if (!suggestions) return;
    remember(`accept:all:${uid()}`, "Accepted all suggestions");
    const checked = suggestions.map((l) => ({ l, p: checkLink(byId, l, system.links) }));
    const okay = checked.filter((x) => x.p?.level !== "bad");
    const skipped = checked.length - okay.length;
    const flagged = okay.filter((x) => x.p).length;
    setSystem((s) => ({ ...s, links: [...s.links, ...okay.map((x) => ({ ...x.l, id: uid("l") }))] }));
    log("good", `Accepted ${okay.length} suggested wire${okay.length === 1 ? "" : "s"}${skipped ? `, refused ${skipped}` : ""}${flagged ? `, ${flagged} flagged as drawn only` : ""}`);
    if (skipped) refuse({ level: "bad", reason: `${skipped} suggestion${skipped === 1 ? "" : "s"} broke a rule once the others were in place and ${skipped === 1 ? "was" : "were"} refused.` });
    else if (flagged) refuse({ level: "warn", reason: `${flagged} of the accepted wires touch a drawn-only block, so nothing travels on them yet.` });
    setSuggestions(null);
  };

  const doTidy = () => {
    remember(`tidy:${uid()}`, "Tidied the layout");
    setSystem((s) => ({ ...s, blocks: tidy(s) }));
    setFitKey((k) => k + 1);
    log("info", "Tidied: clients, servers, platform, stores, outside, left to right");
    bump({ tidied: true });
  };

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const last = h[h.length - 1];
      setSystem(last.system);
      setChanges((c) => [{ at: stamp(), tone: "info" as Tone, text: `Undid: ${last.label}` }, ...c].slice(0, 60));
      return h.slice(0, -1);
    });
    setSel(null);
    lastEdit.current = { key: "", at: 0 };
  }, []);

  const reset = () => {
    const base = baseFor(sysId);
    if (!base) return;
    const from = store.files[sysId] ? "the saved project file" : "the built-in snapshot";
    if (!confirm(`Throw away your edits to ${base.name} and reload ${from}?`)) return;
    setSystem({ ...base, id: sysId });
    setHistory([]);
    setSel(null);
    setSuggestions(null);
    setChanges([{ at: stamp(), tone: "info", text: `Reloaded ${from}` }]);
    setFitKey((k) => k + 1);
  };

  const saveToProject = async () => {
    try {
      const r = await fetch(`/__atlas/save/${sysId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(system) });
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      const { savedAt } = (await r.json()) as { savedAt: string };
      setStore((st) => ({ ...st, files: { ...st.files, [sysId]: { savedAt, system } } }));
      setToast({ tone: "good", text: `Saved to data/${sysId}.json in the project` });
      log("good", `Saved to the project`);
    } catch (e) {
      refuse({ level: "bad", reason: `Could not save to the project: ${(e as Error).message}` });
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(system, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${system.id}.atlas.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMenu(null);
  };

  const importJson = async (file: File) => {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isSystem(parsed)) throw new Error("not an Atlas system file");
      setHistory((h) => [...h.slice(-49), { system, label: `Imported ${file.name}` }]);
      setSystem({ ...parsed, id: system.id, links: parsed.links.map((l) => ({ ...l, why: l.why ?? "" })) });
      setSel(null);
      setFitKey((k) => k + 1);
      log("good", `Imported ${file.name}`);
    } catch (e) {
      refuse({ level: "bad", reason: `Could not import ${file.name}: ${(e as Error).message}` });
    }
    setMenu(null);
  };

  /* ---- versions ---- */
  const takeSnapshot = () => {
    const label = prompt("Name this version (optional)", "") ?? "";
    const snap: Snap = { at: new Date().toISOString(), label: label.trim(), system };
    setSnaps((list) => [snap, ...list].slice(0, 20));
    log("good", `Saved a version${snap.label ? `: ${snap.label}` : ""}`);
    setPanelMode("versions");
    setMenu(null);
  };
  const restoreSnap = (snap: Snap) => {
    setHistory((h) => [...h.slice(-49), { system, label: "Went back to a saved version" }]);
    setSystem({ ...snap.system, id: sysId });
    setSel(null);
    setFitKey((k) => k + 1);
    log("warn", `Went back to the version from ${stamp(new Date(snap.at))}`);
  };
  const deleteSnap = (at: string) => setSnaps((list) => list.filter((s) => s.at !== at));

  /* ---- the tour on paper ---- */
  const exportTour = () => {
    openReport(tourHtml(system, tour(system, problems), problems));
    log("info", "Opened the tour as a page to print or save as PDF");
    setMenu(null);
  };

  /* ---- drafted from code ---- */
  const importSystem = (drafted: System) => {
    const taken = new Set(ids);
    let id = drafted.id;
    for (let i = 2; taken.has(id); i++) id = `${drafted.id}-${i}`;
    const sys = { ...drafted, id };
    setExtra((list) => [...list, sys]);
    setImporting(false);
    setSysId(id);
    setSystem(sys);
    setChanges([{ at: stamp(), tone: "good", text: sys.blocks.length ? `Drafted ${sys.name} from its code: ${sys.blocks.length} pieces, ${sys.links.length} wires` : `Started ${sys.name}` }]);
    setSnaps([]);
    setHistory([]);
    setSel(null);
    setPanelMode("auto");
    setFitKey((k) => k + 1);
    if (!sys.blocks.length) return;
    if (voice) void speak(`I read ${sys.name} from its code and drew ${sys.blocks.length} pieces and ${sys.links.length} wires. Check it, and fix what the code could not tell me.`);
  };
  const forgetImported = () => {
    if (!extra.some((s) => s.id === sysId)) return;
    if (!confirm(`Remove ${system.name} from Atlas? It was drafted from code and can be read again.`)) return;
    setExtra((list) => list.filter((s) => s.id !== sysId));
    try {
      localStorage.removeItem(LS_SYS(sysId));
      localStorage.removeItem(LS_LOG(sysId));
      localStorage.removeItem(LS_SNAPS(sysId));
    } catch {}
    const next = ALL.find((s) => s.id !== sysId);
    switchSystem(next?.id ?? "", next ?? EMPTY);
    setMenu(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
      if (e.key === "Escape") {
        if (storyAt !== null) {
          closeStory(storyAt >= steps.length - 1);
          return;
        }
        if (present && !touring && !linkFrom && !menu && !suggestions) setPresent(false);
        setImporting(false);
        stopTour();
        setLinkFrom(null);
        setMenu(null);
        setSuggestions(null);
        if (!typing) setSel(null);
        else (t as HTMLElement).blur();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        undo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && store.ok) {
        e.preventDefault();
        void saveToProject();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        document.getElementById("find")?.focus();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !typing && sel) {
        e.preventDefault();
        if (sel.type === "block") deleteBlock(sel.id);
        else deleteLink(sel.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const counts = useMemo(() => {
    const m = new Map<Kind, number>();
    for (const b of system.blocks) m.set(b.kind, (m.get(b.kind) ?? 0) + 1);
    return m;
  }, [system.blocks]);
  const apps = system.blocks.filter((b) => ["web", "desktop", "handset"].includes(b.kind)).length;
  const clouds = system.blocks.filter((b) => ["supabase", "vercel"].includes(b.kind)).length;
  const bad = [...problems.entries()].filter(([, p]) => p.level === "bad").map(([id]) => id);

  const selLink = sel?.type === "link" ? system.links.find((l) => l.id === sel.id) : undefined;
  const viewProps = { system, selected: sel, hidden, focus: storyFocus ?? focus, inset: play ? { left: 332, right: 372 } : { left: 200, right: 380 }, fitKey, linkFrom, problems, suggestions, spot, shake, onSelect: setSel, onMove, onLinkTarget: linkTarget, onHint };

  return (
    <div className={`app${present ? " present" : ""}${play ? " play" : ""}`}>
      <header className="top">
        <span className="brand">Atlas</span>
        <span className="crumb">
          <div className="menu picker">
            <button className="pick" aria-label="System" aria-expanded={menu === "system"} onClick={() => setMenu((m) => (m === "system" ? null : "system"))}>
              <Dot origin={originOf(system)} />
              {system.name}
            </button>
            {menu === "system" && (
              <div className="list" role="menu">
                <div className="key">
                  {(Object.keys(ORIGINS) as Origin[]).map((o) => (
                    <span key={o}><Dot origin={o} />{ORIGINS[o].label}</span>
                  ))}
                </div>
                {ALL.map((s) => (
                  <button key={s.id} role="menuitemradio" aria-checked={s.id === sysId} className={s.id === sysId ? "on" : ""} onClick={() => { setMenu(null); if (s.id !== sysId) switchSystem(s.id); }}>
                    <Dot origin={originOf(s)} />
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="muted">{apps} apps · {clouds} clouds · {system.links.length} wires</span>
          {bad.length > 0 && (
            <button className="linkish bad" onClick={() => setSel({ type: "link", id: bad[0] })} title="Select the first impossible wire">
              · {bad.length} impossible
            </button>
          )}
        </span>
        <span className="seg mode" role="group" aria-label="Mode">
          <button className={play ? "on" : ""} onClick={() => { setPlay(true); setLinkFrom(null); setMenu(null); setSuggestions(null); }} aria-pressed={play} title="Missions, the story and plain cards">
            Play
          </button>
          <button className={!play ? "on" : ""} onClick={() => { setPlay(false); if (storyAt !== null) closeStory(false); }} aria-pressed={!play} title="All the tools: add, wire, tidy, save">
            Build
          </button>
        </span>
        <div className="tools">
          <div className="group build">
          <div className="menu">
            <button className="btn primary" onClick={() => setMenu((m) => (m === "add" ? null : "add"))} aria-expanded={menu === "add"}>
              + Block
            </button>
            {menu === "add" && (
              <div className="list" role="menu">
                {(Object.keys(KINDS) as Kind[]).map((k) => (
                  <button key={k} role="menuitem" onClick={() => addBlock(k)}>
                    <Icon kind={k} size={18} /> {KINDS[k].label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className={`btn${suggestions ? " on" : ""}`} onClick={suggestions ? () => { stopTour(); setSuggestions(null); } : suggest} title="Propose the best wiring for these blocks; each wire waits for your confirmation">
            {suggestions ? "Close suggestions" : "Suggest"}
          </button>
          <button className={`btn${linkFrom ? " on" : ""}`} disabled={sel?.type !== "block" && !linkFrom} onClick={() => setLinkFrom(linkFrom ? null : sel?.type === "block" ? sel.id : null)}>
            {linkFrom ? "Cancel wire" : "Wire"}
          </button>
          </div>
          <div className="group">
          {play && system.id && (
            <button className={`btn play-go${storyAt !== null ? " on" : ""}`} onClick={() => (storyAt === null ? setStoryAt(0) : closeStory(false))} title="Go through the system one step at a time">
              {storyAt !== null ? "Stop the story" : "▶ Play the story"}
            </button>
          )}
          <button className={`btn voice${voice ? " on" : ""}`} onClick={toggleVoice} title="The voice explains what you select, and why a wire is refused" aria-pressed={voice}>
            {voice ? "Voice on" : "Voice"}
          </button>
          <button className={`btn${touring ? " on" : ""}`} onClick={explain} title="Walk the whole system aloud, wire by wire">
            {touring ? "Stop" : "Explain"}
          </button>
          <button className="btn" onClick={() => { setPresent(true); setSel(null); setMenu(null); }} title="Hide the tools and show the client the map (Esc to come back)">
            Present
          </button>
          </div>
          <div className="group build">
          <button className="btn" onClick={doTidy} title="Arrange by role: clients, servers, platform, stores, outside">
            Tidy
          </button>
          <button className="btn" onClick={() => setFitKey((k) => k + 1)} title="Frame the whole system">
            Fit
          </button>
          <button className="btn" disabled={history.length === 0} onClick={undo} title={history.length ? `Undo: ${history[history.length - 1].label}` : "Nothing to undo"}>
            Undo
          </button>
          </div>
          <div className="group build">
          {store.ok && (
            <button className={`btn${dirty ? " boxed" : ""}`} onClick={saveToProject} title="Write this map to data/<system>.json (⌘S)">
              {dirty ? "Save" : "Saved"}
            </button>
          )}
          <div className="menu">
            <button className="btn" onClick={() => setMenu((m) => (m === "more" ? null : "more"))} aria-expanded={menu === "more"}>
              More ▾
            </button>
            {menu === "more" && (
              <div className="list" role="menu">
                <button role="menuitem" onClick={takeSnapshot}>
                  Save a version
                </button>
                <button role="menuitem" onClick={() => { setPanelMode("versions"); setSel(null); setMenu(null); }}>
                  Versions…
                </button>
                <button role="menuitem" onClick={exportTour}>
                  Export the tour (PDF)
                </button>
                <button role="menuitem" onClick={() => { setImporting(true); setMenu(null); }}>
                  Import from code…
                </button>
                {extra.some((s) => s.id === sysId) && !store.files[sysId] && (
                  <button role="menuitem" onClick={forgetImported}>
                    Remove this drafted map
                  </button>
                )}
                <button role="menuitem" onClick={exportJson}>
                  Export JSON
                </button>
                <button role="menuitem" onClick={() => fileRef.current?.click()}>
                  Import JSON…
                </button>
                <button role="menuitem" onClick={() => { setMenu(null); reset(); }}>
                  Reset to {store.files[sysId] ? "saved file" : "snapshot"}
                </button>
                <button role="menuitem" onClick={() => setMute((m) => !m)}>
                  {mute ? "Sound: off" : "Sound: on"}
                </button>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          </div>
        </div>
        <span className="spacer" />
        <span className="seg" role="group" aria-label="View">
          <button className={view === "board" ? "on" : ""} onClick={() => setView("board")} aria-pressed={view === "board"}>
            Board
          </button>
          <button className={view === "map" ? "on" : ""} onClick={() => setView("map")} aria-pressed={view === "map"}>
            Map
          </button>
        </span>
        <span className="snap" title={saved ? `Saved to the project at ${stamp(new Date(saved.savedAt))}` : store.ok ? "Not saved to the project yet" : "Edits live in this browser"}>
          <span className={`dot${bad.length ? " bad" : dirty && store.ok ? " warn" : ""}`} /> {system.snapshot}
          {store.ok && <span className="muted">{saved ? (dirty ? " · unsaved changes" : ` · saved ${stamp(new Date(saved.savedAt))}`) : " · not in project yet"}</span>}
        </span>
      </header>

      <div className={`stage${buzzed ? " buzzed" : ""}`}>
        {play && system.id && (
          <div className="playcol">
            <Quest missions={missions} onBuild={() => setPlay(false)} />
            <Key
              counts={counts}
              hidden={hidden}
              onToggle={(k) =>
                setHidden((h) => {
                  const n = new Set(h);
                  if (n.has(k)) n.delete(k);
                  else n.add(k);
                  return n;
                })
              }
            />
          </div>
        )}
        <nav className="legend" aria-label="Block kinds">
          <input
            id="find"
            className="find"
            placeholder="Find a block… (⌘F)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && focus?.size) {
                const first = system.blocks.find((b) => focus.has(b.id));
                if (first) setSel({ type: "block", id: first.id });
              }
            }}
            aria-label="Find a block"
          />
          {q && <div className="found">{focus?.size ?? 0} match{focus?.size === 1 ? "" : "es"} · Enter selects</div>}
          {(Object.keys(KINDS) as Kind[])
            .filter((k) => counts.has(k))
            .map((k) => (
              <button
                key={k}
                className={hidden.has(k) ? "off" : ""}
                onClick={() =>
                  setHidden((h) => {
                    const n = new Set(h);
                    if (n.has(k)) n.delete(k);
                    else n.add(k);
                    return n;
                  })
                }
                aria-pressed={!hidden.has(k)}
              >
                <Icon kind={k} size={18} /> {KINDS[k].label}
                <span className="n">{counts.get(k)}</span>
              </button>
            ))}
        </nav>

        {linkFrom && <div className="hint">Click the block this wire goes to · Esc to cancel</div>}
        {newer && !linkFrom && (
          <div className="hint newer" role="status">
            The project file for this map was saved at {stamp(new Date(newer.savedAt))} and differs from this browser's copy.
            <button className="btn primary" onClick={loadSaved}>
              Load saved file
            </button>
            <button className="btn" onClick={() => setNewer(null)}>
              Keep mine
            </button>
          </div>
        )}

        {view === "board" ? <Board {...viewProps} onRefuse={refuse} /> : <Canvas {...viewProps} />}

        {present && (
          <div className="presentBar" role="toolbar" aria-label="Presentation">
            <span className="who">{system.name}</span>
            <button className={`btn${touring ? " on" : ""}`} onClick={explain}>
              {touring ? "Stop" : "Play the tour"}
            </button>
            <button className="btn" onClick={() => { stopTour(); setPresent(false); }}>
              Exit
            </button>
          </div>
        )}
        {!system.id && !importing && (
          <div className="modal welcome" role="dialog" aria-label="Welcome to Atlas">
            <div className="sheet">
              <h2>Map one of your projects</h2>
              <p className="note">Atlas draws how a project fits together: its apps, database, server, outside services and the wires between them. It reads only what you point it at, a folder on this computer or one of your GitHub repositories, and keeps the maps on this computer.</p>
              <div className="row">
                <button className="btn primary" onClick={() => setImporting(true)}>
                  Import a project…
                </button>
                <button className="btn" onClick={() => importSystem({ ...EMPTY, id: "new-map", name: "New map", tagline: "drawn by hand" })}>
                  Start a blank map
                </button>
              </div>
            </div>
          </div>
        )}
        {importing && <ImportDialog onDone={importSystem} onClose={() => setImporting(false)} />}

        <section className={`changes${logOpen ? "" : " closed"}`} aria-label="Changes">
          <h4 onClick={() => setLogOpen((o) => !o)} role="button" aria-expanded={logOpen}>
            Changes <span className="n">{changes.length}</span>
            <span className="chev">{logOpen ? "▾" : "▸"}</span>
          </h4>
          {!logOpen ? null : changes.length === 0 ? (
            <div className="empty">No changes yet. Every move, wire and edit is listed here.</div>
          ) : (
            <ul>
              {changes.map((c, i) => (
                <li key={i}>
                  <span className={`dot ${c.tone === "good" ? "" : c.tone}`} />
                  <span>{c.text}</span>
                  <time>{c.at}</time>
                </li>
              ))}
            </ul>
          )}
        </section>

        {play && !suggestions && panelMode === "auto" && system.id ? (
          sel?.type === "block" && byId.get(sel.id) ? (
            <PieceCard key={sel.id} system={system} block={byId.get(sel.id)!} problems={problems} onSelect={setSel} />
          ) : sel?.type === "link" && selLink ? (
            <WireCard system={system} link={selLink} problem={problems.get(selLink.id)} onSelect={setSel} />
          ) : (
            <Idle system={system} onStory={() => setStoryAt(0)} />
          )
        ) : (
        <Panel
          system={system}
          sel={sel}
          problems={problems}
          suggestions={suggestions}
          spot={spot}
          onAccept={acceptSuggestion}
          onSkip={skipSuggestion}
          onAcceptAll={acceptAll}
          onSelect={setSel}
          onBlock={onBlock}
          onLink={onLink}
          onDeleteBlock={deleteBlock}
          onDeleteLink={deleteLink}
          onDuplicate={duplicate}
          onStartLink={(id) => setLinkFrom(id)}
          mode={panelMode}
          snaps={snaps}
          onSnapshot={takeSnapshot}
          onRestore={restoreSnap}
          onDeleteSnap={deleteSnap}
          onCloseVersions={() => setPanelMode("auto")}
        />
        )}
        {storyStep && storyAt !== null && (
          <Story steps={steps} index={Math.min(storyAt, steps.length - 1)} auto={storyAuto} onIndex={setStoryAt} onAuto={setStoryAuto} onClose={() => closeStory(storyAt >= steps.length - 1)} />
        )}
        <Confetti seed={cheer} />
        {play && coach && !!system.id && !importing && (
          <Coach
            onDone={() => {
              setCoach(false);
              write("atlas.coached", true);
            }}
          />
        )}

        {caption && (
          <div className="caption" role="status" aria-live="polite">
            <span className="who">ATLAS</span>
            <span className="txt">{caption}</span>
            <button className="btn" onClick={stopTour} aria-label="Stop speaking">
              Stop
            </button>
          </div>
        )}
        {toast && (
          <div className={`toast ${toast.tone}`} role="status">
            {toast.text}
          </div>
        )}
      </div>
    </div>
  );
}
