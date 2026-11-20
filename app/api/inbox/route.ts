import { scanInbox } from "@/lib/inbox";

export async function GET() {
  return Response.json(scanInbox());
}
