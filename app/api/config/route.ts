import { analyticsProvider } from "@/lib/analytics";
import { identityProvider, personaHostedFlow } from "@/lib/identity";
import { contextProvider } from "@/lib/tools/senso";

// Which sponsor integrations are live, so the UI can label demo fallbacks honestly.
export async function GET() {
  return Response.json({
    context: contextProvider(),
    identity: identityProvider(),
    personaHostedFlow: personaHostedFlow(),
    analytics: analyticsProvider(),
  });
}
