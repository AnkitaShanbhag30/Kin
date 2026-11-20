import { DEMO_CAREGIVER, DEMO_USER } from "@/lib/demo";

export type Identity =
  | { provider: "persona"; inquiryId: string; status: string; environment: string }
  | { provider: "simulated"; status: "simulated" };

export type Session = {
  step: "welcome" | "identity" | "connect" | "done";
  user: typeof DEMO_USER;
  identity?: Identity;
  gmail: boolean;
  caregiver: (typeof DEMO_CAREGIVER & { joined: boolean }) | null;
  // Delivery email ids Ruth confirmed she is keeping; saved so those cards stay gone after a reload.
  kept?: string[];
  // Reminders Ruth tapped "Notify me" on (demo only; keyed by date|title).
  notify?: string[];
};

export type Config = { context: string; identity: string; personaHostedFlow: boolean; analytics: string };

export const SESSION_KEY = "kin.session.v2";
export const newSession = (): Session => ({ step: "welcome", user: DEMO_USER, gmail: false, caregiver: null });
