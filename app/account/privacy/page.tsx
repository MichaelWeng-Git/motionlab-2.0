import { PrivacyPolicy } from "@/components/PrivacyPolicy";

// Signed-in copy: inside the product shell, back to the profile.
export default function AccountPrivacyPage() {
  return <PrivacyPolicy backHref="/account" />;
}
