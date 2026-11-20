// Seam for identity verification (e.g. Persona): confirm the human caregiver behind the agent
// before it spends money. Stubbed for the demo.
export async function verifyCaregiver(name: string) {
  return { verified: true, name, provider: "stub" as const };
}
