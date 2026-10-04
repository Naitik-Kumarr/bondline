// A throwaway local chain for the end-to-end tests: Anvil on port 8551 (chain id 8551) with Bondline deployed by
// contracts/script/Deploy.s.sol (LOCAL=true: mock USDG and stocks, stocked demo exchanges, first prices pushed).
// Uses only Anvil's public test keys. Sends nothing to any public chain. Kills what it starts.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWalletClient, createPublicClient, defineChain, encodeFunctionData, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { RawDeployment } from "../src/config.ts";

export const PORT = 8551;
export const CHAIN_ID = 8551;
export const RPC_URL = `http://127.0.0.1:${PORT}`;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Anvil's well-known public test keys (the same on every machine). */
export const ANVIL_KEYS: Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
];

function portInUse(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection({ port: PORT, host: "127.0.0.1" });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });
}

async function rpc(method: string): Promise<unknown> {
  const r = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }) });
  return ((await r.json()) as { result: unknown }).result;
}

export interface LocalChain {
  rpcUrl: string;
  raw: RawDeployment;
  /** The raw deploy file (deleted by stop()). */
  rawPath: string;
  stop(): void;
}

export async function startLocalChain(): Promise<LocalChain> {
  if (await portInUse()) throw new Error(`port ${PORT} is already in use; this test only uses ${PORT} and will not touch what is on it`);
  const rawPath = join(ROOT, "deployments", `raw-${CHAIN_ID}.json`);
  const broadcastDir = join(ROOT, "contracts", "broadcast", "Deploy.s.sol", String(CHAIN_ID));
  let anvil: ChildProcess | null = spawn("anvil", ["--port", String(PORT), "--chain-id", String(CHAIN_ID), "--silent"], { stdio: "ignore" });
  const stop = () => {
    if (anvil && !anvil.killed) anvil.kill("SIGKILL");
    anvil = null;
    rmSync(rawPath, { force: true });
    rmSync(broadcastDir, { recursive: true, force: true });
    rmSync(join(ROOT, "contracts", "cache-c", "Deploy.s.sol", String(CHAIN_ID)), { recursive: true, force: true });
  };
  process.once("exit", stop);
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try {
        up = (await rpc("eth_chainId")) === `0x${CHAIN_ID.toString(16)}`;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!up) throw new Error("anvil did not start");
    const res = spawnSync("forge", ["script", "script/Deploy.s.sol", "--rpc-url", RPC_URL, "--broadcast"], {
      cwd: join(ROOT, "contracts"),
      env: { ...process.env, FOUNDRY_OUT: "out-c", FOUNDRY_CACHE_PATH: "cache-c", LOCAL: "true", DEPLOYER_PRIVATE_KEY: ANVIL_KEYS[0], KEEPER_PRIVATE_KEY: ANVIL_KEYS[1] },
      encoding: "utf8",
      timeout: 540_000,
    });
    if (res.status !== 0 || !existsSync(rawPath)) throw new Error(`deploy failed (status ${res.status}): ${(res.stderr || res.stdout).slice(-2000)}`);
    const raw = JSON.parse(readFileSync(rawPath, "utf8")) as RawDeployment;
    return { rpcUrl: RPC_URL, raw, rawPath, stop };
  } catch (e) {
    stop();
    throw e;
  }
}

/** Mints test USDG (the mock's mint is open) from Anvil's #0 key. `usdg` is a whole-USDG number. */
export async function mintUsdg(chain: LocalChain, to: Address, usdg: number): Promise<void> {
  const c = defineChain({ id: CHAIN_ID, name: "local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [chain.rpcUrl] } } });
  const account = privateKeyToAccount(ANVIL_KEYS[0]);
  const w = createWalletClient({ account, chain: c, transport: http(chain.rpcUrl) });
  const p = createPublicClient({ chain: c, transport: http(chain.rpcUrl) });
  const hash = await w.sendTransaction({
    to: chain.raw.usdg as Address,
    data: encodeFunctionData({ abi: parseAbi(["function mint(address to, uint256 amount)"]), functionName: "mint", args: [to, BigInt(usdg) * 1_000_000n] }),
  });
  await p.waitForTransactionReceipt({ hash });
}
