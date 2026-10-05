/* The voice. Kokoro's af_heart (its clearest voice) through the dev server when it is
   running on this machine, the browser's own British voice otherwise. A line
   is spoken sentence by sentence: the first sentence is short so it starts
   at once, and each next sentence is fetched while the current one plays.
   Hovering primes the first sentence, so a click is instant. */

type Listener = (text: string | null) => void;

let audio: HTMLAudioElement | null = null;
let run = 0;
let kokoro: boolean | null = null; // null = not tried yet
const listeners = new Set<Listener>();
const clips = new Map<string, Promise<Blob>>();
const CLIP_CACHE = 80;

export function onSpeech(fn: Listener): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
const tell = (t: string | null) => listeners.forEach((fn) => fn(t));

/** Turns map text into something a voice can say. */
export function sayable(text: string): string {
  return text
    .replace(/→/g, " to ")
    .replace(/←/g, " from ")
    .replace(/·/g, ", ")
    .replace(/_/g, " ")
    .replace(/\bRLS\b/g, "row level security")
    .replace(/\bDDL\b/g, "D-D-L")
    .replace(/\bWAL\b/g, "write-ahead log")
    .replace(/\bHMAC\b/g, "H-mac")
    .replace(/\bOTP\b/g, "one-time code")
    .replace(/\bgb\b/g, "G-B")
    .replace(/\s+,/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sentences, merged so none is tiny and split so none is long. */
function sentences(text: string): string[] {
  const raw = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const s of raw) {
    const last = out[out.length - 1];
    if (last && last.length < 14) out[out.length - 1] = `${last} ${s}`;
    else if (s.length > 240) {
      let cur = "";
      for (const piece of s.split(/(?<=,)\s+/)) {
        if (cur && cur.length + piece.length > 200) {
          out.push(cur);
          cur = piece;
        } else cur = cur ? `${cur} ${piece}` : piece;
      }
      if (cur) out.push(cur);
    } else out.push(s);
  }
  return out;
}

/* Kokoro answers one request at a time, and two at once both take as long as
   the pair. So clips are fetched through a queue, one in flight, with the
   sentence about to be spoken always ahead of anything hovered. */
type Job = { text: string; prio: number; resolve: (b: Blob) => void; reject: (e: Error) => void };
const pending: Job[] = [];
let inflight: { text: string; prio: number; ctrl: AbortController } | null = null;

function pump() {
  if (inflight || pending.length === 0) return;
  pending.sort((a, b) => a.prio - b.prio);
  const job = pending.shift()!;
  const ctrl = new AbortController();
  inflight = { text: job.text, prio: job.prio, ctrl };
  fetch("/__kokoro/v1/audio/speech", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "kokoro", input: job.text, voice: "af_heart", lang_code: "a", speed: 1, response_format: "wav" }),
    signal: ctrl.signal,
  })
    .then((r) => {
      if (!r.ok || !(r.headers.get("content-type") ?? "").includes("audio")) throw new Error(`kokoro ${r.status}`);
      return r.blob();
    })
    .then(job.resolve, job.reject)
    .finally(() => {
      inflight = null;
      pump();
    });
}

/** A clip for one sentence, cached. Lower prio goes first. */
function clip(text: string, prio: number): Promise<Blob> {
  const hit = clips.get(text);
  if (hit) {
    // Already queued from a hover: a spoken request for the same sentence moves it up.
    const job = pending.find((j) => j.text === text);
    if (job && prio < job.prio) job.prio = prio;
    return hit;
  }
  const p = new Promise<Blob>((resolve, reject) => pending.push({ text, prio, resolve, reject }));
  p.catch(() => {
    if (clips.get(text) === p) clips.delete(text);
  });
  clips.set(text, p);
  if (clips.size > CLIP_CACHE) clips.delete(clips.keys().next().value!);
  pump();
  return p;
}

/** A line is about to be spoken: hovered primes and the old line's prefetches step aside. */
function preempt(keep: string[]) {
  for (let i = pending.length - 1; i >= 0; i--) {
    const job = pending[i];
    if (job.prio >= 1 && !keep.includes(job.text)) {
      pending.splice(i, 1);
      clips.delete(job.text);
      job.reject(new Error("clip dropped"));
    }
  }
  if (inflight && inflight.prio >= 1 && !keep.includes(inflight.text)) {
    clips.delete(inflight.text);
    inflight.ctrl.abort();
  }
}

/** Fetches the opening of a line ahead of time, so speaking it later starts at once. */
export function prime(raw: string) {
  if (kokoro === false) return;
  const first = sentences(sayable(raw))[0];
  if (first && !clips.has(first)) void clip(first, 2).catch(() => undefined);
}

export function stop() {
  run += 1;
  if (audio) {
    audio.pause();
    audio.src = "";
    audio = null;
  }
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* no synthesis */
  }
  tell(null);
}

function play(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const a = new Audio(url);
  audio = a;
  return new Promise<void>((res) => {
    const done = () => {
      URL.revokeObjectURL(url);
      if (audio === a) audio = null;
      res();
    };
    a.onended = done;
    a.onerror = done;
    a.onpause = done;
    void a.play().catch(done);
  });
}

function viaBrowser(text: string, id: number): Promise<void> {
  return new Promise((res) => {
    const synth = window.speechSynthesis;
    if (!synth) return res();
    const u = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    u.voice = voices.find((v) => /Samantha|Karen|Moira|Daniel|Google UK English/.test(v.name)) ?? voices.find((v) => v.lang.startsWith("en")) ?? null;
    u.rate = 1;
    u.pitch = 1;
    const done = () => {
      clearInterval(guard);
      res();
    };
    u.onend = done;
    u.onerror = done;
    const guard = setInterval(() => {
      if (id !== run) done();
    }, 200);
    synth.speak(u);
  });
}

/** Speaks one line and resolves when it has been said, or cut off. */
export async function speak(raw: string): Promise<void> {
  const text = sayable(raw);
  if (!text) return;
  stop();
  const id = run;
  tell(raw.replace(/\s+/g, " ").trim());
  const parts = sentences(text);
  try {
    if (kokoro === false) {
      await viaBrowser(text, id);
      return;
    }
    preempt(parts);
    for (let i = 0; i < parts.length; i++) {
      let blob: Blob;
      try {
        blob = await clip(parts[i], 0).catch(() => (kokoro ? clip(parts[i], 0) : Promise.reject(new Error("no kokoro"))));
      } catch {
        if (id !== run) return;
        if (kokoro === null) kokoro = false; // never reached it: the browser speaks from now on
        await viaBrowser(parts.slice(i).join(" "), id);
        return;
      }
      if (id !== run) return;
      kokoro = true;
      if (parts[i + 1]) void clip(parts[i + 1], 1).catch(() => undefined); // fetched while this one plays
      await play(blob);
    }
  } finally {
    if (id === run) tell(null);
  }
}

/** Which engine spoke last, for the caption. */
export const engine = () => (kokoro ? "Atlas" : "Atlas (browser voice)");
