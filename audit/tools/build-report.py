from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
root=Path('/Users/naitik/surety')
audit=root/'audit'
now=datetime.now(ZoneInfo('Asia/Kolkata')).strftime('%d %B %Y, %H:%M IST')
intro=f'''# Bondline independent audit

**Final report: {now}. Deadline: 4 October 2026, 16:00 IST. Fixes applied: none.**

Audit work, proof fixtures, copied contracts and build output are confined to `audit/`. Original source and live processes were not edited, stopped, restarted or rebuilt. No blockchain transaction was broadcast, no Drip HTTP POST was sent, and no model API call was made. Public RPC reads, local fork simulations, registry queries and GET requests to existing local sites were used. `.env*` files were never opened; secret values are not included in this report or scanner evidence. Parallel specialist reviews covered the six requested areas, followed by proof/severity cross-review.

## Assessment

**No Critical finding was proven.** The principal High contract finding is a conditional denial of claim/withdrawal caused by unsolicited zero-value stock dust. High dependency advisories are separately reported as inventory findings; a remotely reachable production exploit was not established. Medium findings include public replay inventory exposure, empty-offer enumeration growth and non-atomic Drip limits across instances. Exact public-copy replacements appear below.

No payout above a cover's reservation, double settlement, signature redirection/replay, or agent withdrawal escape was reproduced. This is a bounded independent audit, not a certification of every possible state.

**Deployment snapshot:** Robinhood Chain testnet block **128627492**, **4 October 2026, 14:57:36 IST**. All **11** protocol runtimes, expected immutables, nine top-level constructor inputs and eight clones match the isolated fresh build. Both markets hold zero USDG. Aggregate bond **121.216666 USDG**, reservation **41.84**, active principal **209.20**, premiums **6.216666**, claims **0** reconcile with local `/judge`. A later claims-only read at block **128637073**, **15:17:14 IST**, still found zero paid claims. Another session may change state after those snapshots.

**Production-site limit:** both existing localhost sites on ports 3000/3110 were inspected. The source fallback public URL returned `DEPLOYMENT_NOT_FOUND`; the actual production URL was not independently identified. Local headers and bundle inspection therefore do not certify the production proxy/environment. This does not establish that the canonical public site is down.

## Findings ranked by severity

Every contract finding has an executed failing Foundry test; negative keeper-assumption tests are explicitly separated from unauthorized-write defects. Each detailed entry supplies proof, one-line impact, minimal proposed fix and material limits.

| Severity | ID | Finding | Principal proof |
|---|---|---|---|
| Critical | — | None proven | Reservation, once-only settlement and permissions controls passed |
| High | M01 | Zero-value unsolicited stock dust obstructs claims/cash withdrawals | Two failing `testSafety_*StaleDonation` tests |
| High, advisory inventory | W1 | 7 High / 0 Critical dependency entries; 2 High in production inventory | Isolated `npm audit`; local PostCSS marker proof |
| Medium | M02 | Permissionless accounts can trade ahead of public replay history for venue subsidies | Failing `testSafety_untrustedReplayParticipantCannotExtractVenueUSDG` |
| Medium | M03 | Empty offers make whole-book enumeration unbounded | Failing 2M-budget test; measured 7,888,173 gas at 1,000 offers |
| Medium | S-1 | Multi-instance Drip bypasses recipient and daily quotas | Unchanged-handler mock proof: 35 vs 30 USDG, duplicate recipient |
| Medium | C01 | Unconditional payout/keeper timing promises omit execution conditions | Dust and pause/freeze tests; keeper retry code |
| Medium | C02 | Increasing timestamps do not authenticate source age | Failing authorized-keeper retimestamp assumption |
| Medium | C03 | Account registration is overstated as public-replay protection | M02 proof; public offer/account creation |
| Medium | C04 | Complete decision/refusal receipts and model provenance are overstated | Failing issuer-refusal receipt test; off-chain hold path |
| Low | M04 | Health reports success eligibility while issuer transfers will fail | Two failing paused/frozen health assertions |
| Low | M05 | Issuer-blocked trades can revert without a Blocked receipt | Failing issuer-blocked receipt assertion |
| Low | S-2 | No per-IP Drip quota | Same-IP six-address proof consumes daily allowance |
| Low | W2 | Malformed offline claim fixture can write outside chosen output folder | Dry-run fixture confinement assertion fails within audit/ |
| Low | W3 | Baseline security headers absent in local responses/source | Existing local GET header captures |
| Low | W4 | JSON null is an unhandled Drip validation exception | Isolated input-only validation proof |
| Low | C05 | No-admin/no-upgrade wording omits external issuer and keeper powers | Deployed source, proxy slots and keeper tests |
| Low | C06 | Stock share is a buy check, not a continuous holding ceiling | `_checkLimits`, fixed-basket backtest |
| Low | C07 | Automatic premiums and two current record prices are overstated | Fixed feeBps; no-trade record snapshots |
| Low | C08 | Demo script prematurely says a gap claim paid | Later snapshot: all claimsPaid still zero |
| Low | C09 | Market-hours-only oracle wording is false | Fresh round timestamps outside NYSE core hours |
| Low | C10 | Pricing basis/log-return/simulation labels need correction | Independent numeric recomputation |
| Low | C11 | Competitor universals and use by every account opener unsupported | Scope of cited public sources |
| Low | C12 | Roadmap treats existing permissionless SDK/MCP capability as absent | Current factory and six-tool MCP source |
| Low | C13 | Proof capacity, chain-only numbers and SDK refusal coverage overstated | Return fields and checked-source scope |

C01–C04 describe misleading assurances associated with the same underlying behavior, not four additional ways to lose reserved bond. M03's gas budget is an explicit local demonstration, not a proven live RPC outage. M02's large fixture profit is not a current deployed-wallet drain. S-1's funded-wallet exhaustion is a fully mocked multi-instance ordering, not a live dispensing test. Operations below also document continuity risks rather than pretending this audit deployed a droplet.

## Proof index

- Original copied Foundry suite: **168 baseline passes plus 4/4 real-token/mainnet fork passes = all 172 original tests independently passed across two runs**. Default baseline invariants used 256 × 64 = 16,384 calls each, not the historical deeper 200,000-call report. Evidence: `audit/evidence/baseline-tests.txt`, `fork-tests.txt` and status JSON files.
- New Foundry suite: **21 tests: 12 passing controls, 9 intentionally failed safety/trust assertions**, including 1,000 independent reservation fuzz cases. Command: `forge test --root audit/contracts --offline --match-contract AuditMoneySafetyTest -vv`. Tests: `audit/contracts/test/AuditMoneySafety.t.sol`; evidence: `audit/evidence/money-tests.txt`. Exit 1 is expected; compilation succeeded. Failures are grouped and calibrated above.
- Drip: `node audit/tools/drip-proof.cjs`; no network/signing; `audit/evidence/drip-proof.json`.
- Web: `node audit/web-postcss-proof.cjs`, `python3 audit/web-worker-confinement.py`, `node audit/web-input-proof.mjs`; intentional safety assertions fail. npm inventory/evidence and command details appear below.
- Deployment: `audit/evidence/deployment-validation.json`, `deployment-snapshot.json`, explorer/code probes and local HTML captures.
- Claims: `audit/evidence/claims-ledger.md` covers the full README, eight docs and all homepage/judge content; numerical outputs and source hashes are in the adjacent claims evidence files. Fresh backtest output is under `audit/backtest/`.
- Secret scanner outputs contain only file/line/classification, never matched values. No actionable secret was confirmed in scanned text; deliberate exclusions and unavailable environment/history checks are stated below.

'''
parts=[intro]
for name in ['money','deployment','secrets','web','claims','operations']:
    content=(audit/'areas'/f'{name}.md').read_text()
    content=content.replace('`keeper/src/settle.ts:77`','`keeper/src/settle.ts:78`')
    lines=content.splitlines()
    for i,line in enumerate(lines):
        if line.startswith('# '): lines[i]='## '+line[2:]
        elif line.startswith('## '): lines[i]='### '+line[3:]
        elif line.startswith('### '): lines[i]='#### '+line[4:]
    parts.append('\n---\n\n'+'\n'.join(lines)+'\n')
parts.append('''
---

## Consolidated checked-and-clean list

- All 11 deployed protocol runtimes, configured constructor/immutable values, fixed clone targets and local judge balance totals reconcile. No hidden protocol owner, administrator or upgrade mechanism was found. External token issuer/upgrade authority is explicitly scoped.
- All 172 existing Foundry tests passed across the baseline and separate real-token fork runs. The new controls confirm reserved-bond solvency, no second settlement, no agent withdrawal escape, stale/invalid-price rejection and atomic rollback on failed transfers.
- Real USDG domain/payee and one-signature funding paths pass; failed sender substitution does not consume the nonce and successful authorization replay is rejected.
- Every division in `contracts/src` is documented above; reservation and limits round up, payout caps and proportional principal reductions round down. No tested monetary rounding path exceeds the position reservation.
- Root/nested environment, private-directory and log ignore patterns pass for both `.gitignore` and `.vercelignore`. Drip signing-key lookup is server-only; no such reference appears in 3,193 static built files. No actionable literal was confirmed in 7,849 scanned text files; environment files, history and binary/oversize/vendor exclusions are not silently certified.
- The three public web routes validate their non-null address/hash inputs and use fixed/configured outbound destinations; no request-driven SSRF, shell execution or web filesystem-write path was identified. Worker traversal is limited to malformed offline fixture input in the demonstrated proof.
- Fresh model/record tests passed 25/25. Fresh backtest output matches stored numbers after generation metadata is removed. Independently recomputed closes, volatility and replay counts match; all stored model vectors/off-chain rows match current TypeScript. Historical symbolic/mutation/coverage/Slither and actual Rust/WASM runs are separately identified as inspected rather than freshly rerun.
- Existing keeper/agent systemd units already provide restart policies and graceful handling; moving the workers needs no contract redeployment. Actual remote service health, production URL/configuration and a droplet handoff were not performed or certified.

No fix, deployment, automation, service migration, transaction or external message was executed. Source/history/provenance limits and snapshot times are part of the audit's conclusions, not clean-check claims.
''')
(audit/'AUDIT.md').write_text('\n'.join(parts))
print('Final report written:',audit/'AUDIT.md')
print('Words:',len((audit/'AUDIT.md').read_text().split()))
