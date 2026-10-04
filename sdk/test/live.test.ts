// Read-only checks against the real Robinhood Chain testnet deployment. Needs network; sends nothing.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PRICING_VECTORS, deployment } from "@bondline/shared";
import { Bondline, testnetConfig } from "../src/index.ts";

const sdk = new Bondline(testnetConfig({ rpcUrl: process.env.BONDLINE_RPC_URL }));

describe("live testnet reads", () => {
  it("lists the deployed offers with consistent bond arithmetic", async () => {
    const offers = await sdk.listOffers();
    assert.ok(offers.length >= 2, "the team's Careful and Bold offers");
    for (const o of offers) {
      assert.equal(o.bond - o.reserved, o.free, `${o.market} #${o.id}`);
      assert.ok(o.terms.maxLimitBps < 3000);
    }
    const careful = offers.filter((o) => o.agent.toLowerCase() === deployment.wallets.careful.toLowerCase());
    assert.ok(careful.length >= 1);
    assert.equal(careful[0].underwriterIsTeam, true);
  });

  it("quotes a cover, and its reference price is the published vector for Careful's rules", async () => {
    const offers = await sdk.listOffers({ agent: deployment.wallets.careful as `0x${string}` });
    const o = offers[0];
    const v = PRICING_VECTORS.find((x) => x.name.startsWith("Careful's rules"))!;
    const q = await sdk.quoteCover({ market: o.market, offerId: o.id, amount: "10", limitBps: v.limitBps });
    assert.equal(q.premium, (10_000_000n * BigInt(o.terms.feeBps)) / 10_000n);
    assert.equal(q.principal, 10_000_000n - q.premium);
    assert.equal(q.capacityAllows, q.reservationNeeded <= q.free + q.premium);
    assert.ok(q.reference && Math.abs(q.reference.worstCase.fairBps - v.fairBps) < 1e-6);
  });

  it("reads each market's assets and the demo exchange", async () => {
    for (const key of ["live", "replay"]) {
      const m = await sdk.getMarket(key);
      assert.deepEqual(m.assets.map((a) => a.symbol), ["TSLA", "AMZN"]);
      assert.equal(m.capBps, 3000);
    }
  });

  it("lists the team's covered accounts, each with a consistent health reading", async () => {
    const accounts = await sdk.listAccounts({ agent: deployment.wallets.bold as `0x${string}` });
    assert.ok(accounts.length >= 1);
    for (const a of accounts) assert.ok(a.principal >= 0n && a.limit <= a.principal);
  });
});
