// npx tsx --test web/src/lib/drip/route.test.ts
// Runs the real /api/drip handler. No wallet key is set and fetch throws, so no request can sign or reach an RPC:
// every case must be answered by the checks that run before any wallet or RPC work.
import { test } from "node:test";
import assert from "node:assert/strict";

delete process.env.DRIP_PRIVATE_KEY;
let rpcCalls = 0;
globalThis.fetch = async () => {
  rpcCalls++;
  throw new Error("no network in this test");
};

const ADDRESS = "0x00000000000000000000000000000000000000a1";

function post(body: string, ip = "198.51.100.9") {
  return new Request("http://localhost/api/drip", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body,
  });
}

test("any body that isn't an object with a string address gets 400 (W4)", async () => {
  const { POST } = await import("../../app/api/drip/route");
  const bodies = ["null", "[]", '[{"address":"' + ADDRESS + '"}]', "5", '"' + ADDRESS + '"', "true", "{}", '{"address":5}', '{"address":null}', '{"address":"http://127.0.0.1"}', '{"address":"0x12"}', "{not json", ""];
  for (const body of bodies) {
    const res = await POST(post(body));
    assert.equal(res.status, 400, `body ${body}`);
    const json = (await res.json()) as { ok: boolean; error: string };
    assert.equal(json.ok, false);
  }
  assert.equal(rpcCalls, 0);
});

test("one IP gets a few attempts a day, then 429 before any RPC work (S-2)", async () => {
  const { POST } = await import("../../app/api/drip/route");
  const ip = "203.0.113.50";
  for (let i = 0; i < 5; i++) {
    const res = await POST(post(JSON.stringify({ address: `0x${(0xb0 + i).toString(16).padStart(40, "0")}` }), ip));
    assert.equal(res.status, 503, "no key here: the drip says it is off, without signing");
  }
  const sixth = await POST(post(JSON.stringify({ address: ADDRESS }), ip));
  assert.equal(sixth.status, 429);
  assert.match(((await sixth.json()) as { error: string }).error, /Too many drip requests/);
  const other = await POST(post(JSON.stringify({ address: ADDRESS }), "203.0.113.51"));
  assert.equal(other.status, 503, "another IP is not limited");
  assert.equal(rpcCalls, 0);
});
