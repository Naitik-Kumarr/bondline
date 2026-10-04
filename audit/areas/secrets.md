# Area 3: secrets and judge drip

Audited read-only on 4 October 2026, with evidence completed before 15:15 IST. No environment file was opened, no secret value was displayed or copied into audit evidence, and no network POST, signing, transfer, restart, rebuild, or original-file edit was performed. Proofs execute the unchanged drip handler against isolated mocked RPC clients.

## Findings

### S-1 — Medium: separate server instances bypass the drip's recipient and spending limits

- Source: `web/src/app/api/drip/route.ts:33`, `:35`, `:71`, `:72`, `:75`, `:82`, `:92`, `:117`.
- Proof command: `node audit/tools/drip-proof.cjs`. Evidence: `audit/evidence/drip-proof.json`, tests `separate_instances_exceed_daily_cap`, `separate_instances_pay_same_address_twice`, and `separate_instances_drain_funded_wallet_from_same_ip`.
- Result: seven module instances all read the same confirmed-transfer history before sending, then obtain valid pending nonces and send **35 USDG despite the 30 USDG cap**. Two instances pay the same recipient **10 USDG despite one claim per wallet**. Twenty instances, all with the same request IP, drain the modeled wallet from **100 to 0 USDG**. The actual TypeScript handler runs unchanged; RPC, wallet, and responses are stubs, with zero network calls and zero signed transactions.
- Impact: concurrent requests against multiple Next/Vercel workers can exhaust test USDG reserves and give repeat claims, denying judges the promised limited faucet.
- Smallest fix: make recipient eligibility and the rolling spend budget an atomic durable reservation shared by all workers; use one signer queue and retain reservations until the transaction has a terminal outcome. A module-local Promise queue cannot enforce a deployment-wide limit.
- Limit: this proves handler logic under a valid multi-instance/RPC ordering; it does not assert that the current deployment actually ran twenty concurrent instances or that a live wallet was drained.

### S-2 — Low: there is no per-IP quota

- Source: `web/src/app/api/drip/route.ts:106`, `:113`, `:117`.
- Proof command: `node audit/tools/drip-proof.cjs`. Evidence: `audit/evidence/drip-proof.json`, test `same_ip_six_new_addresses_exhaust_daily_quota`.
- Result: six sequential requests from one modeled IP, each naming a fresh address, all return 200 and consume the full **30 USDG** daily allowance. A seventh legitimate request gets 429. The route never reads the IP or any identity other than the submitted wallet address.
- Impact: one caller can exhaust the judge drip's daily allowance with six fresh addresses, even when only one server instance runs.
- Smallest fix: add a shared, trusted-client-IP rate limit before the RPC work and pair it with the existing address limit; keep the global spend reservation from S-1.

## Checked and clean within the stated scope

- **Drip signing key stays server-side in source.** Its environment lookup occurs only at `web/src/app/api/drip/route.ts:58`, within the Node API route. `audit/evidence/drip-client-isolation.json` records zero references to that signing-key environment name across **3,193** built static JavaScript/JSON/source-map files. No key value was examined or printed.
- **Sequential address and daily limits work in one instance.** The actual handler rejects a repeated recipient with 409 and the seventh sequential 5 USDG payment with 429 in `audit/evidence/drip-proof.json`.
- **Issuer and team checks exist.** Before sending, the route checks USDG pause, recipient freeze, and balance at `web/src/app/api/drip/route.ts:62`; team recipients are refused at `:115`. These are source checks, not live dispensing tests.
- **Ignore coverage is present.** `node audit/tools/check-ignore-rules.cjs` verifies both `.gitignore` and `.vercelignore` ignore root and nested `.env` variants, `_private/`, and `logs/` using the installed `ignore` implementation. All tested paths are ignored, including `.env.example` because the later `.env*` rule re-ignores it. Evidence: `audit/evidence/ignore-rules.json`.
- **No actionable secret literal was confirmed in scanned text.** `python3 audit/tools/scan-secrets.py` scanned **7,849 UTF-8 files / 480,618,090 bytes**, including private notes and logs and **196,248,601 bytes** of built client assets across `.next`, `.next-a`, `.next-b`, `.next-e`, `.next-fv2`, `.next-int`, `.next-local`, `.next-preview`, and `.next-ve`. There was no standalone build directory. Evidence: `audit/evidence/secrets-scan-final.json`.
- **All primary scanner candidates were resolved without exposing values.** `python3 audit/tools/review-secret-candidates.py` classified all **28** candidates as dependency documentation examples, names of local-storage keys, or source/HTML fragments; **zero remained unresolved**. Private-key-shaped literals matched public `ox` documentation examples internally and were not treated as deployed wallet secrets. Evidence: `audit/evidence/secrets-reviewed.json` contains filename, line, and classification only.
- **Mnemonic/RPC credential follow-up was clean.** `node audit/tools/scan-mnemonics-rpc.cjs` found **44** checksum-valid mnemonic literals, all internally matched to public dependency documentation; no unresolved mnemonic or credential-bearing API/RPC URL was found. Evidence: `audit/evidence/secrets-mnemonics-rpc.json`, filename/line/classification only.
- **Public environment variable names in application source were appropriate categories.** The client-name scan found only the wallet connection project identifier, browser RPC URL, and E2E account address setting. None was named as a private key, password, or server API secret. Evidence: `audit/evidence/drip-client-isolation.json`. Actual environment values were deliberately not opened, so this is not a certification of every deployed environment setting.

## Limits

- All **three `.env*` files were skipped without opening**, including templates, as expressly requested.
- `node_modules`, `.git`, audit output, Python/Rust vendor/build directories, symlinks, and contract dependency/generated artifact folders were excluded from the primary whole-folder scan; dependency documentation was read programmatically only to resolve public fixture false positives. **471 binary files and 42 files larger than 35 MB** were skipped. The scan therefore does not certify packed build caches, binary assets, arbitrary encrypted material, or unknown secret formats.
- This workspace has **no `.git` repository**. Git tracking/history and whether a previously committed secret was removed cannot be checked here; ignore-pattern behavior was verified independently.
- No running site's environment, hosting secret store, or drip wallet key was opened, and the faucet was never called over the network. Server-only key placement is supported by source and built-bundle inspection, not by inspecting the production secret value.
- The live replay may continue changing logs/state during the audit; this is a read-only snapshot, not a filesystem freeze.
