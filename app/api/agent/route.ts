import { runAgent } from "@/lib/agent";
import { createRunTracker } from "@/lib/analytics";

export const runtime = "nodejs";
export const maxDuration = 300;

// Streams AuditEvents as newline-delimited JSON so the UI renders the trail live.
export async function POST(req: Request) {
  const { prompt } = (await req.json()) as { prompt?: string };
  if (!prompt?.trim()) return Response.json({ error: "prompt required" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const tracker = createRunTracker();
      await runAgent(prompt, (e) => {
        tracker.track(e);
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      });
      await tracker.flush();
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
