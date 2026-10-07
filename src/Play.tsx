import { useEffect, useState } from "react";
import { easeCubicOut, interpolateNumber, timer } from "d3";
import Icon from "./Icons";
import { KINDS, MODES, type Block, type Kind, type Link, type Problem, type System } from "./model";
import { plain, wireKind, type StoryStep } from "./narrate";
import { KIND_PLAIN, health, score, type Mission } from "./missions";
import type { Sel } from "./Canvas";

/* Play mode's screen furniture: the quest card, the story player, the plain
   piece cards, the first-run coach and the little celebration. All of it reads
   the same model the Build tools edit; none of it writes to the map. */

/** Progress ring, level and the missions, with the next thing to do first. */
export function Quest({ missions, onBuild }: { missions: Mission[]; onBuild: () => void }) {
  const s = score(missions);
  const next = missions.find((m) => !m.done);
  const done = missions.filter((m) => m.done).length;
  const [open, setOpen] = useState<string | null>(null);
  const r = 22, c = 2 * Math.PI * r;
  // The ring and its number ease to the new value rather than jumping.
  const [pct, setPct] = useState(s.pct);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setPct(s.pct); return; }
    const from = pct, lerp = interpolateNumber(from, s.pct);
    const t = timer((ms) => { const u = easeCubicOut(Math.min(1, ms / 700)); setPct(Math.round(lerp(u))); if (u >= 1) t.stop(); });
    return () => t.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.pct]);
  return (
    <aside className="quest" aria-label="Missions">
      <header>
        <svg className="ring" viewBox="0 0 56 56" aria-hidden="true">
          <circle cx="28" cy="28" r={r} />
          <circle cx="28" cy="28" r={r} className="val" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
          <text x="28" y="32" textAnchor="middle">{pct}%</text>
        </svg>
        <div>
          <b>{s.level}</b>
          <span>{done} of {missions.length} done · {pct}% understood</span>
        </div>
      </header>
      {next && (
        <div className="next">
          <span className="k">Next up</span>
          <b>{next.title}</b>
          <p>{next.hint}</p>
          {next.build && <button className="btn primary small" onClick={onBuild}>Switch to Build</button>}
        </div>
      )}
      <ol>
        {missions.map((m) => (
          <li key={m.id} className={`${m.done ? "done" : ""}${open === m.id ? " open" : ""}`}>
            <button onClick={() => setOpen((o) => (o === m.id ? null : m.id))} aria-expanded={open === m.id}>
              <span className="check" aria-hidden="true">{m.done ? "✓" : ""}</span>
              <span className="t">{m.title}</span>
              {m.progress && !m.done && <span className="xp">{m.progress}</span>}
            </button>
            {open === m.id && (
              <div className="more">
                <p>{m.hint}</p>
                <p className="why"><span>Why it matters</span> {m.teaches}</p>
              </div>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}

/** The pieces on this map, each with one plain line. Clicking one hides or shows that kind. */
export function Key({ counts, hidden, onToggle }: { counts: Map<Kind, number>; hidden: Set<Kind>; onToggle: (k: Kind) => void }) {
  return (
    <nav className="pkey" aria-label="What the pieces are">
      <h4>Pieces on this map</h4>
      {(Object.keys(KINDS) as Kind[]).filter((k) => counts.has(k)).map((k) => (
        <button key={k} className={hidden.has(k) ? "off" : ""} onClick={() => onToggle(k)} aria-pressed={!hidden.has(k)} title={hidden.has(k) ? "Show these" : "Hide these"}>
          <Icon kind={k} size={20} />
          <span><b>{KINDS[k].label}</b> <i>{counts.get(k)}</i><br /><small>{KIND_PLAIN[k]}</small></span>
        </button>
      ))}
    </nav>
  );
}

/** The story player: one step at a time, big words, your own pace. */
export function Story({ steps, index, auto, onIndex, onAuto, onClose }: { steps: StoryStep[]; index: number; auto: boolean; onIndex: (i: number) => void; onAuto: (on: boolean) => void; onClose: () => void }) {
  const step = steps[index];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); if (index < steps.length - 1) onIndex(index + 1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); if (index > 0) onIndex(index - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, steps.length, onIndex]);
  const last = index === steps.length - 1;
  return (
    <div className="story" role="region" aria-label="Story">
      <div className="bar"><span style={{ width: `${((index + 1) / steps.length) * 100}%` }} /></div>
      <div className="body">
        <span className="kicker">{step.kicker} · {index + 1} / {steps.length}</span>
        <h3 key={index} className="pop">{step.title}</h3>
        <p key={`p${index}`} className="pop">{step.text}</p>
      </div>
      <div className="ctl">
        <button className="btn" onClick={() => onIndex(index - 1)} disabled={index === 0} aria-label="Back">← Back</button>
        <button className={`btn${auto ? " on" : ""}`} onClick={() => onAuto(!auto)} aria-pressed={auto} title="Move on by itself every few seconds, or after the voice finishes">{auto ? "Auto on" : "Auto"}</button>
        {last ? <button className="btn primary" onClick={onClose}>Finish</button> : <button className="btn primary" onClick={() => onIndex(index + 1)}>Next →</button>}
        <button className="btn x2" onClick={onClose} aria-label="Close the story">✕</button>
      </div>
    </div>
  );
}

/** A piece, in plain words: what it is, how it is doing, who it talks to. Technical rows stay one click away. */
export function PieceCard({ system, block, problems, onSelect }: { system: System; block: Block; problems: Map<string, Problem>; onSelect: (s: Sel | null) => void }) {
  const h = health(block, problems, system);
  const out = system.links.filter((l) => l.from === block.id);
  const inn = system.links.filter((l) => l.to === block.id);
  const name = (id: string) => system.blocks.find((b) => b.id === id)?.title ?? "?";
  const [tech, setTech] = useState(false);
  return (
    <aside className="pcard" aria-label={block.title}>
      <header>
        <span className="tile" style={{ "--kc": KINDS[block.kind].color } as React.CSSProperties}><Icon kind={block.kind} size={26} /></span>
        <div><span className="k">{KINDS[block.kind].label}</span><h2>{block.title}</h2></div>
      </header>
      <p className="what">{KIND_PLAIN[block.kind]}{block.sub ? ` ${plain(block.sub)}.` : ""}</p>
      <div className={`light ${h.tone}`}><span className="dot" />{h.label}{h.why && <small>{plain(h.why)}</small>}</div>
      {block.lines.length > 0 && <p className="why"><span>What it does</span>{plain(block.lines.slice(0, 2).join(". "))}.</p>}
      <div className="talks">
        {out.length > 0 && <div><span>Sends to</span>{out.map((l) => <button key={l.id} className="chip" onClick={() => onSelect({ type: "link", id: l.id })}>{name(l.to)} →</button>)}</div>}
        {inn.length > 0 && <div><span>Gets from</span>{inn.map((l) => <button key={l.id} className="chip" onClick={() => onSelect({ type: "link", id: l.id })}>← {name(l.from)}</button>)}</div>}
        {!out.length && !inn.length && <p className="muted">Nothing is wired to it yet.</p>}
      </div>
      {block.details.length > 0 && (
        <>
          <button className="btn small ghost" onClick={() => setTech((t) => !t)} aria-expanded={tech}>{tech ? "Hide" : "Show"} technical details</button>
          {tech && <dl className="tech">{block.details.map((d, i) => <div key={i}><dt>{d.label}</dt><dd>{d.value}</dd></div>)}</dl>}
        </>
      )}
      <button className="btn small ghost" onClick={() => onSelect(null)}>Close</button>
    </aside>
  );
}

export function WireCard({ system, link, problem, onSelect }: { system: System; link: Link; problem?: Problem; onSelect: (s: Sel | null) => void }) {
  const b = (id: string) => system.blocks.find((x) => x.id === id);
  const from = b(link.from), to = b(link.to);
  return (
    <aside className="pcard" aria-label="Wire">
      <header>
        <span className="tile wire"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3 12h14m0 0-4-4m4 4-4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
        <div><span className="k">Wire · {MODES[link.mode].label}</span><h2>{link.label || "A wire"}</h2></div>
      </header>
      <div className="ends">
        {from && <button className="chip" onClick={() => onSelect({ type: "block", id: from.id })}><Icon kind={from.kind} size={16} /> {from.title}</button>}
        <span aria-hidden="true">→</span>
        {to && <button className="chip" onClick={() => onSelect({ type: "block", id: to.id })}><Icon kind={to.kind} size={16} /> {to.title}</button>}
      </div>
      <p className="what">This is {wireKind(link.mode)}.</p>
      <p className="why"><span>Why it is here</span>{link.why ? plain(link.why) : "Nobody has written down why yet."}</p>
      <div className={`light ${problem ? problem.level : "good"}`}><span className="dot" />{problem ? (problem.level === "bad" ? "This wire cannot work" : "Works, with a catch") : "Works"}{problem && <small>{problem.reason}</small>}</div>
      <button className="btn small ghost" onClick={() => onSelect(null)}>Close</button>
    </aside>
  );
}

/** What to do when nothing is selected. */
export function Idle({ system, onStory }: { system: System; onStory: () => void }) {
  return (
    <aside className="pcard idle" aria-label="How to start">
      <span className="k">{system.name}</span>
      <h2>{plain(system.tagline) || "A system map"}</h2>
      <p className="what">{plain(system.note)}</p>
      <ol className="howto">
        <li><b>Click</b> any piece or wire to see what it is for.</li>
        <li><b>Drag</b> the empty space to look around. Scroll to zoom.</li>
        <li><b>Play the story</b> to see how a request travels, one step at a time.</li>
      </ol>
      <button className="btn primary" onClick={onStory}>▶ Play the story</button>
    </aside>
  );
}

const COACH = [
  { title: "Welcome to Atlas", text: "Atlas draws how a project fits together: the apps people use, the servers, the database and the outside services, with wires between them. Think of it as a board game of your software." },
  { title: "Pieces", text: "Each box is one real thing. Phones and websites are on the left, the database is on the right. Click any piece and a card tells you what it does in plain words." },
  { title: "Wires", text: "A wire is a conversation. The arrow shows who asks and who answers. Wires that cannot work are red, and Atlas will tell you why." },
  { title: "Missions", text: "The card on the left gives you small missions. Each one teaches one idea about the system. Finish them all and you understand the whole of it." },
];
export function Coach({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const last = i === COACH.length - 1;
  return (
    <div className="modal coach" role="dialog" aria-label="Quick guide">
      <div className="sheet">
        <span className="k">Quick guide · {i + 1} of {COACH.length}</span>
        <h2>{COACH[i].title}</h2>
        <p className="note big">{COACH[i].text}</p>
        <div className="row">
          <span className="dots" aria-hidden="true">{COACH.map((_, k) => <i key={k} className={k === i ? "on" : ""} />)}</span>
          <span className="spacer" />
          <button className="btn" onClick={onDone}>Skip</button>
          <button className="btn primary" onClick={() => (last ? onDone() : setI(i + 1))}>{last ? "Start playing" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}
