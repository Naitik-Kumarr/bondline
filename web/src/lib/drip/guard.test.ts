// npx tsx --test web/src/lib/drip/guard.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { addressFromBody, clientIp, IpLimiter, type IpLimits } from "./guard";

const ADDRESS = "0x00000000000000000000000000000000000000a1";

test("only a JSON object with a string address passes (W4)", () => {
  for (const body of [null, [], [{ address: ADDRESS }], 5, "0xabc", true, {}, { address: 5 }, { address: null }, { address: "" }]) {
    assert.equal(addressFromBody(body).ok, false, `accepted ${JSON.stringify(body)}`);
  }
  assert.deepEqual(addressFromBody({ address: ADDRESS }), { ok: true, value: ADDRESS });
});

const headers = (h: Record<string, string>) => new Headers(h);

test("the client IP is x-forwarded-for's first entry, else x-real-ip, else one shared bucket", () => {
  assert.equal(clientIp(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1", "x-real-ip": "198.51.100.2" })), "203.0.113.7");
  assert.equal(clientIp(headers({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  assert.equal(clientIp(headers({ "x-forwarded-for": "not-an-ip", "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  assert.equal(clientIp(headers({})), "unknown");
  assert.equal(clientIp(headers({ "x-forwarded-for": "::ffff:203.0.113.7" })), "203.0.113.7");
  // IPv6: counted per /64, however the address is written
  assert.equal(clientIp(headers({ "x-forwarded-for": "2001:db8:1:2::5" })), "2001:db8:1:2::/64");
  assert.equal(clientIp(headers({ "x-forwarded-for": "2001:0DB8:0001:0002:ffff:1:2:3" })), "2001:db8:1:2::/64");
  assert.equal(clientIp(headers({ "x-forwarded-for": "::1" })), "0:0:0:0::/64");
});

const LIMITS: IpLimits = { attempts: 5, drips: 1, windowMs: 1_000, maxTracked: 3 };

test("one paid drip per IP per window; the next request from that IP is refused (S-2)", () => {
  const limiter = new IpLimiter(LIMITS);
  assert.equal(limiter.begin("203.0.113.7", 0).ok, true);
  limiter.finish("203.0.113.7", true, 0);
  const again = limiter.begin("203.0.113.7", 10);
  assert.equal(again.ok, false);
  assert.match(again.ok ? "" : again.error, /One drip per IP address a day/);
  assert.equal(limiter.begin("198.51.100.2", 10).ok, true, "another IP is not affected");
  assert.equal(limiter.begin("203.0.113.7", 1_001).ok, true, "allowed again once the window has passed");
});

test("two requests from one IP at the same time can't both go ahead", () => {
  const limiter = new IpLimiter(LIMITS);
  assert.equal(limiter.begin("203.0.113.7", 0).ok, true);
  assert.equal(limiter.begin("203.0.113.7", 0).ok, false, "the first one holds the drip");
  limiter.finish("203.0.113.7", false, 1);
  assert.equal(limiter.begin("203.0.113.7", 2).ok, true, "an unpaid attempt gives the drip back");
});

test("unpaid attempts are capped too", () => {
  const limiter = new IpLimiter(LIMITS);
  for (let i = 0; i < LIMITS.attempts; i++) {
    assert.equal(limiter.begin("203.0.113.7", i).ok, true);
    limiter.finish("203.0.113.7", false, i);
  }
  const over = limiter.begin("203.0.113.7", 10);
  assert.equal(over.ok, false);
  assert.match(over.ok ? "" : over.error, /Too many drip requests/);
});

test("memory stays bounded: the oldest IP is forgotten first", () => {
  const limiter = new IpLimiter(LIMITS);
  for (const ip of ["192.0.2.1", "192.0.2.2", "192.0.2.3", "192.0.2.4"]) {
    assert.equal(limiter.begin(ip, 0).ok, true);
    limiter.finish(ip, true, 0);
  }
  assert.equal(limiter.begin("192.0.2.4", 1).ok, false, "a recent IP is still remembered");
  assert.equal(limiter.begin("192.0.2.1", 1).ok, true, "the oldest was dropped");
});
