import fs from "node:fs";
import path from "node:path";
import products from "@/data/products.json";

export type KbDoc = { file: string; title: string; text: string };

const KB_DIR = path.join(process.cwd(), "data", "kb");

// Product listings are pushed into the context layer too, so shopping decisions cite trusted context.
function productDocs(): KbDoc[] {
  return products.map((p) => ({
    file: `product-${p.sku}.md`,
    title: `${p.name} — ${p.retailer} listing`,
    text: [
      `# ${p.name} — ${p.retailer} listing`,
      "",
      `- Brand: ${p.brand}. Style: ${p.style}. Sits behind the ear: ${p.behind_the_ear ? "yes" : "no"}.`,
      `- Power: ${p.rechargeable ? "rechargeable" : "disposable batteries"}. Self-fitting app: ${p.self_fitting_app ? "yes" : "no"}.`,
      `- Price: $${p.price_pair_usd} per pair at ${p.retailer}. Return window: ${p.return_window_days} days.`,
      `- FDA status: ${p.fda_note}`,
      `- Listing: ${p.url}`,
    ].join("\n"),
  }));
}

export function loadKb(): KbDoc[] {
  const files = fs
    .readdirSync(KB_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => {
      const text = fs.readFileSync(path.join(KB_DIR, file), "utf8");
      const title = text.match(/^#\s+(.+)$/m)?.[1] ?? file;
      return { file, title, text };
    });
  return [...files, ...productDocs()];
}
