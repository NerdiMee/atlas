import Icon from "./Icons";
import { useState } from "react";
import { KINDS, MODES, STATUS, type Block, type Kind, type Link, type LinkMode, type Problem, type Status, type System } from "./model";
import type { Sel } from "./Canvas";
import { diffSystems, summary, type Snap } from "./diff";

type Props = {
  system: System;
  sel: Sel | null;
  problems: Map<string, Problem>;
  suggestions: Link[] | null;
  spot: string | null;
  onAccept: (id: string) => void;
  onSkip: (id: string) => void;
  onAcceptAll: () => void;
  onSelect: (sel: Sel | null) => void;
  onBlock: (id: string, patch: Partial<Block>) => void;
  onLink: (id: string, patch: Partial<Link>) => void;
  onDeleteBlock: (id: string) => void;
  onDeleteLink: (id: string) => void;
  onDuplicate: (id: string) => void;
  onStartLink: (id: string) => void;
  mode: "auto" | "versions";
  snaps: Snap[];
  onSnapshot: () => void;
  onRestore: (s: Snap) => void;
  onDeleteSnap: (at: string) => void;
  onCloseVersions: () => void;
};

export default function Panel(p: Props) {
  const { system, sel } = p;
  const block = sel?.type === "block" ? system.blocks.find((b) => b.id === sel.id) : undefined;
  const link = sel?.type === "link" ? system.links.find((l) => l.id === sel.id) : undefined;

  // Whatever is selected wins; Versions shows when nothing is.
  if (block) return <BlockPanel {...p} block={block} />;
  if (link) return <LinkPanel {...p} link={link} />;
  if (p.mode === "versions") return <VersionsPanel {...p} />;
  if (p.suggestions) return <SuggestPanel {...p} list={p.suggestions} />;
  return <SystemPanel {...p} />;
}

/** Saved versions of this map, and what changed since each one. */
function VersionsPanel({ system, snaps, onSnapshot, onRestore, onDeleteSnap, onCloseVersions, onSelect }: Props) {
  const [pick, setPick] = useState<string | null>(snaps[0]?.at ?? null);
  const snap = snaps.find((s) => s.at === pick) ?? snaps[0];
  const diff = snap ? diffSystems(snap.system, system) : [];
  const when = (iso: string) => new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <aside className="panel">
      <div>
        <h2>Versions</h2>
        <div className="sub">Save a version, change things, and see what is different.</div>
      </div>
      <div className="actions">
        <button className="btn primary" onClick={onSnapshot}>
          Save a version now
        </button>
        <button className="btn" onClick={onCloseVersions}>
          Close
        </button>
      </div>
      {snaps.length === 0 ? (
        <p className="note">No versions yet. Save one before you start changing the map, and again when you are done.</p>
      ) : (
        <>
          <div>
            <h3>Compare with</h3>
            <div className="vers">
              {snaps.map((s) => (
                <button key={s.at} className={`ver${s.at === snap?.at ? " on" : ""}`} onClick={() => setPick(s.at)}>
                  <span>{s.label || "Version"}</span>
                  <span className="mono">{when(s.at)}</span>
                </button>
              ))}
            </div>
          </div>
          {snap && (
            <div>
              <h3>Since then</h3>
              <p className="note">{summary(diff)}</p>
              <div className="diff">
                {diff.map((d) => (
                  <button key={`${d.what}-${d.id}-${d.change}`} className={`diffItem ${d.change}`} onClick={() => (d.change === "removed" ? undefined : onSelect({ type: d.what === "block" ? "block" : "link", id: d.id }))}>
                    {d.text}
                  </button>
                ))}
              </div>
              <div className="actions">
                <button className="btn" onClick={() => confirm(`Go back to the version from ${when(snap.at)}? The current map stays in Undo.`) && onRestore(snap)}>
                  Go back to this version
                </button>
                <button className="btn danger" onClick={() => onDeleteSnap(snap.at)}>
                  Delete it
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

function SystemPanel({ system, problems, onSelect }: Props) {
  const name = (id: string) => system.blocks.find((b) => b.id === id)?.title ?? "?";
  const wireProblems = system.links.filter((l) => problems.has(l.id)).map((l) => ({ l, p: problems.get(l.id)! }));
  const kinds = (Object.keys(KINDS) as Kind[]).map((k) => [k, system.blocks.filter((b) => b.kind === k).length] as const).filter(([, n]) => n > 0);
  const status = (Object.keys(STATUS) as Status[]).map((s) => [s, system.blocks.filter((b) => b.status === s).length] as const);
  const findings = system.blocks.filter((b) => b.status === "warn");
  return (
    <aside className="panel">
      <div>
        <h2>{system.name}</h2>
        <div className="sub">{system.tagline}</div>
      </div>
      <p className="note">{system.note}</p>
      <div>
        <h3>Blocks</h3>
        {kinds.map(([k, n]) => (
          <div className="row" key={k}>
            <span>
              <i className="sw" style={{ background: KINDS[k].color, marginRight: 8 }} />
              {KINDS[k].label}
            </span>
            <span className="mono">{n}</span>
          </div>
        ))}
        <div className="row">
          <span>Links</span>
          <span className="mono">{system.links.length}</span>
        </div>
      </div>
      <div>
        <h3>State</h3>
        {status.map(([s, n]) => (
          <div className="row" key={s}>
            <span>{STATUS[s].label}</span>
            <span className="mono">{n}</span>
          </div>
        ))}
      </div>
      {findings.length > 0 && (
        <div>
          <h3>Needs attention</h3>
          {findings.map((b) => (
            <div className="row issue" key={b.id}>
              <span>
                <span className="dot bad" style={{ marginRight: 8 }} />
                <button className="x" style={{ color: "var(--ink)", padding: 0 }} onClick={() => onSelect({ type: "block", id: b.id })}>
                  {b.title}
                </button>
              </span>
              <span>{b.details.find((d) => d.label.toLowerCase().startsWith("finding"))?.value ?? "open"}</span>
            </div>
          ))}
        </div>
      )}
      {wireProblems.length > 0 && (
        <div>
          <h3>Wires needing attention</h3>
          {wireProblems.map(({ l, p }) => (
            <div className="row issue" key={l.id}>
              <span>
                <span className={`dot ${p.level}`} style={{ marginRight: 8 }} />
                <button className="x" style={{ color: "var(--ink)", padding: 0, textAlign: "left" }} onClick={() => onSelect({ type: "link", id: l.id })}>
                  {name(l.from)} → {name(l.to)}
                </button>
              </span>
              <span>{p.level === "bad" ? "impossible" : "drawn only"}</span>
            </div>
          ))}
        </div>
      )}
      <p className="note">Click a block or a wire to inspect and edit it. Drag to organise, Tidy to arrange by role, Fit to frame everything. Suggest proposes wires; each waits for your Accept.</p>
    </aside>
  );
}

function BlockPanel({ system, block, problems, onBlock, onDeleteBlock, onDuplicate, onStartLink, onLink, onDeleteLink, onSelect }: Props & { block: Block }) {
  const name = (id: string) => system.blocks.find((b) => b.id === id)?.title ?? "?";
  const links = system.links.filter((l) => l.from === block.id || l.to === block.id);
  const setDetail = (i: number, patch: Partial<{ label: string; value: string }>) =>
    onBlock(block.id, { details: block.details.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  return (
    <aside className="panel">
      <div>
        <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon kind={block.kind} size={26} />
          {block.title || "Untitled block"}
        </h2>
        <div className="sub">
          <span className="status">
            <i className="sw" style={{ background: KINDS[block.kind].color }} /> {KINDS[block.kind].label} · {STATUS[block.status].label}
          </span>
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label htmlFor="f-kind">Kind</label>
          <select id="f-kind" value={block.kind} onChange={(e) => onBlock(block.id, { kind: e.target.value as Kind })}>
            {(Object.keys(KINDS) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {KINDS[k].label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-status">State</label>
          <select id="f-status" value={block.status} onChange={(e) => onBlock(block.id, { status: e.target.value as Status })}>
            {(Object.keys(STATUS) as Status[]).map((s) => (
              <option key={s} value={s}>
                {STATUS[s].label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="f-title">Title</label>
        <input id="f-title" value={block.title} onChange={(e) => onBlock(block.id, { title: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="f-sub">Subtitle</label>
        <input id="f-sub" value={block.sub} onChange={(e) => onBlock(block.id, { sub: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="f-lines">Lines on the block, one per line</label>
        <textarea id="f-lines" value={block.lines.join("\n")} onChange={(e) => onBlock(block.id, { lines: e.target.value.split("\n") })} />
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="f-w">Width</label>
          <input id="f-w" type="number" min={120} max={600} step={10} value={block.w} onChange={(e) => onBlock(block.id, { w: Math.max(120, Number(e.target.value) || 120) })} />
        </div>
      </div>

      <div>
        <h3>Details</h3>
        <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
          {block.details.map((d, i) => (
            <div className="detail" key={i}>
              <input aria-label="detail label" value={d.label} onChange={(e) => setDetail(i, { label: e.target.value })} />
              <input aria-label="detail value" value={d.value} onChange={(e) => setDetail(i, { value: e.target.value })} />
              <button className="x" aria-label="remove detail" onClick={() => onBlock(block.id, { details: block.details.filter((_, j) => j !== i) })}>
                ×
              </button>
            </div>
          ))}
          <button className="btn" onClick={() => onBlock(block.id, { details: [...block.details, { label: "", value: "" }] })}>
            Add detail
          </button>
        </div>
      </div>

      <div>
        <h3>Connections</h3>
        <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
          {links.length === 0 && <div className="note">No wires yet.</div>}
          {links.map((l) => {
            const out = l.from === block.id;
            return (
              <div key={l.id} style={{ display: "grid", gap: 4 }}>
                <div className="conn">
                  <button className="x" style={{ color: "var(--ink-2)", padding: 0, textAlign: "left" }} onClick={() => onSelect({ type: "link", id: l.id })}>
                    {problems.get(l.id) && <span className={`dot ${problems.get(l.id)!.level}`} style={{ marginRight: 6 }} />}
                    {out ? "→ " : "← "}
                    {name(out ? l.to : l.from)} · {MODES[l.mode].label}
                  </button>
                  <button className="x" aria-label="remove wire" onClick={() => onDeleteLink(l.id)}>
                    ×
                  </button>
                </div>
                <input className="wireName" aria-label="wire label" value={l.label} placeholder="what travels on this wire" onChange={(e) => onLink(l.id, { label: e.target.value })} />
              </div>
            );
          })}
          <button className="btn" onClick={() => onStartLink(block.id)}>
            Wire from here…
          </button>
        </div>
      </div>

      <div className="actions">
        <button className="btn" onClick={() => onDuplicate(block.id)}>
          Duplicate
        </button>
        <button className="btn danger" onClick={() => onDeleteBlock(block.id)}>
          Delete block
        </button>
      </div>
    </aside>
  );
}

function LinkPanel({ system, link, problems, onLink, onDeleteLink, onSelect }: Props & { link: Link }) {
  const name = (id: string) => system.blocks.find((b) => b.id === id)?.title ?? "?";
  const problem = problems.get(link.id);
  return (
    <aside className="panel">
      <div>
        <h2>Wire</h2>
        <div className="sub">
          <button className="x" style={{ color: "var(--ink-2)", padding: 0 }} onClick={() => onSelect({ type: "block", id: link.from })}>
            {name(link.from)}
          </button>
          {" → "}
          <button className="x" style={{ color: "var(--ink-2)", padding: 0 }} onClick={() => onSelect({ type: "block", id: link.to })}>
            {name(link.to)}
          </button>
        </div>
      </div>
      <div className="field">
        <label htmlFor="l-label">Label</label>
        <input id="l-label" value={link.label} onChange={(e) => onLink(link.id, { label: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="l-mode">Transport</label>
        <select id="l-mode" value={link.mode} onChange={(e) => onLink(link.id, { mode: e.target.value as LinkMode })}>
          {(Object.keys(MODES) as LinkMode[]).map((m) => (
            <option key={m} value={m}>
              {MODES[m].label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="l-why">Why these two talk, and what travels</label>
        <textarea id="l-why" value={link.why} placeholder="Shown when anyone hovers this wire." onChange={(e) => onLink(link.id, { why: e.target.value })} />
      </div>
      {problem && (
        <div className={`toast-inline ${problem.level}`} role="note">
          <b>{problem.level === "bad" ? "Impossible" : "Flagged"}</b> · {problem.reason}
        </div>
      )}
      <div className="actions">
        <button className="btn" onClick={() => onLink(link.id, { from: link.to, to: link.from })}>
          Reverse direction
        </button>
        <button className="btn danger" onClick={() => onDeleteLink(link.id)}>
          Delete wire
        </button>
      </div>
    </aside>
  );
}

function SuggestPanel({ system, list, spot, onAccept, onSkip, onAcceptAll }: Props & { list: Link[] }) {
  const name = (id: string) => system.blocks.find((b) => b.id === id)?.title ?? "?";
  return (
    <aside className="panel">
      <div>
        <h2>Suggested wiring</h2>
        <div className="sub">
          {list.length === 0 ? "Nothing left to suggest." : `${list.length} wire${list.length === 1 ? "" : "s"} proposed. Each one waits for your say.`}
        </div>
      </div>
      <p className="note">Proposals come from how these kinds of blocks talk in practice: clients through the API, servers with the connection string, Realtime pushing out, the admin path for schema. They are drawn as dotted blue wires until you accept them.</p>
      {list.length > 0 && (
        <div className="actions">
          <button className="btn primary" onClick={onAcceptAll}>
            Accept all {list.length}
          </button>
        </div>
      )}
      <div style={{ display: "grid", gap: 10 }}>
        {list.map((l) => (
          <div className={`sugg${spot === l.id ? " spot" : ""}`} key={l.id} ref={spot === l.id ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}>
            <div className="sugg-h">
              <b>{name(l.from)}</b> → <b>{name(l.to)}</b>
              <span>{MODES[l.mode].label}</span>
            </div>
            <div className="sugg-l">{l.label}</div>
            <div className="note">{l.why}</div>
            <div className="actions">
              <button className="btn" onClick={() => onAccept(l.id)}>
                Accept
              </button>
              <button className="btn" onClick={() => onSkip(l.id)}>
                Skip
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
