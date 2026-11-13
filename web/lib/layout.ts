import { categoryMeta } from "./categories";
import { treemap } from "./treemap";
import type { UsageNode } from "./types";

const FOLDER_PALETTE = [
  "#e05757",
  "#f0c75a",
  "#4fbf8a",
  "#4aa8d8",
  "#9b6fe0",
  "#e07a4f",
  "#5ec8c5",
  "#d46aa6",
  "#8fbf4a",
  "#6c8cff",
];

export type Slice = {
  node: UsageNode;
  a0: number;
  a1: number;
  depth: number;
  color: string;
  share: number;
};

export type Block = {
  node: UsageNode;
  x: number;
  z: number;
  w: number;
  d: number;
  color: string;
};

export type ColumnRow = {
  id: string;
  label: string;
  color: string;
  size: number;
  files: number;
  share: number;
};

export function colorFor(node: UsageNode, index: number, parent: string | null): string {
  if (node.kind === "category" && node.category) return categoryMeta(node.category).color;
  if (node.kind === "other") return "#6b7280";
  const base = FOLDER_PALETTE[index % FOLDER_PALETTE.length];
  return parent ? mixHex(parent, base, 0.62) : base;
}

export function layoutSlices(root: UsageNode, maxDepth: number): Slice[] {
  const slices: Slice[] = [];
  const children = root.children.filter((child) => child.size > 0);
  place(children, -Math.PI / 2, Math.PI * 1.5, 0, null, maxDepth, root.size || 1, slices);
  return slices;
}

function place(
  nodes: UsageNode[],
  a0: number,
  a1: number,
  depth: number,
  parent: string | null,
  maxDepth: number,
  parentSize: number,
  out: Slice[],
) {
  const total = nodes.reduce((sum, node) => sum + node.size, 0) || 1;
  const spanAll = a1 - a0;
  let cursor = a0;
  nodes.forEach((node, index) => {
    const span = (node.size / total) * spanAll;
    const shrink = Math.min(0.015, span * 0.22);
    const start = cursor + shrink / 2;
    const end = cursor + span - shrink / 2;
    const color = colorFor(node, index, parent);
    if (end - start > 0.008) {
      out.push({
        node,
        a0: start,
        a1: end,
        depth,
        color,
        share: node.size / (parentSize || 1),
      });
      if (depth + 1 < maxDepth && node.kind === "dir" && node.children.length > 0) {
        place(
          node.children.filter((child) => child.size > 0),
          start,
          end,
          depth + 1,
          color,
          maxDepth,
          node.size,
          out,
        );
      }
    }
    cursor += span;
  });
}

export function cityBlocks(root: UsageNode): Block[] {
  const children = root.children.filter((child) => child.size > 0);
  const rects = treemap(
    children.map((child) => child.size),
    8,
    8,
  );
  const blocks: Block[] = [];
  children.forEach((node, index) => {
    const rect = rects[index];
    if (!rect || rect.w <= 0.05 || rect.h <= 0.05) return;
    const color = colorFor(node, index, null);
    const nested = node.kind === "dir" ? node.children.filter((child) => child.size > 0) : [];
    if (nested.length > 0 && rect.w > 0.85 && rect.h > 0.85) {
      const pad = 0.08;
      const inner = treemap(
        nested.map((child) => child.size),
        rect.w - pad * 2,
        rect.h - pad * 2,
      );
      nested.forEach((child, childIndex) => {
        const piece = inner[childIndex];
        if (!piece || piece.w <= 0.05 || piece.h <= 0.05) return;
        blocks.push({
          node: child,
          x: rect.x + pad + piece.x,
          z: rect.y + pad + piece.y,
          w: Math.max(piece.w - 0.05, 0.04),
          d: Math.max(piece.h - 0.05, 0.04),
          color: colorFor(child, childIndex, color),
        });
      });
      return;
    }
    blocks.push({
      node,
      x: rect.x + 0.04,
      z: rect.y + 0.04,
      w: Math.max(rect.w - 0.08, 0.04),
      d: Math.max(rect.h - 0.08, 0.04),
      color,
    });
  });
  return blocks;
}

export function columnRows(node: UsageNode): ColumnRow[] {
  const total = node.byType.reduce((sum, entry) => sum + entry.size, 0) || 1;
  return node.byType.map((entry) => {
    const meta = categoryMeta(entry.id);
    return {
      id: entry.id,
      label: meta.label,
      color: meta.color,
      size: entry.size,
      files: entry.files,
      share: entry.size / total,
    };
  });
}

export function mixHex(a: string, b: string, t: number): string {
  const from = parseHex(a);
  const to = parseHex(b);
  const mixed = from.map((channel, index) => Math.round(channel + (to[index] - channel) * t));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function parseHex(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}
