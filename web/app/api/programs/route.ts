import { localRequest, refused } from "@/lib/local";
import { listPrograms } from "@/lib/programs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!localRequest(req)) return refused();
  try {
    const programs = await listPrograms();
    return Response.json({
      programs: programs
        .filter((program) => program.location)
        .map((program) => ({ name: program.name, location: program.location })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read installed programs.";
    return Response.json({ error: message, programs: [] }, { status: 500 });
  }
}
