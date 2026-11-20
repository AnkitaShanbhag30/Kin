// Runs the demo prompt headless and checks the audit trail. Usage: npm run smoke
import { runAgent } from "../lib/agent";
import { createRunTracker } from "../lib/analytics";
import type { AuditEvent } from "../lib/audit";
import { DEMO_PROMPT } from "../lib/demo";

async function main() {
  const events: AuditEvent[] = [];
  const tracker = createRunTracker();
  await runAgent(DEMO_PROMPT, (e) => {
    events.push(e);
    tracker.track(e);
    if (e.kind === "tool_end") console.log(`#${e.step} ${e.ok ? "ok " : "ERR"} ${e.tool} (${e.ms}ms) sources=${e.sources.length}`);
    else if (e.kind === "note") console.log(`   · ${e.text.slice(0, 140)}`);
    else if (e.kind === "error") console.log(`!! ${e.message}`);
  });

  await tracker.flush();
  const ends = events.filter((e): e is Extract<AuditEvent, { kind: "tool_end" }> => e.kind === "tool_end");
  const order = ends.find((e) => e.tool === "place_order" && e.ok);
  const fdaIdx = ends.findIndex((e) => e.tool === "check_fda_status");
  const orderIdx = ends.findIndex((e) => e.tool === "place_order" && e.ok);
  const cited = new Set(
    ends.flatMap((e) => e.sources).filter((s) => s.provider !== "catalog").map((s) => s.content_id),
  );
  const checks = {
    order_placed: Boolean(order),
    fda_before_order: fdaIdx >= 0 && fdaIdx < orderIdx,
    context_sources_ge_3: cited.size >= 3,
    briefed: ends.some((e) => e.tool === "brief_caregiver"),
    no_errors: !events.some((e) => e.kind === "error"),
  };
  console.log("\norder:", order ? (order.output as { order_id: string }).order_id : "none");
  console.log("checks:", checks);
  process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
}

main();
