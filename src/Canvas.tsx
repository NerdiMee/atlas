import { useEffect, useMemo, useRef, useState } from "react";
import HoverCard, { WireTip } from "./Hover";
import type { CSSProperties, PointerEvent as RPointerEvent, WheelEvent as RWheelEvent } from "react";
import Icon from "./Icons";
import { KINDS, MODES, blockHeight, type Block, type Kind, type Link, type Problem, type System } from "./model";

export type Sel = { type: "block" | "link"; id: string };
export type MovePhase = "start" | "move" | "end";

type Props = {
  system: System;
  selected: Sel | null;
  hidden: Set<Kind>;
  focus: Set<string> | null;
  fitKey: number;
  linkFrom: string | null;
  problems: Map<string, Problem>;
  suggestions: Link[] | null;
  spot: string | null;
  shake: { id: string; n: number } | null;
  onSelect: (sel: Sel | null) => void;
  onMove: (id: string, x: number, y: number, phase: MovePhase) => void;
  onLinkTarget: (id: string) => void;
  /** The pointer is resting on this block or wire: a chance to get its explanation ready. */
  onHint?: (h: { block?: string; link?: string; ghost?: boolean }) => void;
  /** Overlay widths Fit keeps clear: the cards on the left and right of the stage. */
  inset?: { left: number; right: number };
};

type View = { x: number; y: number; k: number };
type Pt = { x: number; y: number };
type Side = "l" | "r" | "t" | "b";

const GRID = 10;
const NORMAL: Record<Side, Pt> = { l: { x: -1, y: 0 }, r: { x: 1, y: 0 }, t: { x: 0, y: -1 }, b: { x: 0, y: 1 } };

function centre(b: Block): Pt {
  return { x: b.x + b.w / 2, y: b.y + blockHeight(b) / 2 };
}

/** Wires leave a block from its right edge and enter the next from its left
 *  edge, like a logic board; the shift picks the port along that edge. */
function anchor(b: Block, out: boolean, shift: number): { p: Pt; side: Side } {
  const c = centre(b);
  return out ? { p: { x: b.x + b.w, y: c.y + shift }, side: "r" } : { p: { x: b.x, y: c.y + shift }, side: "l" };
}

function bezier(a: Pt, na: Pt, b: Pt, nb: Pt, t: number) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const back = b.x < a.x + 40; // heading left: loop out and around
  const d = back ? Math.max(90, dist / 2.5) : Math.max(36, dist / 3);
  const p1 = { x: a.x + na.x * d, y: a.y + na.y * d };
  const p2 = { x: b.x + nb.x * d, y: b.y + nb.y * d };
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  const mid = {
    x: w[0] * a.x + w[1] * p1.x + w[2] * p2.x + w[3] * b.x,
    y: w[0] * a.y + w[1] * p1.y + w[2] * p2.y + w[3] * b.y,
  };
  return { d: `M${a.x},${a.y} C${p1.x},${p1.y} ${p2.x},${p2.y} ${b.x},${b.y}`, mid };
}

export default function Canvas({ system, selected, hidden, focus, fitKey, linkFrom, problems, suggestions, spot, shake, onSelect, onMove, onLinkTarget, onHint, inset }: Props) {
  const [view, setView] = useState<View>({ x: 200, y: 70, k: 0.8 });
  const [hoverBlock, setHoverBlock] = useState<{ id: string; x: number; y: number } | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const isDim = (b: Block) => hidden.has(b.kind) || (!!focus && !focus.has(b.id));

  // Fit: frame every block in the space left of the panel and right of the legend.
  useEffect(() => {
    const host = el.current;
    if (!host || system.blocks.length === 0) return;
    const minX = Math.min(...system.blocks.map((b) => b.x));
    const minY = Math.min(...system.blocks.map((b) => b.y));
    const maxX = Math.max(...system.blocks.map((b) => b.x + b.w));
    const maxY = Math.max(...system.blocks.map((b) => b.y + blockHeight(b)));
    const left = inset?.left ?? 200;
    const availW = host.clientWidth - left - (inset?.right ?? 380);
    const availH = host.clientHeight - 100;
    const k = Math.min(1.4, Math.max(0.3, Math.min(availW / (maxX - minX + 40), availH / (maxY - minY + 40))));
    setView({ k, x: left + (availW - (maxX - minX) * k) / 2 - minX * k, y: 50 + (availH - (maxY - minY) * k) / 2 - minY * k });
    // Runs on Fit, when the system changes identity or its blocks first arrive, and when the overlays change; not on every block move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, system.id, system.blocks.length > 0, inset?.left, inset?.right]);
  const [panning, setPanning] = useState(false);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (hoverBlock) onHint?.({ block: hoverBlock.id });
    else if (hover) onHint?.({ link: hover.id, ghost: !!suggestions?.some((l) => l.id === hover.id) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverBlock?.id, hover?.id]);
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const drag = useRef<{ id: string; sx: number; sy: number; bx: number; by: number; moved: boolean } | null>(null);
  const el = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(system.blocks.map((b) => [b.id, b])), [system.blocks]);

  const onWheel = (e: RWheelEvent) => {
    const rect = el.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView((v) => {
      const k = Math.min(2.5, Math.max(0.3, v.k * Math.exp(-e.deltaY * 0.0012)));
      return { k, x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k) };
    });
  };

  const bgDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    pan.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    el.current!.setPointerCapture(e.pointerId);
    setPanning(true);
  };
  const bgMove = (e: RPointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    if (!p) return;
    setView((v) => ({ ...v, x: p.vx + (e.clientX - p.sx), y: p.vy + (e.clientY - p.sy) }));
  };
  const bgUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pan.current) return;
    const moved = Math.hypot(e.clientX - pan.current.sx, e.clientY - pan.current.sy) > 3;
    pan.current = null;
    setPanning(false);
    if (!moved) onSelect(null);
  };

  const blockDown = (b: Block) => (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (linkFrom && linkFrom !== b.id) {
      onLinkTarget(b.id);
      return;
    }
    onSelect({ type: "block", id: b.id });
    drag.current = { id: b.id, sx: e.clientX, sy: e.clientY, bx: b.x, by: b.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const blockMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const nx = Math.round((d.bx + (e.clientX - d.sx) / view.k) / GRID) * GRID;
    const ny = Math.round((d.by + (e.clientY - d.sy) / view.k) / GRID) * GRID;
    if (!d.moved) {
      if (nx === d.bx && ny === d.by) return;
      d.moved = true;
      onMove(d.id, d.bx, d.by, "start");
    }
    onMove(d.id, nx, ny, "move");
  };
  const blockUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.moved) {
      const b = byId.get(d.id);
      if (b) onMove(d.id, b.x, b.y, "end");
    }
  };

  const hoverMove = (l: Link) => () => setHover((h) => (h?.id === l.id ? h : { id: l.id, x: 0, y: 0 }));

  // Each block has one edge for wires in and one for wires out; a block with
  // several on one edge gives each its own port, ordered by the other end.
  const wires = useMemo(() => {
    const all = [...system.links, ...(suggestions ?? [])];
    const ghosts = new Set((suggestions ?? []).map((l) => l.id));
    const port = new Map<string, { out: number; inn: number }>();
    for (const b of system.blocks) {
      const outs = all.filter((l) => l.from === b.id && byId.has(l.to)).sort((p, q) => centre(byId.get(p.to)!).y - centre(byId.get(q.to)!).y);
      const ins = all.filter((l) => l.to === b.id && byId.has(l.from)).sort((p, q) => centre(byId.get(p.from)!).y - centre(byId.get(q.from)!).y);
      const step = (n: number) => Math.min(22, (blockHeight(b) - 16) / Math.max(1, n));
      outs.forEach((l, i) => port.set(l.id, { ...(port.get(l.id) ?? { out: 0, inn: 0 }), out: (i - (outs.length - 1) / 2) * step(outs.length) }));
      ins.forEach((l, i) => port.set(l.id, { ...(port.get(l.id) ?? { out: 0, inn: 0 }), inn: (i - (ins.length - 1) / 2) * step(ins.length) }));
    }
    const out: { l: Link; d: string; mid: Pt; dim: boolean; ghost: boolean }[] = [];
    for (const l of all) {
      const a = byId.get(l.from);
      const b = byId.get(l.to);
      if (!a || !b) continue;
      const pp = port.get(l.id) ?? { out: 0, inn: 0 };
      const sa = anchor(a, true, pp.out);
      const sb = anchor(b, false, pp.inn);
      const { d, mid } = bezier(sa.p, NORMAL[sa.side], sb.p, NORMAL[sb.side], 0.5);
      out.push({ l, d, mid, dim: isDim(a) || isDim(b), ghost: ghosts.has(l.id) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system.links, system.blocks, suggestions, byId, hidden, focus]);

  const hovered = hover ? [...system.links, ...(suggestions ?? [])].find((l) => l.id === hover.id) : undefined;
  const hoveredProblem = hover ? problems.get(hover.id) : undefined;

  const bg = {
    backgroundImage: "radial-gradient(var(--grid) 1px, transparent 1px)",
    backgroundSize: `${24 * view.k}px ${24 * view.k}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
  };

  return (
    <div
      ref={el}
      className={`canvas${panning ? " panning" : ""}${linkFrom ? " linking" : ""}`}
      style={bg}
      onWheel={onWheel}
      onPointerDown={bgDown}
      onPointerMove={bgMove}
      onPointerUp={bgUp}
      onPointerCancel={bgUp}
    >
      <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="wires" width="1" height="1" style={{ overflow: "visible" }} aria-hidden="true">
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--ink-2)" />
            </marker>
            <marker id="arr-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--focus)" />
            </marker>
            <marker id="arr-bad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--bad)" />
            </marker>
            <marker id="arr-warn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--warn)" />
            </marker>
          </defs>
          {wires.map(({ l, d, mid, dim, ghost }) => {
            const sel = selected?.type === "link" && selected.id === l.id;
            const prob = problems.get(l.id);
            const tone = ghost ? "ghost" : sel ? "sel" : prob?.level ?? "";
            return (
              <g key={l.id}>
                <path
                  className={`wire ${tone}${dim ? " dim" : ""}${hover?.id === l.id ? " hot" : ""}${ghost && spot === l.id ? " spot" : ""}${ghost && spot && spot !== l.id ? " faded" : ""}`}
                  d={d}
                  strokeDasharray={ghost ? "3 4" : MODES[l.mode].dash || undefined}
                  markerEnd={`url(#arr${tone === "ghost" ? "-sel" : tone ? `-${tone}` : ""})`}
                />
                {!ghost && !prob && !dim && (
                  <path className="flow" d={d} style={{ stroke: KINDS[byId.get(l.from)!.kind].color, animationDelay: `${-(l.id.charCodeAt(2) % 9) * 0.3}s` }} />
                )}
                <path
                  className="hit"
                  d={d}
                  tabIndex={0}
                  role="button"
                  aria-label={`wire ${l.label || "unlabelled"} from ${byId.get(l.from)?.title} to ${byId.get(l.to)?.title}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (!ghost) onSelect({ type: "link", id: l.id });
                  }}
                  onKeyDown={(e) => {
                    if (!ghost && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onSelect({ type: "link", id: l.id });
                    }
                  }}
                  onPointerEnter={hoverMove(l)}
                  onPointerMove={hoverMove(l)}
                  onPointerLeave={() => setHover(null)}
                />
                {l.label && (
                  <text className={`${dim ? "dim" : ""}${ghost ? " ghost" : ""}${ghost && spot && spot !== l.id ? " faded" : ""}`} x={mid.x} y={mid.y - 6} textAnchor="middle">
                    {ghost ? "? " : ""}
                    {l.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {system.blocks.map((b) => {
          const sel = selected?.type === "block" && selected.id === b.id;
          const cls = [
            "block",
            b.status === "drawn" ? "drawn" : "",
            sel ? "sel" : "",
            isDim(b) ? "dim" : "",
            linkFrom && linkFrom !== b.id ? "target" : "",
            shake?.id === b.id ? "shake" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              key={shake?.id === b.id ? `${b.id}-${shake.n}` : b.id}
              className={cls}
              style={{ left: b.x, top: b.y, width: b.w, height: blockHeight(b), "--kc": KINDS[b.kind].color } as CSSProperties}
              tabIndex={0}
              role="button"
              aria-pressed={sel}
              onPointerDown={(e) => {
                if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
                setHoverBlock(null);
                blockDown(b)(e);
              }}
              onPointerMove={blockMove}
              onPointerUp={blockUp}
              onPointerCancel={blockUp}
              onPointerEnter={(e) => {
                const rect = el.current!.getBoundingClientRect();
                const at = { id: b.id, x: e.clientX - rect.left, y: e.clientY - rect.top };
                if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
                hoverTimer.current = window.setTimeout(() => !drag.current && setHoverBlock(at), 350);
              }}
              onPointerLeave={() => {
                if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
                setHoverBlock(null);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                if (linkFrom && linkFrom !== b.id) onLinkTarget(b.id);
                else onSelect({ type: "block", id: b.id });
              }}
              title={b.title}
            >
              <div className="ico">
                <Icon kind={b.kind} size={30} />
              </div>
              <div className="body">
                <div className="t">
                  {b.status === "warn" && <span className="flag" aria-label="needs attention" />}
                  {b.title}
                </div>
                {b.sub && <div className="s">{b.sub}</div>}
                {b.lines.map((ln, i) => (
                  <div className="l" key={i}>
                    {ln}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {hoverBlock && byId.get(hoverBlock.id) && !drag.current && <HoverCard b={byId.get(hoverBlock.id)!} />}
      {hovered && hover && <WireTip l={hovered} from={byId.get(hovered.from)?.title} to={byId.get(hovered.to)?.title} ghost={!!suggestions?.some((x) => x.id === hovered.id)} problem={hoveredProblem} />}
    </div>
  );
}
