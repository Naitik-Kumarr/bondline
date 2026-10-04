// Fallback for the Verify button when a browser can't reach the RPC itself: relays one transaction's raw input and
// the account's event topics. The browser still decodes and hashes them. Transactions never change, so it caches.
import { NextResponse } from "next/server";
import { isAddress, isHash } from "viem";
import { publicClient } from "@/lib/bondline/book";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tx = params.get("tx") ?? "";
  const account = params.get("account") ?? "";
  if (!isHash(tx) || !isAddress(account, { strict: false })) {
    return NextResponse.json({ error: "tx must be a transaction hash and account an address" }, { status: 400 });
  }
  try {
    const [t, receipt] = await Promise.all([
      publicClient.getTransaction({ hash: tx }),
      publicClient.getTransactionReceipt({ hash: tx }),
    ]);
    const logs = receipt.logs
      .filter((l) => l.address.toLowerCase() === account.toLowerCase())
      .map((l) => ({ address: l.address, topics: l.topics }));
    return NextResponse.json(
      { input: t.input, logs },
      { headers: { "cache-control": "public, max-age=3600, s-maxage=86400" } },
    );
  } catch {
    return NextResponse.json({ error: "couldn't read that transaction from the chain" }, { status: 502 });
  }
}
