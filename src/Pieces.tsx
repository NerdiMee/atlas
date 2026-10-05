import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment, Lightformer, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { shade } from "./Icons";
import { KINDS, type Kind } from "./model";

/* The pieces: small product-render objects. Chrome and brushed metal with a
   studio reflection, tinted plastic for the parts that carry the kind's
   colour, glowing screens. A site is a monitor, a handset a phone, Supabase
   a rack of servers with live LEDs, a database a stack of disks, an outside
   service a globe, the admin path a chrome gear, Vercel its triangle.
   A drawn-only block is the same object as a wireframe. Every piece stands
   on y = 0 inside one square. */

/** Top of each piece, so labels and wires know where it ends. */
export const HEIGHT: Record<string, number> = { monitor: 0.84, tower: 0.74, phone: 0.74, server: 0.9, triangle: 0.82, gear: 0.86, disks: 0.7, globe: 0.82, ghost: 0.6 };

/** The studio: a mid-grey backdrop so metal reads as metal, a big soft top light, two side panels, a dark floor. Baked once. */
export function Studio() {
  return (
    <Environment resolution={256} frames={1}>
      <mesh scale={60}>
        <sphereGeometry args={[1, 32, 16]} />
        <meshBasicMaterial color="#6e7680" side={THREE.BackSide} />
      </mesh>
      <Lightformer intensity={3} rotation-x={Math.PI / 2} position={[0, 8, 0]} scale={[16, 10, 1]} form="rect" />
      <Lightformer intensity={1.4} rotation-y={Math.PI / 2} position={[-10, 3, 0]} scale={[8, 5, 1]} form="rect" color="#e4ecff" />
      <Lightformer intensity={1.4} rotation-y={-Math.PI / 2} position={[10, 3, 0]} scale={[8, 5, 1]} form="rect" color="#fff0dc" />
      <Lightformer intensity={0.8} position={[0, 2, 12]} scale={[14, 3, 1]} form="rect" />
      <Lightformer intensity={0} rotation-x={-Math.PI / 2} position={[0, -6, 0]} scale={[40, 40, 1]} form="rect" color="#000000" />
    </Environment>
  );
}

type Wire = { wire: boolean };
const Chrome = ({ wire, tone = "#d3d8df" }: Wire & { tone?: string }) => <meshStandardMaterial color={tone} metalness={1} roughness={0.22} envMapIntensity={1.3} wireframe={wire} transparent={wire} opacity={wire ? 0.9 : 1} />;
const Steel = ({ wire, tone = "#3a4048" }: Wire & { tone?: string }) => <meshStandardMaterial color={tone} metalness={0.85} roughness={0.38} envMapIntensity={1} wireframe={wire} transparent={wire} opacity={wire ? 0.9 : 1} />;
const Plastic = ({ wire, c, glow = 0.12 }: Wire & { c: string; glow?: number }) => <meshStandardMaterial color={c} emissive={c} emissiveIntensity={glow} metalness={0.2} roughness={0.42} envMapIntensity={0.8} wireframe={wire} transparent={wire} opacity={wire ? 0.9 : 1} />;
const Screen = ({ wire, c, glow = 0.7 }: Wire & { c: string; glow?: number }) => <meshStandardMaterial color={c} emissive={c} emissiveIntensity={glow} metalness={0} roughness={0.15} envMapIntensity={0.6} wireframe={wire} toneMapped={false} />;

/** A small light that breathes, out of phase with its neighbours. */
function Led({ position, color, phase, wire }: { position: [number, number, number]; color: string; phase: number; wire: boolean }) {
  const m = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (m.current) m.current.emissiveIntensity = 0.8 + 1.4 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 2.6 + phase));
  });
  return (
    <mesh position={position}>
      <sphereGeometry args={[0.02, 10, 8]} />
      <meshStandardMaterial ref={m} color={color} emissive={color} emissiveIntensity={1} wireframe={wire} toneMapped={false} />
    </mesh>
  );
}

function Monitor({ c, wire }: { c: string; wire: boolean }) {
  return (
    <group>
      <mesh position={[0, 0.025, 0.02]} castShadow><cylinderGeometry args={[0.24, 0.27, 0.05, 40]} /><Chrome wire={wire} /></mesh>
      <mesh position={[0, 0.16, -0.04]} castShadow><boxGeometry args={[0.08, 0.24, 0.05]} /><Chrome wire={wire} /></mesh>
      <group position={[0, 0.54, 0]} rotation={[-0.1, 0, 0]}>
        <RoundedBox args={[0.9, 0.58, 0.05]} radius={0.02} smoothness={4} castShadow><Steel wire={wire} tone="#2a2f36" /></RoundedBox>
        <mesh position={[0, 0.005, 0.028]}><planeGeometry args={[0.82, 0.5]} /><Screen wire={wire} c={c} /></mesh>
        <mesh position={[0, 0.215, 0.031]}><planeGeometry args={[0.82, 0.07]} /><Screen wire={wire} c={shade(c, 0.55)} glow={0.5} /></mesh>
        <mesh position={[-0.3, 0.215, 0.033]}><planeGeometry args={[0.18, 0.035]} /><Steel wire={wire} tone="#1a1e24" /></mesh>
        <mesh position={[0.1, -0.06, 0.031]}><planeGeometry args={[0.5, 0.2]} /><Screen wire={wire} c={shade(c, 0.25)} glow={0.45} /></mesh>
      </group>
    </group>
  );
}

function Tower({ c, wire }: { c: string; wire: boolean }) {
  return (
    <group>
      <RoundedBox args={[0.34, 0.74, 0.5]} radius={0.025} smoothness={4} position={[-0.27, 0.37, 0]} castShadow><Steel wire={wire} tone="#2a2f36" /></RoundedBox>
      <mesh position={[-0.27, 0.58, 0.252]}><planeGeometry args={[0.26, 0.06]} /><Plastic wire={wire} c={c} glow={0.35} /></mesh>
      <mesh position={[-0.27, 0.48, 0.252]}><planeGeometry args={[0.26, 0.06]} /><Plastic wire={wire} c={c} glow={0.35} /></mesh>
      <mesh position={[-0.27, 0.1, 0.252]}><planeGeometry args={[0.26, 0.08]} /><Chrome wire={wire} /></mesh>
      <Led position={[-0.27, 0.68, 0.26]} color={c} phase={0} wire={wire} />
      <mesh position={[0.2, 0.02, 0.05]} castShadow><cylinderGeometry args={[0.16, 0.18, 0.04, 36]} /><Chrome wire={wire} /></mesh>
      <mesh position={[0.2, 0.12, 0]}><boxGeometry args={[0.06, 0.16, 0.04]} /><Chrome wire={wire} /></mesh>
      <group position={[0.2, 0.4, 0]} rotation={[-0.1, 0, 0]}>
        <RoundedBox args={[0.58, 0.42, 0.04]} radius={0.015} smoothness={4} castShadow><Steel wire={wire} tone="#2a2f36" /></RoundedBox>
        <mesh position={[0, 0, 0.022]}><planeGeometry args={[0.5, 0.34]} /><Screen wire={wire} c={c} /></mesh>
      </group>
    </group>
  );
}

function Phone({ c, wire }: { c: string; wire: boolean }) {
  return (
    <group rotation={[0, 0.35, 0]}>
      <group position={[0, 0.37, 0]} rotation={[-0.08, 0, 0]}>
        <RoundedBox args={[0.38, 0.74, 0.07]} radius={0.04} smoothness={5} castShadow><Chrome wire={wire} tone="#b9bfc8" /></RoundedBox>
        <RoundedBox args={[0.34, 0.7, 0.075]} radius={0.035} smoothness={5}><Steel wire={wire} tone="#14181d" /></RoundedBox>
        <mesh position={[0, 0, 0.039]}><planeGeometry args={[0.3, 0.64]} /><Screen wire={wire} c={c} /></mesh>
        <mesh position={[0, 0.29, 0.041]}><planeGeometry args={[0.1, 0.026]} /><Steel wire={wire} tone="#0d1013" /></mesh>
        <mesh position={[0, 0.16, 0.041]}><planeGeometry args={[0.22, 0.06]} /><Screen wire={wire} c={shade(c, 0.55)} glow={0.5} /></mesh>
        <mesh position={[0, 0.05, 0.041]}><planeGeometry args={[0.22, 0.035]} /><Screen wire={wire} c={shade(c, 0.55)} glow={0.3} /></mesh>
        <mesh position={[0, -0.1, 0.041]}><planeGeometry args={[0.22, 0.14]} /><Screen wire={wire} c={shade(c, 0.25)} glow={0.45} /></mesh>
      </group>
    </group>
  );
}

function Server({ c, wire }: { c: string; wire: boolean }) {
  const units = [0.16, 0.36, 0.56, 0.76];
  return (
    <group>
      <RoundedBox args={[0.54, 0.9, 0.5]} radius={0.02} smoothness={4} position={[0, 0.45, 0]} castShadow><Steel wire={wire} tone="#262b32" /></RoundedBox>
      <mesh position={[-0.255, 0.45, 0.25]}><boxGeometry args={[0.03, 0.9, 0.03]} /><Chrome wire={wire} /></mesh>
      <mesh position={[0.255, 0.45, 0.25]}><boxGeometry args={[0.03, 0.9, 0.03]} /><Chrome wire={wire} /></mesh>
      {units.map((y, i) => (
        <group key={y} position={[0, y, 0.252]}>
          <RoundedBox args={[0.46, 0.15, 0.02]} radius={0.008} smoothness={3}><Plastic wire={wire} c={shade(c, -0.3)} glow={0.2} /></RoundedBox>
          <mesh position={[-0.09, 0.015, 0.012]}><planeGeometry args={[0.24, 0.028]} /><Steel wire={wire} tone="#161a1f" /></mesh>
          <mesh position={[-0.09, -0.035, 0.012]}><planeGeometry args={[0.24, 0.02]} /><Steel wire={wire} tone="#161a1f" /></mesh>
          <mesh position={[0.15, -0.03, 0.012]}><planeGeometry args={[0.1, 0.03]} /><Chrome wire={wire} /></mesh>
          <Led position={[0.13, 0.035, 0.02]} color={shade(c, 0.45)} phase={i * 1.7} wire={wire} />
          <Led position={[0.18, 0.035, 0.02]} color="#f2b63c" phase={i * 2.3 + 1} wire={wire} />
        </group>
      ))}
    </group>
  );
}

function Triangle({ c, wire }: { c: string; wire: boolean }) {
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.44);
    s.lineTo(0.46, -0.34);
    s.lineTo(-0.46, -0.34);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 4 });
    g.center();
    return g;
  }, []);
  return (
    <mesh position={[0, 0.41, 0]} geometry={geo} castShadow>
      <Chrome wire={wire} tone={c} />
    </mesh>
  );
}

/** A gear cut from a profile with bevelled edges, a chrome ring in its bore. */
function Gear({ wire }: { c: string; wire: boolean }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (g.current) g.current.rotation.z -= dt * 0.3;
  });
  const geo = useMemo(() => {
    const teeth = 10;
    const ro = 0.42;
    const ri = 0.33;
    const s = new THREE.Shape();
    const step = (Math.PI * 2) / teeth;
    for (let i = 0; i < teeth; i++) {
      const a = i * step;
      const pts: [number, number][] = [
        [ri, a - step * 0.22],
        [ro, a - step * 0.12],
        [ro, a + step * 0.12],
        [ri, a + step * 0.22],
      ];
      for (const [r, t] of pts) {
        const x = Math.cos(t) * r;
        const y = Math.sin(t) * r;
        if (i === 0 && r === ri && t === a - step * 0.22) s.moveTo(x, y);
        else s.lineTo(x, y);
      }
    }
    s.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.17, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 4, curveSegments: 12 });
    geo.center();
    return geo;
  }, []);
  return (
    <group position={[0, 0.44, 0]}>
      <group ref={g}>
        <mesh geometry={geo} castShadow><Chrome wire={wire} /></mesh>
        <mesh><torusGeometry args={[0.19, 0.035, 12, 40]} /><Chrome wire={wire} tone="#aeb5be" /></mesh>
        <mesh><torusGeometry args={[0.28, 0.012, 8, 48]} /><Steel wire={wire} tone="#8a9098" /></mesh>
      </group>
    </group>
  );
}

function Disks({ c, wire }: { c: string; wire: boolean }) {
  return (
    <group>
      {[0.1, 0.33, 0.56].map((y, i) => (
        <group key={y} position={[0, y, 0]}>
          <mesh castShadow><cylinderGeometry args={[0.4, 0.4, 0.18, 48]} /><Plastic wire={wire} c={shade(c, -0.35)} glow={0.08} /></mesh>
          <mesh position={[0, 0.09, 0]}><torusGeometry args={[0.39, 0.014, 8, 64]} /><Chrome wire={wire} /></mesh>
          <mesh position={[0, -0.09, 0]}><torusGeometry args={[0.39, 0.014, 8, 64]} /><Chrome wire={wire} /></mesh>
          <mesh position={[0, 0.092, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.38, 48]} /><Chrome wire={wire} tone={shade(c, 0.1)} /></mesh>
          <Led position={[0.3, 0, 0.27]} color={shade(c, 0.5)} phase={i * 2.1} wire={wire} />
        </group>
      ))}
    </group>
  );
}

function Globe({ c, wire }: { c: string; wire: boolean }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (g.current) g.current.rotation.y += dt * 0.35;
  });
  return (
    <group>
      <mesh position={[0, 0.02, 0]}><torusGeometry args={[0.26, 0.03, 12, 48]} /><Chrome wire={wire} /></mesh>
      <mesh position={[0, 0.1, 0]}><cylinderGeometry args={[0.04, 0.06, 0.16, 16]} /><Chrome wire={wire} /></mesh>
      <group ref={g} position={[0, 0.46, 0]} rotation={[0, 0, 0.35]}>
        <mesh castShadow><sphereGeometry args={[0.34, 48, 32]} /><Plastic wire={wire} c={shade(c, -0.15)} glow={0.05} /></mesh>
        {[0, Math.PI / 2].map((r) => (
          <mesh key={r} rotation={[Math.PI / 2, 0, r]}><torusGeometry args={[0.348, 0.011, 8, 64]} /><Chrome wire={wire} /></mesh>
        ))}
        <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.348, 0.011, 8, 64]} /><Chrome wire={wire} /></mesh>
        {[0.2, -0.2].map((y) => (
          <mesh key={y} rotation={[Math.PI / 2, 0, 0]} position={[0, y, 0]}><torusGeometry args={[0.283, 0.009, 8, 64]} /><Chrome wire={wire} /></mesh>
        ))}
      </group>
    </group>
  );
}

export default function Piece3D({ kind, wire }: { kind: Kind; wire: boolean }) {
  const { color, symbol } = KINDS[kind];
  switch (symbol) {
    case "monitor": return <Monitor c={color} wire={wire} />;
    case "tower": return <Tower c={color} wire={wire} />;
    case "phone": return <Phone c={color} wire={wire} />;
    case "server": return <Server c={color} wire={wire} />;
    case "triangle": return <Triangle c={color} wire={wire} />;
    case "gear": return <Gear c={color} wire={wire} />;
    case "disks": return <Disks c={color} wire={wire} />;
    case "globe": return <Globe c={color} wire={wire} />;
    default:
      return <mesh position={[0, 0.3, 0]}><boxGeometry args={[0.6, 0.6, 0.6]} /><Plastic wire c={color} glow={0.2} /></mesh>;
  }
}
