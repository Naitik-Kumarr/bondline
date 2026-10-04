import { addressUrl } from "@bondline/shared/chain";
import { TEAM_WALLETS } from "@bondline/shared/deployment";
import { cn } from "@/lib/cn";
import { shortAddress } from "@/lib/format";
import { AgentMark } from "./AgentMark";
import { CopyButton } from "./CopyButton";
import { ArrowUpRightIcon } from "./icons";
import { DemoLabel } from "./Pill";

export type AddressPillProps = {
  address: string;
  /** A name shown before the address, e.g. "Careful". */
  label?: string;
  /** Show the generated geometric mark. */
  mark?: boolean;
  /** Add a copy button. */
  copy?: boolean;
  /** Label team-operated wallets (keeper, agents, test underwriter and buyer) from the deployment record. */
  flagTeam?: boolean;
  className?: string;
};

/** A short address in mono that links to the explorer. */
export function AddressPill({ address, label, mark = false, copy = false, flagTeam = false, className }: AddressPillProps) {
  const role = flagTeam ? TEAM_WALLETS[address.toLowerCase()] : undefined;
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5", className)}>
      <a
        href={addressUrl(address)}
        target="_blank"
        rel="noopener noreferrer"
        title={`${address} on the Robinhood Chain testnet explorer`}
        className={cn(
          "group inline-flex h-7 min-w-0 items-center gap-2 rounded-full bg-surface pr-2.5 shadow-hairline",
          "transition-transform duration-[var(--duration-spring)] ease-spring hover:-translate-y-px motion-reduce:transition-none",
          mark ? "pl-1" : "pl-2.5",
        )}
      >
        {mark ? <AgentMark address={address} size={20} /> : null}
        {label ? <span className="truncate text-[13px] font-medium text-ink">{label}</span> : null}
        <span className="num text-[12.5px] text-ink-2">{shortAddress(address)}</span>
        <ArrowUpRightIcon size={12} className="text-ink-3 transition-colors group-hover:text-ink" />
      </a>
      {copy ? <CopyButton value={address} label="Copy address" /> : null}
      {role ? <DemoLabel kind="team" title={`Team operated wallet: ${role}`} /> : null}
    </span>
  );
}
