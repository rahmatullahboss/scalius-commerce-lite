import { createServerFn } from "@tanstack/react-start";
import { apiGet, apiPatch, apiPost, apiPut } from "../api.server";
import type {
  CreateProductInput,
  ProductDetailDto,
  UpdateProductInput,
} from "./products";
import type { ApiTimestamp, VendorMemberRole, VendorMemberStatus, VendorStatus } from "./vendors";

export interface VendorDashboardContext {
  membershipId: string;
  vendorId: string;
  userId: string;
  role: VendorMemberRole;
  membershipStatus: VendorMemberStatus;
  vendorStatus: VendorStatus;
  vendorName: string;
  vendorSlug: string;
}

export interface VendorDashboardQueryInput {
  [key: string]: string | number | boolean | null | undefined;
  vendorId?: string;
}

export interface VendorDashboardListInput extends VendorDashboardQueryInput {
  page?: number;
  limit?: number;
}

export interface VendorDashboardContextPayload {
  currentVendor: VendorDashboardContext | null;
  memberships: VendorDashboardContext[];
}

export interface VendorDashboardApplicationInput {
  name: string;
  slug: string;
  legalName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  businessAddress: string;
  district: string;
  upazila?: string | null;
  pickupAddress?: string | null;
}

export interface VendorDashboardApplicationResult {
  vendorId: string;
  status: "pending" | "rejected";
  replayed: boolean;
}

export type VendorDashboardTeamRole = "admin" | "catalog" | "fulfillment" | "finance" | "viewer";
export type VendorDashboardTeamMemberStatus = "active" | "suspended" | "revoked";

export interface VendorDashboardTeamMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: VendorMemberRole;
  status: VendorMemberStatus;
  acceptedAt: ApiTimestamp | null;
  updatedAt: ApiTimestamp;
}

export interface VendorDashboardTeamInvite {
  inviteId: string;
  inviteeEmail: string;
  role: VendorDashboardTeamRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  invitedBy: string;
  expiresAt: ApiTimestamp;
  acceptedByUserId: string | null;
  acceptedAt: ApiTimestamp | null;
  revokedAt: ApiTimestamp | null;
  createdAt: ApiTimestamp;
}

export interface VendorDashboardTeamPayload {
  members: VendorDashboardTeamMember[];
  invites: VendorDashboardTeamInvite[];
}

export interface VendorDashboardCreateTeamInviteInput {
  vendorId: string;
  inviteeEmail: string;
  role: VendorDashboardTeamRole;
  expiresInHours?: number;
}

export interface VendorDashboardCreateTeamInviteResult {
  inviteId: string;
  vendorId: string;
  inviteeEmail: string;
  role: VendorDashboardTeamRole;
  expiresAt: ApiTimestamp;
  token: string;
}

export interface VendorDashboardAcceptTeamInviteInput {
  token: string;
}

export interface VendorDashboardAcceptTeamInviteResult {
  inviteId: string;
  vendorId: string;
  membershipId: string;
  role: VendorDashboardTeamRole;
}

export interface VendorDashboardUpdateTeamMemberInput {
  vendorId: string;
  membershipId: string;
  role?: VendorDashboardTeamRole;
  status?: VendorDashboardTeamMemberStatus;
}

export interface VendorDashboardUpdateTeamMemberResult {
  membershipId: string;
  role: VendorDashboardTeamRole;
  status: VendorDashboardTeamMemberStatus;
}

export interface VendorDashboardProfileInput {
  description: string | null;
  logoMediaId: string | null;
  bannerMediaId: string | null;
  showContactEmail: boolean;
  showContactPhone: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  returnPolicy: string | null;
  supportHours: string | null;
  publicationStatus: "draft" | "published";
}

export interface VendorDashboardProfilePayload extends VendorDashboardProfileInput {
  vendorId: string;
  contactEmail: string | null;
  contactPhone: string | null;
  createdAt: ApiTimestamp | null;
  updatedAt: ApiTimestamp | null;
}

export interface VendorDashboardSummaryPayload {
  vendor: VendorDashboardContext;
  products: { total: number; active: number; pendingApproval: number };
  fulfillment: {
    total: number;
    pending: number;
    processing: number;
    ready: number;
    shipped: number;
    delivered: number;
  };
  payoutMethods: { total: number; verified: number };
  financialReporting:
    | { available: false; reason: string }
    | {
        available: true;
        balances: Array<{
          currency: string;
          pendingMinor: number;
          availableMinor: number;
          reservedMinor: number;
          paidMinor: number;
          debtMinor: number;
          lastJournalId: string | null;
          version: number;
          updatedAt: ApiTimestamp;
        }>;
      };
}

export interface VendorDashboardOrderRow {
  id: string;
  orderId: string;
  status: "pending" | "processing" | "ready" | "shipped" | "delivered" | "cancelled";
  fulfillmentStatus: "pending" | "partial" | "complete" | "cancelled";
  version: number;
  customerName: string | null;
  createdAt: ApiTimestamp;
  updatedAt: ApiTimestamp;
}

export interface VendorDashboardProductRow {
  id: string;
  name: string;
  slug: string;
  price: number;
  approvalStatus: "draft" | "submitted" | "approved" | "rejected" | "suspended";
  isActive: boolean;
  createdAt: ApiTimestamp;
  updatedAt: ApiTimestamp;
}

export interface VendorDashboardOrdersPayload {
  orders: VendorDashboardOrderRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface VendorDashboardProductsPayload {
  products: VendorDashboardProductRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface VendorDashboardCategoriesPayload {
  categories: Array<{ id: string; name: string; slug: string }>;
}

export interface VendorDashboardOrderDetailPayload {
  order: VendorDashboardOrderRow;
  items: Array<{
    id: string;
    productName: string | null;
    variantLabel: string | null;
    quantity: number;
    fulfillmentStatus: string;
  }>;
}

export interface VendorDashboardProductDetail extends ProductDetailDto {
  approvalStatus: VendorDashboardProductRow["approvalStatus"];
  moderationVersion: number;
}

export interface VendorDashboardProductVariant {
  id: string;
  productId: string;
  isDefault: boolean;
  size: string | null;
  color: string | null;
  weight: number | null;
  sku: string;
  price: number;
  stock: number;
  reservedStock: number;
  stockVersion: number;
  version: number;
  trackInventory: boolean;
  barcode: string | null;
  barcodeType: "ean13" | "upc" | "isbn" | "gtin" | "custom" | null;
  discountType: "percentage" | "flat" | null;
  discountPercentage: number | null;
  discountAmount: number | null;
  createdAt: ApiTimestamp;
  updatedAt: ApiTimestamp;
}

export interface VendorDashboardProductVariantsPayload {
  variants: VendorDashboardProductVariant[];
}

export interface VendorDashboardPayoutMethod {
  id: string;
  vendorId: string;
  method: "bank" | "bkash" | "nagad" | "rocket" | "manual";
  displayName: string;
  lastFour: string | null;
  providerName: string | null;
  isDefault: boolean;
  status: "pending" | "verified" | "rejected" | "disabled";
  verifiedBy: string | null;
  verifiedAt: ApiTimestamp | null;
  rejectionReason: string | null;
  createdAt: ApiTimestamp;
  updatedAt: ApiTimestamp;
}

export interface VendorDashboardPayoutMethodsPayload {
  payoutMethods: VendorDashboardPayoutMethod[];
}

export interface VendorDashboardCreatePayoutMethodInput {
  vendorId?: string;
  method: VendorDashboardPayoutMethod["method"];
  displayName: string;
  providerName?: string | null;
  isDefault?: boolean;
  destination: Record<string, string | null>;
}

export interface VendorDashboardPayoutMethodIdInput extends VendorDashboardQueryInput {
  methodId: string;
}

export interface VendorDashboardShipmentRow {
  id: string;
  vendorOrderId: string;
  orderId: string;
  providerType: string;
  trackingId: string | null;
  trackingUrl: string | null;
  courierName: string | null;
  status:
    | "pending"
    | "processing"
    | "pickup_assigned"
    | "picked_up"
    | "pickup_failed"
    | "in_transit"
    | "out_for_delivery"
    | "delivered"
    | "partial_delivered"
    | "delivery_failed"
    | "on_hold"
    | "failed"
    | "returned"
    | "cancelled";
  shipmentAmountMinor: number;
  isFinalShipment: boolean;
  version: number;
  pickedUpAt: ApiTimestamp | null;
  deliveredAt: ApiTimestamp | null;
  cancelledAt: ApiTimestamp | null;
  createdAt: ApiTimestamp;
  updatedAt: ApiTimestamp;
}

export interface VendorDashboardShipmentsPayload {
  shipments: VendorDashboardShipmentRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface VendorDashboardDeliveryProvider {
  id: string;
  name: string;
  type: string;
}

export interface VendorDashboardDeliveryProvidersPayload {
  providers: VendorDashboardDeliveryProvider[];
}

export interface VendorDashboardShipmentListInput extends VendorDashboardListInput {
  vendorOrderId?: string;
  status?: VendorDashboardShipmentRow["status"];
}

export interface VendorDashboardProductMutationPayload {
  productId?: string;
  approvalStatus: "draft" | "submitted";
  moderationVersion?: number;
}

export interface VendorDashboardCreateProductInput {
  vendorId?: string;
  product: CreateProductInput;
}

export interface VendorDashboardUpdateProductInput {
  vendorId?: string;
  productId: string;
  product: UpdateProductInput;
}

export interface VendorDashboardProductIdInput extends VendorDashboardQueryInput {
  productId: string;
}

export interface VendorDashboardProductVariantUpdateInput {
  vendorId?: string;
  productId: string;
  variantId: string;
  variant: {
    size: string | null;
    color: string | null;
    weight: number | null;
    sku: string;
    price: number;
    stock: number;
    trackInventory?: boolean;
    barcode?: string | null;
    barcodeType?: "ean13" | "upc" | "isbn" | "gtin" | "custom" | null;
    discountType?: "percentage" | "flat";
    discountPercentage?: number | null;
    discountAmount?: number | null;
  };
}

export interface VendorDashboardOrderIdInput extends VendorDashboardQueryInput {
  vendorOrderId: string;
}

export interface VendorDashboardOrderStatusInput extends VendorDashboardQueryInput {
  vendorOrderId: string;
  expectedVersion: number;
  status: "processing" | "ready";
}

export interface VendorDashboardCreateShipmentInput {
  vendorId?: string;
  vendorOrderId: string;
  idempotencyKey: string;
  items: Array<{ orderItemId: string; quantity: number }>;
  providerId?: string | null;
  providerType?: string;
  trackingId?: string | null;
  trackingUrl?: string | null;
  courierName?: string | null;
  note?: string | null;
  shipmentAmountMinor?: number;
  isFinalShipment?: boolean;
}

export interface VendorDashboardShipmentMutationPayload {
  replayed: boolean;
  shipmentId: string;
  vendorOrderId: string;
  orderId: string;
  vendorId: string;
  status: VendorDashboardShipmentRow["status"];
  version: number;
  success?: boolean;
  message?: string;
  externalId?: string | null;
  trackingId?: string | null;
  trackingUrl?: string | null;
  reconciliationRequired?: boolean;
}

export interface VendorDashboardShipmentIdInput extends VendorDashboardQueryInput {
  shipmentId: string;
}

export interface VendorDashboardShipmentCheckPayload {
  shipmentId: string;
  orderId: string;
  vendorId: string;
  externalId: string;
  trackingId: string | null;
  status: VendorDashboardShipmentRow["status"];
  rawStatus: string;
  version: number;
  applied: boolean;
  path: VendorDashboardShipmentRow["status"][] | null;
  checkedAt: string;
}

export interface VendorDashboardShipmentStatusInput extends VendorDashboardShipmentIdInput {
  expectedVersion: number;
  status: VendorDashboardShipmentRow["status"];
  trackingId?: string | null;
  trackingUrl?: string | null;
  courierName?: string | null;
  note?: string | null;
}

function buildParams(data: VendorDashboardShipmentListInput): Record<string, string> {
  const params: Record<string, string> = {};
  if (data.vendorId) params.vendorId = data.vendorId;
  if (data.page != null) params.page = String(data.page);
  if (data.limit != null) params.limit = String(data.limit);
  if (data.vendorOrderId) params.vendorOrderId = data.vendorOrderId;
  if (data.status) params.status = data.status;
  return params;
}

function vendorMutationPath(path: string, vendorId?: string): string {
  return vendorId
    ? `${path}?vendorId=${encodeURIComponent(vendorId)}`
    : path;
}

export const getVendorDashboardContext = createServerFn({ method: "GET" })
  .validator((data: VendorDashboardQueryInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardContextPayload> => apiGet<VendorDashboardContextPayload>("/vendor-dashboard/context", buildParams(data)));

export const applyForVendorDashboard = createServerFn({ method: "POST" })
  .validator((data: VendorDashboardApplicationInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardApplicationResult> =>
    apiPost<VendorDashboardApplicationResult>("/vendor-dashboard/application", data));

export const getVendorDashboardTeam = createServerFn({ method: "GET" })
  .validator((data: VendorDashboardQueryInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardTeamPayload> =>
    apiGet<VendorDashboardTeamPayload>("/vendor-dashboard/team", buildParams(data)));

export const createVendorDashboardTeamInvite = createServerFn({ method: "POST" })
  .validator((data: VendorDashboardCreateTeamInviteInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardCreateTeamInviteResult> =>
    apiPost<VendorDashboardCreateTeamInviteResult>("/vendor-dashboard/team/invites", data));

export const acceptVendorDashboardTeamInvite = createServerFn({ method: "POST" })
  .validator((data: VendorDashboardAcceptTeamInviteInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardAcceptTeamInviteResult> =>
    apiPost<VendorDashboardAcceptTeamInviteResult>("/vendor-dashboard/team/invites/accept", data));

export const revokeVendorDashboardTeamInvite = createServerFn({ method: "POST" })
  .validator((data: { vendorId: string; inviteId: string }) => data)
  .handler(async ({ data }): Promise<{ inviteId: string; status: "revoked" }> =>
    apiPost<{ inviteId: string; status: "revoked" }>(
      `/vendor-dashboard/team/invites/${encodeURIComponent(data.inviteId)}/revoke`,
      { vendorId: data.vendorId },
    ));

export const updateVendorDashboardTeamMember = createServerFn({ method: "POST" })
  .validator((data: VendorDashboardUpdateTeamMemberInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardUpdateTeamMemberResult> =>
    apiPatch<VendorDashboardUpdateTeamMemberResult>(
      `/vendor-dashboard/team/members/${encodeURIComponent(data.membershipId)}`,
      { vendorId: data.vendorId, role: data.role, status: data.status },
    ));

export const getVendorDashboardProfile = createServerFn({ method: "GET" })
  .validator((data: VendorDashboardQueryInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardProfilePayload> =>
    apiGet<VendorDashboardProfilePayload>("/vendor-dashboard/profile", buildParams(data)));

export const updateVendorDashboardProfile = createServerFn({ method: "POST" })
  .validator((data: { vendorId: string; profile: VendorDashboardProfileInput }) => data)
  .handler(async ({ data }): Promise<VendorDashboardProfilePayload> =>
    apiPut<VendorDashboardProfilePayload>("/vendor-dashboard/profile", {
      vendorId: data.vendorId,
      ...data.profile,
    }));

export const getVendorDashboardSummary = createServerFn({ method: "GET" })
  .validator((data: VendorDashboardQueryInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardSummaryPayload> => apiGet<VendorDashboardSummaryPayload>("/vendor-dashboard/summary", buildParams(data)));

export const getVendorDashboardOrders = createServerFn({ method: "GET" })
  .validator((data: VendorDashboardListInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardOrdersPayload> => apiGet<VendorDashboardOrdersPayload>("/vendor-dashboard/orders", buildParams(data)));

export const getVendorDashboardOrder = createServerFn({ method: "GET" })
  .validator((data: VendorDashboardOrderIdInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardOrderDetailPayload> =>
    apiGet<VendorDashboardOrderDetailPayload>(
      `/vendor-dashboard/orders/${encodeURIComponent(data.vendorOrderId)}`,
      buildParams(data),
    ));

export const getVendorDashboardCategories = createServerFn({ method: "GET" })
  .validator((data: VendorDashboardQueryInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardCategoriesPayload> =>
    apiGet<VendorDashboardCategoriesPayload>("/vendor-dashboard/categories", buildParams(data)));

export const getVendorDashboardProducts = createServerFn({ method: "GET" })
  .validator((data: VendorDashboardListInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardProductsPayload> => apiGet<VendorDashboardProductsPayload>("/vendor-dashboard/products", buildParams(data)));

export const getVendorDashboardProduct = createServerFn({ method: "GET" })
  .validator((data: VendorDashboardProductIdInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardProductDetail> =>
    apiGet<VendorDashboardProductDetail>(
      `/vendor-dashboard/products/${encodeURIComponent(data.productId)}`,
      buildParams(data),
    ));

export const createVendorDashboardProduct = createServerFn({ method: "POST" })
  .validator((data: VendorDashboardCreateProductInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardProductMutationPayload> =>
    apiPost<VendorDashboardProductMutationPayload>(
      vendorMutationPath("/vendor-dashboard/products", data.vendorId),
      data.product,
    ));

export const updateVendorDashboardProduct = createServerFn({ method: "POST" })
  .validator((data: VendorDashboardUpdateProductInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardProductMutationPayload> =>
    apiPut<VendorDashboardProductMutationPayload>(
      vendorMutationPath(
        `/vendor-dashboard/products/${encodeURIComponent(data.productId)}`,
        data.vendorId,
      ),
      data.product,
    ));

export const submitVendorDashboardProduct = createServerFn({ method: "POST" })
  .validator((data: VendorDashboardProductIdInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardProductMutationPayload> =>
    apiPost<VendorDashboardProductMutationPayload>(
      vendorMutationPath(
        `/vendor-dashboard/products/${encodeURIComponent(data.productId)}/submit`,
        data.vendorId,
      ),
    ));

export const getVendorDashboardProductVariants = createServerFn({ method: "GET" })
  .validator((data: VendorDashboardProductIdInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardProductVariantsPayload> =>
    apiGet<VendorDashboardProductVariantsPayload>(
      `/vendor-dashboard/products/${encodeURIComponent(data.productId)}/variants`,
      buildParams(data),
    ));

export const updateVendorDashboardProductVariant = createServerFn({ method: "POST" })
  .validator((data: VendorDashboardProductVariantUpdateInput) => data)
  .handler(async ({ data }): Promise<{
    variantId: string;
    stockVersion: number;
    version: number;
    approvalStatus: VendorDashboardProductRow["approvalStatus"];
    moderationVersion: number;
  }> => apiPut(
    vendorMutationPath(
      `/vendor-dashboard/products/${encodeURIComponent(data.productId)}/variants/${encodeURIComponent(data.variantId)}`,
      data.vendorId,
    ),
    data.variant,
  ));

export const getVendorDashboardPayoutMethods = createServerFn({ method: "GET" })
  .validator((data: VendorDashboardQueryInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardPayoutMethodsPayload> =>
    apiGet<VendorDashboardPayoutMethodsPayload>("/vendor-dashboard/payout-methods", buildParams(data)));

export const createVendorDashboardPayoutMethod = createServerFn({ method: "POST" })
  .validator((data: VendorDashboardCreatePayoutMethodInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardPayoutMethod> => {
    const { vendorId, ...body } = data;
    return apiPost(
      vendorMutationPath("/vendor-dashboard/payout-methods", vendorId),
      body,
    );
  });

export const setDefaultVendorDashboardPayoutMethod = createServerFn({ method: "POST" })
  .validator((data: VendorDashboardPayoutMethodIdInput) => data)
  .handler(async ({ data }): Promise<{ id: string; isDefault: true }> =>
    apiPost(vendorMutationPath(
      `/vendor-dashboard/payout-methods/${encodeURIComponent(data.methodId)}/default`,
      data.vendorId,
    )));

export const disableVendorDashboardPayoutMethod = createServerFn({ method: "POST" })
  .validator((data: VendorDashboardPayoutMethodIdInput) => data)
  .handler(async ({ data }): Promise<{ id: string; status: "disabled" }> =>
    apiPost(vendorMutationPath(
      `/vendor-dashboard/payout-methods/${encodeURIComponent(data.methodId)}/disable`,
      data.vendorId,
    )));

export const updateVendorDashboardOrderStatus = createServerFn({ method: "POST" })
  .validator((data: VendorDashboardOrderStatusInput) => data)
  .handler(async ({ data }): Promise<{ vendorOrderId: string; status: "processing" | "ready"; version: number }> =>
    apiPatch(
      vendorMutationPath(
        `/vendor-dashboard/orders/${encodeURIComponent(data.vendorOrderId)}/status`,
        data.vendorId,
      ),
      { expectedVersion: data.expectedVersion, status: data.status },
    ));

export const getVendorDashboardDeliveryProviders = createServerFn({ method: "GET" })
  .validator((data: VendorDashboardQueryInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardDeliveryProvidersPayload> =>
    apiGet<VendorDashboardDeliveryProvidersPayload>(
      "/vendor-dashboard/delivery-providers",
      data.vendorId ? { vendorId: data.vendorId } : {},
    ));

export const getVendorDashboardShipments = createServerFn({ method: "GET" })
  .validator((data: VendorDashboardShipmentListInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardShipmentsPayload> =>
    apiGet<VendorDashboardShipmentsPayload>("/vendor-dashboard/shipments", buildParams(data)));

export const createVendorDashboardShipment = createServerFn({ method: "POST" })
  .validator((data: VendorDashboardCreateShipmentInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardShipmentMutationPayload> => {
    const { vendorId, vendorOrderId, ...body } = data;
    return apiPost(
      vendorMutationPath(
        `/vendor-dashboard/orders/${encodeURIComponent(vendorOrderId)}/shipments`,
        vendorId,
      ),
      body,
    );
  });

export const checkVendorDashboardShipmentStatus = createServerFn({ method: "POST" })
  .validator((data: VendorDashboardShipmentIdInput) => data)
  .handler(async ({ data }): Promise<VendorDashboardShipmentCheckPayload> =>
    apiPost(vendorMutationPath(
      `/vendor-dashboard/shipments/${encodeURIComponent(data.shipmentId)}/check-status`,
      data.vendorId,
    )));

export const updateVendorDashboardShipmentStatus = createServerFn({ method: "POST" })
  .validator((data: VendorDashboardShipmentStatusInput) => data)
  .handler(async ({ data }): Promise<{ shipmentId: string; status: VendorDashboardShipmentRow["status"]; version: number }> => {
    const { vendorId, shipmentId, ...body } = data;
    return apiPatch(
      vendorMutationPath(
        `/vendor-dashboard/shipments/${encodeURIComponent(shipmentId)}/status`,
        vendorId,
      ),
      body,
    );
  });
