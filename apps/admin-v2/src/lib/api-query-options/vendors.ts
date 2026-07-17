import { queryOptions } from "@tanstack/react-query";
import {
  getVendor,
  getVendors,
  type VendorsQueryInput,
} from "../api-functions/vendors";
import { queryKeys } from "../query-keys";

const MODERATE_STALE_TIME_MS = 1000 * 60 * 2;

export const vendorsQueryOptions = (params: VendorsQueryInput) =>
  queryOptions({
    queryKey: queryKeys.vendors.list(params),
    queryFn: () => getVendors({ data: params }),
    staleTime: MODERATE_STALE_TIME_MS,
  });

export const vendorQueryOptions = (id: string) =>
  queryOptions({
    queryKey: queryKeys.vendors.detail(id),
    queryFn: () => getVendor({ data: { id } }),
    staleTime: 0,
  });
