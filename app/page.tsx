"use client";

import { useMemo, useRef, useState } from "react";
import type { AuditEvent, Source } from "@/lib/audit";
import { DEMO_PROMPT } from "@/lib/demo";

type ToolEnd = Extract<AuditEvent, { kind: "tool_end" }>;
type ToolStart = Extract<AuditEvent, { kind: "tool_start" }>;
type Order = {
  order_id: string; merchant: string; name: string; real_retailer: string; product_url: string; total_usd: number;
  payment_method: string; estimated_delivery: string; caregiver_verification: { verified: boolean; provider: string; status?: string }; return_by: string; otc_reimbursement_claim_by: string; return_window_days: number;
};
type Cost = { name: string; route: string; list_price_usd: number; plan_pays_usd: number; family_pays_usd: number; cited_content_ids: string[] };
type Reminder = { date: string; title: string; details: string };

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const ROUTE_LABEL: Record<string, string> = {
  otc_allowance: "OTC allowance",
  prescription_benefit: "Prescription benefit",
  out_of_pocket: "Pay out of pocket",
};

export default function Home() {
  const [prompt, setPrompt] = useState(DEMO_PROMPT);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [openSource, setOpenSource] = useState<Source | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function run() {
    setEvents([]);
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: ac.signal,
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const l of lines) if (l.trim()) setEvents((prev) => [...prev, JSON.parse(l)]);
      }
    } catch (err) {
      if (!ac.signal.aborted) setEvents((p) => [...p, { kind: "error", id: "x", ts: "", message: String(err) }]);
    } finally {
      setRunning(false);
    }
  }

  const view = useMemo(() => {
    const ended = new Map<string, ToolEnd>();
    events.forEach((e) => e.kind === "tool_end" && ended.set(e.id, e));
    const rows = events.filter((e) => e.kind !== "tool_end" && e.kind !== "done");
    const ends = [...ended.values()];
    const sources = new Map<string, Source>();
    ends.forEach((e) => e.sources.forEach((s) => sources.set(s.content_id, s)));
    return {
      rows,
      ended,
      sources,
      start: events.find((e) => e.kind === "start") as Extract<AuditEvent, { kind: "start" }> | undefined,
      done: events.find((e) => e.kind === "done") as Extract<AuditEvent, { kind: "done" }> | undefined,
      order: ends.find((e) => e.tool === "place_order" && e.ok)?.output as Order | undefined,
      costs: ends.filter((e) => e.tool === "calculate_cost" && e.ok).map((e) => e.output as Cost),
      reminders: ends.filter((e) => e.tool === "schedule_reminder").map((e) => e.input as Reminder),
      brief: ends.find((e) => e.tool === "brief_caregiver")?.input as { headline: string; message_markdown: string } | undefined,
      final: events.find((e) => e.kind === "final") as Extract<AuditEvent, { kind: "final" }> | undefined,
    };
  }, [events]);

  const exportTrail = () => download("kin-audit-trail.json", JSON.stringify(events, null, 2), "application/json");

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-baseline gap-3">
            <span className="text-xl font-semibold tracking-tight">Kin</span>
            <span className="text-sm text-stone-500">An agent that shops for the people you care for, and shows its work</span>
          </div>
          {view.start && (
            <div className="flex gap-2 text-xs">
              <Pill>{view.start.model}</Pill>
              <Pill tone={view.start.integrations.context === "senso" ? "green" : "amber"}>
                context: {view.start.integrations.context === "senso" ? "Senso" : "local fallback"}
              </Pill>
              <Pill tone={view.start.integrations.identity === "persona" ? "green" : "amber"}>
                identity: {view.start.integrations.identity === "persona" ? "Persona" : "stub"}
              </Pill>
              <Pill tone={view.start.integrations.analytics === "amplitude" ? "green" : "stone"}>
                analytics: {view.start.integrations.analytics === "amplitude" ? "Amplitude" : "off"}
              </Pill>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        {/* Left: request + outcome */}
        <section className="space-y-4">
          <Card>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">Caregiver request · Priya, for her mom Ruth</div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="w-full resize-none rounded-lg border border-stone-200 bg-stone-50 p-3 text-[15px] leading-relaxed outline-none focus:border-stone-400"
            />
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={run}
                disabled={running}
                className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {running ? "Working…" : "Run Kin"}
              </button>
              {running && (
                <button onClick={() => abortRef.current?.abort()} className="text-sm text-stone-500 underline">
                  stop
                </button>
              )}
              {view.done && (
                <span className="text-sm text-stone-500">
                  {view.done.steps} actions · {(view.done.ms / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          </Card>

          {view.costs.length > 0 && (
            <Card>
              <Title>What it actually costs</Title>
              <div className="space-y-3">
                {view.costs.map((c, i) => (
                  <div key={i} className="rounded-lg border border-stone-200 p-3">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-stone-500">{ROUTE_LABEL[c.route] ?? c.route}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                      <Stat label="List price" value={usd(c.list_price_usd)} />
                      <Stat label="Plan pays" value={`− ${usd(c.plan_pays_usd)}`} tone="green" />
                      <Stat label="Family pays" value={usd(c.family_pays_usd)} strong />
                    </div>
                    {c.cited_content_ids.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.cited_content_ids.map((id) => (
                          <SourceChip key={id} id={id} sources={view.sources} onOpen={setOpenSource} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {view.order && (
            <Card>
              <div className="flex items-center justify-between">
                <Title>Order placed</Title>
                <Pill tone="amber">DEMO MERCHANT · simulated checkout</Pill>
              </div>
              <div className="text-lg font-medium">{view.order.name}</div>
              <div className="text-sm text-stone-500">
                Real listing: <a className="underline" href={view.order.product_url} target="_blank" rel="noreferrer">{view.order.real_retailer}</a>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Row k="Order ID" v={<span className="font-mono">{view.order.order_id}</span>} />
                <Row k="Total" v={usd(view.order.total_usd)} />
                <Row k="Paid with" v={view.order.payment_method === "hsa_card" ? "HSA card" : "Card on file"} />
                <Row k="Arrives" v={view.order.estimated_delivery} />
                <Row k="Return by" v={<b>{view.order.return_by}</b>} />
                <Row k="Claim OTC reimbursement by" v={view.order.otc_reimbursement_claim_by} />
                <Row
                  k="Caregiver identity"
                  v={view.order.caregiver_verification.provider === "persona" ? `Verified by Persona (${view.order.caregiver_verification.status})` : "Not verified (Persona not configured)"}
                />
              </dl>
            </Card>
          )}

          {view.reminders.length > 0 && (
            <Card>
              <Title>On the family calendar</Title>
              <ul className="divide-y divide-stone-100">
                {view.reminders.map((r, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{r.title}</div>
                      <div className="text-stone-500">{r.date} · {r.details}</div>
                    </div>
                    <button onClick={() => download(`kin-${r.date}.ics`, ics(r), "text/calendar")} className="shrink-0 text-xs underline">
                      .ics
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {(view.brief || view.final) && (
            <Card className="border-emerald-200 bg-emerald-50/60">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-emerald-700">Message to Priya</div>
              {view.brief && <div className="mb-2 text-lg font-medium">{view.brief.headline}</div>}
              <Markdown text={view.brief?.message_markdown ?? view.final!.text} sources={view.sources} onOpen={setOpenSource} />
            </Card>
          )}
        </section>

        {/* Right: audit trail */}
        <section>
          <Card className="lg:sticky lg:top-4">
            <div className="mb-3 flex items-center justify-between">
              <Title>Audit trail</Title>
              {view.done && (
                <button onClick={exportTrail} className="text-xs underline">
                  Export JSON
                </button>
              )}
            </div>
            {view.rows.length === 0 && (
              <p className="text-sm text-stone-500">
                Every lookup, source, decision and action the agent takes shows up here, with the evidence behind it.
              </p>
            )}
            <ol className="relative max-h-[calc(100vh-9rem)] space-y-3 overflow-y-auto border-l border-stone-200 pl-5">
              {view.rows.map((e) => (
                <TrailItem key={e.kind + e.id} e={e} end={e.kind === "tool_start" ? view.ended.get(e.id) : undefined} sources={view.sources} onOpen={setOpenSource} />
              ))}
              {running && <li className="animate-pulse text-sm text-stone-400">thinking…</li>}
            </ol>
          </Card>
        </section>
      </main>

      {openSource && (
        <div className="fixed inset-0 z-10 flex justify-end bg-black/20" onClick={() => setOpenSource(null)}>
          <aside className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <Pill tone={openSource.provider === "senso" ? "green" : openSource.provider === "catalog" ? "stone" : "amber"}>
                {openSource.provider === "senso" ? "Senso context layer" : openSource.provider === "catalog" ? "Product catalog" : "Local KB (fallback)"}
              </Pill>
              <button onClick={() => setOpenSource(null)} className="text-sm text-stone-500">close</button>
            </div>
            <h3 className="mt-2 font-medium">{openSource.title}</h3>
            <div className="mt-1 font-mono text-xs text-stone-400">{openSource.content_id}</div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{openSource.chunk_text}</p>
          </aside>
        </div>
      )}
    </div>
  );
}

function TrailItem({ e, end, sources, onOpen }: { e: AuditEvent; end?: ToolEnd; sources: Map<string, Source>; onOpen: (s: Source) => void }) {
  if (e.kind === "start")
    return (
      <Dot color="bg-stone-400">
        <div className="text-sm text-stone-500">Request received</div>
      </Dot>
    );
  if (e.kind === "note")
    return (
      <Dot color="bg-sky-300">
        <div className="text-sm italic text-stone-600">{e.text}</div>
      </Dot>
    );
  if (e.kind === "error")
    return (
      <Dot color="bg-red-500">
        <div className="text-sm text-red-700">{e.message}</div>
      </Dot>
    );
  if (e.kind === "final")
    return (
      <Dot color="bg-emerald-500">
        <div className="text-sm font-medium">Done</div>
      </Dot>
    );
  if (e.kind !== "tool_start") return null;
  const s = e as ToolStart;
  const color = !end ? "bg-stone-300 animate-pulse" : end.ok ? "bg-emerald-500" : "bg-red-500";
  return (
    <Dot color={color}>
      <details className="group">
        <summary className="cursor-pointer list-none">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">
              <span className="mr-1 text-stone-400">{s.step}.</span>
              {s.label}
            </span>
            {end && <span className="shrink-0 text-xs text-stone-400">{end.ms}ms</span>}
          </div>
          <div className="mt-0.5 truncate text-xs text-stone-500">{summarize(s.tool, s.input, end?.output)}</div>
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded bg-stone-50 p-2 text-[11px] leading-snug">
          {JSON.stringify({ input: s.input, output: end?.output }, null, 2)}
        </pre>
      </details>
      {end && end.sources.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {end.sources.slice(0, 6).map((src) => (
            <SourceChip key={src.content_id} id={src.content_id} sources={sources} onOpen={onOpen} />
          ))}
        </div>
      )}
    </Dot>
  );
}

function summarize(tool: string, input: any, output: any): string {
  switch (tool) {
    case "search_trusted_context": return `“${input?.query}”`;
    case "search_products": return output ? `${output.length} matches` : "searching…";
    case "check_fda_status": return output?.verdict ? `${output.sku}: ${output.fda_category} → ${output.verdict}` : input?.sku;
    case "calculate_cost": return output?.family_pays_usd != null ? `${ROUTE_LABEL[output.route]}: family pays ${usd(output.family_pays_usd)}` : output?.error ?? "";
    case "place_order": return output?.order_id ? `${output.order_id} · return by ${output.return_by}` : output?.error ?? "";
    case "schedule_reminder": return `${input?.date} · ${input?.title}`;
    case "brief_caregiver": return input?.headline ?? "";
    default: return "";
  }
}

function SourceChip({ id, sources, onOpen }: { id: string; sources: Map<string, Source>; onOpen: (s: Source) => void }) {
  const src = sources.get(id);
  const tone = !src ? "bg-stone-100 text-stone-400" : src.provider === "catalog" ? "bg-stone-100 text-stone-600" : "bg-emerald-100 text-emerald-800";
  return (
    <button disabled={!src} onClick={() => src && onOpen(src)} title={src?.title} className={`max-w-[16rem] truncate rounded px-1.5 py-0.5 text-[11px] ${tone} hover:brightness-95`}>
      {src ? src.title.replace(/\s*\(DEMO.*$/, "").slice(0, 40) : id}
    </button>
  );
}

// Tiny renderer: paragraphs, bullets, **bold**, and [content_id] citations as source chips.
function Markdown({ text, sources, onOpen }: { text: string; sources: Map<string, Source>; onOpen: (s: Source) => void }) {
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*|\[[^\]]+\])/g).map((part, i) => {
      if (part.startsWith("**")) return <b key={i}>{part.slice(2, -2)}</b>;
      if (part.startsWith("[") && part.endsWith("]")) {
        const ids = part.slice(1, -1).split(/,\s*/);
        if (ids.every((id) => sources.has(id)))
          return <span key={i} className="mx-0.5 inline-flex gap-1 align-middle">{ids.map((id) => <SourceChip key={id} id={id} sources={sources} onOpen={onOpen} />)}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  return (
    <div className="space-y-2 text-[15px] leading-relaxed">
      {text.split(/\n{2,}/).map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-*] /.test(l)))
          return <ul key={i} className="list-disc space-y-1 pl-5">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*] /, ""))}</li>)}</ul>;
        return <p key={i}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l.replace(/^#+\s*/, ""))}</span>)}</p>;
      })}
    </div>
  );
}

function ics(r: Reminder) {
  const d = r.date.replaceAll("-", "");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kin//EN", "BEGIN:VEVENT", `UID:${d}-${Math.random().toString(36).slice(2)}@kin`, `DTSTART;VALUE=DATE:${d}`, `SUMMARY:${r.title}`, `DESCRIPTION:${r.details.replace(/\n/g, "\\n")}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}

function download(name: string, body: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-stone-200 bg-white p-4 shadow-sm ${className}`}>{children}</div>;
}
function Title({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">{children}</h2>;
}
function Pill({ children, tone = "stone" }: { children: React.ReactNode; tone?: "stone" | "green" | "amber" }) {
  const c = { stone: "bg-stone-100 text-stone-700", green: "bg-emerald-100 text-emerald-800", amber: "bg-amber-100 text-amber-800" }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{children}</span>;
}
function Stat({ label, value, tone, strong }: { label: string; value: string; tone?: "green"; strong?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-stone-400">{label}</div>
      <div className={`${strong ? "text-lg font-semibold" : "text-base"} ${tone === "green" ? "text-emerald-700" : ""}`}>{value}</div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="text-stone-500">{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
function Dot({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <li className="relative">
      <span className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${color}`} />
      {children}
    </li>
  );
}
