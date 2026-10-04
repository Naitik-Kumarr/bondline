import type { BadgeStatus } from "@/lib/badge";

// The badge SVG: system fonts only, no external requests, so it renders anywhere it is embedded.
const pct = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

const SANS = "Geist, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function lines(s: BadgeStatus): { title: string; sub: string; dot: string } {
  const net = "testnet";
  switch (s.state) {
    case "covered":
      return {
        title: "Insured by Bondline",
        sub: `${s.limitBps != null ? `limit ${pct(s.limitBps)}` : "covered"}${s.capBps != null ? ` · to −${pct(s.capBps)}` : ""} · ${net}`,
        dot: "#2c7655",
      };
    case "settled":
      return { title: "Bondline claim paid", sub: `cover settled · ${net}`, dot: "#e7875a" };
    case "closed":
      return { title: "Bondline cover closed", sub: `no longer in force · ${net}`, dot: "#a8a49c" };
    case "unavailable":
      return { title: "Bondline: unavailable", sub: "chain not readable just now", dot: "#a8a49c" };
    default:
      return { title: "Not insured by Bondline", sub: "no cover on this account", dot: "#a8a49c" };
  }
}

export function renderBadge(s: BadgeStatus): string {
  const { title, sub, dot } = lines(s);
  const label = `${title}. ${sub}${s.market === "replay" ? " (replay market)" : ""}.`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="272" height="60" viewBox="0 0 272 60" role="img" aria-label="${label}">
<title>${label}</title>
<rect x="0.5" y="0.5" width="271" height="59" rx="16" fill="#faf8f4" stroke="#1f1f1f" stroke-opacity="0.14"/>
<g transform="translate(14 14)">
<rect width="32" height="32" rx="9" fill="#1f1f1f"/>
<path d="M18.1 16.2h7.9v6.1h-7.9z" fill="#f2a37a"/>
<path d="M6 16.2h20" stroke="#a9aef6" stroke-width="1.7" stroke-dasharray="2.5 2.1"/>
<path d="M6 10.1 9.9 11.9l3-1.2 4.1 3.1 1.1 8.6h7.9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<circle cx="62" cy="23" r="3.5" fill="${dot}"/>
<text x="72" y="27" font-family="${SANS}" font-size="14.5" font-weight="600" fill="#1f1f1f">${title}</text>
<text x="62" y="44" font-family="${MONO}" font-size="10" fill="#57554f">${sub}</text>
</svg>`;
}

