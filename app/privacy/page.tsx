import { PrivacyPolicy } from "@/components/PrivacyPolicy";

// Public copy, linked from /login. Someone deciding whether to hand over a video
// has to be able to read this BEFORE they have an account, so AppShell's
// PUBLIC_PATHS lets this route through the auth gate.
export default function PublicPrivacyPage() {
  return <PrivacyPolicy backHref="/login" />;
}
