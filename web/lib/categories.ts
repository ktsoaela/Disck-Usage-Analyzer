export type Category = {
  id: string;
  label: string;
  color: string;
  exts: readonly string[];
};

/** Same groups as the desktop app in src/app.rs. */
export const CATEGORIES: readonly Category[] = [
  {
    id: "video",
    label: "Video",
    color: "#d94b4b",
    exts: ["mp4", "mkv", "avi", "mov", "wmv", "webm", "flv", "m4v", "mpg", "mpeg", "ts"],
  },
  {
    id: "audio",
    label: "Audio",
    color: "#d98a3a",
    exts: ["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "opus"],
  },
  {
    id: "images",
    label: "Images",
    color: "#d4b23a",
    exts: ["jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff", "svg", "heic", "raw", "psd", "ico", "cr2", "nef"],
  },
  {
    id: "documents",
    label: "Documents",
    color: "#3dba6e",
    exts: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "odt", "ods", "csv", "rtf", "epub"],
  },
  {
    id: "code",
    label: "Code / data",
    color: "#2fbfb0",
    exts: ["rs", "c", "cpp", "h", "hpp", "py", "js", "ts", "tsx", "jsx", "java", "cs", "go", "html", "css", "json", "xml", "toml", "yaml", "yml", "sql", "db", "sqlite", "rlib", "pdb", "o", "obj", "lib", "a"],
  },
  {
    id: "programs",
    label: "Programs",
    color: "#3d8fd4",
    exts: ["exe", "dll", "sys", "so", "dylib", "bin", "msi", "appx", "msix"],
  },
  {
    id: "archives",
    label: "Archives",
    color: "#9a62d6",
    exts: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst", "iso", "img", "vhd", "vhdx", "vmdk", "cab", "dmg"],
  },
  {
    id: "other",
    label: "Other",
    color: "#8b93a1",
    exts: [],
  },
];

const BY_EXT = new Map<string, string>();
for (const category of CATEGORIES) {
  for (const ext of category.exts) BY_EXT.set(ext, category.id);
}

const BY_ID = new Map(CATEGORIES.map((category) => [category.id, category]));

export function categoryOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "other";
  return BY_EXT.get(filename.slice(dot + 1).toLowerCase()) ?? "other";
}

export function categoryMeta(id: string): Category {
  return BY_ID.get(id) ?? CATEGORIES[CATEGORIES.length - 1];
}
