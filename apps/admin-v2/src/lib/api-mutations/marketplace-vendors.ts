import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createVendor,
  updateVendor,
  updateVendorKycDocumentStatus,
  updateVendorPayoutAccountStatus,
  updateVendorStatus,
  type VendorKycStatus,
  type VendorMutationInput,
  type VendorPayoutStatus,
  type VendorStatus,
  type VendorUpdateInput,
} from "../api-functions/vendors";
import { getServerFnError, queryKeys } from "./shared";

export function useCreateVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: VendorMutationInput) => createVendor({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vendors.list() });
      toast.success("Vendor created");
    },
    onError: (err) => toast.error(getServerFnError(err, "Failed to create vendor")),
  });
}

export function useUpdateVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: VendorUpdateInput) => updateVendor({ data }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vendors.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.vendors.detail(variables.id) });
      toast.success("Vendor updated");
    },
    onError: (err) => toast.error(getServerFnError(err, "Failed to update vendor")),
  });
}

export function useUpdateVendorStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; status: VendorStatus }) => updateVendorStatus({ data }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vendors.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.vendors.detail(variables.id) });
      toast.success("Vendor status updated");
    },
    onError: (err) => toast.error(getServerFnError(err, "Failed to update vendor status")),
  });
}

export function useUpdateVendorPayoutAccountStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { vendorId: string; accountId: string; status: VendorPayoutStatus }) =>
      updateVendorPayoutAccountStatus({ data }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vendors.detail(variables.vendorId) });
      toast.success("Payout account status updated");
    },
    onError: (err) => toast.error(getServerFnError(err, "Failed to update payout status")),
  });
}

export function useUpdateVendorKycDocumentStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      vendorId: string;
      documentId: string;
      status: VendorKycStatus;
      rejectionReason?: string | null;
    }) => updateVendorKycDocumentStatus({ data }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vendors.detail(variables.vendorId) });
      toast.success("KYC document status updated");
    },
    onError: (err) => toast.error(getServerFnError(err, "Failed to update KYC status")),
  });
}
