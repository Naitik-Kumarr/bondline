import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { buttonClasses } from "@/components/ui/Button";
import { LazyWalletButton } from "@/components/web3/LazyWalletButton";

/**
 * Marketing routes (the landing page). No wallet providers here: the Connect button loads them on demand,
 * which keeps the first load small (Lighthouse mobile ≥ 90).
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader wallet={<LazyWalletButton buttonClassName={buttonClasses({ size: "sm" })} />} />
      <main id="main">{children}</main>
      <SiteFooter />
    </>
  );
}
