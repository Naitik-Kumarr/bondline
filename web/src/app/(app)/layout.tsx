import { Providers } from "@/app/providers";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { WalletButton } from "@/components/web3/WalletButton";

/**
 * App routes: put every page that reads the chain or talks to a wallet in this folder, e.g.
 * src/app/(app)/market/page.tsx → /market. The route group doesn't change URLs; it wraps pages in
 * wagmi + TanStack Query + RainbowKit, so hooks like useAccount() and <NetworkGuard> work.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div aria-hidden="true" className="glow-hero pointer-events-none absolute inset-x-0 top-0 -z-10 h-[40rem] opacity-70" />
      <SiteHeader wallet={<WalletButton />} />
      <main id="main" className="min-h-[60vh]">
        {children}
      </main>
      <SiteFooter />
    </Providers>
  );
}
