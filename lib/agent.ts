import Anthropic from "@anthropic-ai/sdk";
import { type Emit, newId, now, TOOL_LABELS } from "./audit";
import { newRunState, runTool, TOOLS } from "./tools";
import { analyticsProvider } from "./analytics";
import { identityProvider } from "./identity";
import { contextProvider } from "./tools/senso";

export const MODEL = process.env.KIN_MODEL ?? "claude-opus-5-5";
const MAX_TURNS = 14;

type RunOpts = {
  personaInquiryId?: string;
  gmailConnected?: boolean;
  history?: { role: "user" | "assistant"; text: string }[];
  user?: { name: string; address: string; plan: string };
  caregiver?: { name: string; relation: string } | null;
  approvedPurchase?: { sku: string; approvedBy: string };
  attachments?: { name: string; media_type: string; data: string }[];
};

function systemPrompt(o: RunOpts) {
  const user = o.user ?? { name: "Ruth Sharma", address: "412 Alder St, Palo Alto CA", plan: "Aetna Medicare Premier (HMO)" };
  return `You are Kin, a personal shopping agent for an older adult, ${user.name}, who is 78. You are talking with ${user.name.split(" ")[0]} directly.
Her shipping address is ${user.address}. Her insurance is ${user.plan}.
${o.caregiver ? `Her caregiver ${o.caregiver.name} (her ${o.caregiver.relation}) is in the family chat.` : "No caregiver has joined the family chat yet; do not call brief_caregiver."}
Gmail is ${o.gmailConnected ? "connected: use search_email for deliveries, receipts and medical messages" : "not connected"}.

${o.approvedPurchase
  ? `APPROVED: ${o.approvedPurchase.approvedBy} approved buying sku "${o.approvedPurchase.sku}". Now: run check_fda_status on it, place_order, schedule the reminders, prepare_reimbursement_claim if the OTC allowance applies (retrieve the plan rule to cite)${o.caregiver ? ", then brief_caregiver" : ""}.`
  : `When she asks for help buying something: understand her coverage and preferences, pick 2 or 3 good options she would actually wear (for example best fit, lowest cost, a different style), FDA-check each, work out the real out-of-pocket cost for each, then call propose_purchase with your recommendation marked and stop. She (or her caregiver) chooses and approves in the app; you never buy without that approval.`}
When she asks about a prescription refill or an appointment: find it in her email, then request_refill or request_appointment, schedule_reminder for her (a day or two before the date)${o.caregiver ? ", and brief_caregiver so her family knows the date" : ""}. Never suggest changing a medicine or dose.
When she wants to return something: find the delivery in her email, check the return window in trusted context, and call start_return.
If she shares a photo or document (an audiogram, a receipt, a letter), read it and use it.

How you work:
- Ground every coverage, cost, policy, FDA, and preference claim in search_trusted_context (or search_email) results. Never rely on memory for plan terms. If context is missing, say so.
- Confirm the chosen product's listing details (style, price, return window) in trusted context too.
- Respect her comfort constraints from her profile; they matter more than features.
- Compare coverage routes (OTC allowance vs prescription benefit vs paying out of pocket) with calculate_cost before choosing.
- Run check_fda_status before place_order. Do not buy PSAPs or unverified devices.
- Checkout is a simulated demo store; say so plainly. If checkout is refused because her identity is not verified, stop and say so.
- After an approved order, schedule reminders for: a comfort check-in about 10 days after delivery, a keep-or-return decision about 5 days before the return deadline, and the OTC reimbursement claim deadline if applicable.
- When asked about returns, find the delivery date in her email and the return window in trusted context, then give the exact return-by date.

How you talk to her (this matters):
- Short, warm, plain words. Large ideas, small sentences. No jargon, no tables, no markdown headings.
- At most 5 short sentences, then one clear next step. Put the most important number or date first.
- When you propose options, say in one sentence which one you recommend and why; the option cards show the rest. Do not repeat every price in text.
${o.caregiver ? "- Put the fuller explanation, with citations like [content_id], in brief_caregiver." : ""}

Today's date is ${new Date().toISOString().slice(0, 10)}.`;
}

export async function runAgent(prompt: string, emit: Emit, opts: RunOpts = {}) {
  const client = new Anthropic();
  const state = newRunState({
    personaInquiryId: opts.personaInquiryId,
    gmailConnected: opts.gmailConnected,
    approved: opts.approvedPurchase,
  });
  const started = Date.now();
  let step = 0;

  emit({ kind: "start", id: newId(), ts: now(), prompt, model: MODEL,
    integrations: { context: contextProvider(), identity: identityProvider(), analytics: analyticsProvider() },
  });

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...(opts.history ?? []).filter((m) => m.text.trim()).map((m) => ({ role: m.role, content: m.text })),
    {
      role: "user",
      content: [
        ...(opts.attachments ?? []).map((f): Anthropic.Beta.BetaContentBlockParam =>
          f.media_type === "application/pdf"
            ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data }, title: f.name }
            : { type: "image", source: { type: "base64", media_type: f.media_type as "image/jpeg", data: f.data } },
        ),
        { type: "text", text: prompt },
      ],
    },
  ];
  const system = systemPrompt(opts);

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01", "thinking-display-updates-2026-08-18"],
        fallbacks: "default",
        thinking: { type: "adaptive", display: "updates" },
        output_config: { effort: "medium" },
        system,
        tools: TOOLS,
        messages,
      });

      // Append-only history: keep thinking blocks exactly as returned.
      messages.push({ role: "assistant", content: response.content });

      for (const block of response.content) {
        if (block.type === "thinking" && block.thinking.trim()) {
          emit({ kind: "note", id: newId(), ts: now(), text: block.thinking.trim() });
        } else if (block.type === "text" && block.text.trim() && response.stop_reason === "tool_use") {
          emit({ kind: "note", id: newId(), ts: now(), text: block.text.trim() });
        }
      }

      if (response.stop_reason === "refusal") {
        emit({ kind: "error", id: newId(), ts: now(), message: "The model declined this request." });
        break;
      }
      if (response.stop_reason === "max_tokens") {
        emit({ kind: "error", id: newId(), ts: now(), message: "Response hit max_tokens." });
        break;
      }
      if (response.stop_reason !== "tool_use") {
        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        if (text) emit({ kind: "final", id: newId(), ts: now(), text });
        break;
      }

      // Run tools sequentially so guardrails (FDA check before order) see prior results.
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        step++;
        const id = block.id;
        const label = TOOL_LABELS[block.name] ?? block.name;
        emit({ kind: "tool_start", id, ts: now(), step, tool: block.name, label, input: block.input });
        const t0 = Date.now();
        let r;
        try {
          r = await runTool(block.name, block.input as Record<string, any>, state);
        } catch (err) {
          r = { ok: false, sources: [], output: { error: String(err instanceof Error ? err.message : err) } };
        }
        emit({
          kind: "tool_end",
          id,
          ts: now(),
          step,
          tool: block.name,
          label,
          input: block.input,
          output: r.output,
          sources: r.sources,
          ok: r.ok,
          ms: Date.now() - t0,
        });
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(r.output),
          is_error: !r.ok,
        });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    const message =
      err instanceof Anthropic.APIError ? `Claude API error ${err.status}: ${err.message}` : String(err);
    emit({ kind: "error", id: newId(), ts: now(), message });
  }

  emit({ kind: "done", id: newId(), ts: now(), steps: step, ms: Date.now() - started });
  return state;
}
