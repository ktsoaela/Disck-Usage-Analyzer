import { lstat, readdir, realpath } from "fs/promises";
import type { Dirent } from "fs";
import path from "path";
import { categoryMeta, categoryOf } from "./categories";
import type { CategoryTotal, ScanResult, UsageNode } from "./types";

const STRUCT_DEPTH = 2;
const TOP_FOLDERS = 8;

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

async function statFiles(files: { name: string; full: string }[], ctx: Accum, into: TypeMap) {
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
        bump(ctx, stat.size);
      } catch {
        ctx.denied += 1;
      }
    });
  });
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

function categoryNodes(dir: string, types: TypeMap): UsageNode[] {
  return toList(types).map((total) => ({
    name: categoryMeta(total.id).label,
    path: dir,
    size: total.size,
    files: total.files,
    kind: "category" as const,
    category: total.id,
    byType: [total],
    children: [],
  }));
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

function prune(children: UsageNode[], parentPath: string): UsageNode[] {
  const folders = children.filter((child) => child.kind === "dir").sort((a, b) => b.size - a.size);
  const categories = children.filter((child) => child.kind === "category");
  const keep = folders.slice(0, TOP_FOLDERS);
  const dropped = folders.slice(TOP_FOLDERS);
  const visual = [...keep, ...categories];
  if (dropped.length > 0) {
    visual.push({
      name: "Other",
      path: parentPath,
      size: dropped.reduce((sum, folder) => sum + folder.size, 0),
      files: dropped.reduce((sum, folder) => sum + folder.files, 0),
      kind: "other",
      byType: mergeLists(dropped.map((folder) => folder.byType)),
      children: [],
    });
  }
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
      await statFiles(listed.files, ctx, types);
      return listed.subs;
    },
    4,
    ctx.signal,
  );
  const node = makeDir(name, dir, types, prune(categoryNodes(dir, types), dir));
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
  await statFiles(listed.files, ctx, direct);

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

  const children = prune(
    [...built.map((child) => child.node), ...categoryNodes(dir, direct)],
    dir,
  );
  return { node: makeDir(name, dir, types, children), types };
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
