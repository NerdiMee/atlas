import { useEffect, useState } from "react";
import type { System } from "./model";

/* Import from code: point Atlas at a folder on this computer or a GitHub
   repository and it drafts the map. The dev server does the reading. */

export default function ImportDialog({ onDone, onClose }: { onDone: (s: System) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"local" | "github">("local");
  const [base, setBase] = useState("");
  const [dirs, setDirs] = useState<string[]>([]);
  const [folder, setFolder] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/__atlas/ls")
      .then((r) => r.json())
      .then((d: { base: string; dirs: string[] }) => {
        setBase(d.base);
        setDirs(d.dirs);
      })
      .catch(() => setDirs([]));
  }, []);

  const run = async (body: Record<string, string>) => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/__atlas/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json()) as { system?: System; error?: string };
      if (!r.ok || !d.system) throw new Error(d.error ?? "Could not read that.");
      onDone(body.source === "github" ? { ...d.system, origin: "github" } : d.system);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="modal" role="dialog" aria-label="Import from code" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Import from code</h2>
        <p className="note">Atlas reads the project and drafts the map: the apps, the database, the server, the outside services, and the wires between them. Nothing is sent anywhere; a GitHub repository is read straight from GitHub. Secret values are never read, only which keys exist.</p>
        <span className="seg">
          <button className={tab === "local" ? "on" : ""} onClick={() => setTab("local")}>
            Folder on this computer
          </button>
          <button className={tab === "github" ? "on" : ""} onClick={() => setTab("github")}>
            GitHub
          </button>
        </span>
        {tab === "local" ? (
          <>
            <div className="field">
              <label>Folder</label>
              <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder={base ? `${base}/…` : "/path/to/project"} />
            </div>
            {dirs.length > 0 && (
              <div className="chips">
                {dirs.map((d) => (
                  <button key={d} className={`chip${folder === `${base}/${d}` ? " on" : ""}`} onClick={() => setFolder(`${base}/${d}`)}>
                    {d}
                  </button>
                ))}
              </div>
            )}
            <div className="actions">
              <button className="btn primary" disabled={busy || !folder} onClick={() => run({ source: "local", path: folder })}>
                {busy ? "Reading…" : "Read this folder"}
              </button>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label>Repository</label>
              <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name, or the GitHub address" />
            </div>
            <div className="grid2">
              <div className="field">
                <label>Branch (blank = default)</label>
                <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
              </div>
              <div className="field">
                <label>Token (private repos only)</label>
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" autoComplete="off" />
              </div>
            </div>
            <div className="actions">
              <button className="btn primary" disabled={busy || !repo} onClick={() => run({ source: "github", repo, branch, token })}>
                {busy ? "Reading…" : "Read from GitHub"}
              </button>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
        {err && <div className="toast-inline bad">{err}</div>}
      </div>
    </div>
  );
}
