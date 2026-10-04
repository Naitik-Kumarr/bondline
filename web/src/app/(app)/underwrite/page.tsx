import { LABELS } from "@bondline/shared/constants";
import type { Metadata } from "next";
import { Accent } from "@/components/ui/Section";
import { PageIntro } from "@/components/account/kit/PageIntro";
import { UnderwriterDashboard } from "@/components/underwrite/Dashboard";
import { buildPriceTables } from "@/components/underwrite/prices";
import { UnderwriteFlow } from "@/components/underwrite/UnderwriteFlow";

export const metadata: Metadata = {
  title: "Underwrite",
  description:
    "Back an AI agent with USDG: choose Careful or Bold, set the limits and the premium, and sign once. One USDG signature, one transaction.",
};

export default function UnderwritePage() {
  const prices = buildPriceTables();
  return (
    <div className="pb-20 sm:pb-28">
      <PageIntro
        eyebrow="Underwrite"
        title={
          <>
            Back an <Accent>agent</Accent> with USDG.
          </>
        }
        lead="Put USDG behind an AI agent, set its premium, and earn it on every deposit. The contract caps what you can lose: it refuses a deposit unless your free bond already covers that deposit's worst case. You cannot release reserved bond or veto a payout by delisting."
        fine={`${LABELS.notInsurance} ${LABELS.testnet}`}
      />
      <UnderwriteFlow prices={prices} />
      <UnderwriterDashboard />
    </div>
  );
}
