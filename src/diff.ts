import { KINDS, MODES, type System } from "./model";

/* Versions: a snapshot is the whole system at a moment. The diff between two
   snapshots is a plain list a client could read: what was added, what went,
   what changed. Blocks and wires match by id. */

export type Snap = { at: string; label: string; system: System };
export type DiffItem = { what: "block" | "wire"; change: "added" | "removed" | "changed"; id: string; text: string };

export function diffSystems(before: System, after: System): DiffItem[] {
  const out: DiffItem[] = [];
  const nameIn = (s: System, id: string) => s.blocks.find((b) => b.id === id)?.title ?? "something";
  const bBefore = new Map(before.blocks.map((b) => [b.id, b]));
  const bAfter = new Map(after.blocks.map((b) => [b.id, b]));
  for (const b of after.blocks) {
    const old = bBefore.get(b.id);
    if (!old) {
      out.push({ what: "block", change: "added", id: b.id, text: `Added ${b.title} (${KINDS[b.kind].label.toLowerCase()})` });
      continue;
    }
    const changes: string[] = [];
    if (old.title !== b.title) changes.push(`renamed from ${old.title}`);
    if (old.kind !== b.kind) changes.push(`now a ${KINDS[b.kind].label.toLowerCase()}, was ${KINDS[old.kind].label.toLowerCase()}`);
    if (old.status !== b.status) changes.push(`now ${b.status}, was ${old.status}`);
    if (old.sub !== b.sub) changes.push("subtitle changed");
    if (old.lines.join("\n") !== b.lines.join("\n")) changes.push("its notes changed");
    if (old.details.length !== b.details.length || old.details.some((d, i) => d.label !== b.details[i]?.label || d.value !== b.details[i]?.value)) changes.push("its details changed");
    if (changes.length) out.push({ what: "block", change: "changed", id: b.id, text: `${b.title}: ${changes.join(", ")}` });
  }
  for (const b of before.blocks) if (!bAfter.has(b.id)) out.push({ what: "block", change: "removed", id: b.id, text: `Removed ${b.title}` });

  const lBefore = new Map(before.links.map((l) => [l.id, l]));
  const lAfter = new Map(after.links.map((l) => [l.id, l]));
  for (const l of after.links) {
    const old = lBefore.get(l.id);
    const ends = `${nameIn(after, l.from)} to ${nameIn(after, l.to)}`;
    if (!old) {
      out.push({ what: "wire", change: "added", id: l.id, text: `New wire: ${ends}${l.label ? ` (${l.label})` : ""}` });
      continue;
    }
    const changes: string[] = [];
    if (old.from !== l.from || old.to !== l.to) changes.push(`now runs ${ends}, was ${nameIn(before, old.from)} to ${nameIn(before, old.to)}`);
    if (old.mode !== l.mode) changes.push(`now a ${MODES[l.mode].label.toLowerCase()}, was a ${MODES[old.mode].label.toLowerCase()}`);
    if (old.label !== l.label) changes.push(`carries "${l.label}", was "${old.label}"`);
    if (old.why !== l.why) changes.push("its reason changed");
    if (changes.length) out.push({ what: "wire", change: "changed", id: l.id, text: `Wire ${ends}: ${changes.join(", ")}` });
  }
  for (const l of before.links) if (!lAfter.has(l.id)) out.push({ what: "wire", change: "removed", id: l.id, text: `Wire gone: ${nameIn(before, l.from)} to ${nameIn(before, l.to)}${l.label ? ` (${l.label})` : ""}` });
  return out;
}

export const summary = (d: DiffItem[]) => {
  if (!d.length) return "Nothing has changed.";
  const c = (change: DiffItem["change"]) => d.filter((x) => x.change === change).length;
  const parts = [c("added") && `${c("added")} added`, c("changed") && `${c("changed")} changed`, c("removed") && `${c("removed")} removed`].filter(Boolean);
  return parts.join(", ") + ".";
};
