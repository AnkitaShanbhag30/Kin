"use client";

import { useCallback, useEffect, useState } from "react";
import { KinApp, type InboxScan } from "./kin-app";
import { Onboarding } from "./onboarding";
import { type Config, newSession, type Session, SESSION_KEY } from "./session";
import { store } from "./ui";

export default function Home() {
  const [session, setSession] = useState<Session>();
  const [config, setConfig] = useState<Config>();
  const [inbox, setInbox] = useState<InboxScan>();

  useEffect(() => {
    const saved = store.get<Session>(SESSION_KEY) ?? newSession();
    // Returning from Persona's hosted flow lands on the identity step.
    if (new URL(window.location.href).searchParams.has("inquiry-id")) saved.step = "identity";
    setSession(saved);
    fetch("/api/config").then((r) => r.json()).then(setConfig, () => {});
  }, []);

  useEffect(() => {
    if (session?.gmail && !inbox) fetch("/api/inbox").then((r) => r.json()).then(setInbox, () => {});
  }, [session?.gmail, inbox]);

  const update = useCallback((patch: Partial<Session>) => {
    setSession((s) => {
      const next = { ...(s ?? newSession()), ...patch };
      store.set(SESSION_KEY, next);
      return next;
    });
  }, []);

  if (!session) return null;
  if (session.step !== "done") return <Onboarding session={session} update={update} config={config} />;
  return (
    <KinApp
      session={session}
      update={update}
      config={config}
      inbox={inbox}
      signOut={() => {
        store.set(SESSION_KEY, undefined);
        setInbox(undefined);
        setSession(newSession());
      }}
    />
  );
}
