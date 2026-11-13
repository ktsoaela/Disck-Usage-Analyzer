import { scanPath } from "@/lib/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { path?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send a JSON body with a path." }, { status: 400 });
  }
  const target = typeof body.path === "string" ? body.path.trim() : "";
  if (!target) {
    return Response.json({ error: "Enter a drive or folder path." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (value: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        } catch {
          // The browser closed the stream.
        }
      };
      try {
        const result = await scanPath(target, req.signal, (progress) => {
          send({ type: "progress", ...progress });
        });
        send({ type: "done", result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Scan failed.";
        send({ type: "error", message });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
