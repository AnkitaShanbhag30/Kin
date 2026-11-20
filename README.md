# Kin

**A shopping agent for family caregivers that knows the insurance, makes the purchase, and shows its work.**

Built at the Personal Agents Hackathon (tokens&, SF, Nov 20 2026) for the challenge *"Build a shopping agent with an audit trail."*

## The problem

An adult child is helping a parent buy hearing aids. It's a high-stakes purchase: untreated hearing loss is linked to faster cognitive decline. It's also a mess:

- **Insurance is opaque.** Original Medicare doesn't cover hearing aids. Medicare Advantage plans might, through a network copay *or* an OTC reimbursement allowance, and you usually can't use both. It takes roughly 25 minutes just to work out what a plan covers.
- **Fit is personal.** No single hearing aid works for everyone. The caregiver often doesn't know what the parent will reject (behind-the-ear designs that clash with glasses, tiny batteries for arthritic hands).
- **It's a buy–try–return loop** with 30–180 day windows, and reimbursement deadlines on top.
- **The market has traps.** $40 "hearing amplifiers" (PSAPs) and products that are only "FDA registered" sit next to real FDA-authorized OTC hearing aids.

## What Kin does (one task, end to end)

Priya types one sentence: *"Mom's audiologist said she needs hearing aids. Her plan is Aetna Medicare Advantage. Find something she won't hate, figure out what it actually costs us, and buy it."*

Kin then:

1. **Pulls trusted context** from the Senso context layer: Ruth's plan benefits, Medicare rules, the FDA OTC rule, retailer return policies, and Ruth's care profile.
2. **Filters products** by Ruth's real constraints: nothing behind the ear, rechargeable.
3. **Compares coverage routes** (OTC allowance vs prescription copay vs out of pocket) with deterministic cost math that **must cite** the plan text it relied on.
4. **Checks FDA status** and refuses PSAPs. Flags devices that are only "registered".
5. **Places the order** with a clearly labeled demo merchant and gets back an order ID, delivery date, and return-by date.
6. **Schedules reminders** on the family calendar: a day-10 comfort check-in, a keep-or-return decision before the deadline, and the reimbursement claim deadline. Each one downloads as an `.ics` file.
7. **Briefs the caregiver** in plain English, with each claim linked to its source.

The right-hand **Audit trail** shows every step live: the agent's progress notes, each tool call with raw input and output, and source chips that open the exact context chunk behind a decision. **Export JSON** saves the whole trail.

## Guardrails enforced in code (not just the prompt)

- `place_order` is refused unless `check_fda_status` ran on that SKU, and always refused for PSAPs.
- `calculate_cost` rejects benefit amounts unless they cite `content_id`s the agent actually retrieved during this run.
- Checkout is simulated (`DEMO-xxxxxx` order IDs). No real money moves, and the UI says so on screen.

## Honesty notes

- **Product data** covers real models, retailers, and approximate list prices. Verify them before real use; each entry has a `needs_verification` flag.
- **Plan document** (`data/kb/aetna-ma-hearing-benefit.md`) is a *demo* document modeled on typical Medicare Advantage hearing benefits. Its dollar figures are illustrative, not Aetna's published terms.
- **FDA check** works against FDA OTC-rule categories recorded in the catalog. It is not a live FDA database lookup.
- **Privacy:** the agent sees a plan name, a hearing-loss category, and comfort preferences Ruth agreed to share. It sees no medical records.

## Sponsor tools

| Sponsor | Role in Kin | Where |
|---|---|---|
| **Senso** (context layer) | The single source of trusted context: plan benefits, Medicare rules, FDA OTC rule, retailer return policies, merchant shipping, Ruth's care profile, **and every product listing**. Retrieved with `POST /org/search/context`; each claim cites a chunk (`content_chunk_id`) the caregiver can open in the trail. | `lib/tools/senso.ts`, `scripts/seed-senso.ts` |
| **Persona** (identity) | Before the agent spends money, `place_order` re-checks that the human caregiver behind the agent completed a Persona verification inquiry. Unverified → order refused. | `lib/identity.ts` |
| **Amplitude** (analytics) | Every run streams product-analytics events: `kin_run_started`, `kin_tool_called` (tool, ok, latency, source count and provider), `kin_order_placed`, `kin_run_completed`, `kin_run_error`. That gives a funnel of where caregiver tasks succeed or stall. | `lib/analytics.ts` |

Each integration degrades gracefully when its key is missing, and the header pills show what's live (`context: Senso | local fallback`, `identity: Persona | stub`, `analytics: Amplitude | off`).

## Stack

- **Claude** (`claude-opus-5-5`, Anthropic TypeScript SDK): manual tool-use loop with adaptive thinking and progress updates (`display: "updates"`), which become the "thoughts" in the audit trail. Server-side refusal fallback is enabled.
- **Next.js 15 + Tailwind**, deployable to Vercel. The agent streams NDJSON audit events to the UI.
- Seam for later: `lib/memory.ts` (Cognee: remember Ruth's trial reactions across sessions).

## Run it

```bash
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY, SENSO_API_KEY, PERSONA_*, AMPLITUDE_API_KEY
npm run seed                 # push data/kb + product listings into Senso (once)
npm run dev                  # http://localhost:3000
npm run smoke                # headless run of the demo prompt + checks
```

Without `SENSO_API_KEY`, retrieval falls back to a local keyword search over `data/kb`. The header pill shows **context: local fallback** so nobody mistakes it for Senso.

## Beyond hearing aids

Hearing aids are the wedge. The same loop (trusted coverage context → constrained product choice → guarded purchase → deadlines → caregiver brief) applies to every non-prescription health purchase that falls between the doctor and the pharmacy: walkers, canes, CPAP supplies, orthotic insoles.

## Team

_Names and contact emails go here._
