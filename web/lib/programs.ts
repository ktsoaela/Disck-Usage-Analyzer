import { execFile, spawn } from "child_process";
import path from "path";
import { promisify } from "util";
import type { InstalledProgram } from "./programMatch";

const execFileAsync = promisify(execFile);

let cache: { at: number; programs: InstalledProgram[] } | null = null;
let inflight: Promise<InstalledProgram[]> | null = null;

export function listPrograms(): Promise<InstalledProgram[]> {
  if (process.platform !== "win32") return Promise.resolve([]);
  if (cache && Date.now() - cache.at < 60_000) return Promise.resolve(cache.programs);
  if (!inflight) {
    inflight = readPrograms()
      .then((programs) => {
        cache = { at: Date.now(), programs };
        return programs;
      })
      .catch(() => cache?.programs ?? [])
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

async function readPrograms(): Promise<InstalledProgram[]> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", LIST_SCRIPT],
    { windowsHide: true, timeout: 90_000, maxBuffer: 12 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout.trim() || "[]") as InstalledProgram | InstalledProgram[];
  return (Array.isArray(parsed) ? parsed : [parsed]).filter((program) => program && program.name && program.uninstall);
}

const LIST_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$roots = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$apps = foreach ($root in $roots) {
  Get-ItemProperty $root | ForEach-Object {
    if (-not $_.DisplayName -or -not $_.UninstallString) { return }
    [PSCustomObject]@{
      name = [string]$_.DisplayName
      location = [string]$_.InstallLocation
      uninstall = [string]$_.UninstallString
    }
  }
}
if (-not $apps) { '[]' } else { ConvertTo-Json -InputObject @($apps) -Compress }
`;

export function splitCommand(command: string): { file: string; args: string[] } | null {
  const trimmed = command.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    if (end <= 1) return null;
    return { file: trimmed.slice(1, end), args: splitArgs(trimmed.slice(end + 1).trim()) };
  }
  const exe = trimmed.search(/\.exe\b/i);
  if (exe !== -1) {
    return { file: trimmed.slice(0, exe + 4).trim(), args: splitArgs(trimmed.slice(exe + 4).trim()) };
  }
  const parts = splitArgs(trimmed);
  if (parts.length === 0) return null;
  return { file: parts[0], args: parts.slice(1) };
}

function splitArgs(value: string): string[] {
  const args: string[] = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  for (const match of value.matchAll(pattern)) args.push(match[1] ?? match[2] ?? "");
  return args.filter(Boolean);
}

function resolveExe(file: string): string {
  if (path.isAbsolute(file)) return file;
  if (/^msiexec(\.exe)?$/i.test(file)) {
    return path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "msiexec.exe");
  }
  return file;
}

export function startUninstall(command: string) {
  const parts = splitCommand(command);
  if (!parts) throw new Error("That program has no uninstall command.");
  const file = resolveExe(parts.file);
  const child = spawn(/*turbopackIgnore: true*/ file, parts.args, { detached: true, stdio: "ignore", windowsHide: false });
  child.on("error", () => {
    // The studio already returned. The dialog reported that the uninstaller was started.
  });
  child.unref();
}
