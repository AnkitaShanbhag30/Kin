// Persona: confirm the human caregiver behind the agent before it spends money.
// The caregiver completes Persona's hosted flow in the app; at checkout the agent re-checks
// that inquiry's status with the Persona API (never trusting the redirect's query params).
const PERSONA_API = "https://api.withpersona.com/api/v1";
const PERSONA_HOSTED = "https://inquiry.withpersona.com/verify";
export const CAREGIVER_REFERENCE_ID = "caregiver-priya-demo";

const env = (k: string) => process.env[k]?.trim() || undefined;
// Tolerate values pasted from a hosted-flow link (e.g. "itmpl_abc&environment-id=...").
const idFrom = (k: string, prefix: string) => env(k)?.match(new RegExp(`${prefix}[A-Za-z0-9]+`))?.[0];

// Persona is enforced only when the caregiver can actually complete it (hosted flow or a known inquiry).
export const personaEnforced = () => Boolean(env("PERSONA_API_KEY") && (env("PERSONA_TEMPLATE_ID") || env("PERSONA_INQUIRY_ID")));
export const personaHostedFlow = () => Boolean(env("PERSONA_API_KEY") && env("PERSONA_TEMPLATE_ID"));
export const identityProvider = () => (personaEnforced() ? "persona" : "stub");

export function hostedFlowUrl(redirectUri: string) {
  const template = idFrom("PERSONA_TEMPLATE_ID", "itmpl_");
  if (!template) throw new Error("Set PERSONA_TEMPLATE_ID (itmpl_...) in .env.local");
  const params = new URLSearchParams({
    "inquiry-template-id": template,
    "reference-id": CAREGIVER_REFERENCE_ID,
    "redirect-uri": redirectUri,
  });
  const envId = idFrom("PERSONA_ENVIRONMENT_ID", "env_");
  if (envId) params.set("environment-id", envId);
  return `${PERSONA_HOSTED}?${params}`;
}

export async function getInquiry(inquiryId: string) {
  const key = env("PERSONA_API_KEY");
  if (!key) throw new Error("PERSONA_API_KEY not set");
  const res = await fetch(`${PERSONA_API}/inquiries/${encodeURIComponent(inquiryId)}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Key-Inflection": "kebab" },
  });
  if (!res.ok) throw new Error(`Persona inquiry lookup failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { data?: { id?: string; attributes?: Record<string, unknown> } };
  const a = data.data?.attributes ?? {};
  const status = String(a.status ?? "unknown");
  return {
    inquiry_id: data.data?.id ?? inquiryId,
    status,
    verified: status === "approved" || status === "completed",
    environment: key.startsWith("persona_sandbox") ? ("sandbox" as const) : ("production" as const),
    completed_at: (a["completed-at"] as string | null) ?? null,
  };
}

export async function verifyCaregiver(name: string, inquiryId?: string) {
  if (!personaEnforced()) {
    return { verified: true, name, provider: "stub" as const, note: "Persona not configured; verification simulated." };
  }
  const id = inquiryId || env("PERSONA_INQUIRY_ID");
  if (!id) {
    return { verified: false, name, provider: "persona" as const, status: "not_started", note: "Caregiver has not completed Persona verification." };
  }
  return { name, provider: "persona" as const, ...(await getInquiry(id)) };
}
