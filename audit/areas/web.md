# Area 4: Web, dependency inventory and claim-letter confinement

Independent review completed 4 October 2026 at 15:13 IST. Original files were unchanged. Dependency audit used copied manifests/lockfile under `audit/npm/`; caches, logs, fixtures and proof outputs are under `audit/`. No install, package fix, site rebuild, process restart, model call or transaction occurred. No environment file or secret value was read. Live checks were GET requests only; `/api/drip` was never called over HTTP.

## Findings

### High — W1: lockfile contains high-severity vulnerable dependency versions

**Proof:** from `audit/npm/`:

```sh
npm audit --package-lock-only --audit-level=high --json --registry=https://registry.npmjs.org --cache=/Users/naitik/surety/audit/npm-cache --logs-dir=/Users/naitik/surety/audit/npm-logs
npm audit --package-lock-only --omit=dev --audit-level=high --json --registry=https://registry.npmjs.org --cache=/Users/naitik/surety/audit/npm-cache --logs-dir=/Users/naitik/surety/audit/npm-logs
```

Both exit 1 for findings. `audit/evidence/npm-audit.json` reports **7 High / 0 Critical** dependency entries; the production-only result (`npm-audit-production.json`) reports **2 High / 0 Critical**. Entries propagated through a dependency chain are not seven independent exploit classes. Moderate findings are outside the requested severity scope.

| Affected inventory | Version and location | High advisory / scope |
| --- | --- | --- |
| PostCSS nested under Next | `8.4.31`, `package-lock.json:11290`, `node_modules/next/node_modules/postcss` | Arbitrary file/source-map loading from CSS `sourceMappingURL`; [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849). Production lockfile dependency, typically used when building/processing CSS. |
| `ws` under Reown/WalletConnect | `8.18.0`, four instances; representative `package-lock.json:3670` and `:6569` | Peer-controlled fragment/chunk memory exhaustion; [maintainer advisory](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p). Production dependency inventory. |
| `braces` → `micromatch` → `fast-glob` → Next ESLint plugin/config | `3.0.3` / `4.0.8` / `3.3.1` / `15.5.27`; `package-lock.json:7191`, `:8408` | Deep-pattern recursion exhaustion, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). These five high entries are development dependencies. The reviewed advisory lists no patched `braces` release. |

A local proof confirms the installed PostCSS behavior, without reading any secret or system file:

```sh
node audit/web-postcss-proof.cjs
```

It writes its own harmless source-map marker under `audit/web-postcss-proof/`, parses CSS naming `../outside.map`, reports `postcssVersion: 8.4.31` and `loadedOutsideMarker: true`, and deliberately fails its confinement assertion. Output: `audit/evidence/web-postcss-proof.txt`.

**Impact:** vulnerable libraries can disclose readable files when given untrusted CSS, or exhaust a process when given hostile WebSocket/glob input; production-route exploitability was not established.

**Smallest proposed fix:** update the affected transitive instances through compatible dependency upgrades or targeted overrides: PostCSS **8.5.18 or later** removes the two listed high advisories; `ws` **8.21.0 or later** removes the listed high `ws` advisory. Verify all nested instances and normal build/wallet behavior. Keep unpatched `braces` tooling away from untrusted patterns and track its upstream fix. Do not apply the audit tool's broad `--force` suggestions blindly: its proposed resolutions include major Next/wagmi changes and an ESLint-config downgrade. No fix was applied.

**Qualification:** the reviewed API routes do not accept CSS or glob expressions and do not create a public WebSocket server. The `ws` copies are under wallet SDK packages; package presence does not prove those Node implementations ship to browsers or run on the deployed server. The high ranking here preserves the advisory/inventory severity, not a claim that a stranger can currently read Bondline's keys or crash its public site.

### Low — W2: malformed offline fixture transaction hash escapes the worker's specified output directory

**Source:** `scripts/claim-letters.ts:340` casts a fixture's `settleTx` without validation; `:369` joins it into the filename; `:417` writes that path. The dry-run directory guard (`:74`) checks the chosen output directory, not the final per-letter path. `--out-dir` itself is intentionally operator-controlled.

**Proof:**

```sh
python3 audit/web-worker-confinement.py
```

The unchanged worker is run with `--dry-run --once --fixture` and a specified output directory entirely inside `audit/`. The fixture supplies `settleTx: "../fixture-escaped"`. The worker exits 0 and writes `audit/web-worker-proof/fixture-escaped.json`, outside its specified `worker-output/` folder; the proof's expected-confinement assertion exits 1. See `audit/evidence/web-worker-confinement.json` and `web-worker-confinement-run.txt`. No API/network/model call occurred and the escaped file remains within `audit/`.

**Impact:** an operator processing an untrusted malformed fixture can write or replace JSON outside the chosen fixture-output folder.

**Smallest proposed fix:** require a canonical 32-byte transaction hash before building any letter path, then resolve the candidate and enforce containment under the chosen output root. Apply the same validation to fixture and RPC events.

**Qualification:** production transaction hashes returned by a normal chain RPC have the correct hex form; this proof establishes the offline fixture path, not public API traversal or model-controlled filenames. The generated model text does not choose an output path.

### Low — W3: document responses lack baseline security headers

**Proof:** read-only GET of `http://127.0.0.1:3000/` returned 200; the invalid Verify request returned 400, and `http://127.0.0.1:3110/badge/not-an-address` returned 404. Captured headers are in `audit/evidence/web-local3000-root-headers.txt`, `web-local3000-headers.txt`, and `web-local3110-headers.txt`; the summary is `web-headers-summary.json`. None contains CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy or Permissions-Policy. `web/next.config.ts` has no header policy and no middleware/header configuration was found in the reviewed source.

Reproduce the document check without retaining its body:

```sh
curl -sS --max-time 20 --dump-header audit/evidence/web-local3000-root-headers.txt --output /dev/null http://127.0.0.1:3000/
```

**Impact:** the pages can be framed, and browser protections against content-type confusion and script injection are weaker than a configured policy would provide.

**Smallest proposed fix:** configure page anti-framing (`frame-ancestors 'none'` and/or `X-Frame-Options: DENY`), `nosniff`, a conservative referrer policy and permissions policy in Next or the HTTPS proxy; implement a CSP compatible with Next scripts and wallet/RPC connections. Add HSTS at the actual HTTPS deployment after validating its hostname policy.

**Qualification:** these are existing local development servers. HSTS absence on local HTTP is not a production TLS finding, and a public hosting proxy may add headers; no public response was verified here. No XSS exploit or wallet-signature bypass is claimed. `poweredByHeader: false` is configured and the captured responses omit X-Powered-By.

### Low — W4: valid JSON `null` causes an unhandled Drip validation exception

**Source:** `web/src/app/api/drip/route.ts:109` parses JSON, then `:113` accesses `body.address` outside both the parse catch and the transaction catch.

**Proof:**

```sh
node audit/web-input-proof.mjs
```

The proof extracts only the unchanged handler body, replaces TypeScript annotations, and supplies inert wallet/RPC stubs that throw if reached. `null` throws `TypeError: Cannot read properties of null (reading 'address')`; `{}`, a numeric address, a null address and a URL string return 400. The expected-400 assertion exits 1. Output: `audit/evidence/web-input-proof.txt`. No HTTP POST was made and no secret or transaction path was reached.

**Impact:** a malformed request yields an uncontrolled server error instead of the documented validation response, creating unnecessary error/log load.

**Smallest proposed fix:** validate that parsed JSON is a non-null object with a string `address` before dereferencing it; return 400 for all other shapes. Financial/rate-limit Drip findings belong to area 3 and are not duplicated here.

## Checked and clean

- Route inventory is exactly `/api/verify`, `/api/drip` and `/badge/[account]`. Verify accepts only a transaction hash and address (`api/verify/route.ts:11`); invalid GET returned 400 before RPC work. It relays public transaction input/topics and does not choose an outbound URL from request data.
- Badge strips an optional `.svg`, validates the address, and returned 404 for an invalid address. Its SVG uses fixed strings, enum choices and formatted numeric values; raw route input is not interpolated into markup. Cross-origin access is intentional for public embeddable badges.
- RPC destinations come from server configuration or fixed chain metadata. Request-controlled hashes/addresses become RPC parameters, not network hosts; no URL-fetching API or obvious SSRF path was found in the three routes. Explorer/source-verification destinations are fixed configured explorer services.
- Drip rejects invalid non-null address shapes and team recipients, and directs transfers only to the validated address on a fixed token/chain. This area did not send test requests to its transaction-capable handler.
- No request-driven shell command, server `eval`, runtime code execution, or user-controlled filesystem path was found in `web/src`. The sole reviewed `dangerouslySetInnerHTML` is the static noscript CSS literal in `app/layout.tsx:41`.
- The worker's model output is checked for size, permitted numeric strings, required links and scripted-gap labelling. Fixtures require dry-run; template letters are labelled and excluded from the site's normal letter display. No model call was needed for these checks.

## Limits

No source fixes, lockfile changes, installs, rebuilds, load tests, hostile WebSocket traffic, live financial API requests or process changes were performed. The public deployed domain and its response headers were not verified. Library proofs establish local vulnerable behavior, not an exposed production attack route. Secrets, Drip wallet draining/rate limits and bundle leakage are separately assigned to area 3. All intentional proof failures are regression/safety assertions; they are not failed setup or compiler runs.
