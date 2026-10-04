// npx tsx --test web/next.config.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import nextConfig from "./next.config";

test("every route gets the baseline security headers, and no CSP yet (W3)", async () => {
  assert.equal(typeof nextConfig.headers, "function");
  const rules = await nextConfig.headers!();
  const all = rules.find((r) => r.source === "/:path*");
  assert.ok(all, "a rule for every route");
  const got = Object.fromEntries(all.headers.map((h) => [h.key.toLowerCase(), h.value]));
  assert.equal(got["x-frame-options"], "DENY");
  assert.equal(got["x-content-type-options"], "nosniff");
  assert.equal(got["referrer-policy"], "strict-origin-when-cross-origin");
  assert.equal(got["permissions-policy"], "camera=(), microphone=(), geolocation=(), payment=()");
  const everyKey = rules.flatMap((r) => r.headers.map((h) => h.key.toLowerCase()));
  assert.ok(!everyKey.includes("content-security-policy"), "no CSP: it could break the wallet");
});
