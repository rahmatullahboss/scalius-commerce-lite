import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { RouteErrorComponent } from "~/lib/route-error";
import { VendorForm } from "~/components/admin/vendors/VendorForm";
import { useCreateVendor } from "~/lib/api-mutations/marketplace-vendors";
import { Button } from "~/components/ui/button";

export const Route = createFileRoute("/admin/vendors/new")({
  head: () => ({ meta: [{ title: "New Vendor | Scalius Admin" }] }),
  component: NewVendorPage,
  errorComponent: RouteErrorComponent,
});

function NewVendorPage() {
  const navigate = useNavigate();
  const createVendor = useCreateVendor();

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3">
          <a href="/admin/vendors"><ArrowLeft className="h-4 w-4" /> Back to vendors</a>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">New Vendor</h1>
        <p className="text-muted-foreground">Create a marketplace seller profile.</p>
      </div>
      <VendorForm
        title="Vendor details"
        description="Add seller identity, contact, status, and default commission details."
        submitLabel="Create vendor"
        isSubmitting={createVendor.isPending}
        onSubmit={(data) => {
          createVendor.mutate(data, {
            onSuccess: (payload) => {
              void navigate({ href: `/admin/vendors/${payload.vendor.id}` });
            },
          });
        }}
      />
    </div>
  );
}
