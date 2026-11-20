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
};

export type Config = { context: string; identity: string; personaHostedFlow: boolean; analytics: string };

export const SESSION_KEY = "kin.session.v2";
export const newSession = (): Session => ({ step: "welcome", user: DEMO_USER, gmail: false, caregiver: null });
