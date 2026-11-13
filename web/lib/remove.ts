import { execFile } from "child_process";
import { chmod, lstat, readdir, rm } from "fs/promises";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type DeleteMode = "recycle" | "permanent";

export function resolvePair(root: string, target: string): { root: string; target: string } {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  const rel = path.relative(rootPath, targetPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("The scanned folder stays put.");
  }
  if (/^[a-zA-Z]:\\?$/.test(targetPath)) {
    throw new Error("A drive root stays put.");
  }
  return { root: rootPath, target: targetPath };
}

async function assertReal(target: string) {
  let stat;
  try {
    stat = await lstat(target);
  } catch {
    throw new Error("That item is already gone.");
  }
  if (stat.isSymbolicLink()) throw new Error("Links stay put.");
  if (!stat.isFile() && !stat.isDirectory()) throw new Error("That item cannot be removed.");
  return stat;
}

const RECYCLE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
$path = $env:DISK_USAGE_TARGET
if (-not (Test-Path -LiteralPath $path)) { throw 'That item is already gone.' }
$item = Get-Item -LiteralPath $path -Force
if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Links stay put.' }
if ($item.PSIsContainer) {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($path, 'OnlyErrorDialogs', 'SendToRecycleBin')
} else {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($path, 'OnlyErrorDialogs', 'SendToRecycleBin')
}
`;

async function recycle(target: string) {
  if (process.platform !== "win32") {
    throw new Error("The Recycle Bin is available on Windows.");
  }
  try {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", RECYCLE_SCRIPT],
      {
        env: { ...process.env, DISK_USAGE_TARGET: target },
        windowsHide: true,
        timeout: 120_000,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not move that item to the Recycle Bin.";
    throw new Error(message.replace(/\r/g, "").split("\n").filter(Boolean).at(-1) ?? message);
  }
}

async function clearReadonly(target: string) {
  let stat;
  try {
    stat = await lstat(target);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) return;
  try {
    await chmod(target, stat.isDirectory() ? 0o777 : 0o666);
  } catch {
    // Keep going. A locked file fails the delete with its own message.
  }
  if (!stat.isDirectory()) return;
  let entries;
  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    await clearReadonly(path.join(target, entry.name));
  }
}

async function permanent(target: string) {
  try {
    await rm(target, { recursive: true });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "EPERM" && code !== "EACCES") {
      throw new Error(error instanceof Error ? error.message : "Could not delete that item.");
    }
    await clearReadonly(target);
    try {
      await rm(target, { recursive: true });
    } catch (retry) {
      throw new Error(retry instanceof Error ? retry.message : "Could not delete that item.");
    }
  }
}

export async function removePath(target: string, mode: DeleteMode) {
  await assertReal(target);
  if (mode === "recycle") await recycle(target);
  else await permanent(target);
}
