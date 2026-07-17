import { queryOptions } from "@tanstack/react-query";
import {
  getVendorDashboardCategories,
  getVendorDashboardContext,
  getVendorDashboardDeliveryProviders,
  getVendorDashboardOrder,
  getVendorDashboardOrders,
  getVendorDashboardPayoutMethods,
  getVendorDashboardProfile,
  getVendorDashboardProduct,
  getVendorDashboardProductVariants,
  getVendorDashboardProducts,
  getVendorDashboardShipments,
  getVendorDashboardSummary,
  getVendorDashboardTeam,
  type VendorDashboardListInput,
  type VendorDashboardOrderIdInput,
  type VendorDashboardProductIdInput,
  type VendorDashboardQueryInput,
  type VendorDashboardShipmentListInput,
} from "../api-functions/vendor-dashboard";
import { queryKeys } from "../query-keys";

const SHORT_STALE_TIME_MS = 1000 * 30;

export const vendorDashboardContextQueryOptions = (params: VendorDashboardQueryInput = {}) =>
  queryOptions({
    queryKey: queryKeys.vendorDashboard.context(params),
    queryFn: () => getVendorDashboardContext({ data: params }),
    staleTime: SHORT_STALE_TIME_MS,
  });

export const vendorDashboardSummaryQueryOptions = (params: VendorDashboardQueryInput = {}) =>
  queryOptions({
    queryKey: queryKeys.vendorDashboard.summary(params),
    queryFn: () => getVendorDashboardSummary({ data: params }),
    staleTime: SHORT_STALE_TIME_MS,
  });

export const vendorDashboardTeamQueryOptions = (params: VendorDashboardQueryInput = {}) =>
  queryOptions({
    queryKey: queryKeys.vendorDashboard.team(params),
    queryFn: () => getVendorDashboardTeam({ data: params }),
    staleTime: SHORT_STALE_TIME_MS,
  });

export const vendorDashboardProfileQueryOptions = (params: VendorDashboardQueryInput = {}) =>
  queryOptions({
    queryKey: queryKeys.vendorDashboard.profile(params),
    queryFn: () => getVendorDashboardProfile({ data: params }),
    staleTime: SHORT_STALE_TIME_MS,
  });

export const vendorDashboardOrdersQueryOptions = (params: VendorDashboardListInput) =>
  queryOptions({
    queryKey: queryKeys.vendorDashboard.orders(params),
    queryFn: () => getVendorDashboardOrders({ data: params }),
    staleTime: SHORT_STALE_TIME_MS,
  });

export const vendorDashboardOrderQueryOptions = (params: VendorDashboardOrderIdInput) =>
  queryOptions({
    queryKey: queryKeys.vendorDashboard.order(params.vendorOrderId, { vendorId: params.vendorId }),
    queryFn: () => getVendorDashboardOrder({ data: params }),
    staleTime: SHORT_STALE_TIME_MS,
  });

export const vendorDashboardCategoriesQueryOptions = (params: VendorDashboardQueryInput = {}) =>
  queryOptions({
    queryKey: queryKeys.vendorDashboard.categories(params),
    queryFn: () => getVendorDashboardCategories({ data: params }),
    staleTime: 1000 * 60 * 5,
  });

export const vendorDashboardProductsQueryOptions = (params: VendorDashboardListInput) =>
  queryOptions({
    queryKey: queryKeys.vendorDashboard.products(params),
    queryFn: () => getVendorDashboardProducts({ data: params }),
    staleTime: SHORT_STALE_TIME_MS,
  });

export const vendorDashboardProductQueryOptions = (params: VendorDashboardProductIdInput) =>
  queryOptions({
    queryKey: queryKeys.vendorDashboard.product(params.productId, { vendorId: params.vendorId }),
    queryFn: () => getVendorDashboardProduct({ data: params }),
    staleTime: SHORT_STALE_TIME_MS,
  });

export const vendorDashboardProductVariantsQueryOptions = (params: VendorDashboardProductIdInput) =>
  queryOptions({
    queryKey: queryKeys.vendorDashboard.variants(params.productId, { vendorId: params.vendorId }),
    queryFn: () => getVendorDashboardProductVariants({ data: params }),
    staleTime: SHORT_STALE_TIME_MS,
  });

export const vendorDashboardPayoutMethodsQueryOptions = (params: VendorDashboardQueryInput = {}) =>
  queryOptions({
    queryKey: queryKeys.vendorDashboard.payoutMethods(params),
    queryFn: () => getVendorDashboardPayoutMethods({ data: params }),
    staleTime: SHORT_STALE_TIME_MS,
  });

export const vendorDashboardDeliveryProvidersQueryOptions = (params: VendorDashboardQueryInput = {}) =>
  queryOptions({
    queryKey: queryKeys.vendorDashboard.deliveryProviders(params),
    queryFn: () => getVendorDashboardDeliveryProviders({ data: params }),
    staleTime: 1000 * 60 * 5,
  });

export const vendorDashboardShipmentsQueryOptions = (params: VendorDashboardShipmentListInput) =>
  queryOptions({
    queryKey: queryKeys.vendorDashboard.shipments(params),
    queryFn: () => getVendorDashboardShipments({ data: params }),
    staleTime: SHORT_STALE_TIME_MS,
  });
