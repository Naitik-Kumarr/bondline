// The judge drip's request checks that need no chain and no wallet: the body's shape, the caller's IP address and a
// best-effort per-IP limit. Pure, so they run (and are tested) without Next. The route runs them before any RPC work.
import { isIP, isIPv4 } from "node:net";

export type Check<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * The drip takes one shape: a JSON object with a string `address`. Anything else (null, an array, a number, a string,
 * `{}`, `{ address: 5 }`) is refused here, before the route touches a wallet or an RPC.
 */
export function addressFromBody(body: unknown): Check<string> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Send a JSON object with your wallet address." };
  }
  const address = (body as { address?: unknown }).address;
  if (typeof address !== "string" || address === "") return { ok: false, error: "That isn't a wallet address." };
  return { ok: true, value: address };
}

/**
 * The caller's IP address: the first x-forwarded-for entry, else x-real-ip. On Vercel the platform sets both headers
 * itself, so a caller can't choose them; behind any other proxy, that proxy must overwrite them. IPv6 callers often
 * hold a whole /64, so they are counted by it. Without a usable header, every such caller shares one "unknown" count.
 */
export function clientIp(headers: Pick<Headers, "get">): string {
  const candidates = [headers.get("x-forwarded-for")?.split(",")[0], headers.get("x-real-ip")];
  for (const raw of candidates) {
    const ip = raw?.trim().toLowerCase();
    if (ip && isIP(ip)) return bucketOf(ip);
  }
  return "unknown";
}

function bucketOf(ip: string): string {
  if (isIPv4(ip)) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped && isIPv4(mapped[1])) return mapped[1];
  const [head, tail] = ip.split("::");
  const front = head ? head.split(":") : [];
  const back = tail === undefined ? [] : tail ? tail.split(":") : [];
  const groups = tail === undefined ? front : [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

export interface IpLimits {
  /** Requests per IP per window that get as far as the drip's chain checks. */
  attempts: number;
  /** Successful drips per IP per window. */
  drips: number;
  windowMs: number;
  /** IPs remembered at once; the oldest is forgotten first. Bounds memory. */
  maxTracked: number;
}

/** One drip and five attempts per IP address per 24 hours. */
export const DRIP_IP_LIMITS: IpLimits = { attempts: 5, drips: 1, windowMs: 24 * 60 * 60 * 1000, maxTracked: 10_000 };

type Entry = { attempts: number[]; drips: number[]; pending: number };

/**
 * A per-IP limit kept in this server instance's memory. Best effort: it is not shared between instances and is lost
 * on a restart, so it slows one caller down; it is not the hard cap (that is the drip wallet's balance).
 */
export class IpLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly limits: IpLimits = DRIP_IP_LIMITS) {}

  /**
   * Call before any RPC work. If allowed, it counts an attempt and holds this IP's drip until `finish`, so two
   * requests from one IP at the same time can't both be paid.
   */
  begin(ip: string, now = Date.now()): Check<null> {
    const entry = this.entry(ip, now);
    if (entry.drips.length + entry.pending >= this.limits.drips) {
      return { ok: false, error: "One drip per IP address a day, and this one has had it. Try again tomorrow, or use Paxos's faucet." };
    }
    if (entry.attempts.length >= this.limits.attempts) {
      return { ok: false, error: "Too many drip requests from this IP address today. Try again tomorrow, or use Paxos's faucet." };
    }
    entry.attempts.push(now);
    entry.pending++;
    return { ok: true, value: null };
  }

  /** Call once after every allowed `begin`: `paid` when the drip sent (or may have sent) USDG. */
  finish(ip: string, paid: boolean, now = Date.now()): void {
    const entry = this.entry(ip, now);
    entry.pending = Math.max(0, entry.pending - 1);
    if (paid) entry.drips.push(now);
  }

  private entry(ip: string, now: number): Entry {
    const cutoff = now - this.limits.windowMs;
    let entry = this.entries.get(ip);
    if (!entry) {
      while (this.entries.size >= this.limits.maxTracked) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.entries.delete(oldest);
      }
      entry = { attempts: [], drips: [], pending: 0 };
      this.entries.set(ip, entry);
    }
    entry.attempts = entry.attempts.filter((t) => t > cutoff);
    entry.drips = entry.drips.filter((t) => t > cutoff);
    return entry;
  }
}
