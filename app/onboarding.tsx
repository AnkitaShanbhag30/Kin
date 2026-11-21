"use client";

import { useEffect, useState } from "react";
import type { Config, Session } from "./session";
import SilkRiver from "./components/SilkRiver";
import { Button, Card, KinAvatar, Pill } from "./ui";

type InquiryStatus = { inquiry_id: string; status: string; verified: boolean; environment: string } | { error: string };

export function Onboarding({ session, update, config }: { session: Session; update: (s: Partial<Session>) => void; config?: Config }) {
  const steps = ["welcome", "identity", "connect"] as const;
  const idx = steps.indexOf(session.step as (typeof steps)[number]);
  const labels = ["Sign in", "Confirm it's you", "Connect"];
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#fbfaf7]">
      <div className="relative z-[1] grid min-h-screen md:grid-cols-2">
        {/* Left half: flush, edge-to-edge Silk River gradient with the photo floating on it. Top band on phones. */}
        <div className="relative flex items-center justify-center overflow-hidden px-6 py-8 sm:px-10 md:min-h-screen md:px-12 lg:px-16">
          <SilkRiver style={{ position: "absolute", inset: 0, zIndex: 0 }} {...SILK_COLORS} />
          <div className="relative z-[1] h-56 w-full max-w-md overflow-hidden rounded-[2rem] shadow-[0_24px_60px_-28px_rgba(16,24,40,0.4)] sm:h-72 md:h-[min(72vh,640px)]">
            <img
              src="/images/onboarding-hug.jpg"
              alt="An older woman and her granddaughter hugging and laughing outdoors"
              className="h-full w-full object-cover object-[50%_30%]"
            />
          </div>
        </div>

        {/* Right half: logo, progress, and the step card. */}
        <div className="flex w-full items-center justify-center px-4 py-8 sm:px-6 md:px-10 lg:px-16">
        <div className="w-full max-w-lg">
          <div className="mb-6 flex items-center gap-3">
            <KinAvatar size={44} />
            <span className="font-serif text-[28px] font-semibold leading-none tracking-[-0.3px]">Kin</span>
          </div>

          <div className="mb-6" role="group" aria-label="Setup progress">
            <div className="mb-2 flex items-baseline justify-between text-[16px]">
              <span className="font-bold text-on-surface">{labels[idx]}</span>
              <span className="text-on-surface-variant">Step {idx + 1} of {labels.length}</span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-white/70"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={labels.length}
              aria-valuenow={idx + 1}
              aria-valuetext={`Step ${idx + 1} of ${labels.length}: ${labels[idx]}`}
            >
              <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out" style={{ width: `${((idx + 1) / labels.length) * 100}%` }} />
            </div>
            <ol className="mt-2 grid grid-cols-3 gap-2 text-[16px] leading-[1.25] text-on-surface-variant">
              {labels.map((label, i) => (
                <li key={label} className={`${i === 1 ? "text-center" : i === 2 ? "text-right" : ""} ${i <= idx ? "font-bold text-on-surface" : ""}`}>
                  {label}
                </li>
              ))}
            </ol>
          </div>

          {session.step === "welcome" && <Welcome session={session} onNext={() => update({ step: "identity" })} />}
          {session.step === "identity" && <IdentityStep session={session} update={update} config={config} />}
          {session.step === "connect" && <ConnectStep session={session} update={update} />}
        </div>
        </div>
      </div>
    </div>
  );
}

// Light pastel palette for the left-half background; waves still clearly visible (props only; shader untouched).
const SILK_COLORS = { base: "#F8F6F2", soft: "#E1ECF8", main: "#C3DAF2", accent: "#F7DCC6", deep: "#A6C7EC", saturation: 110 };

// Softer, frosted card used by every step.
const STEP_CARD = "rounded-[2rem] border-white/70 bg-white/80 p-6 shadow-[0_24px_60px_-32px_rgba(16,24,40,0.3)] backdrop-blur-xl sm:p-8";

function Welcome({ session, onNext }: { session: Session; onNext: () => void }) {
  return (
    <Card className={STEP_CARD}>
      <h1 className="font-serif text-[28px] font-semibold leading-[1.2] tracking-[-0.3px]">Help buying health things, with your family in the loop.</h1>
      <p className="mt-3 text-lg text-on-surface-variant">Kin checks your insurance, finds what suits you, buys it, and keeps track of returns.</p>
      <label className="mt-8 block text-base font-bold" htmlFor="email">Email</label>
      <input id="email" readOnly value={session.user.email} className="mt-2 w-full rounded-md border border-outline px-4 py-3 text-lg" />
      <Button className="mt-6 w-full" onClick={onNext}>Sign in as {session.user.firstName}</Button>
      <p className="mt-3 text-center text-[16px] text-on-surface-muted">Demo sign-in. No password is collected.</p>
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
    <Card className={STEP_CARD}>
      <h1 className="font-serif text-[28px] font-semibold leading-[1.2] tracking-[-0.3px]">Confirm it&apos;s you</h1>
      <p className="mt-3 text-lg text-on-surface-variant">
        Kin can spend money for you, so we check your identity once with Persona. Kin checks it again before every purchase.
      </p>

      {verified ? (
        <div className="mt-6 rounded-lg bg-success-container p-4 text-lg text-success">
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
          {status && "error" in status && <p className="mt-3 text-error">{status.error}</p>}
          {status && !("error" in status) && !status.verified && (
            <p className="mt-3 text-tertiary">Persona says: {status.status}. Please try again.</p>
          )}
          <details className="mt-4 text-base text-on-surface-variant">
            <summary className="cursor-pointer">Didn&apos;t come back here? Paste your inquiry ID</summary>
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) check(draft.trim()); }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="inq_..." className="flex-1 rounded-md border border-outline px-3 py-2 font-mono" />
              <Button type="submit" kind="secondary">Check</Button>
            </form>
          </details>
        </>
      ) : (
        <>
          <Button className="mt-6 w-full" onClick={() => update({ identity: { provider: "simulated", status: "simulated" } })}>
            Simulate Persona check
          </Button>
          <p className="mt-3 text-center text-[16px] text-on-surface-muted">Persona keys aren&apos;t set on this demo, so this step is simulated.</p>
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
    <Card className={STEP_CARD}>
      <h1 className="font-serif text-[28px] font-semibold leading-[1.2] tracking-[-0.3px]">Connect your accounts</h1>
      <p className="mt-3 text-lg text-on-surface-variant">So Kin knows what your plan covers, and can watch for deliveries and return dates.</p>

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
      <p className="mt-3 text-[16px] text-on-surface-muted">Demo: Gmail uses a sample inbox. Real Gmail access needs Google&apos;s security review.</p>

      <Button className="mt-8 w-full" onClick={() => update({ step: "done" })}>Open Kin</Button>
    </Card>
  );
}

function Row({ title, detail, right }: { title: string; detail: string; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant p-4">
      <div>
        <div className="text-lg font-bold">{title}</div>
        <div className="text-base text-on-surface-variant">{detail}</div>
      </div>
      {right}
    </div>
  );
}
