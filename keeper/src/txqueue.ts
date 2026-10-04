// One wallet, one queue: every keeper transaction is simulated, sent with an explicit nonce and awaited before the
// next one starts, so pushes and settles can never race each other for a nonce.
import type { Abi, Account, Address, Chain, Hash, PublicClient, TransactionReceipt, Transport, WalletClient } from "viem";
import type { Fields, Logger } from "./log.ts";

export interface Call {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}

export interface SentTx {
  hash: Hash;
  receipt: TransactionReceipt;
  ok: boolean;
  nonce: number;
}

/** A call, or a function that builds one at send time (and may return null to skip it). */
export type CallOrBuilder = Call | (() => Promise<Call | null>);

type Wallet = WalletClient<Transport, Chain, Account>;

export class TxQueue {
  private tail: Promise<void> = Promise.resolve();
  private nonce: number | null = null;
  /** Jobs queued or running. */
  pending = 0;
  sent = 0;

  constructor(
    private readonly client: PublicClient,
    private readonly wallet: Wallet,
    private readonly log: Logger,
    private readonly receiptTimeoutMs = 120_000,
  ) {}

  get address(): Address {
    return this.wallet.account.address;
  }

  /** Queues a contract call behind every earlier job. Resolves to null if the builder skipped it. */
  send(label: string, call: CallOrBuilder, fields: Fields = {}): Promise<SentTx | null> {
    return this.enqueue(async () => {
      const c = typeof call === "function" ? await call() : call;
      if (!c) return null;
      // Simulate first: a revert costs nothing here and comes back decoded.
      const { request } = await this.client.simulateContract({ ...c, account: this.wallet.account } as Parameters<
        PublicClient["simulateContract"]
      >[0]);
      return this.sendWithNonce(label, fields, (nonce) =>
        this.wallet.writeContract({ ...(request as object), account: this.wallet.account, nonce } as Parameters<Wallet["writeContract"]>[0]),
      );
    });
  }

  /**
   * Sends a zero-value transfer to ourselves, only to make the chain produce a new block. On an idle chain the latest
   * block can be older than (or as old as) a feed's last round, and a push needs a newer block time.
   */
  nudge(label = "nudge"): Promise<SentTx | null> {
    return this.enqueue(() =>
      this.sendWithNonce(label, { note: "zero-value self-transfer for a new block" }, (nonce) =>
        this.wallet.sendTransaction({ account: this.wallet.account, chain: this.wallet.chain, to: this.wallet.account.address, value: 0n, nonce }),
      ),
    );
  }

  /** Resolves once everything queued so far has finished, or after `timeoutMs`. */
  async drain(timeoutMs: number): Promise<void> {
    await Promise.race([this.tail, new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    this.pending++;
    const run = this.tail.then(job);
    this.tail = run.then(
      () => {
        this.pending--;
      },
      () => {
        this.pending--;
      },
    );
    return run;
  }

  private async sendWithNonce(label: string, fields: Fields, send: (nonce: number) => Promise<Hash>): Promise<SentTx> {
    const address = this.wallet.account.address;
    if (this.nonce === null) this.nonce = await this.client.getTransactionCount({ address, blockTag: "pending" });
    const nonce = this.nonce;
    let hash: Hash;
    try {
      hash = await send(nonce);
    } catch (e) {
      // A nonce clash, or a send whose fate is unknown: re-read the nonce from the chain next time.
      this.nonce = null;
      throw e;
    }
    this.nonce = nonce + 1;
    this.sent++;
    this.log.info("tx-sent", { label, hash, nonce, ...fields });

    let receipt: TransactionReceipt;
    try {
      receipt = await this.client.waitForTransactionReceipt({ hash, timeout: this.receiptTimeoutMs, pollingInterval: 1_000 });
    } catch (e) {
      this.nonce = null;
      throw e;
    }
    const ok = receipt.status === "success";
    (ok ? this.log.info : this.log.error)("tx-mined", { label, hash, status: receipt.status, block: receipt.blockNumber, gasUsed: receipt.gasUsed });
    return { hash, receipt, ok, nonce };
  }
}
