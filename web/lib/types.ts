export type NodeKind = "dir" | "category" | "other";

export type CategoryTotal = {
  id: string;
  size: number;
  files: number;
};

export type UsageNode = {
  name: string;
  path: string;
  size: number;
  files: number;
  kind: NodeKind;
  category?: string;
  byType: CategoryTotal[];
  children: UsageNode[];
};

export type ScanResult = {
  root: UsageNode;
  path: string;
  files: number;
  bytes: number;
  denied: number;
  elapsedMs: number;
};
