import { KINDS, MODES, blockHeight, type Problem, type System } from "./model";
import type { Step } from "./narrate";

/* The tour on paper: a page with the map drawn as SVG, the narration in the
   order George says it, then what needs fixing and what is still planned.
   Opens in a new tab; the browser's Print makes the PDF. */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function mapSvg(s: System, problems: Map<string, Problem>): string {
  if (!s.blocks.length) return "";
  const pad = 40;
  const minX = Math.min(...s.blocks.map((b) => b.x)) - pad;
  const minY = Math.min(...s.blocks.map((b) => b.y)) - pad;
  const maxX = Math.max(...s.blocks.map((b) => b.x + b.w)) + pad;
  const maxY = Math.max(...s.blocks.map((b) => b.y + blockHeight(b))) + pad;
  const by = new Map(s.blocks.map((b) => [b.id, b]));
  const wires = s.links
    .map((l) => {
      const a = by.get(l.from);
      const b = by.get(l.to);
      if (!a || !b) return "";
      const ax = a.x + a.w;
      const ay = a.y + blockHeight(a) / 2;
      const bx = b.x;
      const byy = b.y + blockHeight(b) / 2;
      const back = bx < ax;
      const c = back ? 60 : Math.max(40, (bx - ax) / 2);
      const d = back ? `M${ax},${ay} C${ax + c},${ay} ${bx - c},${byy} ${bx},${byy}` : `M${ax},${ay} C${ax + c},${ay} ${bx - c},${byy} ${bx},${byy}`;
      const p = problems.get(l.id);
      const color = p?.level === "bad" ? "#d33" : p?.level === "warn" ? "#b8860b" : "#666";
      const dash = MODES[l.mode].dash ? ` stroke-dasharray="${MODES[l.mode].dash}"` : "";
      const mx = (ax + bx) / 2;
      const my = (ay + byy) / 2 - 6;
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.4"${dash} marker-end="url(#a)"/>${l.label ? `<text x="${mx}" y="${my}" text-anchor="middle" font-size="10" fill="#444" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(l.label)}</text>` : ""}`;
    })
    .join("");
  const blocks = s.blocks
    .map((b) => {
      const h = blockHeight(b);
      const c = KINDS[b.kind].color;
      const dashed = b.status === "drawn" || b.kind === "planned" ? ` stroke-dasharray="4 3"` : "";
      const lines = b.lines.slice(0, 3).map((t, i) => `<text x="${b.x + 12}" y="${b.y + 44 + i * 15}" font-size="10" fill="#555">${esc(t.slice(0, 40))}</text>`).join("");
      return `<g><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${h}" rx="8" fill="#fff" stroke="#999"${dashed}/><rect x="${b.x}" y="${b.y}" width="4" height="${h}" rx="2" fill="${c}"/><text x="${b.x + 12}" y="${b.y + 18}" font-size="12" font-weight="600" fill="#111">${esc(b.title)}</text>${b.sub ? `<text x="${b.x + 12}" y="${b.y + 31}" font-size="10" fill="#777">${esc(b.sub.slice(0, 44))}</text>` : ""}${lines}</g>`;
    })
    .join("");
  return `<svg viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" xmlns="http://www.w3.org/2000/svg" font-family="IBM Plex Sans, Helvetica, Arial, sans-serif"><defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#666"/></marker></defs>${wires}${blocks}</svg>`;
}

export function tourHtml(s: System, steps: Step[], problems: Map<string, Problem>): string {
  const date = new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
  const by = new Map(s.blocks.map((b) => [b.id, b]));
  const lines = steps.map((st, i) => {
    const title = st.sel?.type === "block" ? by.get(st.sel.id)?.title : st.sel?.type === "link" ? (() => { const l = s.links.find((x) => x.id === st.sel!.id); return l ? `${by.get(l.from)?.title ?? "?"} → ${by.get(l.to)?.title ?? "?"}` : ""; })() : "";
    return `<li><span class="n">${i + 1}</span><div>${title ? `<b>${esc(title)}</b>` : ""}<p>${esc(st.text)}</p></div></li>`;
  });
  const findings = s.blocks.filter((b) => b.status === "warn").map((b) => `<li><b>${esc(b.title)}</b> ${esc(b.details.find((d) => d.label.toLowerCase().startsWith("finding"))?.value ?? "flagged")}</li>`);
  const bad = s.links.filter((l) => problems.get(l.id)?.level === "bad").map((l) => `<li><b>${esc(by.get(l.from)?.title ?? "?")} → ${esc(by.get(l.to)?.title ?? "?")}</b> ${esc(problems.get(l.id)!.reason)}</li>`);
  const planned = s.blocks.filter((b) => b.kind === "planned" || b.status === "drawn").map((b) => esc(b.title));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(s.name)} · Atlas tour</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font: 11pt/1.5 "IBM Plex Sans", Helvetica, Arial, sans-serif; color: #111; margin: 0; padding: 24px; max-width: 860px; margin-inline: auto; }
  h1 { font-size: 26pt; margin: 0; letter-spacing: -.01em; } h2 { font-size: 13pt; margin: 28px 0 8px; text-transform: uppercase; letter-spacing: .08em; color: #666; }
  .sub { color: #666; margin: 4px 0 0; } .meta { color: #888; font-size: 9.5pt; margin-top: 12px; }
  .map { margin: 20px 0; border: 1px solid #e5e5e5; border-radius: 10px; padding: 12px; page-break-inside: avoid; } .map svg { width: 100%; height: auto; display: block; }
  ol { list-style: none; padding: 0; margin: 0; } ol li { display: flex; gap: 14px; padding: 9px 0; border-bottom: 1px solid #eee; page-break-inside: avoid; }
  ol .n { flex: none; width: 26px; height: 26px; border-radius: 50%; background: #111; color: #fff; display: grid; place-items: center; font-size: 9.5pt; font-weight: 600; }
  ol b { display: block; font-size: 10.5pt; margin-bottom: 2px; } ol p { margin: 0; color: #333; }
  ul { padding-left: 18px; } ul li { margin: 4px 0; }
  .print { position: fixed; right: 16px; top: 16px; padding: 8px 14px; border-radius: 999px; border: 0; background: #111; color: #fff; font: inherit; cursor: pointer; }
  @media print { .print { display: none; } body { padding: 0; } }
</style></head><body>
<button class="print" onclick="print()">Print or save as PDF</button>
<h1>${esc(s.name)}</h1><p class="sub">${esc(s.tagline)}</p><p>${esc(s.note)}</p>
<p class="meta">Atlas tour · ${date} · ${s.blocks.length} pieces · ${s.links.length} wires</p>
<div class="map">${mapSvg(s, problems)}</div>
<h2>The walk-through</h2><ol>${lines.join("")}</ol>
${findings.length || bad.length ? `<h2>What needs fixing</h2><ul>${findings.join("")}${bad.join("")}</ul>` : ""}
${planned.length ? `<h2>Still planned</h2><p>${planned.join(", ")}.</p>` : ""}
</body></html>`;
}

export function openReport(html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
