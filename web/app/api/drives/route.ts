import { access } from "fs/promises";
import { constants } from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.platform !== "win32") {
    return Response.json({ drives: ["/"] });
  }
  const drives: string[] = [];
  for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
    const root = `${letter}:\\`;
    try {
      await access(root, constants.F_OK);
      drives.push(root);
    } catch {
      // This letter has no volume.
    }
  }
  return Response.json({ drives });
}
