import { hostedFlowUrl } from "@/lib/identity";

// Sends the caregiver to Persona's hosted flow; Persona redirects back with ?inquiry-id=...
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  try {
    return Response.redirect(hostedFlowUrl(`${origin}/`), 302);
  } catch (err) {
    return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
