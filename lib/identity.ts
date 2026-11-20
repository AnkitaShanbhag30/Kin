// Persona: confirm the human caregiver behind the agent before it spends money.
// The caregiver completes a Persona inquiry once (hosted flow); the agent re-checks its status at checkout.
const PERSONA_BASE = "https://api.withpersona.com/api/v1";

export const identityProvider = () =>
  process.env.PERSONA_API_KEY && process.env.PERSONA_INQUIRY_ID ? "persona" : "stub";

export async function verifyCaregiver(name: string) {
  const key = process.env.PERSONA_API_KEY;
  const inquiryId = process.env.PERSONA_INQUIRY_ID;
  if (!key || !inquiryId) {
    return { verified: true, name, provider: "stub" as const, note: "Persona not configured; verification skipped." };
  }
  const res = await fetch(`${PERSONA_BASE}/inquiries/${inquiryId}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Persona inquiry lookup failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { data?: { attributes?: Record<string, unknown> } };
  const status = String(data.data?.attributes?.status ?? "unknown");
  return {
    verified: status === "approved" || status === "completed",
    name,
    provider: "persona" as const,
    inquiry_id: inquiryId,
    status,
  };
}
