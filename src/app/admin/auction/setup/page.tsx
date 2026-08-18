import type { Metadata } from "next";
import { getAuctionSetupData } from "@/app/admin/auction/setup/actions";
import { AuctionSetupForm } from "@/app/admin/auction/setup/setup-form";

export const metadata: Metadata = { title: "Auction setup" };
export const dynamic = "force-dynamic";

export default async function AdminAuctionSetupPage() {
  const data = await getAuctionSetupData();

  if (!data.eventEditionId) {
    return <div className="p-10 text-ink-2">No active event edition.</div>;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="mb-8 space-y-1">
        <h1 className="font-heading text-xl font-semibold">Auction setup</h1>
        <p className="text-sm text-ink-2">
          Seat the 12 franchises and control what participants can see before and during the auction.
        </p>
      </div>
      <AuctionSetupForm data={data} />
    </div>
  );
}
