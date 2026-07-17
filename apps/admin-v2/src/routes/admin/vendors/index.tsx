import { useMemo, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Store, Search } from "lucide-react";
import {
  createListSearchValidator,
  normalizeEnumSearchParam,
  type ListSearchParams,
  type SearchValidatorInput,
} from "~/lib/list-helpers";
import { RouteErrorComponent } from "~/lib/route-error";
import { warmRouteQuery } from "~/lib/route-query-warming";
import { vendorsQueryOptions } from "~/lib/api-query-options/vendors";
import { useUpdateVendorStatus } from "~/lib/api-mutations/marketplace-vendors";
import type { VendorStatus } from "~/lib/api-functions/vendors";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";

const vendorStatuses = ["all", "pending", "approved", "rejected", "suspended", "closed"] as const;
const updateStatuses = ["pending", "approved", "rejected", "suspended", "closed"] as const;

const baseSearchValidator = createListSearchValidator(
  ["createdAt", "updatedAt", "name", "status"] as const,
  { sort: "createdAt" },
);

type VendorSort = "createdAt" | "updatedAt" | "name" | "status";
type VendorSearchParams = ListSearchParams<VendorSort> & {
  status: (typeof vendorStatuses)[number];
};

function validateVendorSearch(search: SearchValidatorInput<VendorSearchParams>): VendorSearchParams {
  return {
    ...baseSearchValidator(search),
    status: normalizeEnumSearchParam(search.status, vendorStatuses, "all"),
  };
}

function mapParams(search: VendorSearchParams) {
  return {
    page: search.page,
    limit: search.limit,
    search: search.search || undefined,
    status: search.status,
    sort: search.sort,
    order: search.order,
  };
}

function formatMaybeDate(value: unknown): string {
  if (value == null) return "—";
  const date = value instanceof Date ? value : new Date(typeof value === "number" ? value * 1000 : String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
}

function statusBadgeClass(status: string): string {
  if (status === "approved") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (status === "pending") return "bg-amber-100 text-amber-700 border-amber-200";
  if (status === "rejected") return "bg-red-100 text-red-700 border-red-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

export const Route = createFileRoute("/admin/vendors/")({
  validateSearch: validateVendorSearch,
  loaderDeps: ({ search }) => search,
  staleTime: 1000 * 60 * 2,
  loader: async (loaderArgs) => {
    const { context, deps } = loaderArgs as {
      context: { queryClient: QueryClient };
      deps: VendorSearchParams;
    };
    await warmRouteQuery(context.queryClient, vendorsQueryOptions(mapParams(deps)));
  },
  head: () => ({ meta: [{ title: "Sellers | Marketplace Admin" }] }),
  component: VendorsPage,
  errorComponent: RouteErrorComponent,
});

function VendorsPage() {
  const search = Route.useSearch() as VendorSearchParams;
  const navigate = useNavigate();
  const [searchDraft, setSearchDraft] = useState(search.search);
  const updateStatus = useUpdateVendorStatus();
  const query = useQuery(vendorsQueryOptions(mapParams(search)));
  const vendors = useMemo(() => query.data?.vendors ?? [], [query.data]);
  const pagination = query.data?.pagination ?? {
    page: search.page,
    limit: search.limit,
    total: 0,
    totalPages: 0,
  };

  const stats = useMemo(() => {
    return vendors.reduce(
      (acc, vendor) => {
        acc.total += 1;
        acc[vendor.status as VendorStatus] += 1;
        return acc;
      },
      { total: 0, pending: 0, approved: 0, rejected: 0, suspended: 0, closed: 0 },
    );
  }, [vendors]);

  function updateSearch(updates: Partial<VendorSearchParams>) {
    void navigate({
      search: ((prev: Record<string, unknown>) => ({ ...prev, ...updates })) as never,
    });
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateSearch({ search: searchDraft, page: 1 });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Marketplace Vendors</h1>
          <p className="text-muted-foreground">Review seller applications, vendor status, payout and KYC readiness.</p>
        </div>
        <div className="flex items-center gap-2">
          {query.isFetching && !query.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Refreshing
            </div>
          ) : null}
          <Button asChild size="sm">
            <a href="/admin/vendors/new"><Plus className="h-4 w-4" /> New Vendor</a>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <VendorStat label="Visible" value={stats.total} />
        <VendorStat label="Pending" value={stats.pending} />
        <VendorStat label="Approved" value={stats.approved} />
        <VendorStat label="Rejected" value={stats.rejected} />
        <VendorStat label="Suspended" value={stats.suspended} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vendor Directory</CardTitle>
          <CardDescription>Filter vendors by status and search by name, slug, email, or phone.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSearchSubmit} className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Search vendors..."
                className="pl-9"
              />
            </div>
            <select
              value={search.status}
              onChange={(event) => updateSearch({ status: event.target.value as VendorSearchParams["status"], page: 1 })}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {vendorStatuses.map((status) => (
                <option key={status} value={status}>{status === "all" ? "All statuses" : status}</option>
              ))}
            </select>
            <Button type="submit" variant="outline">Search</Button>
          </form>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Legal name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Loading vendors...</TableCell></TableRow>
              ) : vendors.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No vendors found.</TableCell></TableRow>
              ) : vendors.map((vendor) => (
                <TableRow key={vendor.id}>
                  <TableCell>
                    <div className="font-medium">{vendor.name}</div>
                    <div className="text-xs text-muted-foreground">/{vendor.slug}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadgeClass(vendor.status)}>{vendor.status}</Badge>
                  </TableCell>
                  <TableCell>{vendor.legalName ?? "—"}</TableCell>
                  <TableCell>
                    <div>{vendor.contactPhone ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{vendor.contactEmail ?? "No email"}</div>
                  </TableCell>
                  <TableCell>{formatMaybeDate(vendor.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end gap-2 sm:flex-row sm:justify-end">
                      <select
                        value={vendor.status}
                        disabled={updateStatus.isPending}
                        onChange={(event) => updateStatus.mutate({ id: vendor.id, status: event.target.value as VendorStatus })}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      >
                        {updateStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                      <Button asChild variant="outline" size="sm">
                        <a href={`/admin/vendors/${vendor.id}`}>View</a>
                      </Button>
                      <Button asChild variant="ghost" size="sm">
                        <a href={`/admin/vendors/${vendor.id}/edit`}>Edit</a>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Showing page {pagination.page} of {Math.max(pagination.totalPages, 1)} · {pagination.total} total vendors
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page <= 1}
                onClick={() => updateSearch({ page: Math.max(1, pagination.page - 1) })}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.totalPages === 0 || pagination.page >= pagination.totalPages}
                onClick={() => updateSearch({ page: pagination.page + 1 })}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function VendorStat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-full bg-primary/10 p-2 text-primary">
          <Store className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
