import { categoryMeta } from "./categories";
import type { CategoryTotal, UsageNode } from "./types";

const GB = 1024 ** 3;

function cat(dir: string, id: string, gigabytes: number, files: number): UsageNode {
  const meta = categoryMeta(id);
  const total: CategoryTotal = { id, size: Math.round(gigabytes * GB), files };
  return {
    name: meta.label,
    path: dir,
    size: total.size,
    files,
    kind: "category",
    category: id,
    byType: [total],
    children: [],
  };
}

function folder(name: string, dir: string, children: UsageNode[]): UsageNode {
  const types = new Map<string, CategoryTotal>();
  for (const child of children) {
    for (const entry of child.byType) {
      const current = types.get(entry.id) ?? { id: entry.id, size: 0, files: 0 };
      current.size += entry.size;
      current.files += entry.files;
      types.set(entry.id, current);
    }
  }
  const byType = [...types.values()].sort((a, b) => b.size - a.size);
  return {
    name,
    path: dir,
    size: byType.reduce((sum, entry) => sum + entry.size, 0),
    files: byType.reduce((sum, entry) => sum + entry.files, 0),
    kind: "dir",
    byType,
    children: [...children].sort((a, b) => b.size - a.size),
  };
}

export function sampleRoot(): UsageNode {
  const users = folder("Users", "C:\\Users", [
    folder("Videos", "C:\\Users\\Videos", [cat("C:\\Users\\Videos", "video", 82, 640), cat("C:\\Users\\Videos", "audio", 8, 2100)]),
    folder("Games", "C:\\Users\\Games", [
      cat("C:\\Users\\Games", "programs", 48, 180),
      cat("C:\\Users\\Games", "archives", 9, 24),
      cat("C:\\Users\\Games", "video", 7, 40),
    ]),
    cat("C:\\Users", "images", 24, 18600),
    folder("AppData", "C:\\Users\\AppData", [
      cat("C:\\Users\\AppData", "code", 7, 42000),
      cat("C:\\Users\\AppData", "other", 11, 8000),
    ]),
    folder("Downloads", "C:\\Users\\Downloads", [
      cat("C:\\Users\\Downloads", "archives", 8, 36),
      cat("C:\\Users\\Downloads", "video", 5, 18),
      cat("C:\\Users\\Downloads", "programs", 2, 6),
    ]),
    cat("C:\\Users", "documents", 14, 2400),
  ]);

  const programFiles = folder("Program Files", "C:\\Program Files", [
    cat("C:\\Program Files", "programs", 78, 960),
    cat("C:\\Program Files", "other", 14, 1400),
  ]);

  const windows = folder("Windows", "C:\\Windows", [
    cat("C:\\Windows", "programs", 46, 22000),
    cat("C:\\Windows", "other", 16, 9000),
    cat("C:\\Windows", "code", 4, 1500),
  ]);

  const games = folder("Games", "C:\\Games", [
    folder("Steam", "C:\\Games\\Steam", [
      cat("C:\\Games\\Steam", "programs", 28, 90),
      cat("C:\\Games\\Steam", "video", 4, 12),
      cat("C:\\Games\\Steam", "archives", 3, 8),
    ]),
    folder("Xbox", "C:\\Games\\Xbox", [
      cat("C:\\Games\\Xbox", "programs", 18, 40),
      cat("C:\\Games\\Xbox", "other", 2, 20),
    ]),
  ]);

  const x86 = folder("Program Files (x86)", "C:\\Program Files (x86)", [
    cat("C:\\Program Files (x86)", "programs", 14, 700),
    cat("C:\\Program Files (x86)", "other", 5, 300),
  ]);

  return folder("C:\\", "C:\\", [
    users,
    programFiles,
    windows,
    games,
    x86,
    cat("C:\\", "video", 2, 4),
    cat("C:\\", "other", 3, 80),
  ]);
}
