import { useEffect, useMemo, useRef, useState } from "react";
import { easeCubicInOut, easeCubicOut, interpolate, select, timer, zoom as d3zoom, zoomIdentity, type ZoomBehavior } from "d3";
import HoverCard, { WireTip } from "./Hover";
import type { CSSProperties, PointerEvent as RPointerEvent } from "react";
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
  /** Blocks the view should glide to and frame (the story's current step). */
  flyTo?: Set<string> | null;
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

export default function Canvas({ system, selected, hidden, focus, fitKey, linkFrom, problems, suggestions, spot, shake, onSelect, onMove, onLinkTarget, onHint, inset, flyTo }: Props) {
  const [view, setView] = useState<View>({ x: 200, y: 70, k: 0.8 });
  const [hoverBlock, setHoverBlock] = useState<{ id: string; x: number; y: number } | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const isDim = (b: Block) => hidden.has(b.kind) || (!!focus && !focus.has(b.id));

  const [panning, setPanning] = useState(false);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (hoverBlock) onHint?.({ block: hoverBlock.id });
    else if (hover) onHint?.({ link: hover.id, ghost: !!suggestions?.some((l) => l.id === hover.id) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverBlock?.id, hover?.id]);
  const press = useRef<{ sx: number; sy: number } | null>(null);
  const drag = useRef<{ id: string; sx: number; sy: number; bx: number; by: number; moved: boolean } | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const reduce = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const [zoomReady, setZoomReady] = useState(false);
  const fitted = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  // Pan and zoom are d3-zoom: wheel zooms about the pointer, drag on empty space pans,
  // and Fit or a story step glide there instead of jumping.
  useEffect(() => {
    const host = el.current;
    if (!host) return;
    const z = d3zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.3, 2.5])
      .filter((e: Event & { button?: number }) => {
        if (e.type === "wheel") return true;
        if (e.button) return false;
        const t = e.target as Element | null;
        return !t?.closest(".block") && !t?.closest(".hit");
      })
      .on("start", (e) => { if (e.sourceEvent && e.sourceEvent.type !== "wheel") setPanning(true); })
      .on("zoom", (e) => setView({ x: e.transform.x, y: e.transform.y, k: e.transform.k }))
      .on("end", () => setPanning(false));
    select(host).call(z).on("dblclick.zoom", null);
    zoomRef.current = z;
    setZoomReady(true);
    return () => { select(host).on(".zoom", null); zoomRef.current = null; };
  }, []);

  // The story's step: frame those blocks in the free middle, keeping the scale unless they would not fit.
  useEffect(() => {
    const host = el.current;
    const z = zoomRef.current;
    if (!host || !z || !flyTo || flyTo.size === 0) return;
    const bs = system.blocks.filter((b) => flyTo.has(b.id));
    if (!bs.length) return;
    const minX = Math.min(...bs.map((b) => b.x)), maxX = Math.max(...bs.map((b) => b.x + b.w));
    const minY = Math.min(...bs.map((b) => b.y)), maxY = Math.max(...bs.map((b) => b.y + blockHeight(b)));
    const left = inset?.left ?? 200, right = inset?.right ?? 380;
    const availW = host.clientWidth - left - right, availH = host.clientHeight - 100;
    const k = Math.max(0.6, Math.min(viewRef.current.k, availW / (maxX - minX + 120), availH / (maxY - minY + 120)));
    const t = zoomIdentity.translate(left + availW / 2 - ((minX + maxX) / 2) * k, 50 + availH / 2 - ((minY + maxY) / 2) * k).scale(k);
    select(host).transition().duration(reduce ? 0 : 700).ease(easeCubicInOut).call(z.transform, t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo]);

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
    const t = zoomIdentity.translate(left + (availW - (maxX - minX) * k) / 2 - minX * k, 50 + (availH - (maxY - minY) * k) / 2 - minY * k).scale(k);
    const z = zoomRef.current;
    if (!z) return;
    if (!fitted.current && flyTo?.size) { fitted.current = true; return; } // a story step is already framing the map
    const v = viewRef.current;
    if (fitted.current && Math.abs(v.x - t.x) < 0.5 && Math.abs(v.y - t.y) < 0.5 && Math.abs(v.k - t.k) < 0.001) return;
    if (fitted.current) select(host).transition().duration(reduce ? 0 : 650).ease(easeCubicInOut).call(z.transform, t);
    else select(host).call(z.transform, t);
    fitted.current = true;
    // Runs on Fit, when the system changes identity or its blocks first arrive, and when the overlays change; not on every block move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, system.id, system.blocks.length > 0, inset?.left, inset?.right, zoomReady]);
  // Where each block is drawn. A dragged block follows the pointer; any other move (Tidy, undo, a load) glides.
  const [shown, setShown] = useState<Map<string, Pt>>(() => new Map(system.blocks.map((b) => [b.id, { x: b.x, y: b.y }])));
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    const cur = shownRef.current;
    const moved = system.blocks.filter((b) => { const p = cur.get(b.id); return !p || p.x !== b.x || p.y !== b.y; });
    const gone = [...cur.keys()].some((id) => !byId.has(id));
    if (!moved.length && !gone) return;
    const snap = reduce || !!drag.current || moved.every((b) => !cur.has(b.id));
    if (snap) {
      setShown(new Map(system.blocks.map((b) => [b.id, { x: b.x, y: b.y }])));
      return;
    }
    const from = new Map(moved.map((b) => [b.id, cur.get(b.id) ?? { x: b.x, y: b.y }]));
    const lerp = new Map(moved.map((b) => [b.id, interpolate(from.get(b.id)!, { x: b.x, y: b.y })]));
    const t = timer((ms) => {
      const u = easeCubicOut(Math.min(1, ms / 520));
      setShown(new Map(system.blocks.map((b) => [b.id, lerp.has(b.id) ? lerp.get(b.id)!(u) : shownRef.current.get(b.id) ?? { x: b.x, y: b.y }])));
      if (u >= 1) t.stop();
    });
    return () => t.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system.blocks]);
  const placed = useMemo(() => system.blocks.map((b) => ({ ...b, ...(shown.get(b.id) ?? {}) })), [system.blocks, shown]);

  const byId = useMemo(() => new Map(system.blocks.map((b) => [b.id, b])), [system.blocks]);

  // A press on empty space that does not travel clears the selection; the travelling kind is a pan, which d3-zoom handles.
  const bgDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    press.current = { sx: e.clientX, sy: e.clientY };
  };
  const bgUp = (e: RPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    press.current = null;
    if (p && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) <= 3) onSelect(null);
  };

  const blockDown = (b: Block) => (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (linkFrom && linkFrom !== b.id) {
      onLinkTarget(b.id);
      return;
    }
    onSelect({ type: "block", id: b.id });
    const real = byId.get(b.id) ?? b; // not the in-flight position if it is still gliding
    drag.current = { id: b.id, sx: e.clientX, sy: e.clientY, bx: real.x, by: real.y, moved: false };
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
    const pById = new Map(placed.map((b) => [b.id, b]));
    for (const b of placed) {
      const outs = all.filter((l) => l.from === b.id && pById.has(l.to)).sort((p, q) => centre(pById.get(p.to)!).y - centre(pById.get(q.to)!).y);
      const ins = all.filter((l) => l.to === b.id && pById.has(l.from)).sort((p, q) => centre(pById.get(p.from)!).y - centre(pById.get(q.from)!).y);
      const step = (n: number) => Math.min(22, (blockHeight(b) - 16) / Math.max(1, n));
      outs.forEach((l, i) => port.set(l.id, { ...(port.get(l.id) ?? { out: 0, inn: 0 }), out: (i - (outs.length - 1) / 2) * step(outs.length) }));
      ins.forEach((l, i) => port.set(l.id, { ...(port.get(l.id) ?? { out: 0, inn: 0 }), inn: (i - (ins.length - 1) / 2) * step(ins.length) }));
    }
    const out: { l: Link; d: string; mid: Pt; dim: boolean; ghost: boolean }[] = [];
    for (const l of all) {
      const a = pById.get(l.from);
      const b = pById.get(l.to);
      if (!a || !b) continue;
      const pp = port.get(l.id) ?? { out: 0, inn: 0 };
      const sa = anchor(a, true, pp.out);
      const sb = anchor(b, false, pp.inn);
      const { d, mid } = bezier(sa.p, NORMAL[sa.side], sb.p, NORMAL[sb.side], 0.5);
      out.push({ l, d, mid, dim: isDim(a) || isDim(b), ghost: ghosts.has(l.id) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system.links, placed, suggestions, hidden, focus]);

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
      onPointerDown={bgDown}
      onPointerUp={bgUp}
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

        {placed.map((b) => {
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
