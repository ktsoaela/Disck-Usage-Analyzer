export type NodeKind = "dir" | "file" | "category" | "other";

export type CategoryTotal = {
  id: string;
  size: number;
  files: number;
};

export type FileEntry = {
  name: string;
  path: string;
  size: number;
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
  /**
   * True when this folder's children are the real next level.
   * False when the size is known but the next level still has to be read.
   */
  loaded?: boolean;
  /** Biggest files that sit directly in this folder. */
  largest?: FileEntry[];
};

export type ScanResult = {
  root: UsageNode;
  path: string;
  files: number;
  bytes: number;
  denied: number;
  elapsedMs: number;
};
