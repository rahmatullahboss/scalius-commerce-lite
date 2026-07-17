import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CreditCard, RefreshCcw, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { RouteErrorComponent } from "~/lib/route-error";
import { queryKeys } from "~/lib/query-keys";
import { getVendors } from "~/lib/api-functions/vendors";
import {
  claimMarketplacePayout,
  completeMarketplacePayout,
  getMarketplacePayoutMethods,
  getMarketplacePayouts,
  getMarketplaceReconciliation,
  moderateMarketplacePayoutMethod,
  previewMarketplacePayout,
  processMarketplaceOutbox,
  rebuildMarketplaceProjections,
  releaseMarketplacePayout,
  releaseMarketplaceSettlement,
  reserveMarketplacePayout,
  sweepMarketplaceSettlements,
  type MarketplacePayoutMethodReviewRow,
  type MarketplacePayoutPreview,
  type MarketplacePayoutRow,
  type MarketplaceReconciliation,
} from "~/lib/api-functions/marketplace-finance";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

export const Route = createFileRoute("/admin/marketplace-finance")({
  loader: async ({ context }: { context: { queryClient: QueryClient } }) => {
    await Promise.all([
      context.queryClient.ensureQueryData({
        queryKey: queryKeys.marketplaceFinance.reconciliation,
        queryFn: () => getMarketplaceReconciliation(),
      }),
      context.queryClient.ensureQueryData({
        queryKey: queryKeys.marketplaceFinance.payoutMethods({ status: "pending", page: 1, limit: 100 }),
        queryFn: () => getMarketplacePayoutMethods({ data: { status: "pending", page: 1, limit: 100 } }),
      }),
      context.queryClient.ensureQueryData({
        queryKey: queryKeys.marketplaceFinance.payouts({ page: 1, limit: 50 }),
        queryFn: () => getMarketplacePayouts({ data: { page: 1, limit: 50 } }),
      }),
    ]);
  },
  head: () => ({ meta: [{ title: "Marketplace Finance | Admin" }] }),
  component: MarketplaceFinancePage,
  errorComponent: RouteErrorComponent,
});

function MarketplaceFinancePage() {
  const queryClient = useQueryClient();
  const reconciliationQuery = useQuery({
    queryKey: queryKeys.marketplaceFinance.reconciliation,
    queryFn: () => getMarketplaceReconciliation(),
    refetchInterval: 60_000,
  });
  const payoutMethodsQuery = useQuery({
    queryKey: queryKeys.marketplaceFinance.payoutMethods({ status: "pending", page: 1, limit: 100 }),
    queryFn: () => getMarketplacePayoutMethods({ data: { status: "pending", page: 1, limit: 100 } }),
  });
  const payoutsQuery = useQuery({
    queryKey: queryKeys.marketplaceFinance.payouts({ page: 1, limit: 50 }),
    queryFn: () => getMarketplacePayouts({ data: { page: 1, limit: 50 } }),
  });
  const vendorsQuery = useQuery({
    queryKey: queryKeys.vendors.list({ page: 1, limit: 100, status: "approved" }),
    queryFn: () => getVendors({ data: { page: 1, limit: 100, status: "approved", sort: "name", order: "asc" } }),
  });

  function invalidateFinanceQueries() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.marketplaceFinance.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.vendorDashboard.all });
  }

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Marketplace Finance</h1>
        <p className="text-muted-foreground">Reconcile the immutable ledger, release settlements, and operate seller payouts.</p>
      </div>
      <ReconciliationPanel reconciliation={reconciliationQuery.data} />
      <MaintenancePanel onChanged={invalidateFinanceQueries} />
      <PayoutMethodReviewPanel
        payoutMethods={payoutMethodsQuery.data?.payoutMethods ?? []}
        loading={payoutMethodsQuery.isLoading}
        onChanged={invalidateFinanceQueries}
      />
      <PayoutCreationPanel
        vendors={vendorsQuery.data?.vendors ?? []}
        onChanged={invalidateFinanceQueries}
      />
      <PayoutOperationsPanel
        payouts={payoutsQuery.data?.payouts ?? []}
        loading={payoutsQuery.isLoading}
        onChanged={invalidateFinanceQueries}
      />
    </div>
  );
}

function ReconciliationPanel({ reconciliation }: { reconciliation?: MarketplaceReconciliation }) {
  const mismatchCount = reconciliation
    ? reconciliation.ledgerMismatches.length
      + reconciliation.financialEventMismatches.length
      + reconciliation.refundMismatches.length
      + reconciliation.payoutItemMismatches.length
      + reconciliation.payoutBatchMismatches.length
      + reconciliation.projectionMismatches.length
    : 0;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Reconciliation</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Successful payment/refund evidence, ledger balance, payouts, batches, and cached projections.</p>
        </div>
        {reconciliation?.healthy ? <CheckCircle2 className="h-6 w-6 text-emerald-600" /> : <AlertTriangle className="h-6 w-6 text-amber-600" />}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          <Stat label="Ledger entries" value={reconciliation?.ledgerEntries ?? 0} />
          <Stat label="Confirmed payments" value={reconciliation?.payments ?? 0} />
          <Stat label="Refunds" value={reconciliation?.refunds ?? 0} />
          <Stat label="Payouts" value={reconciliation?.payouts ?? 0} />
          <Stat label="Batches" value={reconciliation?.payoutBatches ?? 0} />
          <Stat label="Projections" value={reconciliation?.projections ?? 0} />
          <Stat label="Mismatches" value={mismatchCount} />
        </div>
        {mismatchCount > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            <MismatchList title="Ledger" items={reconciliation?.ledgerMismatches ?? []} />
            <MismatchList title="Financial event evidence" items={reconciliation?.financialEventMismatches ?? []} />
            <MismatchList title="Refund allocation" items={reconciliation?.refundMismatches ?? []} />
            <MismatchList title="Payout item" items={reconciliation?.payoutItemMismatches ?? []} />
            <MismatchList title="Payout batch" items={reconciliation?.payoutBatchMismatches ?? []} />
            <MismatchList title="Projection" items={reconciliation?.projectionMismatches ?? []} />
          </div>
        ) : <p className="text-sm text-emerald-700">No reconciliation mismatches detected.</p>}
      </CardContent>
    </Card>
  );
}

function MaintenancePanel({ onChanged }: { onChanged: () => void }) {
  const [vendorOrderId, setVendorOrderId] = useState("");
  const rebuild = useMutation({
    mutationFn: () => rebuildMarketplaceProjections(),
    onSuccess: (result) => { toast.success(`Rebuilt ${result.rebuild.vendors} seller projections`); invalidateFinanceQueries(); onChanged(); },
    onError: showError,
  });
  const outbox = useMutation({
    mutationFn: () => processMarketplaceOutbox({ data: { limit: 50 } }),
    onSuccess: (result) => { toast.success(`Processed ${result.processed} finance events`); invalidateFinanceQueries(); onChanged(); },
    onError: showError,
  });
  const sweep = useMutation({
    mutationFn: () => sweepMarketplaceSettlements({ data: { limit: 50 } }),
    onSuccess: (result) => { toast.success(`Released ${result.released} settlements`); invalidateFinanceQueries(); onChanged(); },
    onError: showError,
  });
  const releaseOne = useMutation({
    mutationFn: () => releaseMarketplaceSettlement({ data: { vendorOrderId: vendorOrderId.trim() } }),
    onSuccess: () => { toast.success("Settlement released"); setVendorOrderId(""); invalidateFinanceQueries(); onChanged(); },
    onError: showError,
  });

  function invalidateFinanceQueries() {
    onChanged();
  }

  return (
    <Card>
      <CardHeader><CardTitle>Maintenance and settlements</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => outbox.mutate()} disabled={outbox.isPending}><RefreshCcw className="mr-2 h-4 w-4" />Process outbox</Button>
          <Button variant="outline" onClick={() => rebuild.mutate()} disabled={rebuild.isPending}>Rebuild projections</Button>
          <Button variant="outline" onClick={() => sweep.mutate()} disabled={sweep.isPending}>Sweep eligible settlements</Button>
        </div>
        <div className="flex max-w-xl gap-2">
          <input value={vendorOrderId} onChange={(event) => setVendorOrderId(event.target.value)} placeholder="Vendor order ID" className="h-9 flex-1 rounded-md border px-3 text-sm" />
          <Button onClick={() => releaseOne.mutate()} disabled={!vendorOrderId.trim() || releaseOne.isPending}>Release one</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PayoutMethodReviewPanel({
  payoutMethods,
  loading,
  onChanged,
}: {
  payoutMethods: MarketplacePayoutMethodReviewRow[];
  loading: boolean;
  onChanged: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payout destination review</CardTitle>
        <p className="text-sm text-muted-foreground">
          Review masked seller destinations. Full account details remain encrypted and are never displayed here.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? <p className="text-sm text-muted-foreground">Loading pending destinations…</p> : null}
        {payoutMethods.map((method) => (
          <PayoutMethodReviewRow key={method.id} payoutMethod={method} onChanged={onChanged} />
        ))}
        {!loading && payoutMethods.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No pending payout destinations.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PayoutMethodReviewRow({
  payoutMethod,
  onChanged,
}: {
  payoutMethod: MarketplacePayoutMethodReviewRow;
  onChanged: () => void;
}) {
  const [reason, setReason] = useState("");
  const verify = useMutation({
    mutationFn: () => moderateMarketplacePayoutMethod({
      data: { methodId: payoutMethod.id, status: "verified" },
    }),
    onSuccess: () => {
      toast.success("Payout destination verified");
      onChanged();
    },
    onError: showError,
  });
  const reject = useMutation({
    mutationFn: () => moderateMarketplacePayoutMethod({
      data: {
        methodId: payoutMethod.id,
        status: "rejected",
        reason: reason.trim(),
      },
    }),
    onSuccess: () => {
      toast.success("Payout destination rejected");
      setReason("");
      onChanged();
    },
    onError: showError,
  });

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{payoutMethod.vendorName}</p>
            <Status status={payoutMethod.status} />
            {payoutMethod.isDefault ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Default</span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {payoutMethod.displayName} · {payoutMethod.providerName || payoutMethod.method}
            {payoutMethod.lastFour ? ` · ••••${payoutMethod.lastFour}` : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Method ID: {payoutMethod.id}</p>
        </div>
        <Button onClick={() => verify.mutate()} disabled={verify.isPending || reject.isPending}>
          Verify
        </Button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Rejection reason"
          className="h-9 flex-1 rounded-md border px-3 text-sm"
        />
        <Button
          variant="outline"
          onClick={() => reject.mutate()}
          disabled={!reason.trim() || verify.isPending || reject.isPending}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

function PayoutCreationPanel({ vendors, onChanged }: { vendors: Array<{ id: string; name: string }>; onChanged: () => void }) {
  const [vendorId, setVendorId] = useState("");
  const [currency, setCurrency] = useState("BDT");
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<MarketplacePayoutPreview | null>(null);
  const previewMutation = useMutation({
    mutationFn: () => previewMarketplacePayout({ data: { vendorId, currency } }),
    onSuccess: setPreview,
    onError: showError,
  });
  const reserveMutation = useMutation({
    mutationFn: () => reserveMarketplacePayout({
      data: {
        idempotencyKey: `admin-payout:${vendorId}:${currency}:${crypto.randomUUID()}`,
        vendorId,
        currency,
        amountMinor: amount.trim() ? Math.round(Number(amount) * 100) : undefined,
      },
    }),
    onSuccess: () => { toast.success("Payout balance reserved"); setAmount(""); setPreview(null); invalidateFinanceQueries(); onChanged(); },
    onError: showError,
  });

  function invalidateFinanceQueries() {
    onChanged();
  }

  return (
    <Card>
      <CardHeader><CardTitle>Create payout reservation</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <select value={vendorId} onChange={(event) => { setVendorId(event.target.value); setPreview(null); }} className="h-9 rounded-md border bg-background px-3 text-sm">
            <option value="">Select seller</option>
            {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
          </select>
          <input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} placeholder="Currency" className="h-9 rounded-md border px-3 text-sm" />
          <input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" min={0} step="0.01" placeholder="Amount; blank = all eligible" className="h-9 rounded-md border px-3 text-sm" />
          <Button variant="outline" onClick={() => previewMutation.mutate()} disabled={!vendorId || previewMutation.isPending}>Preview</Button>
        </div>
        {preview ? (
          <div className="rounded-lg border p-4 text-sm">
            <p className="font-medium">Eligible {moneyMinor(preview.eligibleMinor, preview.currency)}</p>
            <p className="text-muted-foreground">Destination: {preview.payoutMethod.displayName}{preview.payoutMethod.lastFour ? ` ••••${preview.payoutMethod.lastFour}` : ""}</p>
            <p className="text-muted-foreground">Available {moneyMinor(preview.balance.availableMinor, preview.currency)} · debt {moneyMinor(preview.balance.debtMinor, preview.currency)}</p>
            <Button className="mt-3" onClick={() => reserveMutation.mutate()} disabled={reserveMutation.isPending}>Reserve payout</Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PayoutOperationsPanel({ payouts, loading, onChanged }: { payouts: MarketplacePayoutRow[]; loading: boolean; onChanged: () => void }) {
  return (
    <Card>
      <CardHeader><CardTitle>Payout operations</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {loading ? <p className="text-sm text-muted-foreground">Loading payouts…</p> : null}
        {payouts.map((payout) => <PayoutOperationRow key={`${payout.id}:${payout.version}`} payout={payout} onChanged={onChanged} />)}
        {!loading && payouts.length === 0 ? <p className="text-sm text-muted-foreground">No payout obligations found.</p> : null}
      </CardContent>
    </Card>
  );
}

function PayoutOperationRow({ payout, onChanged }: { payout: MarketplacePayoutRow; onChanged: () => void }) {
  const [provider, setProvider] = useState(payout.payoutMethod === "manual" ? "manual" : payout.payoutMethod);
  const [providerReference, setProviderReference] = useState("");
  const [releaseReason, setReleaseReason] = useState("provider_failed");
  const claim = useMutation({ mutationFn: () => claimMarketplacePayout({ data: { payoutItemId: payout.id, provider } }), onSuccess: () => { toast.success("Payout claimed for dispatch"); invalidateFinanceQueries(); onChanged(); }, onError: showError });
  const complete = useMutation({ mutationFn: () => completeMarketplacePayout({ data: { payoutItemId: payout.id, providerReference } }), onSuccess: () => { toast.success("Payout completed"); invalidateFinanceQueries(); onChanged(); }, onError: showError });
  const release = useMutation({ mutationFn: () => releaseMarketplacePayout({ data: { payoutItemId: payout.id, reason: releaseReason } }), onSuccess: () => { toast.success("Payout reservation released"); invalidateFinanceQueries(); onChanged(); }, onError: showError });

  function invalidateFinanceQueries() {
    onChanged();
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><WalletCards className="h-4 w-4" /><p className="font-medium">{payout.vendorName}</p><Status status={payout.status} /></div>
          <p className="mt-1 text-xs text-muted-foreground">{moneyMinor(payout.amountMinor, payout.currency)} · {payout.payoutMethodDisplayName}{payout.payoutMethodLastFour ? ` ••••${payout.payoutMethodLastFour}` : ""}</p>
        </div>
        <p className="text-xs text-muted-foreground">{payout.id}</p>
      </div>
      {payout.status === "reserved" ? (
        <div className="flex gap-2"><input value={provider} onChange={(event) => setProvider(event.target.value)} className="h-9 flex-1 rounded-md border px-3 text-sm" placeholder="Provider" /><Button onClick={() => claim.mutate()} disabled={!provider.trim() || claim.isPending}>Claim</Button></div>
      ) : null}
      {payout.status === "processing" ? (
        <div className="grid gap-2 md:grid-cols-2">
          <div className="flex gap-2"><input value={providerReference} onChange={(event) => setProviderReference(event.target.value)} className="h-9 flex-1 rounded-md border px-3 text-sm" placeholder="Provider reference" /><Button onClick={() => complete.mutate()} disabled={!providerReference.trim() || complete.isPending}>Complete</Button></div>
          <div className="flex gap-2"><input value={releaseReason} onChange={(event) => setReleaseReason(event.target.value)} className="h-9 flex-1 rounded-md border px-3 text-sm" placeholder="Release reason" /><Button variant="outline" onClick={() => release.mutate()} disabled={!releaseReason.trim() || release.isPending}>Release</Button></div>
        </div>
      ) : null}
      {payout.status === "failed" ? <Button variant="outline" onClick={() => release.mutate()} disabled={release.isPending}>Release failed reservation</Button> : null}
      {payout.providerReference ? <p className="text-xs text-muted-foreground">Provider reference: {payout.providerReference}</p> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>;
}

function MismatchList({ title, items }: { title: string; items: unknown[] }) {
  return <div className="rounded-lg border p-3"><p className="font-medium">{title} mismatches ({items.length})</p><pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(items.slice(0, 10), null, 2)}</pre></div>;
}

function Status({ status }: { status: string }) {
  return <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{status.replaceAll("_", " ")}</span>;
}

function moneyMinor(value: number, currency: string) {
  return new Intl.NumberFormat("en-BD", { style: "currency", currency }).format(value / 100);
}

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : "Marketplace finance operation failed");
}
