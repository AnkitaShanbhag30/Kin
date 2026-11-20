import { loadKb } from "../kb";
import type { Source } from "../audit";

const SENSO_BASE = "https://apiv2.senso.ai/api/v1";

export const contextProvider = () => (process.env.SENSO_API_KEY ? "senso" : "local-fallback");

type SensoResult = { content_id: string; title: string; chunk_text: string; score?: number };

// Retrieval only: Claude does the reasoning, Senso supplies citable chunks.
export async function searchTrustedContext(query: string): Promise<Source[]> {
  const key = process.env.SENSO_API_KEY;
  if (!key) return localSearch(query);

  const res = await fetch(`${SENSO_BASE}/org/search/context`, {
    method: "POST",
    headers: { "X-API-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ query, max_results: 5 }),
  });
  if (!res.ok) throw new Error(`Senso search failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { results?: SensoResult[] };
  return (data.results ?? []).map((r) => ({ ...r, provider: "senso" as const }));
}

// Offline stand-in so the demo runs without a Senso key. Clearly labeled in the UI.
function localSearch(query: string): Source[] {
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  const chunks = loadKb().flatMap((doc) => {
    const out: { doc: typeof doc; chunk_text: string; i: number }[] = [];
    let heading = "";
    for (const part of doc.text.split(/\n(?=## )|\n(?=- )/).map((c) => c.trim())) {
      if (!part || part.startsWith("# ") || part.startsWith(">")) continue;
      if (part.startsWith("## ")) {
        heading = part.slice(3).split("\n")[0];
        continue;
      }
      out.push({ doc, chunk_text: heading ? `${heading}: ${part.replace(/^- /, "")}` : part, i: out.length });
    }
    return out;
  });
  return chunks
    .map(({ doc, chunk_text, i }) => {
      const hay = (doc.title + " " + chunk_text).toLowerCase();
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0) / Math.max(terms.length, 1);
      return { content_id: `${doc.file.replace(/\.md$/, "")}#${i}`, title: doc.title, chunk_text, score, provider: "local-fallback" as const };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
