// Pushes data/kb/*.md into the Senso context layer. Usage: npm run seed
import { loadKb } from "../lib/kb";

const BASE = "https://apiv2.senso.ai/api/v1";
const key = process.env.SENSO_API_KEY;
if (!key) throw new Error("Set SENSO_API_KEY in .env.local");
const headers = { "X-API-Key": key, "Content-Type": "application/json" };

async function main() {
  const me = await fetch(`${BASE}/org/me`, { headers });
  console.log("org:", me.status, await me.text());

  for (const doc of loadKb()) {
    const res = await fetch(`${BASE}/org/kb/raw`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: doc.title, text: doc.text }),
    });
    if (res.status === 409) {
      console.log(`skip (already ingested): ${doc.file}`);
      continue;
    }
    if (!res.ok) throw new Error(`${doc.file}: ${res.status} ${await res.text()}`);
    const { kb_node_id } = (await res.json()) as { kb_node_id: string };
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const node = (await (await fetch(`${BASE}/org/kb/nodes/${kb_node_id}`, { headers })).json()) as {
        content?: { processing_status?: string };
      };
      const status = node.content?.processing_status;
      if (status === "complete") break;
      if (status === "failed") throw new Error(`${doc.file}: processing failed`);
    }
    console.log(`ingested: ${doc.file} -> ${kb_node_id}`);
  }

  const probe = await fetch(`${BASE}/org/search/context`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query: "OTC hearing aid allowance per ear", max_results: 3 }),
  });
  console.log("probe:", JSON.stringify(await probe.json(), null, 2).slice(0, 1500));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
