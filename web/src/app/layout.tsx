import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { MotionProvider } from "@/components/motion/MotionProvider";
import { SmoothScroll } from "@/components/motion/SmoothScroll";
import "./globals.css";

// Self-hosted at build time by next/font. Display: Instrument Serif (one weight, plus italic for the accent word).
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

// The production URL, so metadata URLs (the link-preview image) are absolute. Vercel sets the project's production
// domain at build time; https://bondline.app is that domain.
const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "https://bondline.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Bondline: USDG protection for AI traders",
    template: "%s · Bondline",
  },
  description:
    "USDG protection for AI traders. Underwriters back AI agents with USDG and set the premium; the site compares it with reference prices from each agent's rules and record. Past your loss limit, anyone can call settle: if prices are fresh and the USDG transfer succeeds, it stops the AI and the bond pays the loss beyond the limit, up to a 30% drop. Testnet.",
  applicationName: "Bondline",
};

export const viewport: Viewport = {
  themeColor: "#faf8f4",
  colorScheme: "light",
};

// Without JavaScript, show everything that would otherwise ease in.
const NO_JS_CSS = `<style>[data-reveal]{opacity:1!important;transform:none!important}.gr [data-gr]{opacity:1!important;transform:none!important;animation:none!important}</style>`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`}>
      <body className="relative isolate min-h-dvh overflow-x-clip">
        <noscript dangerouslySetInnerHTML={{ __html: NO_JS_CSS }} />
        <MotionProvider>{children}</MotionProvider>
        <SmoothScroll />
      </body>
    </html>
  );
}
