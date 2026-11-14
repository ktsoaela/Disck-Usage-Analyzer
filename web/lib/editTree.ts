import { categoryOf } from "./categories";
import type { CategoryTotal, FileEntry, UsageNode } from "./types";

function norm(value: string): string {
  let text = value.replace(/\//g, "\\").toLowerCase();
  if (/^[a-z]:\\$/.test(text)) return text;
  return text.replace(/\\+$/g, "");
}

function isInside(parent: string, child: string): boolean {
  return norm(child).startsWith(`${norm(parent)}\\`);
}

function containsFile(folder: string, file: string): boolean {
  const parent = norm(folder);
  const target = norm(file);
  return target.startsWith(`${parent}\\`) || dirOf(target) === parent;
}

function dirOf(file: string): string {
  const text = norm(file);
  const cut = text.lastIndexOf("\\");
  if (cut <= 2) return text.slice(0, cut + 1);
  return text.slice(0, cut);
}

function subtractTypes(totals: CategoryTotal[], gone: CategoryTotal[]): CategoryTotal[] {
  const drop = new Map(gone.map((total) => [total.id, total]));
  return totals
    .map((total) => {
      const removed = drop.get(total.id);
      if (!removed) return total;
      return { id: total.id, size: total.size - removed.size, files: total.files - removed.files };
    })
    .filter((total) => total.size > 0 && total.files > 0)
    .sort((a, b) => b.size - a.size);
}

function diffTypes(before: CategoryTotal[], after: CategoryTotal[]): CategoryTotal[] {
  const later = new Map(after.map((total) => [total.id, total]));
  return before
    .map((total) => {
      const next = later.get(total.id);
      return {
        id: total.id,
        size: total.size - (next?.size ?? 0),
        files: total.files - (next?.files ?? 0),
      };
    })
    .filter((total) => total.size > 0 && total.files > 0);
}

function dropEmpty(children: UsageNode[]): UsageNode[] {
  return children.filter((child) => child.size > 0).sort((a, b) => b.size - a.size);
}

export function removeFolder(node: UsageNode, folderPath: string): UsageNode {
  if (node.kind !== "dir") return node;
  const target = norm(folderPath);
  const removedBox: { node: UsageNode | null } = { node: null };
  const children = node.children.flatMap((child) => {
    if (child.kind === "dir" && norm(child.path) === target) {
      removedBox.node = child;
      return [];
    }
    if (child.kind === "dir" && isInside(child.path, folderPath)) {
      const next = removeFolder(child, folderPath);
      if (next !== child) {
        removedBox.node = {
          ...child,
          size: Math.max(0, child.size - next.size),
          files: Math.max(0, child.files - next.files),
          byType: diffTypes(child.byType, next.byType),
          largest: [],
          children: [],
        };
      }
      return [next];
    }
    return [child];
  });
  const removed = removedBox.node;
  if (!removed) return node;
  return {
    ...node,
    size: Math.max(0, node.size - removed.size),
    files: Math.max(0, node.files - removed.files),
    byType: subtractTypes(node.byType, removed.byType),
    largest: (node.largest ?? []).filter((file) => !containsFile(folderPath, file.path)),
    children: dropEmpty(children),
  };
}

export function removeFile(node: UsageNode, file: FileEntry): UsageNode {
  if (node.kind !== "dir" || !containsFile(node.path, file.path)) return node;
  const id = categoryOf(file.name);
  const direct = dirOf(file.path) === norm(node.path);
  const gone: CategoryTotal = { id, size: file.size, files: 1 };
  const children = node.children.map((child) => {
    if (child.kind === "dir" && containsFile(child.path, file.path)) return removeFile(child, file);
    if (direct && child.kind === "category" && child.category === id) {
      return {
        ...child,
        size: Math.max(0, child.size - file.size),
        files: Math.max(0, child.files - 1),
        byType: subtractTypes(child.byType, [gone]),
      };
    }
    return child;
  });
  return {
    ...node,
    size: Math.max(0, node.size - file.size),
    files: Math.max(0, node.files - 1),
    byType: subtractTypes(node.byType, [gone]),
    largest: (node.largest ?? []).filter((entry) => norm(entry.path) !== norm(file.path)),
    children: dropEmpty(children),
  };
}

export function rebind(root: UsageNode, paths: string[]): UsageNode[] {
  const stack: UsageNode[] = [];
  let cursor = root;
  for (const folder of paths) {
    const next = cursor.children.find((child) => child.kind === "dir" && norm(child.path) === norm(folder));
    if (!next) break;
    stack.push(next);
    cursor = next;
  }
  return stack;
}
