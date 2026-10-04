import { ButtonLink } from "@/components/ui/Button";
import { ArrowRightIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

/** The way into /tour, at the top of the landing page and the judge kit: deep periwinkle, so it reads first. */
export function TourButton({ className }: { className?: string }) {
  return (
    <ButtonLink
      href="/tour"
      size="lg"
      iconRight={<ArrowRightIcon size={16} />}
      className={cn("bg-accent-ink text-white shadow-pill before:bg-white/12", className)}
    >
      Start the 2 minute tour
    </ButtonLink>
  );
}
