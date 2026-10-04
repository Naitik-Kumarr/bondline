import { isAddress, getAddress } from "viem";
import { readBadgeStatus } from "@/lib/badge";
import { renderBadge } from "@/lib/badge-svg";

// An embeddable SVG: /badge/0x…  (a trailing .svg is fine). Read on every request; the edge caches an answer for a
// minute through Cache-Control, and never caches "unavailable" (the RPC was unreachable).
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ account: string }> }) {
  const { account } = await params;
  const raw = account.replace(/\.svg$/i, "");
  const headers = { "Content-Type": "image/svg+xml; charset=utf-8", "Access-Control-Allow-Origin": "*" };
  if (!isAddress(raw, { strict: false })) {
    return new Response(renderBadge({ state: "none", source: null, limitBps: null, capBps: null, market: null }), {
      status: 404,
      headers: { ...headers, "Cache-Control": "public, max-age=300" },
    });
  }
  const status = await readBadgeStatus(getAddress(raw));
  return new Response(renderBadge(status), {
    headers: {
      ...headers,
      "Cache-Control": status.state === "unavailable" ? "no-store" : "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
