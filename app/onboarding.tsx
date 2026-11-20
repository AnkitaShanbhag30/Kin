"use client";

import { useEffect, useState } from "react";
import type { Config, Session } from "./session";
import { Button, Card, KinAvatar, Pill } from "./ui";

type InquiryStatus = { inquiry_id: string; status: string; verified: boolean; environment: string } | { error: string };

export function Onboarding({ session, update, config }: { session: Session; update: (s: Partial<Session>) => void; config?: Config }) {
  const steps = ["welcome", "identity", "connect"] as const;
  const idx = steps.indexOf(session.step as (typeof steps)[number]);
  return (
    <div className="min-h-screen bg-soft">
      <div className="mx-auto flex max-w-xl flex-col px-4 py-10">
        <div className="mb-8 flex items-center gap-3">
          <KinAvatar size={44} />
          <span className="text-2xl font-bold">Kin</span>
        </div>
        <ol className="mb-6 flex gap-2" aria-label="Setup progress">
          {["Sign in", "Confirm it's you", "Connect"].map((label, i) => (
            <li key={label} className={`flex-1 rounded-full py-1.5 text-center text-sm font-bold ${i <= idx ? "bg-ink text-white" : "bg-white text-muted"}`}>
              {i + 1}. {label}
            </li>
          ))}
        </ol>
        {session.step === "welcome" && <Welcome session={session} onNext={() => update({ step: "identity" })} />}
        {session.step === "identity" && <IdentityStep session={session} update={update} config={config} />}
        {session.step === "connect" && <ConnectStep session={session} update={update} />}
      </div>
    </div>
  );
}

function Welcome({ session, onNext }: { session: Session; onNext: () => void }) {
  return (
    <Card className="p-8">
      <h1 className="text-3xl font-bold leading-tight">Help buying health things, with your family in the loop.</h1>
      <p className="mt-3 text-lg text-muted">Kin checks your insurance, finds what suits you, buys it, and keeps track of returns.</p>
      <label className="mt-8 block text-base font-bold" htmlFor="email">Email</label>
      <input id="email" readOnly value={session.user.email} className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-lg" />
      <Button className="mt-6 w-full" onClick={onNext}>Sign in as {session.user.firstName}</Button>
      <p className="mt-3 text-center text-sm text-muted">Demo sign-in. No password is collected.</p>
    </Card>
  );
}

function IdentityStep({ session, update, config }: { session: Session; update: (s: Partial<Session>) => void; config?: Config }) {
  const [status, setStatus] = useState<InquiryStatus>();
  const [draft, setDraft] = useState("");

  const check = (id: string) =>
    fetch(`/api/persona/status?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((s: InquiryStatus) => {
        setStatus(s);
        if (!("error" in s) && s.verified)
          update({ identity: { provider: "persona", inquiryId: s.inquiry_id, status: s.status, environment: s.environment } });
      });

  // Persona's hosted flow redirects back here with ?inquiry-id=...; confirm it server-side.
  useEffect(() => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("inquiry-id");
    if (id) {
      window.history.replaceState(null, "", url.pathname);
      check(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verified = session.identity;
  return (
    <Card className="p-8">
      <h1 className="text-3xl font-bold">Confirm it&apos;s you</h1>
      <p className="mt-3 text-lg text-muted">
        Kin can spend money for you, so we check your identity once with Persona. Kin checks it again before every purchase.
      </p>

      {verified ? (
        <div className="mt-6 rounded-xl bg-good-bg p-4 text-lg text-good">
          <b>✓ Identity confirmed</b>
          <div className="text-base">
            {verified.provider === "persona"
              ? `Persona ${verified.environment === "sandbox" ? "sandbox " : ""}inquiry ${verified.inquiryId} · ${verified.status}`
              : "Simulated for this demo (Persona keys not set)"}
          </div>
        </div>
      ) : config?.personaHostedFlow ? (
        <>
          <Button href="/api/persona/start" className="mt-6 w-full">Verify with Persona</Button>
          {status && "error" in status && <p className="mt-3 text-urgent">{status.error}</p>}
          {status && !("error" in status) && !status.verified && (
            <p className="mt-3 text-caution">Persona says: {status.status}. Please try again.</p>
          )}
          <details className="mt-4 text-base text-muted">
            <summary className="cursor-pointer">Didn&apos;t come back here? Paste your inquiry ID</summary>
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) check(draft.trim()); }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="inq_..." className="flex-1 rounded-xl border border-line px-3 py-2 font-mono" />
              <Button type="submit" kind="secondary">Check</Button>
            </form>
          </details>
        </>
      ) : (
        <>
          <Button className="mt-6 w-full" onClick={() => update({ identity: { provider: "simulated", status: "simulated" } })}>
            Simulate Persona check
          </Button>
          <p className="mt-3 text-center text-sm text-muted">Persona keys aren&apos;t set on this demo, so this step is simulated.</p>
        </>
      )}

      <Button className="mt-6 w-full" kind={verified ? "primary" : "secondary"} disabled={!verified} onClick={() => update({ step: "connect" })}>
        Continue
      </Button>
    </Card>
  );
}

function ConnectStep({ session, update }: { session: Session; update: (s: Partial<Session>) => void }) {
  return (
    <Card className="p-8">
      <h1 className="text-3xl font-bold">Connect your accounts</h1>
      <p className="mt-3 text-lg text-muted">So Kin knows what your plan covers, and can watch for deliveries and return dates.</p>

      <div className="mt-6 space-y-3">
        <Row title="Insurance plan" detail={session.user.plan} right={<Pill tone="good">✓ Added</Pill>} />
        <Row
          title="Gmail"
          detail="Reads order, delivery and medical emails only"
          right={
            session.gmail ? (
              <Pill tone="good">✓ Connected</Pill>
            ) : (
              <Button kind="secondary" onClick={() => update({ gmail: true })}>Connect</Button>
            )
          }
        />
      </div>
      <p className="mt-3 text-sm text-muted">Demo: Gmail uses a sample inbox. Real Gmail access needs Google&apos;s security review.</p>

      <Button className="mt-8 w-full" onClick={() => update({ step: "done" })}>Open Kin</Button>
    </Card>
  );
}

function Row({ title, detail, right }: { title: string; detail: string; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line p-4">
      <div>
        <div className="text-lg font-bold">{title}</div>
        <div className="text-base text-muted">{detail}</div>
      </div>
      {right}
    </div>
  );
}
