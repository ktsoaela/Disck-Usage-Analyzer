import { localRequest, refused } from "@/lib/local";
import { matchProgram } from "@/lib/programMatch";
import { listPrograms, startUninstall } from "@/lib/programs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!localRequest(req)) return refused();
  let body: { path?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send a JSON body with a path." }, { status: 400 });
  }
  const folder = typeof body.path === "string" ? body.path.trim() : "";
  if (!folder) return Response.json({ error: "Choose an installed program folder." }, { status: 400 });
  try {
    const programs = await listPrograms();
    const program = matchProgram(folder, programs);
    if (!program?.uninstall) {
      return Response.json({ error: "That folder is not an installed program." }, { status: 404 });
    }
    startUninstall(program.uninstall);
    return Response.json({ ok: true, name: program.name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the uninstaller.";
    return Response.json({ error: message }, { status: 400 });
  }
}
