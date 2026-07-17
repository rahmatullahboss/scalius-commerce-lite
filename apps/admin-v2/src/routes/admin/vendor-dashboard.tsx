import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  CreditCard,
  Edit3,
  Package,
  Plus,
  Send,
  ShoppingCart,
  Store,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { RouteErrorComponent } from "~/lib/route-error";
import { warmRouteQuery } from "~/lib/route-query-warming";
import {
  vendorDashboardCategoriesQueryOptions,
  vendorDashboardContextQueryOptions,
  vendorDashboardDeliveryProvidersQueryOptions,
  vendorDashboardOrderQueryOptions,
  vendorDashboardOrdersQueryOptions,
  vendorDashboardPayoutMethodsQueryOptions,
  vendorDashboardProductQueryOptions,
  vendorDashboardProductVariantsQueryOptions,
  vendorDashboardProductsQueryOptions,
  vendorDashboardShipmentsQueryOptions,
  vendorDashboardSummaryQueryOptions,
} from "~/lib/api-query-options/vendor-dashboard";
import {
  applyForVendorDashboard,
  createVendorDashboardPayoutMethod,
  createVendorDashboardProduct,
  createVendorDashboardShipment,
  checkVendorDashboardShipmentStatus,
  disableVendorDashboardPayoutMethod,
  setDefaultVendorDashboardPayoutMethod,
  submitVendorDashboardProduct,
  updateVendorDashboardOrderStatus,
  updateVendorDashboardProduct,
  updateVendorDashboardProductVariant,
  updateVendorDashboardShipmentStatus,
  type VendorDashboardContext,
  type VendorDashboardOrderRow,
  type VendorDashboardPayoutMethod,
  type VendorDashboardProductDetail,
  type VendorDashboardProductVariant,
  type VendorDashboardProductRow,
  type VendorDashboardShipmentRow,
  type VendorDashboardSummaryPayload,
} from "~/lib/api-functions/vendor-dashboard";
import type { CreateProductInput } from "~/lib/api-functions/products";
import { queryKeys } from "~/lib/query-keys";
import { ADMIN_PERMISSIONS } from "~/lib/admin-permissions";
import { usePermissions } from "~/contexts/PermissionContext";
import { ProductForm } from "~/components/admin/ProductForm";
import { SellerInviteAcceptancePanel, VendorTeamPanel } from "~/components/admin/vendor-dashboard/VendorTeamPanels";
import { VendorProfilePanel } from "~/components/admin/vendor-dashboard/VendorProfilePanel";
import type { Category } from "~/components/admin/product-form/types";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";

const PAGE_SIZE = 50;
type VendorDashboardSearch = { vendorId?: string };

type EditorState =
  | { mode: "create" }
  | { mode: "edit"; productId: string }
  | null;

function validateVendorDashboardSearch(search: Record<string, unknown>): VendorDashboardSearch {
  const vendorId = typeof search.vendorId === "string" && search.vendorId.trim()
    ? search.vendorId.trim()
    : undefined;
  return { vendorId };
}

function params(search: VendorDashboardSearch) {
  return { vendorId: search.vendorId };
}

export const Route = createFileRoute("/admin/vendor-dashboard")({
  validateSearch: validateVendorDashboardSearch,
  loaderDeps: ({ search }) => search,
  loader: async (loaderArgs) => {
    const { context, deps } = loaderArgs as {
      context: { queryClient: QueryClient };
      deps: VendorDashboardSearch;
    };
    await Promise.all([
      warmRouteQuery(context.queryClient, vendorDashboardContextQueryOptions(params(deps))),
      warmRouteQuery(context.queryClient, vendorDashboardSummaryQueryOptions(params(deps))).catch(() => undefined),
    ]);
  },
  head: () => ({ meta: [{ title: "Seller Dashboard | Marketplace Admin" }] }),
  component: VendorDashboardPage,
  errorComponent: RouteErrorComponent,
});

function VendorDashboardPage() {
  const search = Route.useSearch() as VendorDashboardSearch;
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const contextQuery = useQuery(vendorDashboardContextQueryOptions(params(search)));
  const summaryQuery = useQuery(vendorDashboardSummaryQueryOptions(params(search)));
  const memberships = contextQuery.data?.memberships ?? [];
  const selectedVendorId = summaryQuery.data?.vendor.vendorId
    ?? contextQuery.data?.currentVendor?.vendorId
    ?? search.vendorId;
  const selectedMembership = memberships.find((membership) => membership.vendorId === selectedVendorId)
    ?? contextQuery.data?.currentVendor
    ?? null;
  const canManageTeam = selectedMembership?.vendorStatus === "approved" &&
    (selectedMembership.role === "owner" || selectedMembership.role === "admin");

  function selectVendor(vendorId: string) {
    void navigate({ search: (() => ({ vendorId: vendorId || undefined })) as never });
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Seller Dashboard</h1>
          <p className="text-muted-foreground">
            Manage seller products, fulfillment, shipments, and ledger-derived balances.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedVendorId ?? ""}
            onChange={(event) => selectVendor(event.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {memberships.length === 0 ? <option value="">No vendor access</option> : null}
            {memberships.map((membership) => (
              <option key={membership.vendorId} value={membership.vendorId}>
                {membership.vendorName}
              </option>
            ))}
          </select>
          {hasPermission(ADMIN_PERMISSIONS.VENDORS_VIEW) ? (
            <Button asChild variant="outline" size="sm">
              <a href="/admin/vendors">Manage vendors</a>
            </Button>
          ) : null}
        </div>
      </div>

      <SellerInviteAcceptancePanel onAccepted={selectVendor} />

      {selectedMembership?.vendorStatus === "approved" && summaryQuery.isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Vendor dashboard is unavailable for this user or vendor.
          </CardContent>
        </Card>
      ) : null}

      {selectedVendorId && selectedMembership?.vendorStatus === "approved" ? (
        <Tabs defaultValue="overview" className="space-y-5">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="products">Products</TabsTrigger>
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="shipments">Shipments</TabsTrigger>
            <TabsTrigger value="finance">Finance</TabsTrigger>
            {canManageTeam ? <TabsTrigger value="profile">Store profile</TabsTrigger> : null}
            {canManageTeam ? <TabsTrigger value="team">Team</TabsTrigger> : null}
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <OverviewPanel summary={summaryQuery.data} />
          </TabsContent>
          <TabsContent value="products">
            <VendorProductsPanel vendorId={selectedVendorId} />
          </TabsContent>
          <TabsContent value="orders">
            <VendorOrdersPanel vendorId={selectedVendorId} />
          </TabsContent>
          <TabsContent value="shipments">
            <VendorShipmentsPanel vendorId={selectedVendorId} />
          </TabsContent>
          <TabsContent value="finance">
            <VendorFinancePanel vendorId={selectedVendorId} summary={summaryQuery.data} />
          </TabsContent>
          {canManageTeam ? (
            <TabsContent value="profile">
              <VendorProfilePanel vendorId={selectedVendorId} />
            </TabsContent>
          ) : null}
          {canManageTeam ? (
            <TabsContent value="team">
              <VendorTeamPanel vendorId={selectedVendorId} />
            </TabsContent>
          ) : null}
        </Tabs>
      ) : selectedMembership ? (
        <SellerApplicationStatusPanel membership={selectedMembership} onResubmitted={selectVendor} />
      ) : (
        <SellerApplicationPanel onApplied={selectVendor} />
      )}
    </div>
  );
}

interface SellerApplicationPanelProps {
  onApplied: (vendorId: string) => void;
  initialName?: string;
  initialSlug?: string;
  mode?: "apply" | "resubmit";
}

function SellerApplicationPanel({
  onApplied,
  initialName = "",
  initialSlug = "",
  mode = "apply",
}: SellerApplicationPanelProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(initialSlug);
  const [legalName, setLegalName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [district, setDistrict] = useState("");
  const [upazila, setUpazila] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [slugEdited, setSlugEdited] = useState(Boolean(initialSlug));
  const isResubmission = mode === "resubmit";

  const mutation = useMutation({
    mutationFn: () => applyForVendorDashboard({
      data: {
        name: name.trim(),
        slug: slug.trim(),
        legalName: legalName.trim() || null,
        contactEmail: contactEmail.trim() || null,
        contactPhone: contactPhone.trim() || null,
        businessAddress: businessAddress.trim(),
        district: district.trim(),
        upazila: upazila.trim() || null,
        pickupAddress: pickupAddress.trim() || null,
      },
    }),
    onSuccess: (result) => {
      toast.success(
        result.replayed
          ? "Existing seller application loaded"
          : isResubmission
            ? "Corrected seller application resubmitted for review"
            : "Seller application submitted for review",
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.vendorDashboard.all });
      onApplied(result.vendorId);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to submit seller application"),
  });

  const disabled = !name.trim() || !slug.trim() || !businessAddress.trim() || !district.trim();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isResubmission ? "Correct and resubmit seller application" : "Apply to become a seller"}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {isResubmission
            ? "Update the rejected application with corrected business and pickup details. Resubmission returns the same seller record to platform review."
            : "Submit your store details for platform review. Commission policy and approval status are controlled by the marketplace."}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Store name">
            <input
              value={name}
              onChange={(event) => {
                const nextName = event.target.value;
                setName(nextName);
                if (!slugEdited) setSlug(normalizeSellerSlug(nextName));
              }}
              className="h-9 w-full rounded-md border px-3"
              placeholder="Seller One"
            />
          </Field>
          <Field label="Store URL slug">
            <input
              value={slug}
              onChange={(event) => {
                setSlugEdited(true);
                setSlug(normalizeSellerSlug(event.target.value));
              }}
              className="h-9 w-full rounded-md border px-3"
              placeholder="seller-one"
            />
          </Field>
          <Field label="Legal name">
            <input value={legalName} onChange={(event) => setLegalName(event.target.value)} className="h-9 w-full rounded-md border px-3" />
          </Field>
          <Field label="Contact email">
            <input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} className="h-9 w-full rounded-md border px-3" />
          </Field>
          <Field label="Contact phone">
            <input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} className="h-9 w-full rounded-md border px-3" />
          </Field>
          <Field label="District">
            <input value={district} onChange={(event) => setDistrict(event.target.value)} className="h-9 w-full rounded-md border px-3" />
          </Field>
          <Field label="Upazila">
            <input value={upazila} onChange={(event) => setUpazila(event.target.value)} className="h-9 w-full rounded-md border px-3" />
          </Field>
          <Field label="Business address">
            <textarea value={businessAddress} onChange={(event) => setBusinessAddress(event.target.value)} className="min-h-24 w-full rounded-md border px-3 py-2" />
          </Field>
          <Field label="Pickup address">
            <textarea value={pickupAddress} onChange={(event) => setPickupAddress(event.target.value)} className="min-h-24 w-full rounded-md border px-3 py-2" placeholder="Leave blank to use business address" />
          </Field>
        </div>
        <Button onClick={() => mutation.mutate()} disabled={disabled || mutation.isPending}>
          {mutation.isPending
            ? "Submitting…"
            : isResubmission
              ? "Resubmit seller application"
              : "Submit seller application"}
        </Button>
      </CardContent>
    </Card>
  );
}

function SellerApplicationStatusPanel({
  membership,
  onResubmitted,
}: {
  membership: VendorDashboardContext;
  onResubmitted: (vendorId: string) => void;
}) {
  const descriptions: Record<VendorDashboardContext["vendorStatus"], string> = {
    pending: "Your seller application is under platform review. Catalog, fulfillment, and payout operations remain locked until approval.",
    approved: "Your seller store is approved.",
    rejected: "Your seller application was rejected. Correct the business details below and resubmit the same seller record for review.",
    suspended: "Seller operations are suspended by the marketplace. Existing records remain preserved.",
    closed: "This seller store is closed and operational access is disabled.",
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{membership.vendorName}</CardTitle>
            <StatusPill status={membership.vendorStatus} />
          </div>
          <p className="text-sm text-muted-foreground">Reserved storefront: /vendors/{membership.vendorSlug}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">{descriptions[membership.vendorStatus]}</p>
          <p className="text-xs text-muted-foreground">Application ID: {membership.vendorId}</p>
        </CardContent>
      </Card>
      {membership.vendorStatus === "rejected" ? (
        <SellerApplicationPanel
          mode="resubmit"
          initialName={membership.vendorName}
          initialSlug={membership.vendorSlug}
          onApplied={onResubmitted}
        />
      ) : null}
    </div>
  );
}

function normalizeSellerSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function OverviewPanel({ summary }: { summary?: VendorDashboardSummaryPayload }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard icon={Store} label="Vendor" value={summary?.vendor.vendorName ?? "—"} hint={summary?.vendor.role ?? "No role"} />
      <MetricCard icon={Package} label="Products" value={String(summary?.products.total ?? 0)} hint={`${summary?.products.active ?? 0} active · ${summary?.products.pendingApproval ?? 0} pending`} />
      <MetricCard icon={ShoppingCart} label="Fulfillment" value={String(summary?.fulfillment.total ?? 0)} hint={`${summary?.fulfillment.pending ?? 0} pending · ${summary?.fulfillment.shipped ?? 0} shipped`} />
      <MetricCard icon={CreditCard} label="Payout methods" value={String(summary?.payoutMethods.total ?? 0)} hint={`${summary?.payoutMethods.verified ?? 0} verified`} />
    </div>
  );
}

function VendorProductsPanel({ vendorId }: { vendorId: string }) {
  const queryClient = useQueryClient();
  const productsQuery = useQuery(vendorDashboardProductsQueryOptions({ vendorId, page: 1, limit: PAGE_SIZE }));
  const categoriesQuery = useQuery(vendorDashboardCategoriesQueryOptions({ vendorId }));
  const [editor, setEditor] = useState<EditorState>(null);
  const submitMutation = useMutation({
    mutationFn: (productId: string) => submitVendorDashboardProduct({ data: { vendorId, productId } }),
    onSuccess: () => {
      toast.success("Product submitted for review");
      void queryClient.invalidateQueries({ queryKey: queryKeys.vendorDashboard.all });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to submit product"),
  });

  if (editor) {
    return (
      <ProductEditor
        vendorId={vendorId}
        productId={editor.mode === "edit" ? editor.productId : undefined}
        categories={(categoriesQuery.data?.categories ?? []) as Category[]}
        onClose={() => setEditor(null)}
      />
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Seller products</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Draft, submit, and revise products without platform-admin access.</p>
        </div>
        <Button onClick={() => setEditor({ mode: "create" })} disabled={categoriesQuery.isLoading}>
          <Plus className="mr-2 h-4 w-4" />New product
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {productsQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading products…</p> : null}
        {(productsQuery.data?.products ?? []).map((product) => (
          <div key={product.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{product.name}</p>
                <StatusPill status={product.approvalStatus} />
                {!product.isActive ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Inactive</span> : null}
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground">/{product.slug} · ৳{product.price.toLocaleString()}</p>
            </div>
            <div className="flex gap-2">
              {canEditProduct(product) ? (
                <Button variant="outline" size="sm" onClick={() => setEditor({ mode: "edit", productId: product.id })}>
                  <Edit3 className="mr-1 h-3.5 w-3.5" />Edit
                </Button>
              ) : null}
              {product.approvalStatus === "draft" || product.approvalStatus === "rejected" ? (
                <Button size="sm" onClick={() => submitMutation.mutate(product.id)} disabled={submitMutation.isPending}>
                  <Send className="mr-1 h-3.5 w-3.5" />Submit
                </Button>
              ) : null}
            </div>
          </div>
        ))}
        {!productsQuery.isLoading && (productsQuery.data?.products.length ?? 0) === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No seller products yet.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ProductEditor({
  vendorId,
  productId,
  categories,
  onClose,
}: {
  vendorId: string;
  productId?: string;
  categories: Category[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    ...vendorDashboardProductQueryOptions({ vendorId, productId: productId ?? "new-product" }),
    enabled: Boolean(productId),
  });
  if (productId && detailQuery.isLoading) {
    return <Card><CardContent className="p-8 text-sm text-muted-foreground">Loading product editor…</CardContent></Card>;
  }
  if (productId && !detailQuery.data) {
    return <Card><CardContent className="p-8 text-sm text-destructive">Seller product could not be loaded.</CardContent></Card>;
  }
  const product = detailQuery.data;
  const defaultValues = product ? productDefaults(product) : undefined;

  async function submitProduct(values: CreateProductInput) {
    if (productId) {
      return updateVendorDashboardProduct({
        data: { vendorId, productId, product: { ...values, id: productId } },
      });
    }
    return createVendorDashboardProduct({ data: { vendorId, product: values } });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{productId ? "Edit seller product" : "New seller product"}</h2>
          <p className="text-sm text-muted-foreground">Approved product edits are automatically resubmitted for moderation.</p>
        </div>
        <Button variant="outline" onClick={onClose}>Back to products</Button>
      </div>
      <ProductForm
        key={productId ?? "new"}
        categories={categories}
        defaultValues={defaultValues}
        isEdit={Boolean(productId)}
        enableVariantLoading={false}
        submitProduct={submitProduct}
        successDescription={productId ? "Seller product revision saved." : "Seller product draft created."}
        onSubmitSuccess={() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.vendorDashboard.all });
          onClose();
        }}
      />
      {productId ? <VariantInventoryPanel vendorId={vendorId} productId={productId} /> : null}
    </div>
  );
}

interface VariantDraft {
  size: string;
  color: string;
  weight: string;
  sku: string;
  price: string;
  stock: string;
  trackInventory: boolean;
  barcode: string;
  barcodeType: "" | "ean13" | "upc" | "isbn" | "gtin" | "custom";
  discountType: "percentage" | "flat";
  discountValue: string;
}

function VariantInventoryPanel({ vendorId, productId }: { vendorId: string; productId: string }) {
  const queryClient = useQueryClient();
  const variantsQuery = useQuery(vendorDashboardProductVariantsQueryOptions({ vendorId, productId }));
  const mutation = useMutation({
    mutationFn: ({ variant, draft }: { variant: VendorDashboardProductVariant; draft: VariantDraft }) =>
      updateVendorDashboardProductVariant({
        data: {
          vendorId,
          productId,
          variantId: variant.id,
          variant: {
            size: draft.size.trim() || null,
            color: draft.color.trim() || null,
            weight: draft.weight.trim() ? Number(draft.weight) : null,
            sku: draft.sku.trim(),
            price: Number(draft.price),
            stock: Math.max(0, Math.trunc(Number(draft.stock))),
            trackInventory: draft.trackInventory,
            barcode: draft.barcode.trim() || null,
            barcodeType: draft.barcodeType || null,
            discountType: draft.discountType,
            discountPercentage: draft.discountType === "percentage" ? Number(draft.discountValue || 0) : 0,
            discountAmount: draft.discountType === "flat" ? Number(draft.discountValue || 0) : 0,
          },
        },
      }),
    onSuccess: (result) => {
      toast.success(
        result.approvalStatus === "submitted"
          ? "SKU saved and product resubmitted for review"
          : "SKU and inventory saved",
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.vendorDashboard.all });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to save SKU"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>SKU and inventory</CardTitle>
        <p className="text-sm text-muted-foreground">Stock-only changes stay live. SKU, price, option, barcode, or discount changes are resubmitted for moderation.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {variantsQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading SKUs…</p> : null}
        {(variantsQuery.data?.variants ?? []).map((variant) => (
          <VariantEditorRow
            key={`${variant.id}:${variant.version}:${variant.stockVersion}`}
            variant={variant}
            saving={mutation.isPending}
            onSave={(draft) => mutation.mutate({ variant, draft })}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function VariantEditorRow({
  variant,
  saving,
  onSave,
}: {
  variant: VendorDashboardProductVariant;
  saving: boolean;
  onSave: (draft: VariantDraft) => void;
}) {
  const [draft, setDraft] = useState<VariantDraft>(() => ({
    size: variant.size ?? "",
    color: variant.color ?? "",
    weight: variant.weight == null ? "" : String(variant.weight),
    sku: variant.sku,
    price: String(variant.price),
    stock: String(variant.stock),
    trackInventory: variant.trackInventory,
    barcode: variant.barcode ?? "",
    barcodeType: variant.barcodeType ?? "",
    discountType: variant.discountType ?? "percentage",
    discountValue: String(
      (variant.discountType ?? "percentage") === "flat"
        ? variant.discountAmount ?? 0
        : variant.discountPercentage ?? 0,
    ),
  }));
  const set = <K extends keyof VariantDraft>(key: K, value: VariantDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">{variant.isDefault ? "Simple product SKU" : [variant.color, variant.size].filter(Boolean).join(" / ") || "Option SKU"}</p>
          <p className="text-xs text-muted-foreground">Reserved stock: {variant.reservedStock} · stock version {variant.stockVersion}</p>
        </div>
        <Button size="sm" onClick={() => onSave(draft)} disabled={saving || !draft.sku.trim()}>Save SKU</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="SKU"><input value={draft.sku} onChange={(event) => set("sku", event.target.value)} className="h-9 w-full rounded-md border px-3" /></Field>
        <Field label="Stock"><input type="number" min={0} value={draft.stock} onChange={(event) => set("stock", event.target.value)} className="h-9 w-full rounded-md border px-3" /></Field>
        <Field label={variant.isDefault ? "Price (from product)" : "Price"}><input type="number" min={0} value={draft.price} disabled={variant.isDefault} onChange={(event) => set("price", event.target.value)} className="h-9 w-full rounded-md border px-3 disabled:bg-muted" /></Field>
        <Field label="Weight"><input type="number" min={0} value={draft.weight} onChange={(event) => set("weight", event.target.value)} className="h-9 w-full rounded-md border px-3" /></Field>
        <Field label="Size"><input value={draft.size} disabled={variant.isDefault} onChange={(event) => set("size", event.target.value)} className="h-9 w-full rounded-md border px-3 disabled:bg-muted" /></Field>
        <Field label="Color"><input value={draft.color} disabled={variant.isDefault} onChange={(event) => set("color", event.target.value)} className="h-9 w-full rounded-md border px-3 disabled:bg-muted" /></Field>
        <Field label="Barcode"><input value={draft.barcode} onChange={(event) => set("barcode", event.target.value)} className="h-9 w-full rounded-md border px-3" /></Field>
        <Field label="Barcode type"><select value={draft.barcodeType} onChange={(event) => set("barcodeType", event.target.value as VariantDraft["barcodeType"])} className="h-9 w-full rounded-md border bg-background px-3"><option value="">None</option><option value="ean13">EAN-13</option><option value="upc">UPC</option><option value="isbn">ISBN</option><option value="gtin">GTIN</option><option value="custom">Custom</option></select></Field>
        <Field label="Discount type"><select value={draft.discountType} onChange={(event) => set("discountType", event.target.value as VariantDraft["discountType"])} className="h-9 w-full rounded-md border bg-background px-3"><option value="percentage">Percentage</option><option value="flat">Flat</option></select></Field>
        <Field label="Discount value"><input type="number" min={0} value={draft.discountValue} onChange={(event) => set("discountValue", event.target.value)} className="h-9 w-full rounded-md border px-3" /></Field>
        <label className="flex items-center gap-2 self-end rounded-md border px-3 py-2 text-sm"><input type="checkbox" checked={draft.trackInventory} onChange={(event) => set("trackInventory", event.target.checked)} />Track inventory</label>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1 text-sm"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>;
}

function VendorOrdersPanel({ vendorId }: { vendorId: string }) {
  const queryClient = useQueryClient();
  const ordersQuery = useQuery(vendorDashboardOrdersQueryOptions({ vendorId, page: 1, limit: PAGE_SIZE }));
  const [shipmentOrderId, setShipmentOrderId] = useState<string | null>(null);
  const statusMutation = useMutation({
    mutationFn: ({ order, status }: { order: VendorDashboardOrderRow; status: "processing" | "ready" }) =>
      updateVendorDashboardOrderStatus({
        data: { vendorId, vendorOrderId: order.id, expectedVersion: order.version, status },
      }),
    onSuccess: () => {
      toast.success("Fulfillment status updated");
      void queryClient.invalidateQueries({ queryKey: queryKeys.vendorDashboard.all });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to update order"),
  });

  if (shipmentOrderId) {
    return <ShipmentEditor vendorId={vendorId} vendorOrderId={shipmentOrderId} onClose={() => setShipmentOrderId(null)} />;
  }

  return (
    <Card>
      <CardHeader><CardTitle>Seller fulfillment groups</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {(ordersQuery.data?.orders ?? []).map((order) => (
          <div key={order.id} className="flex flex-col gap-3 rounded-lg border p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2"><p className="font-medium">{order.customerName || "Customer"}</p><StatusPill status={order.status} /></div>
              <p className="mt-1 text-xs text-muted-foreground">Order {order.orderId} · seller group {order.id}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {order.status === "pending" ? <Button size="sm" onClick={() => statusMutation.mutate({ order, status: "processing" })}>Start processing</Button> : null}
              {order.status === "processing" ? <Button size="sm" onClick={() => statusMutation.mutate({ order, status: "ready" })}>Mark ready</Button> : null}
              {order.status === "processing" || order.status === "ready" ? (
                <Button variant="outline" size="sm" onClick={() => setShipmentOrderId(order.id)}>
                  <Truck className="mr-1 h-3.5 w-3.5" />Create shipment
                </Button>
              ) : null}
            </div>
          </div>
        ))}
        {!ordersQuery.isLoading && (ordersQuery.data?.orders.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">No seller orders found.</p> : null}
      </CardContent>
    </Card>
  );
}

function ShipmentEditor({ vendorId, vendorOrderId, onClose }: { vendorId: string; vendorOrderId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const orderQuery = useQuery(vendorDashboardOrderQueryOptions({ vendorId, vendorOrderId }));
  const providersQuery = useQuery(vendorDashboardDeliveryProvidersQueryOptions({ vendorId }));
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [providerId, setProviderId] = useState("manual");
  const [courierName, setCourierName] = useState("");
  const [trackingId, setTrackingId] = useState("");
  const [collectAmount, setCollectAmount] = useState("0");
  const mutation = useMutation({
    mutationFn: () => {
      const items = (orderQuery.data?.items ?? [])
        .map((item) => ({ orderItemId: item.id, quantity: quantities[item.id] ?? 0 }))
        .filter((item) => item.quantity > 0);
      if (items.length === 0) throw new Error("Select at least one shipment quantity");
      const shipmentAmountMinor = Math.round(Math.max(0, Number(collectAmount) || 0) * 100);
      return createVendorDashboardShipment({
        data: {
          vendorId,
          vendorOrderId,
          idempotencyKey: `${vendorOrderId}:${crypto.randomUUID()}`,
          items,
          providerId: providerId === "manual" ? null : providerId,
          providerType: providerId === "manual" ? "manual" : undefined,
          courierName: providerId === "manual" ? courierName || null : null,
          trackingId: providerId === "manual" ? trackingId || null : null,
          shipmentAmountMinor,
          isFinalShipment: items.every((item) => {
            const purchased = orderQuery.data?.items.find((candidate) => candidate.id === item.orderItemId)?.quantity ?? 0;
            return item.quantity === purchased;
          }),
        },
      });
    },
    onSuccess: (result) => {
      if (result.reconciliationRequired) {
        toast.warning(result.message || "Courier booking requires reconciliation before retrying");
      } else if (result.success === false) {
        toast.error(result.message || "Courier rejected the shipment");
      } else {
        toast.success(result.message || "Seller shipment created");
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.vendorDashboard.all });
      onClose();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to create shipment"),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between"><CardTitle>Create seller shipment</CardTitle><Button variant="outline" onClick={onClose}>Cancel</Button></CardHeader>
      <CardContent className="space-y-4">
        {(orderQuery.data?.items ?? []).map((item) => (
          <label key={item.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_120px] sm:items-center">
            <span><span className="font-medium">{item.productName || "Product"}</span><span className="block text-xs text-muted-foreground">{item.variantLabel || "Default variant"} · purchased {item.quantity}</span></span>
            <input type="number" min={0} max={item.quantity} value={quantities[item.id] ?? 0} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: Math.max(0, Math.min(item.quantity, Number(event.target.value) || 0)) }))} className="h-9 rounded-md border px-3" />
          </label>
        ))}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Courier provider">
            <select value={providerId} onChange={(event) => setProviderId(event.target.value)} className="h-9 w-full rounded-md border bg-background px-3">
              <option value="manual">Manual / own rider</option>
              {(providersQuery.data?.providers ?? []).map((provider) => <option key={provider.id} value={provider.id}>{provider.name} ({provider.type})</option>)}
            </select>
          </Field>
          <Field label="Amount to collect (BDT)">
            <input type="number" min={0} step="0.01" value={collectAmount} onChange={(event) => setCollectAmount(event.target.value)} className="h-9 w-full rounded-md border px-3" />
          </Field>
          {providerId === "manual" ? (
            <>
              <Field label="Courier name"><input value={courierName} onChange={(event) => setCourierName(event.target.value)} className="h-9 w-full rounded-md border px-3" /></Field>
              <Field label="Tracking ID"><input value={trackingId} onChange={(event) => setTrackingId(event.target.value)} className="h-9 w-full rounded-md border px-3" /></Field>
            </>
          ) : null}
        </div>
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || orderQuery.isLoading || providersQuery.isLoading}>{mutation.isPending ? "Creating…" : "Create shipment"}</Button>
      </CardContent>
    </Card>
  );
}

function VendorShipmentsPanel({ vendorId }: { vendorId: string }) {
  const queryClient = useQueryClient();
  const shipmentsQuery = useQuery(vendorDashboardShipmentsQueryOptions({ vendorId, page: 1, limit: PAGE_SIZE }));
  const mutation = useMutation({
    mutationFn: ({ shipment, status }: { shipment: VendorDashboardShipmentRow; status: VendorDashboardShipmentRow["status"] }) =>
      updateVendorDashboardShipmentStatus({
        data: { vendorId, shipmentId: shipment.id, expectedVersion: shipment.version, status },
      }),
    onSuccess: () => {
      toast.success("Shipment status updated");
      void queryClient.invalidateQueries({ queryKey: queryKeys.vendorDashboard.all });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to update shipment"),
  });
  const courierCheckMutation = useMutation({
    mutationFn: (shipmentId: string) => checkVendorDashboardShipmentStatus({
      data: { vendorId, shipmentId },
    }),
    onSuccess: (result) => {
      toast.success(
        result.applied
          ? `Courier status refreshed: ${result.status.replaceAll("_", " ")}`
          : "Courier status checked; no forward status change",
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.vendorDashboard.all });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to refresh courier status"),
  });

  return (
    <Card>
      <CardHeader><CardTitle>Seller shipments</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {(shipmentsQuery.data?.shipments ?? []).map((shipment) => {
          const nextStatuses = nextShipmentStatuses(shipment.status);
          return (
            <div key={shipment.id} className="flex flex-col gap-3 rounded-lg border p-4 lg:flex-row lg:items-center lg:justify-between">
              <div><div className="flex items-center gap-2"><p className="font-medium">Shipment {shipment.id}</p><StatusPill status={shipment.status} /></div><p className="mt-1 text-xs text-muted-foreground">Order group {shipment.vendorOrderId}{shipment.trackingId ? ` · tracking ${shipment.trackingId}` : ""}</p></div>
              <div className="flex flex-wrap items-center gap-2">
                {shipment.providerType !== "manual" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => courierCheckMutation.mutate(shipment.id)}
                    disabled={courierCheckMutation.isPending}
                  >
                    Refresh courier
                  </Button>
                ) : null}
                {nextStatuses.length > 0 ? (
                  <select defaultValue="" onChange={(event) => { const value = event.target.value as VendorDashboardShipmentRow["status"]; if (value) mutation.mutate({ shipment, status: value }); event.currentTarget.value = ""; }} className="h-9 rounded-md border bg-background px-3 text-sm">
                    <option value="">Update status…</option>
                    {nextStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
                  </select>
                ) : null}
              </div>
            </div>
          );
        })}
        {!shipmentsQuery.isLoading && (shipmentsQuery.data?.shipments.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">No seller shipments yet.</p> : null}
      </CardContent>
    </Card>
  );
}

function VendorFinancePanel({ vendorId, summary }: { vendorId: string; summary?: VendorDashboardSummaryPayload }) {
  const reporting = summary?.financialReporting;
  return (
    <div className="space-y-4">
      {!reporting || reporting.available === false ? (
        <Card><CardHeader><CardTitle>Seller balances</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{reporting?.reason ?? "Financial reporting is not available."}</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {reporting.balances.map((balance) => (
            <Card key={balance.currency}>
              <CardHeader><CardTitle>{balance.currency} balance</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <Balance label="Pending" value={moneyMinor(balance.pendingMinor, balance.currency)} />
                <Balance label="Available" value={moneyMinor(balance.availableMinor, balance.currency)} />
                <Balance label="Reserved" value={moneyMinor(balance.reservedMinor, balance.currency)} />
                <Balance label="Paid" value={moneyMinor(balance.paidMinor, balance.currency)} />
                <Balance label="Debt" value={moneyMinor(balance.debtMinor, balance.currency)} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <PayoutMethodManager vendorId={vendorId} />
    </div>
  );
}

function PayoutMethodManager({ vendorId }: { vendorId: string }) {
  const queryClient = useQueryClient();
  const methodsQuery = useQuery(vendorDashboardPayoutMethodsQueryOptions({ vendorId }));
  const [method, setMethod] = useState<VendorDashboardPayoutMethod["method"]>("bank");
  const [displayName, setDisplayName] = useState("");
  const [providerName, setProviderName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [destinationValue, setDestinationValue] = useState("");
  const [bankName, setBankName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [routingNumber, setRoutingNumber] = useState("");
  const [manualInstructions, setManualInstructions] = useState("");
  const [manualReference, setManualReference] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  function clearSensitiveForm() {
    setAccountName("");
    setDestinationValue("");
    setBankName("");
    setBranchName("");
    setRoutingNumber("");
    setManualInstructions("");
    setManualReference("");
  }

  function refreshMethods() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.vendorDashboard.payoutMethods({ vendorId }) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.vendorDashboard.all });
  }

  const createMutation = useMutation({
    mutationFn: () => {
      const destination: Record<string, string | null> = method === "bank"
        ? {
            accountName,
            accountNumber: destinationValue,
            bankName,
            branchName: branchName || null,
            routingNumber: routingNumber || null,
          }
        : method === "manual"
          ? { instructions: manualInstructions, reference: manualReference || null }
          : { accountName, phoneNumber: destinationValue };
      return createVendorDashboardPayoutMethod({
        data: {
          vendorId,
          method,
          displayName,
          providerName: providerName || null,
          isDefault,
          destination,
        },
      });
    },
    onSuccess: () => {
      toast.success("Payout destination encrypted and submitted for review");
      clearSensitiveForm();
      setDisplayName("");
      setProviderName("");
      setIsDefault(false);
      refreshMethods();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to register payout destination"),
  });
  const defaultMutation = useMutation({
    mutationFn: (methodId: string) => setDefaultVendorDashboardPayoutMethod({ data: { vendorId, methodId } }),
    onSuccess: () => { toast.success("Default payout destination updated"); refreshMethods(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to update default destination"),
  });
  const disableMutation = useMutation({
    mutationFn: (methodId: string) => disableVendorDashboardPayoutMethod({ data: { vendorId, methodId } }),
    onSuccess: () => { toast.success("Payout destination disabled"); refreshMethods(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to disable payout destination"),
  });

  const createDisabled = !displayName.trim() || (
    method === "bank"
      ? !accountName.trim() || !destinationValue.trim() || !bankName.trim()
      : method === "manual"
        ? !manualInstructions.trim()
        : !accountName.trim() || !destinationValue.trim()
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payout destinations</CardTitle>
        <p className="text-sm text-muted-foreground">Sensitive destination details are encrypted. Saved methods display only masked identifiers.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          {(methodsQuery.data?.payoutMethods ?? []).map((payoutMethod) => (
            <div key={payoutMethod.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{payoutMethod.displayName}</p>
                  <StatusPill status={payoutMethod.status} />
                  {payoutMethod.isDefault ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Default</span> : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{payoutMethod.providerName || payoutMethod.method}{payoutMethod.lastFour ? ` · ••••${payoutMethod.lastFour}` : ""}</p>
                {payoutMethod.rejectionReason ? <p className="mt-1 text-xs text-destructive">{payoutMethod.rejectionReason}</p> : null}
              </div>
              <div className="flex gap-2">
                {!payoutMethod.isDefault && (payoutMethod.status === "pending" || payoutMethod.status === "verified") ? <Button variant="outline" size="sm" onClick={() => defaultMutation.mutate(payoutMethod.id)}>Set default</Button> : null}
                {payoutMethod.status !== "disabled" ? <Button variant="outline" size="sm" onClick={() => disableMutation.mutate(payoutMethod.id)}>Disable</Button> : null}
              </div>
            </div>
          ))}
          {!methodsQuery.isLoading && (methodsQuery.data?.payoutMethods.length ?? 0) === 0 ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No payout destination registered.</p> : null}
        </div>

        <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
          <h3 className="font-medium">Register a new destination</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Method"><select value={method} onChange={(event) => { setMethod(event.target.value as VendorDashboardPayoutMethod["method"]); clearSensitiveForm(); }} className="h-9 w-full rounded-md border bg-background px-3"><option value="bank">Bank</option><option value="bkash">bKash</option><option value="nagad">Nagad</option><option value="rocket">Rocket</option><option value="manual">Manual</option></select></Field>
            <Field label="Display name"><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="h-9 w-full rounded-md border px-3" placeholder="Primary bank" /></Field>
            <Field label="Provider name"><input value={providerName} onChange={(event) => setProviderName(event.target.value)} className="h-9 w-full rounded-md border px-3" placeholder={method === "bank" ? "Bank name" : "Optional provider"} /></Field>
            {method === "manual" ? (
              <>
                <Field label="Instructions"><textarea value={manualInstructions} onChange={(event) => setManualInstructions(event.target.value)} className="min-h-24 w-full rounded-md border px-3 py-2" placeholder="Owner-approved manual payout instructions" /></Field>
                <Field label="Reference"><input value={manualReference} onChange={(event) => setManualReference(event.target.value)} className="h-9 w-full rounded-md border px-3" /></Field>
              </>
            ) : (
              <>
                <Field label="Account name"><input value={accountName} onChange={(event) => setAccountName(event.target.value)} className="h-9 w-full rounded-md border px-3" autoComplete="off" /></Field>
                <Field label={method === "bank" ? "Account number" : "Mobile number"}><input value={destinationValue} onChange={(event) => setDestinationValue(event.target.value)} className="h-9 w-full rounded-md border px-3" inputMode="numeric" autoComplete="off" /></Field>
                {method === "bank" ? <><Field label="Bank name"><input value={bankName} onChange={(event) => setBankName(event.target.value)} className="h-9 w-full rounded-md border px-3" /></Field><Field label="Branch"><input value={branchName} onChange={(event) => setBranchName(event.target.value)} className="h-9 w-full rounded-md border px-3" /></Field><Field label="Routing number"><input value={routingNumber} onChange={(event) => setRoutingNumber(event.target.value)} className="h-9 w-full rounded-md border px-3" inputMode="numeric" /></Field></> : null}
              </>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />Make default after registration</label>
          <Button onClick={() => createMutation.mutate()} disabled={createDisabled || createMutation.isPending}>Encrypt and submit</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({ icon: Icon, label, value, hint }: { icon: typeof Store; label: string; value: string; hint: string }) {
  return <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-full bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></div><div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="truncate text-xl font-semibold">{value}</p><p className="truncate text-xs text-muted-foreground">{hint}</p></div></CardContent></Card>;
}

function Balance({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>;
}

function StatusPill({ status }: { status: string }) {
  return <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize">{status.replaceAll("_", " ")}</span>;
}

function canEditProduct(product: VendorDashboardProductRow): boolean {
  return product.approvalStatus === "draft" || product.approvalStatus === "rejected" || product.approvalStatus === "approved";
}

function productDefaults(product: VendorDashboardProductDetail) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: product.price,
    categoryId: product.categoryId ?? "",
    slug: product.slug,
    metaTitle: product.metaTitle,
    metaDescription: product.metaDescription,
    isActive: product.isActive,
    discountType: (product.discountType || "percentage") as "percentage" | "flat",
    discountPercentage: product.discountPercentage || 0,
    discountAmount: product.discountAmount || 0,
    freeDelivery: product.freeDelivery,
    slugEdited: true,
    images: (product.images || []).map((image) => ({
      id: image.id,
      url: image.url,
      filename: image.alt ?? image.url.split("/").pop() ?? "image",
      size: 0,
      createdAt: new Date(image.createdAt),
    })),
    attributes: product.attributes || [],
    additionalInfo: product.additionalInfo || [],
  };
}

function nextShipmentStatuses(status: VendorDashboardShipmentRow["status"]): VendorDashboardShipmentRow["status"][] {
  const transitions: Partial<Record<VendorDashboardShipmentRow["status"], VendorDashboardShipmentRow["status"][]>> = {
    pending: ["processing", "pickup_assigned", "cancelled", "failed"],
    processing: ["pickup_assigned", "picked_up", "in_transit", "cancelled", "failed"],
    pickup_assigned: ["picked_up", "pickup_failed", "cancelled"],
    pickup_failed: ["pickup_assigned", "cancelled", "failed"],
    picked_up: ["in_transit", "returned"],
    in_transit: ["out_for_delivery", "delivered", "partial_delivered", "delivery_failed", "on_hold", "returned"],
    out_for_delivery: ["delivered", "partial_delivered", "delivery_failed", "on_hold", "returned"],
    partial_delivered: ["delivered", "returned"],
    delivery_failed: ["out_for_delivery", "returned", "cancelled"],
    on_hold: ["in_transit", "out_for_delivery", "returned", "cancelled"],
  };
  return transitions[status] ?? [];
}

function moneyMinor(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en-BD", { style: "currency", currency }).format(amountMinor / 100);
}
