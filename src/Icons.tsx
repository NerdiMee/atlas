import { KINDS, type Kind } from "./model";

/* Atlas's own symbol set: one small flat pictogram per kind, so a site is a
   screen, a database is a stack of disks, Supabase is a rack of servers and
   so on. The board carries the same shapes as solids. */

/** Mixes a hex colour toward white (amt > 0) or black (amt < 0). */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function Shape({ symbol, color }: { symbol: string; color: string }) {
  const light = shade(color, 0.45);
  const dark = shade(color, -0.45);
  switch (symbol) {
    case "monitor":
      return (
        <>
          <rect x="3" y="5" width="26" height="17" rx="2" fill={dark} />
          <rect x="5" y="7" width="22" height="13" rx="1" fill={color} />
          <rect x="5" y="7" width="22" height="3" fill={light} opacity=".6" />
          <rect x="14" y="22" width="4" height="3" fill={dark} />
          <rect x="9" y="25" width="14" height="2.5" rx="1" fill={dark} />
        </>
      );
    case "tower":
      return (
        <>
          <rect x="3" y="4" width="10" height="24" rx="1.5" fill={dark} />
          <rect x="5" y="7" width="6" height="1.6" fill={light} opacity=".7" />
          <rect x="5" y="10" width="6" height="1.6" fill={light} opacity=".7" />
          <circle cx="8" cy="24" r="1.2" fill={light} />
          <rect x="15" y="6" width="14" height="11" rx="1.5" fill={dark} />
          <rect x="16.5" y="7.5" width="11" height="8" fill={color} />
          <rect x="20" y="17" width="4" height="2.5" fill={dark} />
          <rect x="17" y="19.5" width="10" height="2" rx="1" fill={dark} />
        </>
      );
    case "phone":
      return (
        <>
          <rect x="9" y="2.5" width="14" height="27" rx="3" fill={dark} />
          <rect x="11" y="6" width="10" height="19" rx="1" fill={color} />
          <rect x="11" y="6" width="10" height="4" fill={light} opacity=".55" />
          <rect x="13.5" y="4" width="5" height="1.2" rx=".6" fill={light} opacity=".5" />
          <circle cx="16" cy="27" r="1.1" fill={light} opacity=".7" />
        </>
      );
    case "server":
      return (
        <>
          <rect x="5" y="2.5" width="22" height="27" rx="2" fill={dark} />
          {[5, 12.5, 20].map((y) => (
            <g key={y}>
              <rect x="7" y={y} width="18" height="5.5" rx="1" fill={color} />
              <rect x="9" y={y + 2} width="8" height="1.4" fill={dark} opacity=".6" />
              <circle cx="22.5" cy={y + 2.75} r="1.2" fill={light} />
            </g>
          ))}
        </>
      );
    case "triangle":
      return (
        <>
          <path d="M16,4 L29.5,27.5 L2.5,27.5 Z" fill={color} />
          <path d="M16,4 L29.5,27.5 L16,27.5 Z" fill={dark} opacity=".35" />
        </>
      );
    case "gear":
      return (
        <>
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <rect key={a} x="14" y="2.5" width="4" height="7" rx="1" fill={dark} transform={`rotate(${a} 16 16)`} />
          ))}
          <circle cx="16" cy="16" r="9" fill={color} />
          <circle cx="16" cy="16" r="9" fill={light} opacity=".25" />
          <circle cx="16" cy="16" r="3.6" fill={dark} />
        </>
      );
    case "disks":
      return (
        <>
          {[20, 13, 6].map((y) => (
            <g key={y}>
              <path d={`M6,${y + 2} v5 a10,3.4 0 0 0 20,0 v-5 Z`} fill={dark} />
              <ellipse cx="16" cy={y + 2} rx="10" ry="3.4" fill={color} />
              <ellipse cx="16" cy={y + 2} rx="10" ry="3.4" fill={light} opacity=".3" />
            </g>
          ))}
        </>
      );
    case "globe":
      return (
        <>
          <circle cx="16" cy="16" r="12.5" fill={color} />
          <circle cx="16" cy="16" r="12.5" fill="none" stroke={dark} strokeWidth="1.3" />
          <ellipse cx="16" cy="16" rx="5.5" ry="12.5" fill="none" stroke={dark} strokeWidth="1.2" />
          <path d="M3.5,16 h25 M5.5,10 h21 M5.5,22 h21" stroke={dark} strokeWidth="1.1" fill="none" />
          <path d="M9,7 a10,4 0 0 1 8,-1" stroke={light} strokeWidth="2" strokeLinecap="round" fill="none" opacity=".8" />
        </>
      );
    default:
      return <rect x="5" y="5" width="22" height="22" rx="2" fill="none" stroke={color} strokeWidth="1.4" strokeDasharray="3 2" />;
  }
}

export default function Icon({ kind, size = 28 }: { kind: Kind; size?: number }) {
  const { color, symbol, label } = KINDS[kind];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={label} style={{ flex: "none" }}>
      <Shape symbol={symbol} color={color} />
    </svg>
  );
}
