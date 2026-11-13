export type InstalledProgram = {
  name: string;
  location: string;
  uninstall?: string;
};

function norm(value: string): string {
  let text = value.replace(/\//g, "\\").toLowerCase();
  if (/^[a-z]:\\$/.test(text)) return text;
  return text.replace(/\\+$/g, "");
}

function deepEnough(folder: string): boolean {
  return norm(folder).split("\\").filter(Boolean).length >= 3;
}

/** A folder matches a program only when it is that program's install folder. */
export function matchProgram(folderPath: string, programs: InstalledProgram[]): InstalledProgram | null {
  const key = norm(folderPath);
  if (!deepEnough(key)) return null;
  return programs.find((program) => program.location && norm(program.location) === key) ?? null;
}
