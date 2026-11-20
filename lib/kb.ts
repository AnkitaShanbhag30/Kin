import fs from "node:fs";
import path from "node:path";

export type KbDoc = { file: string; title: string; text: string };

const KB_DIR = path.join(process.cwd(), "data", "kb");

export function loadKb(): KbDoc[] {
  return fs
    .readdirSync(KB_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => {
      const text = fs.readFileSync(path.join(KB_DIR, file), "utf8");
      const title = text.match(/^#\s+(.+)$/m)?.[1] ?? file;
      return { file, title, text };
    });
}
