"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AuditEvent, Source } from "@/lib/audit";
import { DEMO_CAREGIVER, DEMO_PROMPT } from "@/lib/demo";
import type { Config, Session } from "./session";
import {
  Button, Card, KinAvatar, Markdown, PersonAvatar, Pill, ProductImage, SourceChip, SourceDrawer,
  daysFromNow, download, ics, longDate, niceDate, usd,
} from "./ui";

type ChatId = "kin" | "family";
type View = "today" | ChatId;
type Msg = {
  id: string; chat: ChatId; from: "user" | "kin" | "caregiver" | "system"; text: string;
  runId?: string; headline?: string; files?: string[]; proposalRunId?: string;
};
type Attachment = { name: string; media_type: string; data: string };
type Option = {
  sku: string; name: string; style: string; retailer: string; product_url: string; price_pair_usd: number;
  rechargeable?: boolean; behind_the_ear?: boolean; self_fitting_app?: boolean; rating?: number;
  return_window_days: number; label: string; reason: string; tradeoff: string; route: string;
  family_pays_usd: number; plan_pays_usd: number;
};
type Proposal = { options: Option[]; recommended_sku: string };
type AskExtra = { approvedPurchase?: { sku: string; approvedBy: string }; from?: "user" | "caregiver"; attachments?: Attachment[] };
type ToolEnd = Extract<AuditEvent, { kind: "tool_end" }>;
type Order = {
  order_id: string; name: string; real_retailer: string; product_url: string; total_usd: number; sku: string;
  estimated_delivery: string; return_by: string; otc_reimbursement_claim_by: string;
  buyer_verification?: { provider: string; status?: string; environment?: string };
};
type Cost = { sku: string | null; route: string; list_price_usd: number | null; plan_pays_usd: number | null; family_pays_usd: number };
type Reminder = { date: string; title: string; details: string };
export type InboxScan = {
  deliveries: { email_id: string; item: string; retailer: string; order_ref: string; delivered_on: string; return_by: string; days_left: number }[];
  medical: { email_id: string; from: string; subject: string; date: string; body: string }[];
};

const uid = () => Math.random().toString(36).slice(2, 10);

export function KinApp({
  session, update, config, inbox, signOut,
}: {
  session: Session; update: (s: Partial<Session>) => void; config?: Config; inbox?: InboxScan; signOut: () => void;
}) {
  const [view, setView] = useState<View>("today");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [runs, setRuns] = useState<Record<string, AuditEvent[]>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [panel, setPanel] = useState<{ tab: "steps" | "reminders"; runId?: string } | null>(null);
  const [openSource, setOpenSource] = useState<Source | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const dismissed = session.kept ?? [];
  const [gmailJustConnected, setGmailJustConnected] = useState(false);
  // Both "Connect Gmail" paths (Today card and sidebar link) confirm the same way on Today.
  const connectGmail = () => { update({ gmail: true }); setGmailJustConnected(true); setView("today"); };
  const ac = useRef<AbortController | null>(null);

  const push = (m: Omit<Msg, "id">) => setMessages((prev) => [...prev, { ...m, id: uid() }]);

  // Family chat history isn't persisted; reseed the join messages for an existing caregiver.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (session.caregiver?.joined && !messages.some((m) => m.chat === "family"))
      push({ chat: "family", from: "system", text: `${session.caregiver.firstName} is in the family chat.` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const all = useMemo(() => Object.values(runs).flat(), [runs]);
  const derived = useMemo(() => {
    const ends = all.filter((e): e is ToolEnd => e.kind === "tool_end");
    const sources = new Map<string, Source>();
    ends.forEach((e) => e.sources.forEach((s) => sources.set(s.content_id, s)));
    const order = [...ends].reverse().find((e) => e.tool === "place_order" && e.ok)?.output as Order | undefined;
    const costs = ends.filter((e) => e.tool === "calculate_cost" && e.ok).map((e) => e.output as Cost);
    const chosen = order ? costs.filter((c) => c.sku === order.sku).sort((a, b) => a.family_pays_usd - b.family_pays_usd)[0] : undefined;
    const reminders = ends.filter((e) => e.tool === "schedule_reminder").map((e) => e.input as Reminder);
    return { sources, order, chosen, reminders };
  }, [all]);

  async function ask(text: string, chat: ChatId = "kin", extra: AskExtra = {}) {
    if (running || !text.trim()) return;
    setView(chat);
    const history = messages
      .filter((m) => m.chat === chat && (m.from === "user" || m.from === "kin"))
      .map((m) => ({ role: m.from === "user" ? ("user" as const) : ("assistant" as const), text: m.text }));
    push({ chat, from: extra.from ?? "user", text, files: extra.attachments?.map((f) => f.name) });
    const runId = uid();
    setRuns((r) => ({ ...r, [runId]: [] }));
    setRunning(runId);
    const controller = new AbortController();
    ac.current = controller;
    let gotFinal = false;
    const onEvent = (e: AuditEvent) => {
      setRuns((r) => ({ ...r, [runId]: [...(r[runId] ?? []), e] }));
      if (e.kind === "final") {
        gotFinal = true;
        push({ chat, from: "kin", text: e.text, runId });
      } else if (e.kind === "error") {
        gotFinal = true;
        push({ chat, from: "kin", text: `Sorry, something went wrong: ${e.message}`, runId });
      } else if (e.kind === "tool_end" && e.tool === "brief_caregiver" && e.ok && session.caregiver?.joined) {
        const b = e.input as { headline: string; message_markdown: string };
        push({ chat: "family", from: "kin", text: b.message_markdown, headline: b.headline, runId });
      }
    };
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: text,
          history,
          personaInquiryId: session.identity?.provider === "persona" ? session.identity.inquiryId : undefined,
          gmailConnected: session.gmail,
          user: { name: session.user.name, address: session.user.address, plan: session.user.plan },
          caregiver: session.caregiver?.joined ? { name: session.caregiver.name, relation: session.caregiver.relation } : null,
          approvedPurchase: extra.approvedPurchase,
          attachments: extra.attachments,
        }),
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
        for (const l of lines) if (l.trim()) onEvent(JSON.parse(l));
      }
    } catch (err) {
      if (!controller.signal.aborted) onEvent({ kind: "error", id: uid(), ts: "", message: String(err) });
    } finally {
      if (!gotFinal && !controller.signal.aborted) push({ chat, from: "kin", text: "I finished. You can see every step in Activity.", runId });
      setRunning(null);
    }
  }

  function approve(p: Option, by: "user" | "caregiver") {
    const name = by === "user" ? session.user.firstName : session.caregiver?.firstName ?? "Family";
    ask(
      by === "user" ? `Yes, please buy the ${p.name}.` : `Approved. Go ahead and buy the ${p.name} for Mom.`,
      by === "user" ? "kin" : "family",
      { approvedPurchase: { sku: p.sku, approvedBy: name }, from: by },
    );
  }

  function shareWithFamily(runId: string) {
    if (!session.caregiver?.joined) return setInviteOpen(true);
    push({ chat: "family", from: "user", text: `${session.caregiver.firstName}, can you look at this and place the order for me?` });
    push({ chat: "family", from: "kin", text: "Here's what I suggested. Either of you can approve it.", proposalRunId: runId });
    setView("family");
  }

  function invite() {
    update({ caregiver: { ...DEMO_CAREGIVER, joined: false } });
    setInviteOpen(false);
    setView("family");
    push({ chat: "family", from: "system", text: `You invited ${DEMO_CAREGIVER.firstName} (your ${DEMO_CAREGIVER.relation}) by email.` });
    setTimeout(() => {
      update({ caregiver: { ...DEMO_CAREGIVER, joined: true } });
      push({ chat: "family", from: "system", text: `${DEMO_CAREGIVER.firstName} joined the family chat. (demo)` });
      push({ chat: "family", from: "caregiver", text: "Hi Mom! I'm here. Kin will keep me posted on the hearing aids." });
    }, 1500);
  }

  const urgentCount = (inbox?.deliveries.filter((d) => !dismissed.includes(d.email_id)).length ?? 0) + (derived.order ? 1 : 0);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r border-line bg-soft p-4 lg:flex">
        <div className="mb-6 flex items-center gap-3 px-2">
          <KinAvatar size={36} />
          <span className="text-xl font-bold">Kin</span>
        </div>
        <NavItem active={view === "today"} onClick={() => setView("today")} icon="☀︎" label="Today" badge={urgentCount || undefined} />
        <div className="mt-6 px-3 text-sm font-bold uppercase tracking-wide text-muted">Chats</div>
        <NavItem active={view === "kin"} onClick={() => setView("kin")} icon={<KinAvatar size={26} />} label="Kin" />
        {session.caregiver ? (
          <NavItem active={view === "family"} onClick={() => setView("family")} icon={<PersonAvatar name={session.caregiver.firstName} size={26} />} label={`Family · ${session.caregiver.firstName}`} />
        ) : (
          <NavItem onClick={() => setInviteOpen(true)} icon="+" label="Invite family" />
        )}
        <div className="mt-6 px-3 text-sm font-bold uppercase tracking-wide text-muted">Connected</div>
        <div className="space-y-1 px-3 py-1 text-base">
          <Conn ok label="Identity" detail={session.identity?.provider === "persona" ? "Persona" : "Simulated"} />
          <Conn ok label="Plan" detail="Aetna" />
          {session.gmail ? <Conn ok label="Gmail" detail="Demo inbox" /> : (
            <button className="text-left font-bold text-brand underline" onClick={connectGmail}>Connect Gmail</button>
          )}
          {session.caregiver?.joined ? <Conn ok label="Family" detail={session.caregiver.firstName} /> : (
            <button className="block text-left font-bold text-brand underline" onClick={() => setInviteOpen(true)}>Invite family</button>
          )}
        </div>
        <div className="mt-auto flex items-center gap-3 border-t border-line px-2 pt-4">
          <PersonAvatar name={session.user.firstName} size={36} tone="bg-brand-bg text-brand" />
          <div className="flex-1">
            <div className="font-bold">{session.user.firstName}</div>
            <button className="text-sm text-muted underline" onClick={signOut}>Sign out (reset demo)</button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-white/90 px-4 py-3 backdrop-blur">
          <div className="flex gap-1 lg:hidden">
            {(["today", "kin", "family"] as const).map((v) => (
              <button key={v} onClick={() => (v === "family" && !session.caregiver ? setInviteOpen(true) : setView(v))}
                className={`rounded-full px-4 py-2 font-bold ${view === v ? "bg-ink text-white" : "bg-soft"}`}>
                {v === "today" ? "Today" : v === "kin" ? "Kin" : "Family"}
              </button>
            ))}
          </div>
          <h1 className="hidden text-xl font-bold lg:block">
            {view === "today" ? "Today" : view === "kin" ? "Kin" : `Family · ${session.user.firstName}, ${session.caregiver?.firstName ?? ""} and Kin`}
          </h1>
          <Button kind="secondary" onClick={() => setPanel(panel ? null : { tab: "steps" })}>
            {panel ? "Hide activity" : "Activity"}
          </Button>
        </header>

        <div className="flex-1">
          {view === "today" && (
            <Today
              session={session} inbox={inbox} order={derived.order} chosen={derived.chosen} dismissed={dismissed}
              onDismiss={(id) => update({ kept: [...dismissed, id] })} onAsk={(t) => ask(t)} onInvite={() => setInviteOpen(true)}
              onConnectGmail={connectGmail} gmailJustConnected={gmailJustConnected} onGmailNoticeDone={() => setGmailJustConnected(false)} onSteps={() => setPanel({ tab: "steps" })}
            />
          )}
          {view !== "today" && (
            <Chat
              chat={view} session={session} messages={messages.filter((m) => m.chat === view)} runs={runs} running={running}
              derived={derived} onAsk={(t, extra) => ask(t, view, extra)} onOpenSource={setOpenSource}
              onSteps={(runId) => setPanel({ tab: "steps", runId })} onStop={() => ac.current?.abort()}
              onInvite={() => setInviteOpen(true)}
              onPostToFamily={(t) => push({ chat: "family", from: "user", text: t })}
              onApprove={approve} onShare={shareWithFamily}
            />
          )}
        </div>
      </main>

      {panel && (
        <ActivityPanel
          panel={panel} setPanel={setPanel} runs={runs} reminders={derived.reminders} sources={derived.sources}
          onOpenSource={setOpenSource} config={config} running={running}
          notified={session.notify ?? []} onNotify={(k) => update({ notify: [...(session.notify ?? []), k] })}
        />
      )}

      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} onInvite={invite} />}
      <SourceDrawer source={openSource} onClose={() => setOpenSource(null)} />
    </div>
  );
}

function NavItem({ active, onClick, icon, label, badge }: { active?: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number }) {
  return (
    <button onClick={onClick} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-lg ${active ? "bg-white font-bold shadow-sm" : "hover:bg-white/70"}`}>
      <span className="flex w-7 justify-center text-xl">{icon}</span>
      <span className="flex-1">{label}</span>
      {badge ? <span className="rounded-full bg-urgent px-2 text-sm font-bold text-white">{badge}</span> : null}
    </button>
  );
}

function Conn({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={ok ? "text-good" : "text-muted"}>{ok ? "✓" : "○"}</span>
      <span className="font-bold">{label}</span>
      <span className="text-muted">{detail}</span>
    </div>
  );
}

/* ---------------- Today ---------------- */

function Today({
  session, inbox, order, chosen, dismissed, onDismiss, onAsk, onInvite, onConnectGmail, onSteps, gmailJustConnected, onGmailNoticeDone,
}: {
  session: Session; inbox?: InboxScan; order?: Order; chosen?: Cost; dismissed: string[];
  onDismiss: (id: string) => void; onAsk: (t: string) => void; onInvite: () => void; onConnectGmail: () => void; onSteps: () => void;
  gmailJustConnected?: boolean; onGmailNoticeDone?: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const cards: { key: string; node: React.ReactNode }[] = [];
  if (order) cards.push({ key: "order", node: <OrderCard order={order} chosen={chosen} onSteps={onSteps} /> });
  if (session.gmail)
    inbox?.deliveries.filter((d) => !dismissed.includes(d.email_id)).forEach((d) =>
      cards.push({
        key: d.email_id,
        node: (
          <Card className="border-urgent/30">
            <Pill tone="urgent">{d.days_left} {d.days_left === 1 ? "day" : "days"} left • return by {longDate(d.return_by)}</Pill>
            <h3 className="mt-3 text-2xl font-bold">{d.item}</h3>
            <p className="mt-1 text-lg text-muted">Delivered {niceDate(d.delivered_on)} from {d.retailer}. <b className="text-ink">Found in your email.</b></p>
            <KeepOrReturn
              item={d.item}
              onReturn={() => onAsk(`I don't like the ${d.item} I got from ${d.retailer}. When do I have to return it by, and can you help me return it?`)}
              onKeep={() => onDismiss(d.email_id)}
            />
          </Card>
        ),
      }),
    );
  if (session.gmail && !order)
    inbox?.medical.forEach((m) =>
      cards.push({
        key: m.email_id,
        node: (
          <Card>
            <Pill tone="brand">From {m.from}</Pill>
            <h3 className="mt-3 text-2xl font-bold">Your audiologist recommends hearing aids</h3>
            <p className="mt-1 text-lg text-muted">Kin can find ones you&apos;ll wear and check what your Aetna plan pays.</p>
            <Button className="mt-4" onClick={() => onAsk(DEMO_PROMPT)}>Help me choose hearing aids</Button>
          </Card>
        ),
      }),
    );
  if (!session.gmail)
    cards.push({
      key: "gmail",
      node: (
        <Card>
          <h3 className="text-2xl font-bold">Let Kin watch your deliveries</h3>
          <p className="mt-1 text-lg text-muted">Connect Gmail and Kin will tell you when something arrives and when it must go back.</p>
          <Button className="mt-4" onClick={onConnectGmail}>Connect Gmail</Button>
        </Card>
      ),
    });
  if (!session.caregiver)
    cards.push({
      key: "invite",
      node: (
        <Card>
          <h3 className="text-2xl font-bold">Bring your family in</h3>
          <p className="mt-1 text-lg text-muted">Invite someone you trust. Kin keeps them updated so you don&apos;t have to.</p>
          <Button className="mt-4" kind="secondary" onClick={onInvite}>Invite family</Button>
        </Card>
      ),
    });

  const visible = showAll ? cards : cards.slice(0, 2);
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h2 className="text-3xl font-bold">{greeting}, {session.user.firstName}.</h2>
      <p className="mt-1 text-lg text-muted">
        {cards.length ? `${cards.length === 1 ? "One thing" : `${cards.length} things`} for you today.` : "Nothing needs you today."}
      </p>
      <div className="mt-6 space-y-4">
        {gmailJustConnected && <GmailConnectedCard onDone={() => onGmailNoticeDone?.()} />}
        {visible.map((c) => <div key={c.key}>{c.node}</div>)}
      </div>
      {cards.length > 2 && (
        <Button kind="ghost" className="mt-4" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show less" : `Show ${cards.length - 2} more`}
        </Button>
      )}
      <div className="mt-10">
        <Button kind="secondary" onClick={() => onAsk(DEMO_PROMPT)}>Ask Kin something</Button>
      </div>
    </div>
  );
}

// "I'm keeping it" asks to confirm, shows a short done note, then removes the card (saved in the session).
function KeepOrReturn({ item, onReturn, onKeep }: { item: string; onReturn: () => void; onKeep: () => void }) {
  const [stage, setStage] = useState<"choose" | "confirm" | "done">("choose");
  useEffect(() => {
    if (stage !== "done") return;
    const t = setTimeout(onKeep, 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);
  if (stage === "done")
    return (
      <p role="status" className="mt-4 rounded-xl bg-good-bg p-4 text-lg font-bold text-good">✓ Done. Kin won&apos;t remind you about returning it.</p>
    );
  if (stage === "confirm")
    return (
      <div className="mt-4 rounded-xl bg-soft p-4">
        <p className="text-lg font-bold">Keep the {item}?</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button onClick={() => setStage("done")}>Yes, I&apos;m keeping it</Button>
          <Button kind="secondary" onClick={() => setStage("choose")}>Not yet</Button>
        </div>
      </div>
    );
  return (
    <div className="mt-4 flex flex-wrap gap-3">
      <Button onClick={onReturn}>Help me return it</Button>
      <Button kind="secondary" onClick={() => setStage("confirm")}>I&apos;m keeping it</Button>
    </div>
  );
}

// Shown at the top of Today right after Gmail connects; fades out after 30s (no fade with reduced motion).
function GmailConnectedCard({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = useState(false);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { const t = setTimeout(onDone, 30_000); return () => clearTimeout(t); }
    const f = setTimeout(() => setFading(true), 30_000);
    const t = setTimeout(onDone, 30_700);
    return () => { clearTimeout(f); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div role="status" className={`transition-opacity duration-700 ${fading ? "opacity-0" : "opacity-100"}`}>
      <Card className="border-good/30">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-good-bg text-lg font-bold text-good" aria-hidden>✓</span>
          <div>
            <h3 className="text-2xl font-bold">Gmail connected</h3>
            <p className="mt-1 text-lg text-muted">Kin will tell you when something arrives and when it must go back.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function OrderCard({ order, chosen, onSteps }: { order: Order; chosen?: Cost; onSteps?: () => void }) {
  const rows = [
    { tone: "brand" as const, label: "Arrives", date: order.estimated_delivery },
    { tone: "urgent" as const, label: "Decide keep or return by", date: order.return_by },
    { tone: "good" as const, label: "Claim money back from Aetna by", date: order.otc_reimbursement_claim_by },
  ];
  const claimSteps = [
    "Keep the itemized receipt.",
    "Fill in the OTC Hearing Aid Reimbursement Form.",
    `Send both to Aetna by ${niceDate(order.otc_reimbursement_claim_by)} (within 90 days of purchase).`,
    "Aetna mails a check within 30 days of approving the claim.",
  ];
  return (
    <Card>
      {/* Celebration: a check that draws in (static when reduced motion is on), then a warm headline. */}
      <div className="flex items-center gap-3">
        <svg width="44" height="44" viewBox="0 0 44 44" className="kin-celebrate shrink-0" aria-hidden>
          <circle cx="22" cy="22" r="20" className="fill-good-bg" />
          <path d="M13 22.5l6 6 12-13" fill="none" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="kin-check stroke-good" />
        </svg>
        <p className="text-2xl font-bold text-good">Your new hearing aids are on the way!</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Pill tone="good">✓ Ordered</Pill>
        <Pill tone="caution">Demo store · no real purchase</Pill>
      </div>
      <h3 className="mt-3 text-2xl font-bold">{order.name}</h3>
      {chosen && chosen.plan_pays_usd != null && (
        <div className="mt-3 rounded-xl bg-good-bg p-4">
          <div className="text-3xl font-bold text-good">You pay {usd(chosen.family_pays_usd)}</div>
          <div className="text-lg text-good">Aetna pays you back {usd(chosen.plan_pays_usd)} of the {usd(order.total_usd)} price.</div>
        </div>
      )}
      <ul className="mt-4 space-y-2">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-3 text-lg">
            <span>{r.label}</span>
            <Pill tone={r.tone}>{niceDate(r.date)}{r.tone === "urgent" ? ` · ${daysFromNow(r.date)} days` : ""}</Pill>
          </li>
        ))}
      </ul>
      {chosen?.plan_pays_usd != null && (
        <div className="mt-5 border-t border-line pt-4">
          <h4 className="text-xl font-bold">Getting {usd(chosen.plan_pays_usd)} back from Aetna</h4>
          <ol className="mt-2 list-decimal space-y-1 pl-6 text-lg">
            {claimSteps.map((s) => <li key={s}>{s}</li>)}
          </ol>
        </div>
      )}
      <p className="mt-4 rounded-xl bg-soft p-4 text-lg">Not sure about them? You can return them until <b>{longDate(order.return_by)}</b>.</p>
      {order.buyer_verification && (
        <p className="mt-3 text-base text-muted">
          {order.buyer_verification.provider === "persona"
            ? `✓ Confirmed it was you with Persona${order.buyer_verification.environment === "sandbox" ? " sandbox" : ""} before buying.`
            : "Identity check simulated for this demo."}
        </p>
      )}
      {onSteps && <Button kind="ghost" className="mt-2 -ml-4" onClick={onSteps}>See how Kin decided</Button>}
    </Card>
  );
}

/* ---------------- Chat ---------------- */

function Chat({
  chat, session, messages, runs, running, derived, onAsk, onOpenSource, onSteps, onStop, onInvite, onPostToFamily, onApprove, onShare,
}: {
  chat: ChatId; session: Session; messages: Msg[]; runs: Record<string, AuditEvent[]>; running: string | null;
  derived: { sources: Map<string, Source>; order?: Order; chosen?: Cost };
  onAsk: (t: string, extra?: AskExtra) => void; onOpenSource: (s: Source) => void; onSteps: (runId: string) => void; onStop: () => void;
  onInvite: () => void; onPostToFamily: (t: string) => void;
  onApprove: (p: Option, by: "user" | "caregiver") => void; onShare: (runId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [listening, setListening] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const ordered = new Set(Object.values(runs).flat().filter((e): e is ToolEnd => e.kind === "tool_end" && e.tool === "place_order" && e.ok).map((e) => (e.output as Order).sku));

  async function addFiles(list: FileList | null) {
    for (const f of Array.from(list ?? [])) {
      if (!/^image\/(png|jpeg|gif|webp)$|^application\/pdf$/.test(f.type) || f.size > 8_000_000) continue;
      const data = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1]);
        r.readAsDataURL(f);
      });
      setFiles((prev) => [...prev, { name: f.name, media_type: f.type, data }]);
    }
  }

  // Browser speech recognition (Chrome/Safari); no key needed.
  function dictate() {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) return alert("Voice input isn't supported in this browser. Try Chrome or Safari.");
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onresult = (e: any) => setDraft((d) => (d ? d + " " : "") + e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  }
  const bottom = useRef<HTMLDivElement>(null);
  const runEvents = running ? runs[running] ?? [] : [];
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, runEvents.length]);

  if (chat === "family" && !session.caregiver)
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h2 className="text-3xl font-bold">A chat for you, your family, and Kin</h2>
        <p className="mt-3 text-lg text-muted">Kin posts updates here after it buys something, so your family always knows.</p>
        <Button className="mt-6" onClick={onInvite}>Invite family</Button>
      </div>
    );

  const send = () => {
    const t = draft.trim() || (files.length ? "Here's a file for you to look at." : "");
    if (!t) return;
    setDraft("");
    const attachments = files;
    setFiles([]);
    if (attachments.length) return onAsk(t, { attachments });
    // In the family chat, messages go to the family; start with "Kin" to ask the agent.
    if (chat === "family" && !/^@?kin\b/i.test(t)) onPostToFamily(t);
    else onAsk(t.replace(/^@?kin[,:]?\s*/i, "") || t);
  };

  const lastLabel = [...runEvents].reverse().find((e) => e.kind === "tool_start");
  const steps = runEvents.filter((e) => e.kind === "tool_end").length;
  const empty = messages.length === 0 && !running;

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col px-4">
      <div className="flex-1 space-y-6 py-8">
        {empty && chat === "kin" && (
          <div>
            <div className="flex items-center gap-3">
              <KinAvatar size={48} />
              <h2 className="text-3xl font-bold">Hi {session.user.firstName}. What can I help with?</h2>
            </div>
            <div className="mt-6 grid gap-3">
              {[
                DEMO_PROMPT,
                ...(session.gmail ? ["When do I have to return the sound amplifier I bought?"] : []),
                "What does my plan pay for hearing aids?",
              ].map((s) => (
                <button key={s} onClick={() => onAsk(s)} className="rounded-2xl border border-line p-4 text-left text-lg hover:bg-soft">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => {
          if (m.from === "system") return <p key={m.id} className="text-center text-base text-muted">{m.text}</p>;
          if (m.from === "user" || (m.from === "caregiver" && m.text.startsWith("Approved.")))
            return m.from === "caregiver" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-caution-bg px-5 py-3 text-lg"><b>{session.caregiver?.firstName}:</b> {m.text}</div>
              </div>
            ) : (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-5 py-3 text-lg text-white">
                  {m.files?.map((f) => <div key={f} className="mb-1 text-base opacity-80">📎 {f}</div>)}
                  {m.text}
                </div>
              </div>
            );
          const isCaregiver = m.from === "caregiver";
          const order = m.runId ? orderInRun(runs[m.runId]) : undefined;
          return (
            <div key={m.id} className="flex gap-3">
              {isCaregiver ? <PersonAvatar name={session.caregiver?.firstName ?? "P"} /> : <KinAvatar />}
              <div className="min-w-0 flex-1">
                <div className="mb-1 font-bold">
                  {isCaregiver ? session.caregiver?.firstName : "Kin"}
                  {m.headline && <span className="ml-2 font-normal text-muted">· update for the family</span>}
                </div>
                {m.headline && <div className="mb-2 text-xl font-bold">{m.headline}</div>}
                <div className="text-lg">
                  <Markdown text={m.text} sources={derived.sources} onOpen={onOpenSource} />
                </div>
                {m.proposalRunId && proposalInRun(runs[m.proposalRunId]) && (
                  <div className="mt-4">
                    <ProposalCard p={proposalInRun(runs[m.proposalRunId])!} ordered={ordered} busy={!!running}
                      buyLabel={`Approve this one as ${session.caregiver?.firstName} (demo)`} onBuy={(o) => onApprove(o, "caregiver")} />
                  </div>
                )}
                {m.runId && !order && proposalInRun(runs[m.runId]) && chat === "kin" && (
                  <div className="mt-4">
                    <ProposalCard p={proposalInRun(runs[m.runId])!} ordered={ordered} busy={!!running}
                      buyLabel="Buy this one" onBuy={(o) => onApprove(o, "user")}
                      share={{ label: session.caregiver?.joined ? `Ask ${session.caregiver.firstName} to choose` : "Ask family to choose", onClick: () => onShare(m.runId!) }} />
                  </div>
                )}
                {m.runId && <ActionCards events={runs[m.runId]} />}
                {order && (
                  <div className="mt-4">
                    <OrderCard order={order} chosen={derived.order?.order_id === order.order_id ? derived.chosen : undefined} />
                  </div>
                )}
                {m.runId && (
                  <Button kind="ghost" className="mt-1 -ml-4" onClick={() => onSteps(m.runId!)}>
                    See every step
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {running && (
          <div className="flex gap-3">
            <KinAvatar />
            <div className="flex-1 rounded-2xl bg-soft p-4">
              <div className="text-lg font-bold">
                {lastLabel && lastLabel.kind === "tool_start" ? `${lastLabel.label}…` : "Thinking…"}
              </div>
              <div className="mt-1 flex items-center gap-3 text-base text-muted">
                <span className="inline-flex gap-1">
                  {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 animate-pulse rounded-full bg-brand" style={{ animationDelay: `${i * 150}ms` }} />)}
                </span>
                {steps} steps done
                <button className="underline" onClick={() => onSteps(running)}>Watch</button>
                <button className="underline" onClick={onStop}>Stop</button>
              </div>
            </div>
          </div>
        )}
        <div ref={bottom} />
      </div>

      <form className="sticky bottom-0 bg-white pb-4 pt-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {files.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-2 rounded-full bg-brand-bg px-3 py-1 font-bold text-brand">
                📎 {f.name}
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-3xl border border-line bg-soft p-2">
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <button type="button" onClick={() => fileInput.current?.click()} aria-label="Add a photo or document"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-2xl hover:bg-line">＋</button>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
            placeholder={chat === "family" ? `Message your family (start with "Kin" to ask Kin)` : "Message Kin"}
            className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-lg outline-none"
          />
          <button type="button" onClick={dictate} aria-label="Speak instead of typing"
            className={`flex h-12 shrink-0 items-center gap-2 rounded-full px-4 font-bold ${listening ? "bg-urgent text-white" : "hover:bg-line"}`}>
            🎤 {listening ? "Listening…" : "Speak"}
          </button>
          <Button type="submit" disabled={!!running || (!draft.trim() && !files.length)}>Send</Button>
        </div>
      </form>
    </div>
  );
}

function proposalInRun(events?: AuditEvent[]) {
  return events?.find((e): e is ToolEnd => e.kind === "tool_end" && e.tool === "propose_purchase" && e.ok)?.output as Proposal | undefined;
}

function ProposalCard({ p, ordered, busy, buyLabel, onBuy, share }: {
  p: Proposal; ordered: Set<string>; busy: boolean; buyLabel: string; onBuy: (o: Option) => void;
  share?: { label: string; onClick: () => void };
}) {
  const [more, setMore] = useState<{ options: Option[]; hidden_not_fda: number } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Recommended first; at most three, so the choice stays easy. "Show more" appends the rest.
  const base = [...p.options].sort((a, b) => Number(b.sku === p.recommended_sku) - Number(a.sku === p.recommended_sku)).slice(0, 3);
  const all = [...base, ...(more?.options ?? [])];
  const chosen = all.find((o) => ordered.has(o.sku));
  const options = all;
  async function showMore() {
    setLoadingMore(true);
    const allowance = Math.max(0, ...p.options.filter((o) => o.route === "otc_allowance").map((o) => o.plan_pays_usd));
    const r = await fetch(`/api/options?exclude=${encodeURIComponent(p.options.map((o) => o.sku).join(","))}&allowance=${allowance}`);
    setMore(await r.json());
    setLoadingMore(false);
  }
  return (
    <div className="space-y-3">
      <div className="text-lg font-bold">{chosen ? "You chose:" : `Pick one${options.length > 1 ? ` of ${options.length}` : ""}:`}</div>
      {!chosen && <RatingKey />}
      {options.filter((o) => !chosen || o.sku === chosen.sku).map((o) => {
        const pick = o.sku === p.recommended_sku;
        return (
          <Card key={o.sku} className={pick && !chosen ? "border-2 border-brand" : ""}>
            <div className="flex gap-4">
              <ProductImage sku={o.sku} style={o.style} size={104} />
              <div className="min-w-0">
                <div className="flex flex-wrap gap-2">
                  {pick && <Pill tone="brand">★ Kin&apos;s pick</Pill>}
                  <Pill>{o.label}</Pill>
                </div>
                <h3 className="mt-2 text-xl font-bold leading-tight">{o.name}</h3>
                <p className="mt-1 text-lg">{o.reason}</p>
                {o.tradeoff && <p className="mt-1 text-base text-caution">⚠ {o.tradeoff}</p>}
              </div>
            </div>
            <Ratings o={o} />
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-2xl font-bold text-good">You pay {usd(o.family_pays_usd)}</div>
                <div className="text-base text-muted">
                  {o.plan_pays_usd > 0 ? `Aetna pays back ${usd(o.plan_pays_usd)} · ` : ""}{o.return_window_days} days to return · FDA hearing aid ✓
                </div>
              </div>
              {chosen ? (
                <Pill tone="good">✓ Approved and ordered</Pill>
              ) : (
                <Button kind={pick ? "primary" : "secondary"} disabled={busy} onClick={() => onBuy(o)}>{buyLabel}</Button>
              )}
            </div>
          </Card>
        );
      })}
      {!chosen && !more && (
        <Button kind="secondary" className="w-full" disabled={loadingMore} onClick={showMore}>
          {loadingMore ? "Finding more…" : "Show more options"}
        </Button>
      )}
      {!chosen && more && (
        <p className="text-base text-muted">
          {more.options.length ? `Showing ${more.options.length} more.` : "No other hearing aids to show."}
          {more.hidden_not_fda > 0 && ` ${more.hidden_not_fda} more were left out because they aren't FDA hearing aids.`}
        </p>
      )}
      {!chosen && share && <Button kind="ghost" className="-ml-4" disabled={busy} onClick={share.onClick}>{share.label}</Button>}
      <p className="text-sm text-muted">Nothing is bought until someone taps to approve. Demo store: no real purchase.</p>
    </div>
  );
}

/* Easy-to-scan ratings: a word, a color, and filled dots (never color alone). Computed from real data. */
type Score = { label: string; score: number; why: string };
function scoresFor(o: Option): Score[] {
  const pay = o.family_pays_usd;
  const s: Score[] = [
    { label: "Price for you", score: pay <= 400 ? 5 : pay <= 800 ? 4 : pay <= 1200 ? 3 : pay <= 2000 ? 2 : 1, why: o.plan_pays_usd > 0 ? `${usd(o.price_pair_usd)} before Aetna pays back` : "no plan payback" },
    {
      label: "Fits you",
      score: Math.max(1, 5 - (o.behind_the_ear ? 3 : 0) - (o.rechargeable === false ? 2 : 0)),
      why: [o.behind_the_ear ? "sits behind the ear" : "in the ear", o.rechargeable === false ? "tiny batteries" : "rechargeable"].join(", "),
    },
    {
      label: "Easy to use",
      score: Math.min(5, 2 + (o.rechargeable ? 2 : 0) + (o.self_fitting_app ? 1 : 0)),
      why: [o.rechargeable ? "charges in a case" : "change batteries", o.self_fitting_app ? "app sets it up" : "needs a fitting"].join(", "),
    },
    {
      label: "Time to return",
      score: o.return_window_days >= 90 ? 5 : o.return_window_days >= 45 ? 4 : o.return_window_days >= 30 ? 3 : 2,
      why: `${o.return_window_days} days`,
    },
  ];
  if (typeof o.rating === "number") s.push({ label: "Reviews", score: Math.round(o.rating), why: `${o.rating.toFixed(1)} of 5 stars` });
  return s;
}

const WORD = ["", "Poor", "Fair", "OK", "Good", "Great"];
function Ratings({ o }: { o: Option }) {
  return (
    <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {scoresFor(o).map((r) => {
        const color = r.score >= 4 ? "bg-good" : r.score === 3 ? "bg-caution" : "bg-urgent";
        const text = r.score >= 4 ? "text-good" : r.score === 3 ? "text-caution" : "text-urgent";
        return (
          <div key={r.label}>
            <dt className="flex items-baseline justify-between gap-2">
              <span className="font-bold">{r.label}</span>
              <span className={`font-bold ${text}`}>{WORD[r.score]}</span>
            </dt>
            <dd>
              <span className="mt-1 flex gap-1" role="img" aria-label={`${r.label}: ${r.score} out of 5, ${WORD[r.score]}`}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className={`h-2.5 flex-1 rounded-full ${i <= r.score ? color : "bg-line"}`} />
                ))}
              </span>
              <span className="text-sm text-muted">{r.why}</span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function RatingKey() {
  return (
    <p className="text-base text-muted">
      More filled bars is better. <span className="font-bold text-good">Great/Good</span> ·{" "}
      <span className="font-bold text-caution">OK</span> · <span className="font-bold text-urgent">Fair/Poor</span>
    </p>
  );
}

function ActionCards({ events }: { events?: AuditEvent[] }) {
  const ends = events?.filter((e): e is ToolEnd => e.kind === "tool_end" && e.ok && (e.tool === "start_return" || e.tool === "prepare_reimbursement_claim")) ?? [];
  return (
    <>
      {ends.map((e) => {
        const o = e.output as any;
        return e.tool === "start_return" ? (
          <Card key={e.id} className="mt-4">
            <div className="flex flex-wrap gap-2"><Pill tone="good">✓ Return started</Pill><Pill tone="caution">Demo</Pill></div>
            <h3 className="mt-2 text-2xl font-bold">{o.item}</h3>
            <div className="mt-2 text-3xl font-bold text-good">{usd(o.refund_usd)} back</div>
            <p className="mt-2 text-lg">Drop it off by <b className="text-urgent">{niceDate(o.return_by)}</b>. {o.drop_off}</p>
            <p className="mt-1 text-base text-muted">Return number {o.return_id} · refund in {o.refund_timing}</p>
          </Card>
        ) : (
          <Card key={e.id} className="mt-4">
            <div className="flex flex-wrap gap-2"><Pill tone="good">Claim form filled in</Pill><Pill tone="caution">Demo · not sent</Pill></div>
            <h3 className="mt-2 text-2xl font-bold">Get {usd(o.claim_amount_usd)} back from Aetna</h3>
            <p className="mt-1 text-lg">{o.form} for {o.member}. Receipt attached. Send it by <b className="text-urgent">{niceDate(o.submit_by)}</b>.</p>
            <p className="mt-1 text-base text-muted">Draft {o.claim_id}</p>
          </Card>
        );
      })}
    </>
  );
}

function orderInRun(events?: AuditEvent[]) {
  return events?.find((e): e is ToolEnd => e.kind === "tool_end" && e.tool === "place_order" && e.ok)?.output as Order | undefined;
}

/* ---------------- Activity panel ---------------- */

function ActivityPanel({
  panel, setPanel, runs, reminders, sources, onOpenSource, config, running, notified, onNotify,
}: {
  notified: string[]; onNotify: (key: string) => void;
  panel: { tab: "steps" | "reminders"; runId?: string };
  setPanel: (p: { tab: "steps" | "reminders"; runId?: string } | null) => void;
  runs: Record<string, AuditEvent[]>; reminders: Reminder[]; sources: Map<string, Source>;
  onOpenSource: (s: Source) => void; config?: Config; running: string | null;
}) {
  const runIds = Object.keys(runs);
  const runId = panel.runId ?? running ?? runIds[runIds.length - 1];
  const events = runId ? runs[runId] ?? [] : [];
  const ended = new Map(events.filter((e): e is ToolEnd => e.kind === "tool_end").map((e) => [e.id, e]));
  const done = events.find((e) => e.kind === "done");

  return (
    <aside className="fixed inset-0 z-40 flex flex-col bg-white lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-[400px] lg:shrink-0 lg:border-l lg:border-line">
      <div className="flex items-center justify-between border-b border-line p-4">
        <div>
          <h2 className="text-2xl font-bold">Activity</h2>
          <p className="text-base text-muted">What Kin did, step by step</p>
        </div>
        <Button kind="ghost" onClick={() => setPanel(null)}>Close</Button>
      </div>
      <div className="flex gap-2 px-4 pt-3">
        {(["steps", "reminders"] as const).map((t) => (
          <button key={t} onClick={() => setPanel({ ...panel, tab: t })}
            className={`rounded-full px-4 py-2 font-bold ${panel.tab === t ? "bg-ink text-white" : "bg-soft"}`}>
            {t === "steps" ? "Steps" : `Reminders${reminders.length ? ` (${reminders.length})` : ""}`}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {panel.tab === "steps" && (
          <>
            {!events.length && <p className="text-lg text-muted">When Kin works on something, every lookup, source and action shows up here.</p>}
            <ol className="space-y-4">
              {events.map((e) => {
                if (e.kind === "note") return <li key={e.id} className="border-l-4 border-brand-bg pl-3 text-base italic text-muted">{e.text}</li>;
                if (e.kind === "error") return <li key={e.id} className="rounded-xl bg-urgent-bg p-3 text-urgent">{e.message}</li>;
                if (e.kind !== "tool_start") return null;
                const end = ended.get(e.id);
                return (
                  <li key={e.id} className="flex gap-3">
                    <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${!end ? "animate-pulse bg-line" : end.ok ? "bg-good-bg text-good" : "bg-urgent-bg text-urgent"}`}>
                      {end ? (end.ok ? "✓" : "!") : e.step}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-lg font-bold leading-snug">{e.label}</div>
                      <div className="text-base text-muted">{summarize(e.tool, e.input, end?.output)}</div>
                      {end && end.sources.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {end.sources.slice(0, 4).map((s) => <SourceChip key={s.content_id} id={s.content_id} sources={sources} onOpen={onOpenSource} />)}
                        </div>
                      )}
                      <details className="mt-1 text-sm text-muted">
                        <summary className="cursor-pointer">Details</summary>
                        <pre className="mt-1 max-h-60 overflow-auto rounded-lg bg-soft p-2 text-xs">{JSON.stringify({ input: e.input, output: end?.output }, null, 2)}</pre>
                      </details>
                    </div>
                  </li>
                );
              })}
            </ol>
            {done && done.kind === "done" && (
              <div className="mt-6 flex items-center justify-between border-t border-line pt-4 text-base text-muted">
                <span>{done.steps} steps · {(done.ms / 1000).toFixed(0)}s</span>
                <Button kind="secondary" onClick={() => download("kin-activity.json", JSON.stringify(events, null, 2), "application/json")}>Save record</Button>
              </div>
            )}
          </>
        )}

        {panel.tab === "reminders" && (
          <ul className="space-y-3">
            {!reminders.length && <p className="text-lg text-muted">No reminders yet.</p>}
            {reminders.map((r, i) => (
              <li key={i} className="rounded-xl border border-line p-4">
                <Pill tone={/return/i.test(r.title) ? "urgent" : /claim|reimburse/i.test(r.title) ? "good" : "brand"}>{niceDate(r.date)}</Pill>
                <div className="mt-2 text-lg font-bold">{r.title}</div>
                <div className="text-base text-muted">{r.details}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <Button kind="ghost" className="-ml-4" onClick={() => download(`kin-${r.date}.ics`, ics(r), "text/calendar")}>Add to my calendar</Button>
                  {notified.includes(`${r.date}|${r.title}`) ? (
                    <span role="status" className="font-bold text-good">✓ We&apos;ll remind you {niceDate(r.date)} (demo)</span>
                  ) : (
                    <Button kind="ghost" onClick={() => onNotify(`${r.date}|${r.title}`)}>Notify me</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {config && (
        <div className="border-t border-line p-4 text-sm text-muted">
          <div className="font-bold text-ink">Powered by</div>
          <div>Trusted context: {config.context === "senso" ? "Senso ✓" : "local fallback"}</div>
          <div>Identity: {config.identity === "persona" ? "Persona ✓" : "simulated"}</div>
          <div>Analytics: {config.analytics === "amplitude" ? "Amplitude ✓" : "off"}</div>
        </div>
      )}
    </aside>
  );
}

function summarize(tool: string, input: any, output: any): string {
  switch (tool) {
    case "search_trusted_context": return `“${input?.query}”`;
    case "search_email": return output?.error ?? `“${input?.query}” · ${output?.length ?? 0} emails`;
    case "search_products": return output ? `${output.length} found` : "Searching…";
    case "check_fda_status": return output?.verdict ? `${output.sku}: ${output.verdict === "ok" ? "real hearing aid" : output.verdict === "caution" ? "not confirmed, avoid" : "not a hearing aid"}` : input?.sku;
    case "calculate_cost": return output?.family_pays_usd != null ? `You'd pay ${usd(output.family_pays_usd)}` : output?.error ?? "";
    case "place_order": return output?.order_id ? `${output.order_id} · return by ${output.return_by}` : output?.error ?? "";
    case "propose_purchase": return output?.options ? `${output.options.length} options · waiting for a choice` : output?.error ?? "";
    case "start_return": return output?.return_id ? `${output.return_id} · ${usd(output.refund_usd)} back` : output?.error ?? "";
    case "prepare_reimbursement_claim": return output?.claim_id ? `${usd(output.claim_amount_usd)} claim ready · send by ${output.submit_by}` : output?.error ?? "";
    case "schedule_reminder": return `${input?.date} · ${input?.title}`;
    case "brief_caregiver": return input?.headline ?? "";
    default: return "";
  }
}

function InviteModal({ onClose, onInvite }: { onClose: () => void; onInvite: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-2xl font-bold">Invite family</h2>
        <p className="mt-1 text-lg text-muted">They&apos;ll join a chat with you and Kin.</p>
        <label className="mt-5 block font-bold">Name</label>
        <input readOnly value={DEMO_CAREGIVER.name} className="mt-1 w-full rounded-xl border border-line px-4 py-3 text-lg" />
        <label className="mt-3 block font-bold">Email</label>
        <input readOnly value={DEMO_CAREGIVER.email} className="mt-1 w-full rounded-xl border border-line px-4 py-3 text-lg" />
        <label className="mt-3 block font-bold">They are your</label>
        <input readOnly value={DEMO_CAREGIVER.relation} className="mt-1 w-full rounded-xl border border-line px-4 py-3 text-lg" />
        <div className="mt-6 flex gap-3">
          <Button onClick={onInvite} className="flex-1">Send invite</Button>
          <Button kind="secondary" onClick={onClose}>Cancel</Button>
        </div>
        <p className="mt-3 text-sm text-muted">Demo: no email is sent.</p>
      </div>
    </div>
  );
}
