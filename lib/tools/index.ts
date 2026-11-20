import type Anthropic from "@anthropic-ai/sdk";
import products from "@/data/products.json";
import type { Source } from "../audit";
import { verifyCaregiver } from "../identity";
import { searchEmail } from "../inbox";
import { searchTrustedContext } from "./senso";

export type Product = (typeof products)[number];

export type RunState = {
  seenSourceIds: Set<string>;
  fdaChecked: Map<string, string>;
  orders: Record<string, unknown>[];
  personaInquiryId?: string;
  gmailConnected?: boolean;
  approved?: { sku: string; approvedBy: string };
};

export const newRunState = (
  opts: { personaInquiryId?: string; gmailConnected?: boolean; approved?: { sku: string; approvedBy: string } } = {},
): RunState => ({
  seenSourceIds: new Set(),
  fdaChecked: new Map(),
  orders: [],
  ...opts,
});

type ToolResult = { output: unknown; sources: Source[]; ok: boolean };

const day = (d: Date, add: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + add);
  return x.toISOString().slice(0, 10);
};
const money = (n: number) => Math.round(n * 100) / 100;
const findProduct = (sku: string) => products.find((p) => p.sku === sku);
const catalogSource = (p: Product): Source => ({
  content_id: `catalog:${p.sku}`,
  title: `${p.name} (${p.retailer} listing)`,
  chunk_text: `${p.style}; rechargeable: ${p.rechargeable}; $${p.price_pair_usd}/pair; ${p.return_window_days}-day returns. ${p.fda_note}`,
  provider: "catalog",
});

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "search_trusted_context",
    description:
      "Search the trusted context layer (Senso) holding Ruth's insurance plan documents, Medicare rules, FDA hearing-aid rules, retailer return policies, and Ruth's care profile. Returns chunks with content_id for citation. Call this before stating any coverage, cost, policy, or preference fact.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Natural-language question." } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "search_email",
    description:
      "Search the user's connected email (Gmail) for order confirmations, delivery notices, receipts, and medical or insurance messages. Use it to find when something was delivered so you can work out the return deadline.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "search_products",
    description: "Search the hearing-aid catalog (real models and list prices). Filter by comfort constraints.",
    input_schema: {
      type: "object",
      properties: {
        exclude_behind_the_ear: { type: "boolean" },
        rechargeable_only: { type: "boolean" },
        max_price_pair_usd: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "check_fda_status",
    description: "Check a product's FDA category (OTC hearing aid, prescription, PSAP, or unverified). Required before place_order.",
    input_schema: {
      type: "object",
      properties: { sku: { type: "string" } },
      required: ["sku"],
      additionalProperties: false,
    },
  },
  {
    name: "calculate_cost",
    description:
      "Compute out-of-pocket cost for a product under a coverage route. Benefit amounts must come from retrieved context; pass the content_ids you relied on.",
    input_schema: {
      type: "object",
      properties: {
        sku: { type: "string" },
        route: { type: "string", enum: ["otc_allowance", "prescription_benefit", "out_of_pocket"] },
        benefit_per_ear_usd: {
          type: "number",
          description: "otc_allowance: max reimbursement per ear. prescription_benefit: member copay per ear. out_of_pocket: 0.",
        },
        ears: { type: "integer", minimum: 1, maximum: 2 },
        source_content_ids: { type: "array", items: { type: "string" } },
      },
      required: ["sku", "route", "benefit_per_ear_usd", "ears", "source_content_ids"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_purchase",
    description:
      "Show the user 2 or 3 options to choose from (1 only if nothing else qualifies), each with a plain reason, its trade-off, and the cost math. Mark one as recommended. The user picks one and taps Buy, or asks their caregiver to choose. Call after check_fda_status (on every option) and calculate_cost, then stop and wait; never place an order without approval.",
    input_schema: {
      type: "object",
      properties: {
        options: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              sku: { type: "string" },
              label: { type: "string", description: "2-4 words, e.g. 'Best fit for you', 'Lowest cost', 'Most invisible'." },
              reason: { type: "string", description: "One plain sentence: why it suits her." },
              tradeoff: { type: "string", description: "One plain sentence: the main downside." },
              route: { type: "string", enum: ["otc_allowance", "prescription_benefit", "out_of_pocket"] },
              family_pays_usd: { type: "number" },
              plan_pays_usd: { type: "number" },
            },
            required: ["sku", "label", "reason", "tradeoff", "route", "family_pays_usd", "plan_pays_usd"],
            additionalProperties: false,
          },
        },
        recommended_sku: { type: "string" },
      },
      required: ["options", "recommended_sku"],
      additionalProperties: false,
    },
  },
  {
    name: "place_order",
    description:
      "Place the order with the DEMO merchant (simulated checkout; no real money moves). Only for a product the user (or their caregiver) has approved, and only after check_fda_status in this session. Returns order id, delivery date, return-by date and reimbursement claim deadline.",
    input_schema: {
      type: "object",
      properties: {
        sku: { type: "string" },
        payment_method: { type: "string", enum: ["hsa_card", "card_on_file"] },
        ship_to: { type: "string" },
        buyer_name: { type: "string" },
      },
      required: ["sku", "payment_method", "ship_to", "buyer_name"],
      additionalProperties: false,
    },
  },
  {
    name: "start_return",
    description:
      "Start a return for something the user bought (DEMO: simulated with the retailer). Use the delivery date from email and the return window from trusted context. Returns a return number, drop-off instructions and the refund estimate.",
    input_schema: {
      type: "object",
      properties: {
        item: { type: "string" },
        retailer: { type: "string" },
        order_ref: { type: "string" },
        delivered_on: { type: "string", description: "YYYY-MM-DD" },
        return_window_days: { type: "integer" },
        refund_usd: { type: "number" },
        reason: { type: "string" },
      },
      required: ["item", "retailer", "order_ref", "delivered_on", "return_window_days", "refund_usd", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "prepare_reimbursement_claim",
    description:
      "Fill in the insurance OTC hearing-aid reimbursement claim from the order receipt (DEMO: prepared, not submitted). Use plan rules from trusted context for the amount and deadline.",
    input_schema: {
      type: "object",
      properties: {
        order_id: { type: "string" },
        plan: { type: "string" },
        claim_amount_usd: { type: "number" },
        submit_by: { type: "string", description: "YYYY-MM-DD" },
        source_content_ids: { type: "array", items: { type: "string" } },
      },
      required: ["order_id", "plan", "claim_amount_usd", "submit_by", "source_content_ids"],
      additionalProperties: false,
    },
  },
  {
    name: "schedule_reminder",
    description: "Put a reminder on the family calendar (check-ins, return deadline, reimbursement claim).",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        title: { type: "string" },
        details: { type: "string" },
      },
      required: ["date", "title", "details"],
      additionalProperties: false,
    },
  },
  {
    name: "brief_caregiver",
    description:
      "Post an update to the family chat for the caregiver: what was bought and why, the cost math with plan share, deadlines, and what to watch for. Call once after a purchase or important finding, only if a caregiver is in the family chat.",
    input_schema: {
      type: "object",
      properties: {
        headline: { type: "string" },
        message_markdown: { type: "string" },
      },
      required: ["headline", "message_markdown"],
      additionalProperties: false,
    },
  },
];

export async function runTool(name: string, input: Record<string, any>, state: RunState): Promise<ToolResult> {
  switch (name) {
    case "search_trusted_context": {
      const sources = await searchTrustedContext(String(input.query));
      sources.forEach((s) => state.seenSourceIds.add(s.content_id));
      return {
        ok: true,
        sources,
        output: sources.map(({ content_id, title, chunk_text }) => ({ content_id, title, chunk_text })),
      };
    }

    case "search_email": {
      if (!state.gmailConnected) return { ok: false, sources: [], output: { error: "Gmail is not connected." } };
      const emails = searchEmail(String(input.query));
      const sources: Source[] = emails.map((e) => ({
        content_id: `email:${e.id}`,
        title: `${e.from}: ${e.subject}`,
        chunk_text: `${e.date} — ${e.body}`,
        provider: "email",
      }));
      sources.forEach((s) => state.seenSourceIds.add(s.content_id));
      return { ok: true, sources, output: emails };
    }

    case "search_products": {
      const hits = products.filter(
        (p) =>
          (!input.exclude_behind_the_ear || !p.behind_the_ear) &&
          (!input.rechargeable_only || p.rechargeable) &&
          (input.max_price_pair_usd == null || p.price_pair_usd <= input.max_price_pair_usd),
      );
      const sources = hits.map(catalogSource);
      sources.forEach((s) => state.seenSourceIds.add(s.content_id));
      return { ok: true, sources, output: hits };
    }

    case "check_fda_status": {
      const p = findProduct(input.sku);
      if (!p) return { ok: false, sources: [], output: { error: `Unknown sku ${input.sku}` } };
      const verdict =
        p.fda_category === "otc_hearing_aid" || p.fda_category === "prescription_hearing_aid"
          ? "ok"
          : p.fda_category === "registered_unverified"
            ? "caution"
            : "block";
      state.fdaChecked.set(p.sku, verdict);
      return {
        ok: true,
        sources: [catalogSource(p)],
        output: {
          sku: p.sku,
          fda_category: p.fda_category,
          verdict,
          eligible_for_otc_allowance: p.fda_category === "otc_hearing_aid",
          note: p.fda_note,
          method: "Checked against FDA OTC rule categories from the product listing, not a live FDA database lookup.",
        },
      };
    }

    case "calculate_cost": {
      const p = findProduct(input.sku);
      if (!p) return { ok: false, sources: [], output: { error: `Unknown sku ${input.sku}` } };
      const cited: string[] = input.source_content_ids ?? [];
      const unknown = cited.filter((id) => !state.seenSourceIds.has(id));
      if (input.route !== "out_of_pocket" && (cited.length === 0 || unknown.length)) {
        return {
          ok: false,
          sources: [],
          output: { error: "Benefit amounts must cite content_ids retrieved in this session.", unknown_ids: unknown },
        };
      }
      const ears = input.ears ?? 2;
      const perEar = Number(input.benefit_per_ear_usd) || 0;
      const list = p.price_pair_usd * (ears / 2);
      let planPays = 0;
      let familyPays = list;
      if (input.route === "otc_allowance") {
        planPays = Math.min(perEar * ears, list);
        familyPays = list - planPays;
      } else if (input.route === "prescription_benefit") {
        familyPays = perEar * ears;
        planPays = Math.max(list - familyPays, 0);
      }
      const rx = input.route === "prescription_benefit";
      return {
        ok: true,
        sources: rx ? [] : [catalogSource(p)],
        output: {
          sku: rx ? null : p.sku,
          name: rx ? "Plan prescription hearing aids (NationsHearing network, fitted)" : p.name,
          route: input.route,
          list_price_usd: rx ? null : money(list),
          plan_pays_usd: rx ? null : money(planPays),
          family_pays_usd: money(familyPays),
          ears,
          cited_content_ids: cited,
          ...(rx && { note: "Copay tier for a network prescription aid; not the searched product." }),
        },
      };
    }

    case "propose_purchase": {
      const opts = (input.options ?? []) as Record<string, any>[];
      const bad = opts.filter((o) => !findProduct(o.sku) || state.fdaChecked.get(o.sku) !== "ok").map((o) => o.sku);
      if (!opts.length || bad.length)
        return { ok: false, sources: [], output: { error: "Run check_fda_status on every option first; only FDA hearing aids can be proposed.", not_ok: bad } };
      const options = opts.map((o) => {
        const p = findProduct(o.sku)!;
        return {
          sku: p.sku,
          name: p.name,
          style: p.style,
          rechargeable: p.rechargeable,
          retailer: p.retailer,
          product_url: p.url,
          price_pair_usd: p.price_pair_usd,
          return_window_days: p.return_window_days,
          label: o.label,
          reason: o.reason,
          tradeoff: o.tradeoff,
          route: o.route,
          family_pays_usd: money(o.family_pays_usd),
          plan_pays_usd: money(o.plan_pays_usd),
        };
      });
      const recommended = options.some((o) => o.sku === input.recommended_sku) ? input.recommended_sku : options[0].sku;
      return {
        ok: true,
        sources: options.map((o) => catalogSource(findProduct(o.sku)!)),
        output: { options, recommended_sku: recommended, awaiting: "choice and approval" },
      };
    }

    case "start_return": {
      const deadline = day(new Date(input.delivered_on + "T12:00:00"), input.return_window_days);
      if (new Date(deadline + "T23:59:59") < new Date())
        return { ok: false, sources: [], output: { error: `Return window closed on ${deadline}.` } };
      return {
        ok: true,
        sources: [],
        output: {
          return_id: `RET-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          status: "Return started (demo, simulated with the retailer)",
          item: input.item,
          retailer: input.retailer,
          order_ref: input.order_ref,
          return_by: deadline,
          refund_usd: money(input.refund_usd),
          drop_off: "Any UPS Store. Bring the item in its box; the QR code is in this message. No printing needed.",
          refund_timing: "3 to 5 business days after drop-off",
        },
      };
    }

    case "prepare_reimbursement_claim": {
      const order = state.orders.find((o) => o.order_id === input.order_id) as Record<string, any> | undefined;
      const cited: string[] = input.source_content_ids ?? [];
      if (!cited.length || cited.some((id) => !state.seenSourceIds.has(id)))
        return { ok: false, sources: [], output: { error: "Cite plan rules retrieved in this session." } };
      return {
        ok: true,
        sources: [],
        output: {
          claim_id: `CLM-DRAFT-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
          status: "Ready to submit (demo, not sent to the insurer)",
          plan: input.plan,
          form: "OTC Hearing Aid Reimbursement Form",
          member: "Ruth Sharma",
          item: order?.name ?? "Hearing aids",
          purchase_date: order?.ordered_on ?? null,
          amount_paid_usd: order?.total_usd ?? null,
          claim_amount_usd: money(input.claim_amount_usd),
          attachments: ["Itemized receipt (from the order email)", "FDA OTC category on receipt"],
          submit_by: input.submit_by,
          cited_content_ids: cited,
        },
      };
    }

    case "place_order": {
      const p = findProduct(input.sku);
      if (!p) return { ok: false, sources: [], output: { error: `Unknown sku ${input.sku}` } };
      if (state.approved?.sku !== p.sku)
        return { ok: false, sources: [], output: { error: "Refused: this purchase has not been approved. Call propose_purchase and wait for approval." } };
      const verdict = state.fdaChecked.get(p.sku);
      if (!verdict) return { ok: false, sources: [], output: { error: "Refused: run check_fda_status on this sku first." } };
      if (verdict === "block")
        return { ok: false, sources: [], output: { error: "Refused: product is not an FDA hearing aid (PSAP)." } };
      const caregiver = await verifyCaregiver(input.buyer_name, state.personaInquiryId);
      if (!caregiver.verified)
        return { ok: false, sources: [], output: { error: "Refused: the buyer has not verified their identity with Persona.", caregiver } };
      const today = new Date();
      const delivery = day(today, 3);
      const order = {
        order_id: `DEMO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        merchant: "Kin Demo Merchant (simulated checkout, no real purchase)",
        sku: p.sku,
        name: p.name,
        real_retailer: p.retailer,
        product_url: p.url,
        total_usd: p.price_pair_usd,
        payment_method: input.payment_method,
        ship_to: input.ship_to,
        ordered_on: day(today, 0),
        estimated_delivery: delivery,
        return_window_days: p.return_window_days,
        return_by: day(new Date(delivery), p.return_window_days),
        otc_reimbursement_claim_by: day(today, 90),
        buyer_verification: caregiver,
        approved_by: state.approved.approvedBy,
      };
      state.orders.push(order);
      return { ok: true, sources: [catalogSource(p)], output: order };
    }

    case "schedule_reminder":
      return {
        ok: true,
        sources: [],
        output: { scheduled: true, calendar: "Family calendar (demo)", ...input },
      };

    case "brief_caregiver":
      return { ok: true, sources: [], output: { delivered_to: "Priya (in-app message)", ...input } };

    default:
      return { ok: false, sources: [], output: { error: `Unknown tool ${name}` } };
  }
}
