export type Source = {
  content_id: string;
  title: string;
  chunk_text: string;
  score?: number;
  provider: "senso" | "local-fallback" | "catalog" | "email";
};

export type AuditEvent =
  | {
      kind: "start";
      id: string;
      ts: string;
      prompt: string;
      model: string;
      integrations: { context: string; identity: string; analytics: string };
    }
  | { kind: "note"; id: string; ts: string; text: string }
  | { kind: "tool_start"; id: string; ts: string; step: number; tool: string; label: string; input: unknown }
  | {
      kind: "tool_end";
      id: string;
      ts: string;
      step: number;
      tool: string;
      label: string;
      input: unknown;
      output: unknown;
      sources: Source[];
      ok: boolean;
      ms: number;
    }
  | { kind: "final"; id: string; ts: string; text: string }
  | { kind: "error"; id: string; ts: string; message: string }
  | { kind: "done"; id: string; ts: string; steps: number; ms: number };

export type Emit = (e: AuditEvent) => void;

export const now = () => new Date().toISOString();
export const newId = () => Math.random().toString(36).slice(2, 10);

// Plain-English labels shown in the audit trail.
export const TOOL_LABELS: Record<string, string> = {
  search_trusted_context: "Checked your plan and the rules",
  search_email: "Checked your email",
  search_products: "Looked for hearing aids that suit you",
  check_fda_status: "Made sure it's a real FDA hearing aid",
  calculate_cost: "Worked out what you'll pay",
  place_order: "Confirmed it's you and placed the order (demo store)",
  schedule_reminder: "Added a reminder",
  brief_caregiver: "Updated your family",
};
