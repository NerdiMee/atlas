import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas as R3F, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { CubicBezierLine, Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { MovePhase, Sel } from "./Canvas";
import HoverCard, { WireTip } from "./Hover";
import Piece3D, { HEIGHT, Studio } from "./Pieces";
import { CH, CW, KINDS, LANES, MODES, type Block, type Kind, type Link, type Problem, type System } from "./model";
import { shade } from "./Icons";

/* The board: every block is a solid piece standing on a square. Pick a piece
   up, set it down on a free square; an occupied square refuses the move. The
   2D map and the board share one set of coordinates, so a move here is a
   move there. One square is CW × CH map units. */

type Dims = { cols: number; rows: number };

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
  inset?: { left: number; right: number };
  onRefuse: (p: Problem, blockId?: string) => void;
};

type Cell = { cx: number; cz: number };
const cellOf = (b: Block): Cell => ({ cx: Math.round(b.x / CW), cz: Math.round(b.y / CH) });
const worldOf = (c: Cell, d: Dims) => new THREE.Vector3(c.cx - d.cols / 2 + 0.5, 0, c.cz - d.rows / 2 + 0.5);
const inBoard = (c: Cell, d: Dims) => c.cx >= 0 && c.cx < d.cols && c.cz >= 0 && c.cz < d.rows;
/** The board is as big as its pieces need, plus a rim of free squares. */
const dimsOf = (blocks: Block[]): Dims => {
  let cols = 6;
  let rows = 4;
  for (const b of blocks) {
    const c = cellOf(b);
    cols = Math.max(cols, c.cx + 3);
    rows = Math.max(rows, c.cz + 3);
  }
  return { cols, rows };
};

/** The matrix reads left to right the way data flows; each lane is three squares wide, as Tidy lays it out. */
const laneOf = (cx: number) => Math.min(LANES.length - 1, Math.floor(cx / 3));

/* Every piece has one side for wires in (its left face) and one for wires
   out (its right face), like a logic board. Wires on the same face get their
   own port, ordered by where the other end sits, so they fan out instead of
   overlapping. */
type Ports = Map<string, { a: THREE.Vector3; b: THREE.Vector3 }>;
function portsOf(system: System, byId: Map<string, Block>, d: Dims, fan: Map<string, number>, extra: Link[]): Ports {
  const all = [...system.links, ...extra];
  const out = new Map<string, { a: THREE.Vector3; b: THREE.Vector3 }>();
  const at = (b: Block) => worldOf(cellOf(b), d).add(new THREE.Vector3(fan.get(b.id) ?? 0, 0, 0));
  const spread = (i: number, n: number) => (i - (n - 1) / 2) * Math.min(0.24, 0.8 / Math.max(1, n));
  const key = (b: Block) => cellOf(b).cz * 1000 + cellOf(b).cx;
  for (const b of system.blocks) {
    const outs = all.filter((l) => l.from === b.id && byId.has(l.to)).sort((p, q) => key(byId.get(p.to)!) - key(byId.get(q.to)!));
    const ins = all.filter((l) => l.to === b.id && byId.has(l.from)).sort((p, q) => key(byId.get(p.from)!) - key(byId.get(q.from)!));
    const y = HEIGHT[KINDS[b.kind].symbol] * 0.5;
    const c = at(b);
    outs.forEach((l, i) => {
      const e = out.get(l.id) ?? { a: new THREE.Vector3(), b: new THREE.Vector3() };
      e.a.set(c.x + 0.5, y, c.z + spread(i, outs.length));
      out.set(l.id, e);
    });
    ins.forEach((l, i) => {
      const e = out.get(l.id) ?? { a: new THREE.Vector3(), b: new THREE.Vector3() };
      e.b.set(c.x - 0.5, y, c.z + spread(i, ins.length));
      out.set(l.id, e);
    });
  }
  return out;
}

/** The path of a wire: out of the right face, into the left face, arching over whatever lanes lie between. */
function curveOf(pa: THREE.Vector3, pb: THREE.Vector3) {
  const back = pb.x < pa.x + 0.6;
  const span = Math.abs(pb.x - pa.x);
  const dx = back ? 1.3 : Math.max(0.7, span * 0.38);
  const lift = back ? 0.9 : 0.12 + Math.max(0, span - 2.5) * 0.22;
  const m1 = new THREE.Vector3(pa.x + dx, Math.max(pa.y, pb.y) + lift, pa.z);
  const m2 = new THREE.Vector3(pb.x - dx, Math.max(pa.y, pb.y) + lift, pb.z);
  return { m1, m2, curve: new THREE.CubicBezierCurve3(pa, m1, m2, pb) };
}

/** Sets the camera to frame the whole board whenever its size changes. */
function Rig({ d, fitKey, inset }: { d: Dims; fitKey: number; inset?: { left: number; right: number } }) {
  const { camera, size } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const left = inset?.left ?? 0, right = inset?.right ?? 0;
  useEffect(() => {
    // Pull back enough that the board fits between the overlays, and slide it into the free middle.
    const free = Math.max(300, size.width - left - right);
    const zoom = 1 + (size.width / free - 1) * 0.32;
    const span = Math.max(d.cols, d.rows * 1.4) * zoom;
    const shift = (-(left - right) / 2 / size.width) * span;
    camera.position.set(shift, span * 0.9, span * 0.72);
    camera.lookAt(shift, 0, 0);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.set(shift, 0, 0);
      controls.update();
    }
  }, [camera, controls, d.cols, d.rows, fitKey, size.width, left, right]);
  return null;
}

function Piece({ b, d, sel, dim, lifted, shake, target, fan, onDown, onHover }: { b: Block; d: Dims; fan: number | undefined; sel: boolean; dim: boolean; lifted: boolean; shake: { id: string; n: number } | null; target: boolean; onDown: (e: ThreeEvent<PointerEvent>) => void; onHover: (e: ThreeEvent<PointerEvent> | null) => void }) {
  const g = useRef<THREE.Group>(null);
  const goal = useMemo(() => worldOf(cellOf(b), d).add(new THREE.Vector3(fan ?? 0, 0, 0)), [b.x, b.y, d, fan]);
  useFrame(({ clock }) => {
    const grp = g.current;
    if (!grp) return;
    grp.position.x += (goal.x - grp.position.x) * 0.18;
    grp.position.z += (goal.z - grp.position.z) * 0.18;
    grp.position.y += ((lifted ? 0.5 : 0) - grp.position.y) * 0.2;
    const age = shake && shake.id === b.id ? Date.now() - shake.n : 9999;
    if (age < 450) grp.position.x += Math.sin(clock.elapsedTime * 70) * 0.07 * (1 - age / 450);
  });
  const drawn = b.status === "drawn" || b.kind === "planned";
  return (
    <group ref={g} position={[goal.x, 0, goal.z]} onPointerDown={onDown} onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "grab"; onHover(e); }} onPointerOut={() => { document.body.style.cursor = ""; onHover(null); }}>
      <group scale={dim ? 0.6 : 1}>
        <Piece3D kind={b.kind} wire={drawn} />
      </group>
      {(sel || target || fan !== undefined) && (
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.46, 0.5, 48]} />
          <meshBasicMaterial color={fan !== undefined && !sel ? "#ff5c5c" : "#4f8cff"} transparent opacity={target ? 0.5 : 1} />
        </mesh>
      )}
      {b.status === "warn" && (
        <mesh position={[0.36, HEIGHT[KINDS[b.kind].symbol] + 0.12, 0]}>
          <sphereGeometry args={[0.06, 12, 8]} />
          <meshBasicMaterial color="#ff5c5c" />
        </mesh>
      )}
      <Html position={[0, HEIGHT[KINDS[b.kind].symbol] + 0.28, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
        <div className={`plabel${dim ? " dim" : ""}${sel ? " sel" : ""}${fan !== undefined ? " clash" : ""}`}>{b.title}{fan !== undefined ? " · shares a square" : ""}</div>
      </Html>
    </group>
  );
}

/** Reads the pointer against the board plane while a piece is held. */
function DragLayer({ dragging, d, onCell, onDrop }: { dragging: boolean; d: Dims; onCell: (c: Cell | null) => void; onDrop: () => void }) {
  const { camera, gl } = useThree();
  useEffect(() => {
    if (!dragging) return;
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    const move = (e: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      if (!ray.ray.intersectPlane(plane, hit)) return onCell(null);
      const c = { cx: Math.floor(hit.x + d.cols / 2), cz: Math.floor(hit.z + d.rows / 2) };
      onCell(inBoard(c, d) ? c : null);
    };
    const up = () => onDrop();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, d, camera, gl, onCell, onDrop]);
  return null;
}

/** Light travelling along a wire from its start to its end: the direction of the data. */
function Flow({ curve, color, seed }: { curve: THREE.Curve<THREE.Vector3>; color: string; seed: number }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const n = 3;
  const tail = 3;
  useFrame(({ clock }) => {
    const t0 = clock.elapsedTime * 0.12 + seed;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < tail; k++) {
        const m = refs.current[i * tail + k];
        if (!m) continue;
        const t = (((t0 + i / n) % 1) + 1 - k * 0.028) % 1;
        curve.getPoint(t, m.position);
        const fade = t < 0.06 ? t / 0.06 : t > 0.94 ? (1 - t) / 0.06 : 1;
        (m.material as THREE.MeshBasicMaterial).opacity = fade * (1 - k / tail) * 0.8;
      }
    }
  });
  return (
    <group>
      {Array.from({ length: n * tail }, (_, j) => (
        <mesh key={j} ref={(el) => (refs.current[j] = el)}>
          <sphereGeometry args={[j % tail === 0 ? 0.03 : 0.02, 10, 8]} />
          <meshBasicMaterial color={color} transparent opacity={0.9} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/** A soft halo under a live wire that breathes, so the eye finds the active paths. */
function Glow({ pa, m1, m2, pb, color, seed }: { pa: THREE.Vector3; m1: THREE.Vector3; m2: THREE.Vector3; pb: THREE.Vector3; color: string; seed: number }) {
  const ref = useRef<{ material: { opacity: number } } | null>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.material.opacity = 0.05 + 0.1 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 1.1 + seed));
  });
  return <CubicBezierLine ref={ref as never} start={pa} end={pb} midA={m1} midB={m2} color={color} lineWidth={4} transparent opacity={0.1} depthWrite={false} />;
}

function Wire({ a, ports, tone, dashed, ghost, label, dim, live, onSelect, onHover }: { a: Block; ports: { a: THREE.Vector3; b: THREE.Vector3 }; tone: string; dashed: boolean; ghost: boolean; label: string; dim: boolean; live: boolean; onSelect?: () => void; onHover: (on: boolean) => void }) {
  const pa = ports.a;
  const pb = ports.b;
  const { m1, m2, curve } = useMemo(() => curveOf(pa, pb), [pa.x, pa.y, pa.z, pb.x, pb.y, pb.z]); // eslint-disable-line react-hooks/exhaustive-deps
  const mid = useMemo(() => curve.getPoint(0.5), [curve]);
  // Arrowhead: a small cone just before the entry port, pointing into the left face.
  const tangent = curve.getTangent(0.97).normalize();
  const tip = pb.clone().sub(tangent.clone().multiplyScalar(0.16));
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
  const color = tone === "sel" ? "#4f8cff" : tone === "bad" ? "#ff5c5c" : tone === "warn" ? "#f2b63c" : ghost ? "#4f8cff" : "#8b939c";
  const flowColor = tone === "sel" ? "#9cc0ff" : shade(KINDS[a.kind].color, 0.35);
  const seed = useMemo(() => (a.id + label).split("").reduce((h, ch) => h + ch.charCodeAt(0), 0) % 7, [a.id, label]);
  return (
    <group>
      {live && !dim && <Glow pa={pa} m1={m1} m2={m2} pb={pb} color={tone === "sel" ? "#4f8cff" : KINDS[a.kind].color} seed={seed} />}
      {live && !dim && <Flow curve={curve} color={flowColor} seed={seed} />}
      <CubicBezierLine
        start={pa}
        end={pb}
        midA={m1}
        midB={m2}
        color={color}
        lineWidth={tone === "sel" ? 2.5 : 1.6}
        dashed={dashed || ghost}
        dashSize={ghost ? 0.12 : 0.18}
        gapSize={ghost ? 0.1 : 0.12}
        transparent
        opacity={dim ? 0.2 : ghost ? 0.75 : 1}
        onPointerDown={(e) => { e.stopPropagation(); onSelect?.(); }}
        onPointerOver={(e) => { e.stopPropagation(); onHover(true); }}
        onPointerOut={() => onHover(false)}
      />
      {/* port studs on both faces */}
      <mesh position={pa}><sphereGeometry args={[0.035, 10, 8]} /><meshBasicMaterial color={color} transparent opacity={dim ? 0.2 : 1} /></mesh>
      <mesh position={tip} quaternion={q}>
        <coneGeometry args={[0.06, 0.2, 10]} />
        <meshBasicMaterial color={color} transparent opacity={dim ? 0.2 : 1} />
      </mesh>
      {label && (
        <Html position={mid} center zIndexRange={[3, 0]} style={{ pointerEvents: "none" }}>
          <div className={`wlabel${ghost ? " ghost" : ""}${dim ? " dim" : ""}`}>{ghost ? "? " : ""}{label}</div>
        </Html>
      )}
    </group>
  );
}

export default function Board({ system, selected, hidden, focus, fitKey, linkFrom, problems, suggestions, spot, shake, onSelect, onMove, onLinkTarget, onRefuse, onHint, inset }: Props) {
  const isDim = (b: Block) => hidden.has(b.kind) || (!!focus && !focus.has(b.id));
  const [hoverBlock, setHoverBlock] = useState<{ id: string; x: number; y: number } | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const [drag, setDrag] = useState<{ id: string; from: Cell; moved: boolean } | null>(null);
  const [cell, setCell] = useState<Cell | null>(null);
  const [hover, setHover] = useState<{ id: string; ghost: boolean; x: number; y: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => () => { document.body.style.cursor = ""; }, []);
  useEffect(() => {
    if (hoverBlock) onHint?.({ block: hoverBlock.id });
    else if (hover) onHint?.({ link: hover.id, ghost: hover.ghost });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverBlock?.id, hover?.id]);
  const byId = useMemo(() => new Map(system.blocks.map((b) => [b.id, b])), [system.blocks]);
  const d = useMemo(() => dimsOf(system.blocks), [system.blocks]);
  const occupied = useMemo(() => {
    const m = new Map<string, Block>();
    for (const b of system.blocks) m.set(`${cellOf(b).cx},${cellOf(b).cz}`, b);
    return m;
  }, [system.blocks]);
  // Blocks the map placed within one square of each other land on the same
  // square here. They are fanned apart and marked, never silently stacked.
  const clash = useMemo(() => {
    const groups = new Map<string, Block[]>();
    for (const b of system.blocks) {
      const k = `${cellOf(b).cx},${cellOf(b).cz}`;
      groups.set(k, [...(groups.get(k) ?? []), b]);
    }
    const m = new Map<string, number>();
    for (const list of groups.values()) if (list.length > 1) list.forEach((b, i) => m.set(b.id, (i - (list.length - 1) / 2) * 0.34));
    return m;
  }, [system.blocks]);

  const ports = useMemo(() => portsOf(system, byId, d, clash, suggestions ?? []), [system, byId, d, clash, suggestions]);

  const pieceDown = (b: Block) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (linkFrom && linkFrom !== b.id) {
      onLinkTarget(b.id);
      return;
    }
    onSelect({ type: "block", id: b.id });
    setDrag({ id: b.id, from: cellOf(b), moved: false });
    setCell(cellOf(b));
  };

  const onCell = (c: Cell | null) => {
    setCell(c);
    if (!drag || !c) return;
    if (!drag.moved) {
      if (c.cx === drag.from.cx && c.cz === drag.from.cz) return;
      onMove(drag.id, drag.from.cx * CW, drag.from.cz * CH, "start");
      setDrag({ ...drag, moved: true });
    }
    const other = occupied.get(`${c.cx},${c.cz}`);
    if (other && other.id !== drag.id) return; // hover an occupied square: the piece waits
    onMove(drag.id, c.cx * CW, c.cz * CH, "move");
  };

  const onDrop = () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    const target = cell;
    setCell(null);
    if (!target) {
      if (d.moved) onMove(d.id, d.from.cx * CW, d.from.cz * CH, "move");
      return;
    }
    const other = occupied.get(`${target.cx},${target.cz}`);
    if (other && other.id !== d.id) {
      onMove(d.id, d.from.cx * CW, d.from.cz * CH, "move");
      onRefuse({ level: "bad", reason: `${other.title} already stands on that square. One piece per square, like the board it is on.` }, d.id);
      return;
    }
    if (d.moved) onMove(d.id, target.cx * CW, target.cz * CH, "end");
  };

  const hoveredLink = hover ? (hover.ghost ? suggestions?.find((l) => l.id === hover.id) : system.links.find((l) => l.id === hover.id)) : undefined;
  const hoveredProblem = hover && !hover.ghost ? problems.get(hover.id) : undefined;
  const hoverOccupied = cell && drag ? occupied.get(`${cell.cx},${cell.cz}`)?.id !== undefined && occupied.get(`${cell.cx},${cell.cz}`)?.id !== drag.id : false;

  return (
    <div
      ref={wrap}
      className={`board${linkFrom ? " linking" : ""}`}
    >
      <R3F shadows camera={{ position: [0, 12, 8], fov: 40 }} dpr={[1, 2]} gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }} onPointerMissed={() => onSelect(null)}>
        <Studio />
        <Rig d={d} fitKey={fitKey} inset={inset} />
        <color attach="background" args={["#0b0d10"]} />
        <fog attach="fog" args={["#0b0d10", 22, 46]} />
        <hemisphereLight args={["#dfe8f5", "#1a1d23", 0.5]} />
        <directionalLight position={[6, 14, 5]} intensity={1.3} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} />
        <pointLight position={[-8, 6, -6]} intensity={0.4} color="#4f8cff" />

        {/* the matrix: one tile per square, lanes tinted by role, a fine grid, and lane headers along the far edge */}
        {Array.from({ length: Math.ceil(d.cols / 3) }, (_, i) => {
          const x0 = -d.cols / 2 + i * 3;
          const w = Math.min(3, d.cols - i * 3);
          return (
            <group key={`lane${i}`}>
              <mesh position={[x0 + w / 2, -0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                <planeGeometry args={[w, d.rows]} />
                <meshStandardMaterial color={i % 2 ? "#161a20" : "#12161b"} roughness={0.9} metalness={0.05} />
              </mesh>
              <Html position={[x0 + w / 2, 0, d.rows / 2 + 0.4]} center zIndexRange={[3, 0]} style={{ pointerEvents: "none" }}>
                <div className="lane">{LANES[laneOf(i * 3)]}</div>
              </Html>
            </group>
          );
        })}
        <Line
          points={[
            ...Array.from({ length: d.cols + 1 }, (_, i) => [[-d.cols / 2 + i, 0, -d.rows / 2], [-d.cols / 2 + i, 0, d.rows / 2]]).flat(),
            ...Array.from({ length: d.rows + 1 }, (_, i) => [[-d.cols / 2, 0, -d.rows / 2 + i], [d.cols / 2, 0, -d.rows / 2 + i]]).flat(),
          ] as [number, number, number][]}
          segments
          color="#242a32"
          lineWidth={1}
        />
        <Line
          points={Array.from({ length: Math.ceil(d.cols / 3) }, (_, i) => [[-d.cols / 2 + i * 3, 0.002, -d.rows / 2], [-d.cols / 2 + i * 3, 0.002, d.rows / 2]]).flat() as [number, number, number][]}
          segments
          color="#3a424c"
          lineWidth={1.4}
        />
        {cell && drag && (
          <mesh position={[worldOf(cell, d).x, 0.005, worldOf(cell, d).z]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.96, 0.96]} />
            <meshBasicMaterial color={hoverOccupied ? "#5a2222" : "#1d3a2a"} />
          </mesh>
        )}
        <Html position={[-d.cols / 2, 0, -d.rows / 2 - 0.4]} zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
          <div className="lane dim">in on the left · out on the right · data flows this way →</div>
        </Html>

        {system.links.map((l) => {
          const a = byId.get(l.from);
          const b = byId.get(l.to);
          if (!a || !b) return null;
          const sel = selected?.type === "link" && selected.id === l.id;
          const prob = problems.get(l.id);
          const tone = sel ? "sel" : prob?.level ?? "";
          const pp = ports.get(l.id);
          if (!pp) return null;
          return (
            <Wire key={l.id} a={a} ports={pp} tone={tone} dashed={!!MODES[l.mode].dash} ghost={false} label={l.label} dim={isDim(a) || isDim(b)} live={!prob} onSelect={() => onSelect({ type: "link", id: l.id })} onHover={(on) => setHover(on ? { id: l.id, ghost: false, x: hover?.x ?? 0, y: hover?.y ?? 0 } : null)} />
          );
        })}
        {suggestions?.map((l) => {
          const a = byId.get(l.from);
          const b = byId.get(l.to);
          if (!a || !b) return null;
          const pp = ports.get(l.id);
          if (!pp) return null;
          return <Wire key={l.id} a={a} ports={pp} tone={spot === l.id ? "sel" : ""} dashed={false} ghost label={l.label} dim={!!spot && spot !== l.id} live={spot === l.id} onHover={(on) => setHover(on ? { id: l.id, ghost: true, x: hover?.x ?? 0, y: hover?.y ?? 0 } : null)} />;
        })}

        {system.blocks.map((b) => (
          <Piece
            key={b.id}
            b={b}
            d={d}
            fan={clash.get(b.id)}
            sel={selected?.type === "block" && selected.id === b.id}
            dim={isDim(b)}
            lifted={drag?.id === b.id}
            shake={shake}
            target={!!linkFrom && linkFrom !== b.id}
            onDown={(e) => {
              if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
              setHoverBlock(null);
              pieceDown(b)(e);
            }}
            onHover={(e) => {
              if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
              if (!e || drag) {
                setHoverBlock(null);
                return;
              }
              const r = wrap.current!.getBoundingClientRect();
              const at = { id: b.id, x: e.nativeEvent.clientX - r.left, y: e.nativeEvent.clientY - r.top };
              hoverTimer.current = window.setTimeout(() => setHoverBlock(at), 350);
            }}
          />
        ))}

        <DragLayer dragging={!!drag} d={d} onCell={onCell} onDrop={onDrop} />
        <OrbitControls enabled={!drag} enablePan makeDefault minDistance={4} maxDistance={40} maxPolarAngle={1.35} target={[0, 0, 0]} />
      </R3F>

      {hoverBlock && !drag && byId.get(hoverBlock.id) && <HoverCard b={byId.get(hoverBlock.id)!} />}
      {hoveredLink && hover && <WireTip l={hoveredLink} from={byId.get(hoveredLink.from)?.title} to={byId.get(hoveredLink.to)?.title} ghost={hover.ghost} problem={hoveredProblem} />}
    </div>
  );
}
