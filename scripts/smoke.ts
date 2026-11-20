// Runs the demo headless in two turns (propose, then approve) and checks the audit trail. Usage: npm run smoke
import { runAgent } from "../lib/agent";
import { createRunTracker } from "../lib/analytics";
import type { AuditEvent } from "../lib/audit";
import { DEMO_CAREGIVER, DEMO_PROMPT, DEMO_USER } from "../lib/demo";

type End = Extract<AuditEvent, { kind: "tool_end" }>;
const base = { user: DEMO_USER, caregiver: { name: DEMO_CAREGIVER.name, relation: DEMO_CAREGIVER.relation }, gmailConnected: true };

async function turn(prompt: string, opts: Parameters<typeof runAgent>[2]) {
  const events: AuditEvent[] = [];
  const tracker = createRunTracker();
  await runAgent(prompt, (e) => {
    events.push(e);
    tracker.track(e);
    if (e.kind === "tool_end") console.log(`#${e.step} ${e.ok ? "ok " : "ERR"} ${e.tool} (${e.ms}ms) sources=${e.sources.length}`);
    else if (e.kind === "error") console.log(`!! ${e.message}`);
  }, opts);
  await tracker.flush();
  const ends = events.filter((e): e is End => e.kind === "tool_end");
  const final = events.find((e) => e.kind === "final");
  return { events, ends, final: final?.kind === "final" ? final.text : "" };
}

async function main() {
  console.log("— turn 1: propose");
  const t1 = await turn(DEMO_PROMPT, base);
  const proposed = t1.ends.find((e) => e.tool === "propose_purchase" && e.ok)?.output as
    | { options: { sku: string; name: string }[]; recommended_sku: string }
    | undefined;
  const proposal = proposed?.options.find((o) => o.sku === proposed.recommended_sku);
  console.log("options:", proposed?.options.map((o) => o.sku).join(", "));
  console.log("— turn 2: approve", proposal?.sku);
  const t2 = proposal
    ? await turn(`Yes, please buy the ${proposal.name}.`, {
        ...base,
        history: [{ role: "user", text: DEMO_PROMPT }, { role: "assistant", text: t1.final }],
        approvedPurchase: { sku: proposal.sku, approvedBy: DEMO_USER.firstName },
      })
    : { ends: [] as End[], events: [] as AuditEvent[], final: "" };

  const cited = new Set(t1.ends.flatMap((e) => e.sources).filter((s) => s.provider === "senso" || s.provider === "local-fallback").map((s) => s.content_id));
  const checks = {
    proposed_choices: (proposed?.options.length ?? 0) >= 2,
    proposed_without_buying: Boolean(proposal) && !t1.ends.some((e) => e.tool === "place_order" && e.ok),
    context_sources_ge_3: cited.size >= 3,
    order_placed_after_approval: t2.ends.some((e) => e.tool === "place_order" && e.ok),
    briefed_family: t2.ends.some((e) => e.tool === "brief_caregiver"),
    no_errors: ![...t1.events, ...t2.events].some((e) => e.kind === "error"),
  };
  console.log("\nchecks:", checks);
  process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
}

main();
