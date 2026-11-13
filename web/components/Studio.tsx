"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { human, percent, shortName } from "@/lib/format";
import { rebind, removeFile, removeFolder } from "@/lib/editTree";
import { canEnter, colorFor, columnRows } from "@/lib/layout";
import { matchProgram, type InstalledProgram } from "@/lib/programMatch";
import { sampleRoot } from "@/lib/sample";
import type { FileEntry, ScanResult, UsageNode } from "@/lib/types";
import { Scene, type DiagramView } from "./Scene";

type Model = {
  root: UsageNode;
  path: string;
  files: number;
  denied: number;
  elapsedMs?: number;
  sample: boolean;
};

const VIEWS: { id: DiagramView; label: string; caption: string }[] = [
  {
    id: "explosion",
    label: "Explosion",
    caption: "Drag the slider. Each piece is a folder or a kind of file, and the lines lead back to the hub.",
  },
  {
    id: "rings",
    label: "Rings",
    caption: "The outer ring is what sits inside the ring beneath it. Click a folder to open it.",
  },
  {
    id: "city",
    label: "City",
    caption: "Footprint and height follow the bytes. Blocks inside a block are that folder's contents.",
  },
  {
    id: "columns",
    label: "File types",
    caption: "Each column is one kind of file under the folder you are viewing.",
  },
];

function freshSample(): Model {
  const root = sampleRoot();
  return { root, path: root.path, files: root.files, denied: 0, sample: true };
}

type Nav = { trail: UsageNode[][]; cursor: number };

function rootNav(): Nav {
  return { trail: [[]], cursor: 0 };
}

function sameTrail(a: UsageNode[], b: UsageNode[]) {
  if (a.length !== b.length) return false;
  return a.every((node, index) => node.path === b[index]?.path && node.name === b[index]?.name);
}

function visit(nav: Nav, target: UsageNode[]): Nav {
  for (let index = nav.cursor; index >= 0; index -= 1) {
    if (sameTrail(nav.trail[index] ?? [], target)) return { ...nav, cursor: index };
  }
  const trail = nav.trail.slice(0, nav.cursor + 1);
  trail.push(target);
  return { trail, cursor: trail.length - 1 };
}

function step(nav: Nav, delta: number): Nav {
  const cursor = Math.min(Math.max(nav.cursor + delta, 0), nav.trail.length - 1);
  return cursor === nav.cursor ? nav : { ...nav, cursor };
}

type Pending =
  | { kind: "folder"; node: UsageNode; permanent: boolean }
  | { kind: "file"; file: FileEntry; permanent: boolean }
  | { kind: "uninstall"; name: string; path: string };

function samePath(a: string, b: string) {
  const clean = (value: string) => value.replace(/\//g, "\\").replace(/\\+$/g, "").toLowerCase();
  return clean(a) === clean(b);
}

function upOne(nav: Nav): Nav {
  const stack = nav.trail[nav.cursor] ?? [];
  if (stack.length === 0) return nav;
  return visit(nav, stack.slice(0, -1));
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-disk-usage": "studio" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error || "That action failed.");
  return payload;
}

export default function Studio() {
  const [model, setModel] = useState<Model>(freshSample);
  const [nav, setNav] = useState<Nav>(rootNav);
  const [view, setView] = useState<DiagramView>("explosion");
  const [explode, setExplode] = useState(0.62);
  const [hover, setHover] = useState<UsageNode | null>(null);
  const [path, setPath] = useState(() => sampleRoot().path);
  const [shownPath, setShownPath] = useState(() => sampleRoot().path);
  const folderFocused = useRef(false);
  const pwdFocused = useRef(false);
  const pwdCommit = useRef(false);
  const pwdRef = useRef<HTMLInputElement>(null);
  const [drives, setDrives] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ files: number; bytes: number; denied: number } | null>(null);
  const [error, setError] = useState("");
  const [programs, setPrograms] = useState<InstalledProgram[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingError, setPendingError] = useState("");
  const [acting, setActing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const deleteTarget = useRef<UsageNode | null>(null);

  const stack = nav.trail[nav.cursor] ?? [];
  const current = stack.at(-1) ?? model.root;
  if (!folderFocused.current && current.path !== shownPath) {
    setShownPath(current.path);
    setPath(current.path);
  }
  const canBack = nav.cursor > 0;
  const canForward = nav.cursor < nav.trail.length - 1;
  const viewMeta = VIEWS.find((item) => item.id === view) ?? VIEWS[0];
  const hoveredFile = hover?.kind === "file" && !model.sample ? hover : null;
  const actionDir = hoveredFile
    ? null
    : hover && hover.kind === "dir" && !model.sample && !samePath(hover.path, model.path)
      ? hover
      : !model.sample && !samePath(current.path, model.path)
        ? current
        : null;
  const program = actionDir ? matchProgram(actionDir.path, programs) : null;
  pendingRef.current = pending;
  deleteTarget.current = hoveredFile ?? actionDir;

  useEffect(() => {
    let cancel = false;
    fetch("/api/drives")
      .then((response) => response.json())
      .then((body: { drives?: string[] }) => {
        if (!cancel) setDrives(body.drives ?? []);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    let cancel = false;
    fetch("/api/programs", { headers: { "x-disk-usage": "studio" } })
      .then((response) => response.json())
      .then((body: { programs?: InstalledProgram[] }) => {
        if (!cancel) setPrograms(body.programs ?? []);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (pendingRef.current) {
        if (event.key === "Escape") setPending(null);
        return;
      }
      if (event.key === "Delete") {
        const node = deleteTarget.current;
        if (!node) return;
        event.preventDefault();
        setPendingError("");
        setPending(
          node.kind === "file"
            ? { kind: "file", file: { name: node.name, path: node.path, size: node.size }, permanent: event.shiftKey }
            : { kind: "folder", node, permanent: event.shiftKey },
        );
        return;
      }
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        setNav((currentNav) => step(currentNav, -1));
        return;
      }
      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        setNav((currentNav) => step(currentNav, 1));
        return;
      }
      if (event.key === "Escape" || event.key === "Backspace") {
        event.preventDefault();
        setNav(upOne);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setHover(null);
  }, [current, view]);

  useEffect(() => {
    const field = pwdRef.current;
    if (!field || document.activeElement === field) return;
    field.scrollLeft = field.scrollWidth;
  }, [current.path]);

  async function scan(target: string) {
    const trimmed = target.trim();
    if (!trimmed) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setScanning(true);
    setError("");
    setProgress({ files: 0, bytes: 0, denied: 0 });
    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: trimmed }),
        signal: controller.signal,
      });
      if (!response.ok) {
        let message = `Scan failed (${response.status})`;
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // Keep the status message.
        }
        throw new Error(message);
      }
      await readStream(response, (message) => {
        if (message.type === "progress") {
          setProgress({ files: message.files, bytes: message.bytes, denied: message.denied });
        } else if (message.type === "done") {
          const result = message.result;
          setModel({
            root: result.root,
            path: result.path,
            files: result.files,
            denied: result.denied,
            elapsedMs: result.elapsedMs,
            sample: false,
          });
          setNav(rootNav());
          setPath(result.path);
        } else if (message.type === "error" && message.message !== "The scan was cancelled.") {
          setError(message.message);
        }
      });
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "Scan failed.");
    } finally {
      if (abortRef.current === controller) {
        setScanning(false);
        abortRef.current = null;
      }
    }
  }

  function applyRoot(nextRoot: UsageNode) {
    setModel((currentModel) => ({
      ...currentModel,
      root: nextRoot,
      files: nextRoot.files,
      bytes: nextRoot.size,
    }));
    setNav((currentNav) => {
      const trail = currentNav.trail[currentNav.cursor] ?? [];
      return { trail: [rebind(nextRoot, trail.map((node) => node.path))], cursor: 0 };
    });
    setHover(null);
  }

  function ask(next: Pending) {
    setPendingError("");
    setPending(next);
  }

  async function confirmPending() {
    if (!pending || acting) return;
    setActing(true);
    setPendingError("");
    try {
      if (pending.kind === "uninstall") {
        await postJson("/api/uninstall", { path: pending.path });
      } else if (pending.kind === "file") {
        await postJson("/api/delete", {
          root: model.path,
          path: pending.file.path,
          mode: pending.permanent ? "permanent" : "recycle",
        });
        applyRoot(removeFile(model.root, pending.file));
      } else {
        await postJson("/api/delete", {
          root: model.path,
          path: pending.node.path,
          mode: pending.permanent ? "permanent" : "recycle",
        });
        applyRoot(removeFolder(model.root, pending.node.path));
      }
      setPending(null);
    } catch (cause) {
      setPendingError(cause instanceof Error ? cause.message : "That action failed.");
    } finally {
      setActing(false);
    }
  }

  function openNode(node: UsageNode) {
    if (!canEnter(node) || scanning) return;
    const listed = node.loaded === true || (node.loaded == null && !model.sample);
    if (listed && node.children.length > 0) {
      setNav((currentNav) => {
        const base = currentNav.trail[currentNav.cursor] ?? [];
        const target = [...base, node];
        const ahead = currentNav.trail[currentNav.cursor + 1];
        if (ahead && sameTrail(ahead, target)) return { ...currentNav, cursor: currentNav.cursor + 1 };
        return visit(currentNav, target);
      });
      return;
    }
    void loadFolder(node.path);
  }

  function goToPath(target: string) {
    const trimmed = target.trim();
    if (!trimmed || scanning) return;
    if (samePath(trimmed, current.path) && !model.sample) return;
    if (!model.sample) {
      const found = findDir(model.root, trimmed);
      if (found && found.loaded !== false) {
        const next = ancestors(model.root, found.path);
        if (next) {
          setNav((currentNav) => visit(currentNav, next));
          setPath(found.path);
          setShownPath(found.path);
          return;
        }
      }
    }
    void loadFolder(trimmed);
  }

  async function loadFolder(folderPath: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setScanning(true);
    setError("");
    setProgress({ files: 0, bytes: 0, denied: 0 });
    let opened: UsageNode | null = null;
    let failure = "";
    try {
      const response = await fetch("/api/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folderPath }),
        signal: controller.signal,
      });
      if (!response.ok) {
        let message = `Could not read that folder (${response.status})`;
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // Keep the status message.
        }
        throw new Error(message);
      }
      await readStream(response, (message) => {
        if (message.type === "progress") {
          setProgress({ files: message.files, bytes: message.bytes, denied: message.denied });
        } else if (message.type === "folder") {
          opened = message.node;
        } else if (message.type === "error" && message.message !== "The scan was cancelled.") {
          failure = message.message;
        }
      });
      if (controller.signal.aborted) return;
      if (failure) throw new Error(failure);
      if (!opened) throw new Error("That folder could not be read.");
      const fresh = opened;
      let nextRoot = fresh;
      let replacedRoot = false;
      setModel((currentModel) => {
        const known = !currentModel.sample && findDir(currentModel.root, fresh.path);
        if (!known) {
          replacedRoot = true;
          nextRoot = fresh;
          return { root: fresh, path: fresh.path, files: fresh.files, denied: 0, sample: false };
        }
        nextRoot = graft(currentModel.root, fresh);
        return { ...currentModel, root: nextRoot, files: nextRoot.files, sample: false };
      });
      setNav((currentNav) => {
        if (replacedRoot) return rootNav();
        const base = currentNav.trail[currentNav.cursor] ?? [];
        const parent = rebind(nextRoot, base.map((item) => item.path));
        const openedNode = findDir(nextRoot, fresh.path) ?? fresh;
        const target = [...parent, openedNode];
        const trail = currentNav.trail.slice(0, currentNav.cursor + 1);
        trail.push(target);
        return { trail, cursor: trail.length - 1 };
      });
      setPath(fresh.path);
      setShownPath(fresh.path);
      setHover(null);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "Could not read that folder.");
      setPath(current.path);
      setShownPath(current.path);
    } finally {
      if (abortRef.current === controller) {
        setScanning(false);
        abortRef.current = null;
      }
    }
  }

  function onHistoryClick(event: MouseEvent) {
    if (event.button === 3) {
      event.preventDefault();
      setNav((currentNav) => step(currentNav, -1));
    } else if (event.button === 4) {
      event.preventDefault();
      setNav((currentNav) => step(currentNav, 1));
    }
  }

  const crumbs = [model.root, ...stack];

  return (
    <div className="studio">
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <strong>Disk Usage Analyzer</strong>
            <em>3D studio</em>
          </div>
        </div>
        <div className="views" role="tablist" aria-label="Diagram">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={view === item.id}
              className={view === item.id ? "on" : ""}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {view === "explosion" && (
          <label className="explode">
            <span>Pull apart</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(explode * 100)}
              onChange={(event) => setExplode(Number(event.target.value) / 100)}
            />
          </label>
        )}
      </header>

      <div className="body">
        <aside className="rail">
          <form
            className="scan"
            onSubmit={(event) => {
              event.preventDefault();
              void scan(path);
            }}
          >
            <label htmlFor="folder" title={current.path}>
              <span>Folder</span>
              <span className="cwd">{current.path}</span>
            </label>
            <div className="scan-row">
              <input
                id="folder"
                value={path}
                placeholder="C:\ or D:\Games"
                spellCheck={false}
                onFocus={() => {
                  folderFocused.current = true;
                }}
                onBlur={() => {
                  folderFocused.current = false;
                }}
                onChange={(event) => setPath(event.target.value)}
              />
              {scanning ? (
                <button type="button" className="ghost" onClick={() => abortRef.current?.abort()}>
                  Cancel
                </button>
              ) : (
                <button type="submit" className="gold">
                  Scan
                </button>
              )}
            </div>
            {drives.length > 0 && (
              <div className="drives">
                {drives.map((drive) => (
                  <button key={drive} type="button" onClick={() => { setPath(drive); void scan(drive); }}>
                    {drive}
                  </button>
                ))}
              </div>
            )}
          </form>

          {error && <p className="error">{error}</p>}
          {scanning && progress && (
            <p className="status">
              Reading {progress.files.toLocaleString()} files · {human(progress.bytes)}
            </p>
          )}
          {model.sample && <p className="sample">Sample disk. Open a folder to read it, or scan a path.</p>}

          <div className="total">
            <div>
              <b>{human(current.size)}</b>
              <span>{current.files.toLocaleString()} files</span>
            </div>
            {!model.sample && model.elapsedMs != null && stack.length === 0 && (
              <small>
                Scanned in {(model.elapsedMs / 1000).toFixed(1)}s
                {model.denied > 0 ? ` · ${model.denied.toLocaleString()} folders could not be read` : ""}
              </small>
            )}
          </div>

          <nav className="crumbs" aria-label="Folder path">
            {crumbs.map((node, index) => (
              <button
                key={`${node.path}-${index}`}
                type="button"
                onClick={() => setNav((currentNav) => visit(currentNav, stack.slice(0, index)))}
                title={node.path}
              >
                {shortName(index === 0 ? node.path : node.name, 18)}
              </button>
            ))}
          </nav>

          {hover && (
            <div className="detail">
              <strong title={hover.path}>{shortName(hover.name, 36)}</strong>
              <span>
                {human(hover.size)} · {percent(hover.size, current.size)} · {hover.files.toLocaleString()} files
              </span>
            </div>
          )}

          {hoveredFile && (
            <div className="actions">
              <button
                type="button"
                className="ghost"
                disabled={acting}
                onClick={() => ask({ kind: "file", file: { name: hoveredFile.name, path: hoveredFile.path, size: hoveredFile.size }, permanent: false })}
              >
                Recycle Bin
              </button>
              <button
                type="button"
                className="danger"
                disabled={acting}
                onClick={() => ask({ kind: "file", file: { name: hoveredFile.name, path: hoveredFile.path, size: hoveredFile.size }, permanent: true })}
              >
                Delete permanently
              </button>
            </div>
          )}

          {actionDir && (
            <div className="actions">
              <button type="button" className="ghost" disabled={acting} onClick={() => ask({ kind: "folder", node: actionDir, permanent: false })}>
                Recycle Bin
              </button>
              <button type="button" className="danger" disabled={acting} onClick={() => ask({ kind: "folder", node: actionDir, permanent: true })}>
                Delete permanently
              </button>
              {program && (
                <button
                  type="button"
                  className="ghost"
                  disabled={acting}
                  onClick={() => ask({ kind: "uninstall", name: program.name, path: actionDir.path })}
                >
                  Uninstall {shortName(program.name, 22)}
                </button>
              )}
            </div>
          )}

          <Breakdown current={current} view={view} hover={hover} onOpen={openNode} onHover={setHover} />

          <p className="hint">
            Two levels of the open folder are drawn. Double-click a name in the diagram to open that folder, as deep as the path goes. Files in that folder are listed by name.
            Type or paste a folder in the path on the canvas and press Enter. Back and Forward move through folders you opened. Esc steps up. Del moves the hovered file or folder to the Recycle Bin, and Shift+Del deletes it permanently.
            Uninstall starts that program's own uninstaller.
          </p>
        </aside>

        <section
          className="stage"
          aria-label={`${viewMeta.label} diagram of ${current.path}, ${human(current.size)}`}
          onMouseDown={(event) => {
            if (event.button === 3 || event.button === 4) event.preventDefault();
          }}
          onAuxClick={onHistoryClick}
        >
          <div className="where">
            <button type="button" className="ghost" onClick={() => setNav((currentNav) => step(currentNav, -1))} disabled={!canBack}>
              Back
            </button>
            <button type="button" className="ghost" onClick={() => setNav((currentNav) => step(currentNav, 1))} disabled={!canForward}>
              Forward
            </button>
            <input
              ref={pwdRef}
              className="pwd"
              aria-label="Current folder"
              title={path}
              value={path}
              spellCheck={false}
              disabled={scanning}
              onFocus={(event) => {
                pwdFocused.current = true;
                event.currentTarget.select();
              }}
              onBlur={(event) => {
                pwdFocused.current = false;
                if (pwdCommit.current) {
                  pwdCommit.current = false;
                  return;
                }
                const typed = event.currentTarget.value.trim();
                if (!scanning && typed && !samePath(typed, current.path)) {
                  goToPath(typed);
                  return;
                }
                setPath(current.path);
                setShownPath(current.path);
              }}
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  pwdCommit.current = true;
                  goToPath(event.currentTarget.value);
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  pwdCommit.current = true;
                  setPath(current.path);
                  setShownPath(current.path);
                  event.currentTarget.blur();
                }
              }}
            />
          </div>
          <Scene root={current} view={view} explode={explode} onHover={setHover} onSelect={openNode} />
          <p className="caption">{viewMeta.caption}</p>
        </section>
      </div>
      {pending && (
        <div className="dialog-back">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <h2 id="confirm-title">
              {pending.kind === "uninstall"
                ? `Uninstall ${pending.name}?`
                : pending.permanent
                  ? "Delete permanently?"
                  : "Move to the Recycle Bin?"}
            </h2>
            <p className="dialog-path">
              {pending.kind === "file" ? pending.file.path : pending.kind === "folder" ? pending.node.path : pending.path}
            </p>
            <p>
              {pending.kind === "uninstall"
                ? "This starts the program's own uninstaller. The folder stays until that uninstaller removes it."
                : pending.permanent
                  ? "This cannot be undone."
                  : "You can restore it from the Recycle Bin."}
            </p>
            {pending.kind !== "uninstall" && (
              <p>
                {pending.kind === "file"
                  ? `${pending.file.name} · ${human(pending.file.size)}`
                  : `${pending.node.name} · ${human(pending.node.size)}`}
              </p>
            )}
            {pendingError && <p className="error">{pendingError}</p>}
            <div className="dialog-actions">
              <button type="button" className="ghost" disabled={acting} onClick={() => setPending(null)}>
                Cancel
              </button>
              <button type="button" className={pending.kind !== "uninstall" && pending.permanent ? "danger" : "gold"} disabled={acting} onClick={() => void confirmPending()}>
                {acting ? "Working…" : pending.kind === "uninstall" ? "Uninstall" : pending.permanent ? "Delete permanently" : "Move to Recycle Bin"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Breakdown({
  current,
  view,
  hover,
  onOpen,
  onHover,
}: {
  current: UsageNode;
  view: DiagramView;
  hover: UsageNode | null;
  onOpen: (node: UsageNode) => void;
  onHover: (node: UsageNode | null) => void;
}) {
  const columns = useMemo(() => (view === "columns" ? columnRows(current) : []), [view, current]);

  if (view === "columns") {
    if (columns.length === 0) return <p className="empty">This folder has no readable files.</p>;
    return (
      <ul className="rows">
        {columns.map((row) => (
          <li key={row.id} className={hover?.category === row.id && hover.kind === "category" ? "hot" : ""}>
            <span className="swatch" style={{ background: row.color }} />
            <span className="name">
              <b>{row.label}</b>
              <i>
                <em style={{ width: `${Math.max(row.share * 100, 1)}%`, background: row.color }} />
              </i>
            </span>
            <span className="meta">
              {percent(row.size, current.size)}
              <small>{human(row.size)}</small>
            </span>
          </li>
        ))}
      </ul>
    );
  }

  if (current.children.length === 0) return <p className="empty">This folder has no readable files.</p>;

  return (
    <ul className="rows">
      {current.children.map((node, index) => {
        const share = current.size > 0 ? node.size / current.size : 0;
        const color = colorFor(node, index, null);
        const hot = hover === node;
        const tag = node.kind === "dir" ? "Folder" : node.kind === "file" ? "File" : node.kind === "other" ? "Group" : "Files";
        const canOpen = canEnter(node);
        return (
          <li key={`${node.kind}-${node.path}-${node.name}-${index}`} className={hot ? "hot" : ""}>
            <button
              type="button"
              onMouseEnter={() => onHover(node)}
              onClick={() => {
                if (canOpen) onOpen(node);
              }}
              title={node.path}
            >
              <span className="swatch" style={{ background: color }} />
              <span className="name">
                <b>{shortName(node.name, 32)}</b>
                <i>
                  <em style={{ width: `${Math.max(share * 100, 1)}%`, background: color }} />
                </i>
              </span>
              <span className="meta">
                {percent(node.size, current.size)}
                <small>
                  {human(node.size)} · {tag}
                </small>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

type StreamMessage =
  | { type: "progress"; files: number; bytes: number; denied: number }
  | { type: "done"; result: ScanResult }
  | { type: "folder"; node: UsageNode }
  | { type: "error"; message: string };

function ancestors(root: UsageNode, folderPath: string): UsageNode[] | null {
  if (samePath(root.path, folderPath)) return [];
  for (const child of root.children) {
    if (child.kind !== "dir") continue;
    if (samePath(child.path, folderPath)) return [child];
    const nested = ancestors(child, folderPath);
    if (nested) return [child, ...nested];
  }
  return null;
}

function findDir(node: UsageNode, folderPath: string): UsageNode | null {
  if (node.kind === "dir" && samePath(node.path, folderPath)) return node;
  for (const child of node.children) {
    const found = findDir(child, folderPath);
    if (found) return found;
  }
  return null;
}

function graft(node: UsageNode, fresh: UsageNode): UsageNode {
  if (node.kind === "dir" && samePath(node.path, fresh.path)) return fresh;
  let changed = false;
  const children = node.children.map((child) => {
    const next = graft(child, fresh);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

async function readStream(response: Response, onMessage: (message: StreamMessage) => void) {
  if (!response.body) throw new Error("The scan returned an empty response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) emit(line, onMessage);
  }
  emit(buffer, onMessage);
}

function emit(line: string, onMessage: (message: StreamMessage) => void) {
  const trimmed = line.trim();
  if (!trimmed) return;
  onMessage(JSON.parse(trimmed) as StreamMessage);
}
