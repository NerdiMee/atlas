import Icon from "./Icons";
import { KINDS, MODES, STATUS, type Block, type Link, type Problem } from "./model";
import { plain, wireKind } from "./narrate";

/* Hover hints live in one fixed strip at the bottom of the stage, never at
   the pointer. Resting on a piece or a wire fills the strip; clicking is
   still what opens the full panel. */

export default function HoverCard({ b }: { b: Block; x?: number; y?: number; width?: number }) {
  return (
    <div className="hstrip" role="status">
      <Icon kind={b.kind} size={20} />
      <b>{b.title}</b>
      <span className="hs-s">
        {KINDS[b.kind].label} · {STATUS[b.status].label}
        {b.sub ? ` · ${b.sub}` : ""}
      </span>
      {b.details.slice(0, 2).map((d, i) => (
        <span className="hs-d" key={i}>
          <span>{d.label}</span> {d.value}
        </span>
      ))}
    </div>
  );
}

export function WireTip({ l, from, to, ghost, problem }: { l: Link; from?: string; to?: string; ghost: boolean; problem?: Problem }) {
  return (
    <div className="hstrip" role="status">
      <b>{l.label || "unlabelled wire"}</b>
      <span className="hs-s">
        {ghost ? "suggested · " : ""}
        {from} → {to} · {MODES[l.mode].label}
      </span>
      <span className="hs-why">{wireKind(l.mode)}. {l.why ? plain(l.why) : "Nobody has written down why yet. Click the wire to add it."}</span>
      {problem && <span className={`hs-p ${problem.level}`}>{problem.reason}</span>}
    </div>
  );
}
