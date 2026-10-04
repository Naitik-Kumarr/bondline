# Area 6: continuity after the Mac sleeps

Reviewed 4 October 2026, 15:05 IST. Read-only source inspection; no process was started, stopped or restarted, no deployment was made, and no transaction was sent. Environment files and secret values were not read. The recommendations below are proposals, not executed steps.

## What stops

| Component | On Mac sleep or loss of connectivity | What still exists |
| --- | --- | --- |
| Keeper live mirror | No new mainnet-to-testnet price pushes. | Last on-chain feed rounds. It copies real source timestamps, so fresh-looking weekend prices cannot be manufactured honestly. |
| Keeper replay | No scheduled historical price pushes; after wake it jumps to the current replay time rather than resuming the missed interval. | The frozen replay history and on-chain last round. Missed intermediate prices are not replayed. |
| Keeper settle loop | No automatic scans or settlement transactions. | Anyone with RPC access and gas can still call `settle`; contracts do not run an automatic timer. A breach followed by a rebound while the keeper is offline can be missed, because settlement uses the current price. |
| Keeper scripted gap | No further Friday/weekend/Monday scenario work or record writes. | Saved progress resumes only if its control file and progress file are preserved together. |
| Careful and Bold | No model calls, decisions, trades or new refusal receipts. | Existing token balances and transaction receipts. The accounts remain active unless independently paused/closed/settled. |
| Local Next server | Requests to that server, and any tunnel pointing at it, stop responding. | A separately hosted site can remain online and read public RPCs; an independently deployed web instance was not verified in this area. |
| Claim-letter worker / local post-processing | No new letters, refreshed agent records, or hero snapshot updates. | Previously generated files and all chain events. Backfill is possible later. |

Proof: `keeper/src/index.ts:43`, `:90`, `:107` run mirror/replay/settle/gap loops inside one Node process. `agents/src/index.ts:277` runs both agents inside one Node process. `keeper/src/config.ts:142` derives replay time from elapsed wall-clock seconds; `keeper/src/replay.ts:46` chooses only the currently applicable round, and `:38` stops pushes after the window ends. `keeper/src/replay-data.ts:51` implements the last-round-at-or-before-time lookup. `keeper/src/settle.ts:95` reads current health; it does not replay historical breaches.

Both the recorded configuration and the parent auditor's pinned chain review show a 90,000-second (25-hour) Live price limit and a 300-second Replay limit. Live data can already be stale during the weekend even when the keeper is healthy. The live mirror skips unchanged source rounds (`keeper/src/mirror.ts:26`); moving it to a droplet does not renew those timestamps. Replay agents intentionally stop at the scheduled end (`agents/src/index.ts:109`, `:245`), and do not trade the subsequent scripted gap. Keeping the server awake does not turn an ended replay into ongoing trading.

## Verified operational limitations

### Medium: restarts can silently choose a different replay schedule unless the runtime record is explicit

**Proof:** selective, non-secret JSON read of `deployments/rhTestnet.json` and `shared/src/deployment.json` on this audit showed `replay.startsAt: null` and `replay.speed: 24` in both. `keeper/src/config.ts:101` normally uses the bundled shared record; `:104` permits an explicit runtime record; `:131` permits environment overrides. `agents/src/config.ts` has the same logic. The other session may be using an override or another deployment record; its effective configuration was not inspected.

**Impact:** copying only the bundles and defaults can leave Replay unscheduled; using `REPLAY_STARTS_AT=now` on the droplet creates a different clock from the running session and the judge site.

**Smallest proposed fix:** preserve the running session's actual absolute `startsAt`, `speed`, window boundaries and deployed addresses in one non-secret runtime JSON file, and point both services' `BONDLINE_DEPLOYMENT` at it. Preserve any session-specific gap output path and control file. Do not infer the active schedule from a stale bundled default, and do not reschedule merely to move hosts.

### Medium: Mac and droplet workers have no cross-host singleton lock

**Proof:** `keeper/src/txqueue.ts:26` stores its queue and nonce only in memory; `:91` reads the pending nonce on first use. `agents/src/index.ts:277` serializes each local cycle, while `agents/src/trade.ts:68` sends directly through its wallet. No inter-process or inter-host leader lease appears in these execution paths.

**Impact:** two hosts operating the same keeper or agent wallet can race nonces, duplicate model decisions and trigger unpredictable replay/gap sends.

**Smallest proposed fix:** operate exactly one leader for each wallet. Complete the current Mac session or perform one deliberate handoff: stop new work on the old host, reconcile pending transaction receipts/nonces, then enable the droplet services. Do not start the new services while the other Claude session still runs those wallets. A local `flock` wrapper would prevent two copies on the droplet only; it would not protect against the Mac.

### Low: a live chain view does not automatically refresh every published artifact

**Proof:** `/judge` has 60-second regeneration (`web/src/app/(read)/judge/page.tsx:23`); `/market`, `/live`, `/party` and agent detail use 30-second regeneration. Chain balances and events are read at rendering (`web/src/components/market/data.ts:36`, `web/src/components/live/data.ts:97`). Agent records are bundled (`web/src/components/market/data.ts:65`), the hero imports `web/src/data/gap-demo.json`, and the main gap detail is an eager build-time import (`web/src/components/judge/gap.ts:38`). Letters and party records are filesystem reads (`web/src/lib/letters.ts:23`, `web/src/lib/external/files.ts:17`), gated by `verification/D.json`; Vercel/server-function copies are snapshots listed in `web/next.config.ts:13`.

**Impact:** new settlements can appear in chain totals while the hero, agent history, gap narrative or letters still show an earlier deployment snapshot. An already open browser tab is not refreshed merely by an ISR interval; the countdown updates its own clock, not the page's chain data.

**Smallest proposed fix:** after actual completion, separately regenerate/synchronize the intended read-only artifacts and deploy a fresh web build; colocated mutable letters/party files can be read on later renders without a rebuild. Judges should refresh the page and inspect the displayed block/time. Do not run `scripts/after-replay.sh` as a read-only publishing shortcut: lines 28–29 also run transaction-producing setup steps.

## Smallest proposed droplet setup

Use the existing droplet as one always-on host, with a Node runtime satisfying the repository's `node >=22` requirement, one keeper service and one agents service. If a public web deployment is already independently healthy, those two workers are sufficient for chain activity. If it is not, also run the production Next server from the same release under a service manager and expose it through HTTPS at the confirmed judge URL. A static file server alone is insufficient: the application uses server rendering, route handlers, ISR and filesystem reads. The current public judge domain was not confirmed, so public availability must be checked before calling the migration complete.

1. Transfer the reviewed `keeper/dist/keeper.mjs` and `agents/dist/agents.mjs` as a matched release. These are bundled outputs; they do not need Foundry or a contract rebuild. Transfer the explicit non-secret runtime deployment/session record. For a self-hosted site, transfer its production build, required runtime dependencies and the repository files it actually reads. Set `BONDLINE_REPO_ROOT` to the shared release root if the web working directory differs from `web/`.
2. Preserve the deployed keeper identity and the two deployed agent identities. Supply their secrets privately through root-owned, mode-600 service environment files, without embedding them in bundles or command arguments. Set `BONDLINE_ENV_FILE=none` so a stray project `.env` is not loaded. The agents also need the Anthropic credential; missing credentials cause them to wait without sending (`agents/src/index.ts:104`). Use one shared deployment record and absolute replay clock for both workers.
3. Preserve the active gap's `STATE_DIR/gap.json` and `gap-progress.json`, and any completed gap records. Defaults are `keeper/state/` and `/opt/bondline/deployments/gap-demo.json` when the keeper working directory is `/opt/bondline/keeper` (`keeper/src/gap.ts:49`). Progress is selected only when the saved control matches (`:319`). Do not remove progress, substitute another control or replay Friday during a handoff.
4. Reuse the provided `keeper/deploy/bondline-keeper.service` and `agents/deploy/bondline-agents.service`. They already restart on failure (5 and 10 seconds), load external environment files, and run the bundled files. Choose their documented unprivileged service user and writable state/log directories. The provided units default to root because their `User`/`Group` lines are commented. Enable only after the single-leader handoff is complete.
5. Read-only acceptance checks: both services stay active, startup reports chain 46630 and the expected market/keeper/agent addresses, their effective replay schedules agree, wallet gas balances are nonzero, and RPC/API connectivity works. During an open replay, compare new feed timestamps with source selection and verify real receipts on-chain. During the closed weekend/window, check heartbeat and explicit waiting state instead of demanding artificial fresh prices. Open `/`, `/judge`, `/live` and an account page through the actual external HTTPS URL and check their block/time and stale indicators. None of these acceptance checks require sending a new transaction manually.

Claim letters are optional for live balances/settlements. For continuously appearing new letters on a colocated site, add one supervised read-only `scripts/claim-letters.ts` worker using the existing dependency tree and private Anthropic credential, with its allowed output directory on the same disk. It scans from deployment blocks on restart and skips existing transaction-hash files (`scripts/claim-letters.ts:372`, `:432`). A separately hosted immutable web deployment will not receive droplet-written letters automatically; publish a new snapshot when required. Keeper and agent heartbeats/exit restarts are useful, but the repository does not provide an external failure-alert mechanism or a verified remote uptime guarantee.

## Clean checks and limits

- Existing systemd units have `Restart=always`, network ordering, graceful signal handling and external credential files. Keeper attempts to drain its queue on shutdown (`keeper/src/index.ts:117`).
- Keeper config checks the RPC chain ID and on-chain market USDG; startup verifies all four feeds name the configured keeper. No need to redeploy contracts merely to move the workers.
- Replay source data and price choice are deterministic from the preserved clock; settle account lists and terminal states are reconstructed from the chain after restart. There is no persistent private key in these source files.
- This area did not read environment files, private keys, logs, or process command arguments; it did not inspect the droplet, manipulate services, or confirm a public domain. Existing compiled bundle/source equivalence, current remote service state and effective overrides remain to be confirmed before deployment. No operational change was made.
