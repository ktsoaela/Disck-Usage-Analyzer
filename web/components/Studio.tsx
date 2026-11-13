"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { human, percent, shortName } from "@/lib/format";
import { colorFor, columnRows } from "@/lib/layout";
import { sampleRoot } from "@/lib/sample";
import type { ScanResult, UsageNode } from "@/lib/types";
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

export default function Studio() {
  const [model, setModel] = useState<Model>(freshSample);
  const [stack, setStack] = useState<UsageNode[]>([]);
  const [view, setView] = useState<DiagramView>("explosion");
  const [explode, setExplode] = useState(0.62);
  const [hover, setHover] = useState<UsageNode | null>(null);
  const [path, setPath] = useState("");
  const [drives, setDrives] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ files: number; bytes: number; denied: number } | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const current = stack.at(-1) ?? model.root;
  const viewMeta = VIEWS.find((item) => item.id === view) ?? VIEWS[0];

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
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      setStack((items) => items.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setHover(null);
  }, [current, view]);

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
          setStack([]);
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

  function openNode(node: UsageNode) {
    if (node.kind !== "dir" || node.children.length === 0) return;
    setStack((items) => [...items, node]);
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
            <label htmlFor="folder">Folder</label>
            <div className="scan-row">
              <input
                id="folder"
                value={path}
                placeholder="C:\ or D:\Games"
                spellCheck={false}
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
          {model.sample && <p className="sample">Sample disk. Scan a drive to replace it.</p>}

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
                onClick={() => setStack(stack.slice(0, index))}
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

          <Breakdown current={current} view={view} hover={hover} onOpen={openNode} />

          <p className="hint">
            Two levels of folders are drawn. Deeper files are grouped by type, and the totals still include them.
            Delete stays in the desktop app. Esc steps back.
          </p>
        </aside>

        <section className="stage" aria-label={`${viewMeta.label} diagram of ${current.name}, ${human(current.size)}`}>
          <Scene root={current} view={view} explode={explode} onHover={setHover} onSelect={openNode} />
          <p className="caption">{viewMeta.caption}</p>
        </section>
      </div>
    </div>
  );
}

function Breakdown({
  current,
  view,
  hover,
  onOpen,
}: {
  current: UsageNode;
  view: DiagramView;
  hover: UsageNode | null;
  onOpen: (node: UsageNode) => void;
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
        const tag = node.kind === "dir" ? "Folder" : node.kind === "other" ? "Group" : "Files";
        return (
          <li key={`${node.kind}-${node.name}-${index}`} className={hot ? "hot" : ""}>
            <button type="button" onClick={() => onOpen(node)} disabled={node.kind !== "dir" || node.children.length === 0} title={node.path}>
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
  | { type: "error"; message: string };

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
