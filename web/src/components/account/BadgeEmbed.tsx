"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";

/** The "Insured by Bondline" badge for this account, with HTML and Markdown snippets to paste into a README or site. */
export function BadgeEmbed({ account }: { account: string }) {
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  const base = origin ?? "https://YOUR-BONDLINE-SITE";
  const src = `${base}/badge/${account}`;
  const html = `<a href="${base}/account/${account}"><img src="${src}" alt="Insured by Bondline" width="272" height="60"></a>`;
  const md = `[![Insured by Bondline](${src})](${base}/account/${account})`;
  return (
    <Card>
      <h2 className="text-[17px] font-medium tracking-[-0.01em] text-ink">Insured by Bondline badge</h2>
      <p className="mt-1 text-[13px] text-ink-3">
        An SVG that reads this account&apos;s cover from the chain each time it loads: covered, claim paid, or not covered.
        Testnet.
      </p>
      <div className="mt-4 flex min-h-[60px] items-center rounded-card bg-sunken p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- a small SVG that reads the chain; next/image would cache it */}
        <img src={`/badge/${account}`} alt="Insured by Bondline badge for this account" width={272} height={60} className="h-[60px] w-[272px] max-w-full" />
      </div>
      {(
        [
          ["HTML", html],
          ["Markdown", md],
        ] as const
      ).map(([label, text]) => (
        <div key={label} className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12.5px] text-ink-3">{label}</span>
            <CopyButton value={text} label={`Copy ${label} snippet`} />
          </div>
          <pre className="num mt-1.5 overflow-x-auto whitespace-pre-wrap break-all rounded-field bg-sunken px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-2">
            <code>{text}</code>
          </pre>
        </div>
      ))}
    </Card>
  );
}
