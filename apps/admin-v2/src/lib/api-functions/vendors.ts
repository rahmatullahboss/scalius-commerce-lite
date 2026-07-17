import { createServerFn } from "@tanstack/react-start";
import { apiGet, apiPatch, apiPost } from "../api.server";

export type VendorStatus = "pending" | "approved" | "rejected" | "suspended" | "closed";
export type ApiTimestamp = string | number | null;
export type VendorMemberRole = "owner" | "admin" | "catalog" | "fulfillment" | "finance" | "viewer";
export type VendorMemberStatus = "invited" | "active" | "suspended" | "revoked";
export type VendorPayoutMethod = "bank" | "bkash" | "nagad" | "rocket" | "manual";
export type VendorPayoutStatus = "pending" | "verified" | "rejected" | "disabled";
export type VendorKycType = "identity" | "trade_license" | "tax" | "bank_document" | "other";
export type VendorKycStatus = "pending" | "approved" | "rejected" | "expired";

export interface VendorSummary {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  status: VendorStatus;
  contactEmail: string | null;
  contactPhone: string | null;
  createdAt: ApiTimestamp;
  updatedAt: ApiTimestamp;
  deletedAt: ApiTimestamp;
}

export interface VendorMember {
  id: string;
  vendorId: string;
  userId: string;
  role: VendorMemberRole;
  status: VendorMemberStatus;
  userName: string | null;
  userEmail: string | null;
  invitedAt: ApiTimestamp;
  acceptedAt: ApiTimestamp;
  revokedAt: ApiTimestamp;
  createdAt: ApiTimestamp;
  updatedAt: ApiTimestamp;
}

export interface VendorAddress {
  id: string;
  vendorId: string;
  type: "business" | "pickup" | "return";
  label: string | null;
  recipientName: string | null;
  phone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  district: string | null;
  upazila: string | null;
  postalCode: string | null;
  countryCode: string;
  isDefault: boolean;
  createdAt: ApiTimestamp;
  updatedAt: ApiTimestamp;
}

export interface VendorPayoutAccount {
  id: string;
  vendorId: string;
  method: VendorPayoutMethod;
  displayName: string;
  lastFour: string | null;
  providerName: string | null;
  isDefault: boolean;
  status: VendorPayoutStatus;
  verifiedBy: string | null;
  verifiedAt: ApiTimestamp;
  rejectionReason: string | null;
  createdAt: ApiTimestamp;
  updatedAt: ApiTimestamp;
}

export interface VendorKycDocument {
  id: string;
  vendorId: string;
  type: VendorKycType;
  originalFilename: string | null;
  mimeType: string | null;
  status: VendorKycStatus;
  reviewedBy: string | null;
  reviewedAt: ApiTimestamp;
  rejectionReason: string | null;
  createdAt: ApiTimestamp;
  updatedAt: ApiTimestamp;
}

export interface VendorCommissionRule {
  id: string;
  scope: "platform" | "vendor";
  vendorId: string | null;
  rateBps: number;
  status: "draft" | "active" | "retired";
  priority: number;
  effectiveFrom: ApiTimestamp;
  effectiveTo: ApiTimestamp;
}

export interface VendorDetail extends VendorSummary {
  members: VendorMember[];
  addresses: VendorAddress[];
  payoutAccounts: VendorPayoutAccount[];
  kycDocuments: VendorKycDocument[];
  commissionRules: VendorCommissionRule[];
}

export interface VendorsQueryInput {
  [key: string]: string | number | boolean | null | undefined;
  page?: number;
  limit?: number;
  search?: string;
  status?: VendorStatus | "all";
  sort?: "createdAt" | "updatedAt" | "name" | "status";
  order?: "asc" | "desc";
}

export interface VendorsListPayload {
  vendors: VendorSummary[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface VendorDetailPayload { vendor: VendorDetail }

export interface VendorMutationInput {
  name: string;
  slug: string;
  legalName?: string | null;
  status?: VendorStatus;
  ownerUserId?: string | null;
  commissionBps?: number;
  contactEmail?: string | null;
  contactPhone?: string | null;
  businessAddress?: string | null;
  district?: string | null;
  upazila?: string | null;
  pickupAddress?: string | null;
}

export interface VendorUpdateInput extends Partial<VendorMutationInput> { id: string }
export interface VendorStatusPayload { vendor: VendorSummary }
export interface VendorPayoutAccountPayload { payoutAccount: VendorPayoutAccount }
export interface VendorKycDocumentPayload { kycDocument: VendorKycDocument }

function buildVendorsParams(data: VendorsQueryInput): Record<string, string> {
  const params: Record<string, string> = {};
  if (data.page != null) params.page = String(data.page);
  if (data.limit != null) params.limit = String(data.limit);
  if (data.search) params.search = data.search;
  if (data.status) params.status = data.status;
  if (data.sort) params.sort = data.sort;
  if (data.order) params.order = data.order;
  return params;
}

export const getVendors = createServerFn({ method: "GET" })
  .validator((data: VendorsQueryInput) => data)
  .handler(async ({ data }): Promise<VendorsListPayload> => apiGet<VendorsListPayload>("/vendors", buildVendorsParams(data)));

export const getVendor = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<VendorDetailPayload> => apiGet<VendorDetailPayload>(`/vendors/${data.id}`));

export const createVendor = createServerFn({ method: "POST" })
  .validator((data: VendorMutationInput) => data)
  .handler(async ({ data }): Promise<VendorStatusPayload> => apiPost<VendorStatusPayload>("/vendors", data));

export const updateVendor = createServerFn({ method: "POST" })
  .validator((data: VendorUpdateInput) => data)
  .handler(async ({ data }): Promise<VendorStatusPayload> => {
    const { id, ...body } = data;
    return apiPatch<VendorStatusPayload>(`/vendors/${id}`, body);
  });

export const updateVendorStatus = createServerFn({ method: "POST" })
  .validator((data: { id: string; status: VendorStatus; reason?: string | null }) => data)
  .handler(async ({ data }): Promise<VendorStatusPayload> => apiPatch<VendorStatusPayload>(
    `/vendors/${data.id}/status`,
    { status: data.status, reason: data.reason ?? null },
  ));

export const updateVendorPayoutAccountStatus = createServerFn({ method: "POST" })
  .validator((data: { vendorId: string; accountId: string; status: VendorPayoutStatus; rejectionReason?: string | null }) => data)
  .handler(async ({ data }): Promise<VendorPayoutAccountPayload> => apiPatch<VendorPayoutAccountPayload>(
    `/vendors/${data.vendorId}/payout-accounts/${data.accountId}/status`,
    { status: data.status, rejectionReason: data.rejectionReason ?? null },
  ));

export const updateVendorKycDocumentStatus = createServerFn({ method: "POST" })
  .validator((data: { vendorId: string; documentId: string; status: VendorKycStatus; rejectionReason?: string | null }) => data)
  .handler(async ({ data }): Promise<VendorKycDocumentPayload> => apiPatch<VendorKycDocumentPayload>(
    `/vendors/${data.vendorId}/kyc-documents/${data.documentId}/status`,
    { status: data.status, rejectionReason: data.rejectionReason ?? null },
  ));
