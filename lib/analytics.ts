import type { AuditEvent } from "./audit";

// Amplitude: every agent step becomes a product-analytics event (HTTP V2 API, batched per run).
const AMPLITUDE_URL = "https://api2.amplitude.com/2/httpapi";
const USER_ID = "caregiver-priya-demo";

export const analyticsProvider = () => (process.env.AMPLITUDE_API_KEY ? "amplitude" : "off");

type AmpEvent = { user_id: string; event_type: string; time: number; session_id: number; event_properties: Record<string, unknown> };

export function createRunTracker() {
  const sessionId = Date.now();
  const events: AmpEvent[] = [];
  const add = (event_type: string, event_properties: Record<string, unknown>) =>
    events.push({ user_id: USER_ID, event_type, time: Date.now(), session_id: sessionId, event_properties });

  return {
    track(e: AuditEvent) {
      if (e.kind === "start") add("kin_run_started", { model: e.model });
      else if (e.kind === "tool_end") {
        add("kin_tool_called", {
          tool: e.tool,
          step: e.step,
          ok: e.ok,
          ms: e.ms,
          source_count: e.sources.length,
          source_providers: [...new Set(e.sources.map((s) => s.provider))],
        });
        if (e.tool === "place_order" && e.ok) {
          const o = e.output as { sku: string; total_usd: number; payment_method: string };
          add("kin_order_placed", { sku: o.sku, total_usd: o.total_usd, payment_method: o.payment_method });
        }
      } else if (e.kind === "error") add("kin_run_error", { message: e.message.slice(0, 200) });
      else if (e.kind === "done") add("kin_run_completed", { steps: e.steps, ms: e.ms });
    },
    async flush() {
      const key = process.env.AMPLITUDE_API_KEY;
      if (!key || events.length === 0) return;
      try {
        const res = await fetch(AMPLITUDE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: key, events }),
        });
        if (!res.ok) console.error("Amplitude upload failed", res.status, await res.text());
      } catch (err) {
        console.error("Amplitude upload failed", err);
      }
    },
  };
}
