import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, type QueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { RouteErrorComponent } from "~/lib/route-error";
import { vendorQueryOptions } from "~/lib/api-query-options/vendors";
import { VendorForm } from "~/components/admin/vendors/VendorForm";
import { useUpdateVendor } from "~/lib/api-mutations/marketplace-vendors";
import { Button } from "~/components/ui/button";

export const Route = createFileRoute("/admin/vendors/$vendorId/edit")({
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
  head: () => ({ meta: [{ title: "Edit Vendor | Scalius Admin" }] }),
  component: EditVendorPage,
  errorComponent: RouteErrorComponent,
});

function EditVendorPage() {
  const { vendorId } = Route.useParams() as { vendorId: string };
  const { data } = useSuspenseQuery(vendorQueryOptions(vendorId));
  const updateVendor = useUpdateVendor();
  const navigate = useNavigate();
  const vendorPath = "/admin/vendors/" + vendorId;

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3">
          <a href={vendorPath}><ArrowLeft className="h-4 w-4" /> Back to vendor</a>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Edit Vendor</h1>
        <p className="text-muted-foreground">Update seller identity, contact, and operational fields.</p>
      </div>
      <VendorForm
        title="Vendor details"
        description="Update seller identity, contact, status, and default commission details."
        submitLabel="Save vendor"
        initialVendor={data.vendor}
        isSubmitting={updateVendor.isPending}
        onSubmit={(formData) => {
          updateVendor.mutate(
            { id: vendorId, ...formData },
            {
              onSuccess: () => {
                void navigate({ href: vendorPath });
              },
            },
          );
        }}
      />
    </div>
  );
}
