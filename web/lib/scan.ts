import { lstat, readdir, realpath } from "fs/promises";
import type { Dirent } from "fs";
import path from "path";
import { categoryOf } from "./categories";
import type { CategoryTotal, FileEntry, ScanResult, UsageNode } from "./types";

const STRUCT_DEPTH = 8;
const TOP_FOLDERS = 200;
const TOP_FILES = 400;
const LEVEL_FILES = 400;

type Bucket = { size: number; files: number };
type TypeMap = Record<string, Bucket>;

type Accum = {
  files: number;
  bytes: number;
  denied: number;
  signal: AbortSignal;
  onProgress: (progress: { files: number; bytes: number; denied: number }) => void;
  lastEmit: number;
};

export type Built = { node: UsageNode; types: TypeMap };

function abortIfNeeded(ctx: Accum) {
  if (ctx.signal.aborted) {
    const error = new Error("The scan was cancelled.");
    error.name = "AbortError";
    throw error;
  }
}

function bump(ctx: Accum, size: number) {
  ctx.files += 1;
  ctx.bytes += size;
  const now = Date.now();
  if (now - ctx.lastEmit > 250) {
    ctx.lastEmit = now;
    ctx.onProgress({ files: ctx.files, bytes: ctx.bytes, denied: ctx.denied });
  }
}

function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active += 1;
        task().then(resolve, reject).finally(() => {
          active -= 1;
          const next = queue.shift();
          if (next) next();
        });
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
  };
}

const listSlots = pLimit(8);
const fileSlots = pLimit(48);

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function norm(value: string): string {
  return path.normalize(value).toLowerCase();
}

type Keep = "ok" | "skip" | "denied";

async function keepDir(dir: string, visited: Set<string>): Promise<Keep> {
  const self = norm(path.resolve(dir));
  if (visited.has(self)) return "skip";
  visited.add(self);
  return listSlots(async () => {
    try {
      const stat = await lstat(dir);
      if (stat.isSymbolicLink() || !stat.isDirectory()) return "skip";
      const real = norm(await realpath(dir));
      if (real !== self) return "skip";
      return "ok";
    } catch {
      return "denied";
    }
  });
}

async function listDir(dir: string): Promise<{ files: { name: string; full: string }[]; subs: string[] } | null> {
  return listSlots(async () => {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const files: { name: string; full: string }[] = [];
      const subs: string[] = [];
      for (const entry of entries as Dirent[]) {
        if (entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) subs.push(full);
        else if (entry.isFile()) files.push({ name: entry.name, full });
      }
      return { files, subs };
    } catch {
      return null;
    }
  });
}

async function statFiles(files: { name: string; full: string }[], ctx: Accum, into: TypeMap): Promise<FileEntry[]> {
  const found: FileEntry[] = [];
  await mapPool(files, 16, async (file) => {
    await fileSlots(async () => {
      abortIfNeeded(ctx);
      try {
        const stat = await lstat(file.full);
        if (!stat.isFile()) return;
        const id = categoryOf(file.name);
        const bucket = into[id] ?? { size: 0, files: 0 };
        bucket.size += stat.size;
        bucket.files += 1;
        into[id] = bucket;
        found.push({ name: file.name, path: file.full, size: stat.size });
        bump(ctx, stat.size);
      } catch {
        ctx.denied += 1;
      }
    });
  });
  return found;
}

function biggest(files: FileEntry[]): FileEntry[] {
  return [...files].sort((a, b) => b.size - a.size).slice(0, 15);
}

function toList(types: TypeMap): CategoryTotal[] {
  return Object.entries(types)
    .filter(([, bucket]) => bucket.size > 0)
    .map(([id, bucket]) => ({ id, size: bucket.size, files: bucket.files }))
    .sort((a, b) => b.size - a.size);
}

function mergeInto(target: TypeMap, source: TypeMap) {
  for (const [id, bucket] of Object.entries(source)) {
    const current = target[id] ?? { size: 0, files: 0 };
    current.size += bucket.size;
    current.files += bucket.files;
    target[id] = current;
  }
}

function makeDir(name: string, dir: string, types: TypeMap, children: UsageNode[]): UsageNode {
  const byType = toList(types);
  return {
    name,
    path: dir,
    size: byType.reduce((sum, total) => sum + total.size, 0),
    files: byType.reduce((sum, total) => sum + total.files, 0),
    kind: "dir",
    byType,
    children,
    loaded: true,
  };
}

function mergeLists(lists: CategoryTotal[][]): CategoryTotal[] {
  const types: TypeMap = {};
  for (const list of lists) {
    for (const total of list) {
      const bucket = types[total.id] ?? { size: 0, files: 0 };
      bucket.size += total.size;
      bucket.files += total.files;
      types[total.id] = bucket;
    }
  }
  return toList(types);
}

function fileNodes(files: FileEntry[]): UsageNode[] {
  return files.map((file) => {
    const id = categoryOf(file.name);
    const total: CategoryTotal = { id, size: file.size, files: 1 };
    return {
      name: file.name,
      path: file.path,
      size: file.size,
      files: 1,
      kind: "file" as const,
      category: id,
      byType: [total],
      children: [],
    };
  });
}

function smallerItems(dropped: UsageNode[], parentPath: string): UsageNode {
  return {
    name: "Smaller items",
    path: parentPath,
    size: dropped.reduce((sum, node) => sum + node.size, 0),
    files: dropped.reduce((sum, node) => sum + node.files, 0),
    kind: "other",
    byType: mergeLists(dropped.map((node) => node.byType)),
    children: [],
  };
}

function assemble(
  folders: UsageNode[],
  files: UsageNode[],
  parentPath: string,
  folderCap = TOP_FOLDERS,
  fileCap = TOP_FILES,
): UsageNode[] {
  const sortedFolders = [...folders].sort((a, b) => b.size - a.size);
  const sortedFiles = [...files].sort((a, b) => b.size - a.size);
  const dropped = [...sortedFolders.slice(folderCap), ...sortedFiles.slice(fileCap)];
  const visual = [...sortedFolders.slice(0, folderCap), ...sortedFiles.slice(0, fileCap)];
  if (dropped.length > 0) visual.push(smallerItems(dropped, parentPath));
  visual.sort((a, b) => b.size - a.size);
  return visual;
}

async function crawl(
  initial: string[],
  run: (dir: string) => Promise<string[]>,
  concurrency: number,
  signal: AbortSignal,
) {
  const queue = [...initial];
  let running = 0;
  await new Promise<void>((resolve, reject) => {
    const pump = () => {
      if (signal.aborted) {
        const error = new Error("The scan was cancelled.");
        error.name = "AbortError";
        reject(error);
        return;
      }
      while (running < concurrency && queue.length > 0) {
        const dir = queue.shift();
        if (!dir) break;
        running += 1;
        run(dir).then(
          (children) => {
            for (const child of children) queue.push(child);
            running -= 1;
            if (running === 0 && queue.length === 0) resolve();
            else pump();
          },
          (error) => reject(error),
        );
      }
      if (running === 0 && queue.length === 0) resolve();
    };
    pump();
  });
}

async function measure(dir: string, name: string, ctx: Accum, visited: Set<string>): Promise<Built> {
  const types: TypeMap = {};
  let directFiles: FileEntry[] = [];
  await crawl(
    [dir],
    async (current) => {
      abortIfNeeded(ctx);
      const keep = await keepDir(current, visited);
      if (keep === "skip") return [];
      if (keep === "denied") {
        ctx.denied += 1;
        return [];
      }
      const listed = await listDir(current);
      if (!listed) {
        ctx.denied += 1;
        return [];
      }
      const files = await statFiles(listed.files, ctx, types);
      if (norm(current) === norm(dir)) directFiles = files;
      return listed.subs;
    },
    4,
    ctx.signal,
  );
  const node = makeDir(name, dir, types, []);
  const shown = assemble([], fileNodes(directFiles), dir);
  const shownBytes = shown.reduce((sum, child) => sum + child.size, 0);
  const nested = node.size - shownBytes;
  const children = [...shown];
  if (nested > 0) {
    children.push({
      name: "Inside",
      path: dir,
      size: nested,
      files: Math.max(0, node.files - shown.reduce((sum, child) => sum + child.files, 0)),
      kind: "other",
      byType: [],
      children: [],
    });
  }
  node.children = children.sort((a, b) => b.size - a.size);
  node.largest = biggest(directFiles);
  node.loaded = false;
  return { node, types };
}

async function scanDir(dir: string, name: string, depth: number, ctx: Accum, visited: Set<string>): Promise<Built> {
  abortIfNeeded(ctx);
  const keep = await keepDir(dir, visited);
  if (keep !== "ok") {
    if (keep === "denied") ctx.denied += 1;
    return { node: makeDir(name, dir, {}, []), types: {} };
  }

  const listed = await listDir(dir);
  if (!listed) {
    ctx.denied += 1;
    return { node: makeDir(name, dir, {}, []), types: {} };
  }

  const direct: TypeMap = {};
  const directFiles = await statFiles(listed.files, ctx, direct);

  const built = (
    await mapPool(listed.subs, 2, async (sub) => {
      abortIfNeeded(ctx);
      const childName = path.basename(sub);
      if (depth >= STRUCT_DEPTH) return measure(sub, childName, ctx, visited);
      return scanDir(sub, childName, depth + 1, ctx, visited);
    })
  ).filter((child) => child.node.size > 0);

  const types: TypeMap = {};
  mergeInto(types, direct);
  for (const child of built) mergeInto(types, child.types);

  const folderNodes = built.map((child) => child.node);
  const children = assemble(folderNodes, fileNodes(directFiles), dir);
  const node = makeDir(name, dir, types, children);
  node.largest = biggest(directFiles);
  node.loaded = folderNodes.length <= TOP_FOLDERS;
  return { node, types };
}

/** Read one folder level so a click can keep going deeper than the first scan. */
export async function listLevel(
  input: string,
  signal: AbortSignal,
  onProgress: Accum["onProgress"],
): Promise<UsageNode> {
  const resolved = path.resolve(normalizeInput(input));
  let rootStat;
  try {
    rootStat = await lstat(resolved);
  } catch {
    throw new Error(`Can't open ${resolved}`);
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`${resolved} is not a folder.`);
  }

  const ctx: Accum = {
    files: 0,
    bytes: 0,
    denied: 0,
    signal,
    onProgress,
    lastEmit: 0,
  };
  const listed = await listDir(resolved);
  if (!listed) throw new Error(`Can't read ${resolved}`);

  const direct: TypeMap = {};
  const directFiles = await statFiles(listed.files, ctx, direct);
  const built = await mapPool(listed.subs, 2, async (sub) => {
    abortIfNeeded(ctx);
    const measured = await measure(sub, path.basename(sub), ctx, new Set());
    measured.node.children = [];
    measured.node.loaded = false;
    return measured;
  });

  const types: TypeMap = {};
  mergeInto(types, direct);
  for (const child of built) mergeInto(types, child.types);
  const folders = built.map((child) => child.node).filter((node) => node.size > 0);
  const node = makeDir(
    path.basename(resolved) || resolved,
    resolved,
    types,
    assemble(folders, fileNodes(directFiles), resolved, folders.length || 1, LEVEL_FILES),
  );
  node.largest = biggest(directFiles);
  node.loaded = true;
  onProgress({ files: ctx.files, bytes: ctx.bytes, denied: ctx.denied });
  return node;
}

function normalizeInput(input: string): string {
  const trimmed = input.trim().replace(/^"|"$/g, "");
  if (/^[a-zA-Z]:$/.test(trimmed)) return `${trimmed}\\`;
  return trimmed;
}

export async function scanPath(
  input: string,
  signal: AbortSignal,
  onProgress: Accum["onProgress"],
): Promise<ScanResult> {
  const resolved = path.resolve(normalizeInput(input));
  let rootStat;
  try {
    rootStat = await lstat(resolved);
  } catch {
    throw new Error(`Can't open ${resolved}`);
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`${resolved} is not a folder.`);
  }

  const started = Date.now();
  const ctx: Accum = {
    files: 0,
    bytes: 0,
    denied: 0,
    signal,
    onProgress,
    lastEmit: 0,
  };
  const built = await scanDir(resolved, resolved, 0, ctx, new Set());
  onProgress({ files: ctx.files, bytes: ctx.bytes, denied: ctx.denied });
  return {
    root: built.node,
    path: resolved,
    files: ctx.files,
    bytes: built.node.size,
    denied: ctx.denied,
    elapsedMs: Date.now() - started,
  };
}
