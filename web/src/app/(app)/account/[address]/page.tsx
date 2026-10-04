import type { Metadata } from "next";
import { Suspense } from "react";
import { getAddress, isAddress } from "viem";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { Skeleton } from "@/components/ui/Skeleton";
import { shortAddress } from "@/lib/format";
import { ClaimLetter } from "@/components/account/ClaimLetter";
import { AccountView } from "@/components/account/AccountView";
import { AccountHistory } from "@/components/account/History";
import { AccountReceipts } from "@/components/account/Receipts";
import { SettledPayout } from "@/components/account/SettledPayout";

type Params = { params: Promise<{ address: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { address } = await params;
  return {
    title: isAddress(address) ? `Account ${shortAddress(address)}` : "Account",
    description: "A covered account: its value, health against the limit, the AI's receipts, and the actions on it.",
  };
}

function ListSkeleton({ rows, label }: { rows: number; label: string }) {
  return (
    <Card padding="none" aria-busy="true" aria-label={label}>
      <ul className="divide-y divide-line">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="px-5 py-5 sm:px-6">
            <Skeleton className="h-4 w-48" rounded="sm" />
            <Skeleton className="mt-3 h-3.5 w-full" rounded="sm" />
            <Skeleton className="mt-2 h-3.5 w-2/3" rounded="sm" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default async function AccountPage({ params }: Params) {
  const { address } = await params;
  if (!isAddress(address)) {
    return (
      <Container size="narrow" className="py-20 text-center sm:py-28">
        <p className="eyebrow">Covered account</p>
        <h1 className="mt-4 font-display text-display-m text-ink">That isn&apos;t an address.</h1>
        <p className="mx-auto mt-4 max-w-[30rem] text-[16px] leading-relaxed text-ink-2">
          Account links look like /account/0x… with a 40-character hex address.
        </p>
        <div className="mt-8 flex justify-center">
          <ButtonLink href="/cover">Get cover</ButtonLink>
        </div>
      </Container>
    );
  }
  const account = getAddress(address);
  return (
    <div className="pb-20 sm:pb-28">
      <AccountView
        account={account}
        receipts={
          <Suspense fallback={<ListSkeleton rows={3} label="Loading receipts" />}>
            <AccountReceipts account={account} />
          </Suspense>
        }
        history={
          <Suspense fallback={<ListSkeleton rows={2} label="Loading history" />}>
            <AccountHistory account={account} />
          </Suspense>
        }
        letter={<ClaimLetter account={account} />}
        settledPayout={
          <Suspense fallback={<Skeleton className="h-5 w-20" rounded="sm" />}>
            <SettledPayout account={account} />
          </Suspense>
        }
      />
    </div>
  );
}
