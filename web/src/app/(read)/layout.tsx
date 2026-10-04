import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { buttonClasses } from "@/components/ui/Button";
import { LazyWalletButton } from "@/components/web3/LazyWalletButton";

/**
 * Read-only pages that read the chain on the server (/market, /agent/[address], /judge). No wallet providers here:
 * like the landing page, the Connect button loads wagmi and RainbowKit only when someone reaches for it, so these
 * pages stay light on phones. The route group doesn't change URLs.
 */
export default function ReadLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div aria-hidden="true" className="glow-hero pointer-events-none absolute inset-x-0 top-0 -z-10 h-[40rem] opacity-70" />
      <SiteHeader wallet={<LazyWalletButton buttonClassName={buttonClasses({ size: "sm" })} />} />
      <main id="main" className="min-h-[60vh]">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
