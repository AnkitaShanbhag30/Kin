// Seam for a memory layer (e.g. Cognee): persist and recall trial reactions across sessions.
// Not wired yet; Ruth's preferences currently live in the trusted-context KB.
export async function rememberPreference(_who: string, _note: string): Promise<void> {}
export async function recallPreferences(_who: string): Promise<string[]> {
  return [];
}
