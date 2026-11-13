import { localRequest, refused } from "@/lib/local";
import { removePath, resolvePair, type DeleteMode } from "@/lib/remove";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!localRequest(req)) return refused();
  let body: { root?: unknown; path?: unknown; mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send a JSON body with a path." }, { status: 400 });
  }
  const root = typeof body.root === "string" ? body.root.trim() : "";
  const target = typeof body.path === "string" ? body.path.trim() : "";
  const mode: DeleteMode = body.mode === "permanent" ? "permanent" : body.mode === "recycle" ? "recycle" : "recycle";
  if (body.mode !== "permanent" && body.mode !== "recycle") {
    return Response.json({ error: "Choose the Recycle Bin or a permanent delete." }, { status: 400 });
  }
  if (!root || !target) {
    return Response.json({ error: "Choose an item inside the scanned folder." }, { status: 400 });
  }
  try {
    const pair = resolvePair(root, target);
    await removePath(pair.target, mode);
    return Response.json({ ok: true, mode });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not remove that item.";
    return Response.json({ error: message }, { status: 400 });
  }
}
