import { BuiltForAgents } from "@/components/landing/BuiltForAgents";
import { ClosingCta } from "@/components/landing/ClosingCta";
import { Differentiators } from "@/components/landing/Differentiators";
import { Hero } from "@/components/landing/Hero";
import { NewsStrip } from "@/components/landing/NewsStrip";
import { Sides } from "@/components/landing/Sides";
import { TheLine } from "@/components/landing/TheLine";
import { UsdgLine } from "@/components/landing/UsdgLine";

// The proof strip reads the chain; regenerate at most every minute.
export const revalidate = 60;

export default function LandingPage() {
  return (
    <>
      <Hero />
      <TheLine />
      <Differentiators />
      <UsdgLine />
      <NewsStrip />
      <Sides />
      <BuiltForAgents />
      <ClosingCta />
    </>
  );
}
