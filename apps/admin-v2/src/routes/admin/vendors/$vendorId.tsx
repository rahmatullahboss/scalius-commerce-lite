import { createFileRoute, redirect } from "@tanstack/react-router";
import { useSuspenseQuery, type QueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileCheck2, Landmark, Store, Users } from "lucide-react";
import { RouteErrorComponent } from "~/lib/route-error";
import { formatMarketplaceDate } from "~/lib/marketplace-date";
import { vendorQueryOptions } from "~/lib/api-query-options/vendors";
import {
  useUpdateVendorKycDocumentStatus,
  useUpdateVendorPayoutAccountStatus,
  useUpdateVendorStatus,
} from "~/lib/api-mutations/marketplace-vendors";
import type {
  VendorDetail,
  VendorKycStatus,
  VendorPayoutStatus,
  VendorStatus,
} from "~/lib/api-functions/vendors";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Separator } from "~/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";

const updateStatuses: VendorStatus[] = ["pending", "approved", "rejected", "suspended", "closed"];
const payoutStatuses: VendorPayoutStatus[] = ["pending", "verified", "rejected", "disabled"];
const kycStatuses: VendorKycStatus[] = ["pending", "approved", "rejected", "expired"];

function statusBadgeClass(status: string): string {
  if (status === "approved" || status === "verified" || status === "active") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (status === "pending" || status === "invited") return "bg-amber-100 text-amber-700 border-amber-200";
  if (status === "rejected") return "bg-red-100 text-red-700 border-red-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

export const Route = createFileRoute("/admin/vendors/$vendorId")({
  loader: async (loaderArgs) => {
    const { context, params } = loaderArgs as {
      context: { queryClient: QueryClient };
      params: { vendorId: string };
    };
    const payload = await context.queryClient
      .ensureQueryData(vendorQueryOptions(params.vendorId))
      .catch(() => null);
    if (!payload) throw redirect({ href: "/admin/vendors" });
  },
  head: () => ({ meta: [{ title: "Seller Detail | Marketplace Admin" }] }),
  component: VendorDetailPage,
  errorComponent: RouteErrorComponent,
});

function VendorDetailPage() {
  const { vendorId } = Route.useParams() as { vendorId: string };
  const { data } = useSuspenseQuery(vendorQueryOptions(vendorId));
  const vendor = data.vendor as VendorDetail;
  const updateStatus = useUpdateVendorStatus();
  const updatePayoutStatus = useUpdateVendorPayoutAccountStatus();
  const updateKycStatus = useUpdateVendorKycDocumentStatus();
  const activeCommission = vendor.commissionRules.find((rule) => rule.status === "active");
  const businessAddress = vendor.addresses.find((address) => address.type === "business" && address.isDefault);
  const pickupAddress = vendor.addresses.find((address) => address.type === "pickup" && address.isDefault);

  function handleKycStatusChange(documentId: string, status: VendorKycStatus) {
    const rejectionReason = status === "rejected"
      ? window.prompt("Rejection reason", "")
      : null;
    if (status === "rejected" && rejectionReason === null) return;
    updateKycStatus.mutate({ vendorId: vendor.id, documentId, status, rejectionReason });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3">
            <a href="/admin/vendors"><ArrowLeft className="h-4 w-4" /> Back to vendors</a>
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{vendor.name}</h1>
            <Badge variant="outline" className={statusBadgeClass(vendor.status)}>{vendor.status}</Badge>
          </div>
          <p className="text-muted-foreground">/{vendor.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`/admin/vendors/${vendor.id}/edit`}>Edit</a>
          </Button>
          <select
            aria-label="Vendor status"
            value={vendor.status}
            disabled={updateStatus.isPending}
            onChange={(event) => updateStatus.mutate({ id: vendor.id, status: event.target.value as VendorStatus })}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {updateStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard icon={Store} label="Commission" value={`${((activeCommission?.rateBps ?? 0) / 100).toFixed(2)}%`} />
        <SummaryCard icon={Users} label="Members" value={String(vendor.members.length)} />
        <SummaryCard icon={FileCheck2} label="KYC Documents" value={String(vendor.kycDocuments.length)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Vendor Profile</CardTitle>
            <CardDescription>Business identity and contact information.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <InfoRow label="Legal name" value={vendor.legalName} />
            <InfoRow label="Email" value={vendor.contactEmail} />
            <InfoRow label="Phone" value={vendor.contactPhone} />
            <InfoRow label="District" value={businessAddress?.district ?? pickupAddress?.district} />
            <InfoRow label="Upazila" value={businessAddress?.upazila ?? pickupAddress?.upazila} />
            <Separator />
            <InfoRow label="Business address" value={businessAddress?.addressLine1} />
            <InfoRow label="Pickup address" value={pickupAddress?.addressLine1} />
            <InfoRow label="Created" value={formatMarketplaceDate(vendor.createdAt)} />
            <InfoRow label="Updated" value={formatMarketplaceDate(vendor.updatedAt)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payout Accounts</CardTitle>
            <CardDescription>Where vendor payouts will be sent.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {vendor.payoutAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payout accounts submitted.</p>
            ) : vendor.payoutAccounts.map((account) => (
              <div key={account.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">{account.displayName}</div>
                  <Badge variant="outline" className={statusBadgeClass(account.status)}>{account.status}</Badge>
                </div>
                <div className="mt-1 text-muted-foreground">{account.method} · •••• {account.lastFour ?? "—"}</div>
                <div className="mt-1 text-xs text-muted-foreground">{account.providerName ?? "Provider not set"}{account.isDefault ? " · Default" : ""}</div>
                <select
                  value={account.status}
                  disabled={updatePayoutStatus.isPending}
                  onChange={(event) => updatePayoutStatus.mutate({
                    vendorId: vendor.id,
                    accountId: account.id,
                    status: event.target.value as VendorPayoutStatus,
                  })}
                  className="mt-3 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  {payoutStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vendor Members</CardTitle>
          <CardDescription>Users who can operate this vendor account.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendor.members.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No members linked.</TableCell></TableRow>
              ) : vendor.members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="font-medium">{member.userName ?? member.userId}</div>
                    <div className="text-xs text-muted-foreground">{member.userEmail ?? "No email"}</div>
                  </TableCell>
                  <TableCell>{member.role}</TableCell>
                  <TableCell><Badge variant="outline" className={statusBadgeClass(member.status)}>{member.status}</Badge></TableCell>
                  <TableCell>{formatMarketplaceDate(member.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>KYC Documents</CardTitle>
          <CardDescription>Submitted documents for vendor approval.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reviewed</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>File</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendor.kycDocuments.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No KYC documents submitted.</TableCell></TableRow>
              ) : vendor.kycDocuments.map((document) => (
                <TableRow key={document.id}>
                  <TableCell>{document.type}</TableCell>
                  <TableCell><Badge variant="outline" className={statusBadgeClass(document.status)}>{document.status}</Badge></TableCell>
                  <TableCell>{formatMarketplaceDate(document.reviewedAt ?? document.createdAt)}</TableCell>
                  <TableCell>{document.rejectionReason ?? "—"}</TableCell>
                  <TableCell>{document.originalFilename ?? document.mimeType ?? "Stored securely"}</TableCell>
                  <TableCell className="text-right">
                    <select
                      value={document.status}
                      disabled={updateKycStatus.isPending}
                      onChange={(event) => handleKycStatusChange(document.id, event.target.value as VendorKycStatus)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {kycStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: typeof Landmark; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-full bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></div>
        <div><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold">{value}</p></div>
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[160px_1fr]">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value == null || value === "" ? "—" : String(value)}</dd>
    </div>
  );
}
