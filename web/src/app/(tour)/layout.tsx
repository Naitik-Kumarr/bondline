/**
 * The guided tour (/tour). No wallet, no site navigation and no footer: the tour draws its own header (progress, step
 * count, a way out) and its Back and Next bar, and it reads the chain on the server. The route group doesn't change URLs.
 * data-lenis-prevent: the tour scrolls natively, so a smooth-scroll still in flight can't undo "each step starts at the
 * top" (SmoothScroll skips anything inside it).
 */
export default function TourLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div aria-hidden="true" className="glow-hero pointer-events-none absolute inset-x-0 top-0 -z-10 h-[40rem] opacity-70" />
      <div data-lenis-prevent="">{children}</div>
    </>
  );
}
