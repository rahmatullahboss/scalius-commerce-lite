import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image, Save, Store } from "lucide-react";
import { toast } from "sonner";
import { vendorDashboardProfileQueryOptions } from "~/lib/api-query-options/vendor-dashboard";
import {
  updateVendorDashboardProfile,
  type VendorDashboardProfileInput,
} from "~/lib/api-functions/vendor-dashboard";
import { queryKeys } from "~/lib/query-keys";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

const EMPTY_PROFILE: VendorDashboardProfileInput = {
  description: null,
  logoMediaId: null,
  bannerMediaId: null,
  showContactEmail: false,
  showContactPhone: false,
  seoTitle: null,
  seoDescription: null,
  returnPolicy: null,
  supportHours: null,
  publicationStatus: "draft",
};

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {hint ? <span className="ml-2 text-xs text-muted-foreground">{hint}</span> : null}
      {children}
    </label>
  );
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function VendorProfilePanel({ vendorId }: { vendorId: string }) {
  const queryClient = useQueryClient();
  const profileQuery = useQuery(vendorDashboardProfileQueryOptions({ vendorId }));
  const [form, setForm] = useState<VendorDashboardProfileInput>(EMPTY_PROFILE);

  useEffect(() => {
    if (!profileQuery.data) return;
    setForm({
      description: profileQuery.data.description,
      logoMediaId: profileQuery.data.logoMediaId,
      bannerMediaId: profileQuery.data.bannerMediaId,
      showContactEmail: profileQuery.data.showContactEmail,
      showContactPhone: profileQuery.data.showContactPhone,
      seoTitle: profileQuery.data.seoTitle,
      seoDescription: profileQuery.data.seoDescription,
      returnPolicy: profileQuery.data.returnPolicy,
      supportHours: profileQuery.data.supportHours,
      publicationStatus: profileQuery.data.publicationStatus,
    });
  }, [profileQuery.data]);

  const mutation = useMutation({
    mutationFn: () => updateVendorDashboardProfile({ data: { vendorId, profile: form } }),
    onSuccess: () => {
      toast.success(form.publicationStatus === "published" ? "Seller profile published" : "Seller profile saved as draft");
      void queryClient.invalidateQueries({ queryKey: queryKeys.vendorDashboard.profile({ vendorId }) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.vendorDashboard.all });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to save seller profile"),
  });

  if (profileQuery.isLoading) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading seller profile…</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Store className="h-5 w-5" />Public store profile</CardTitle>
          <p className="text-sm text-muted-foreground">
            Draft content remains private. Published content appears only while the seller itself is approved.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field label="Seller description">
            <textarea
              value={form.description ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, description: nullable(event.target.value) }))}
              rows={5}
              maxLength={5000}
              className="w-full rounded-md border px-3 py-2"
              placeholder="Tell customers about the store, products, and service."
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Logo media ID" hint="Existing active media record">
              <div className="relative">
                <Image className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  value={form.logoMediaId ?? ""}
                  onChange={(event) => setForm((current) => ({ ...current, logoMediaId: nullable(event.target.value) }))}
                  className="h-9 w-full rounded-md border pl-9 pr-3 font-mono text-sm"
                />
              </div>
            </Field>
            <Field label="Banner media ID" hint="Existing active media record">
              <div className="relative">
                <Image className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  value={form.bannerMediaId ?? ""}
                  onChange={(event) => setForm((current) => ({ ...current, bannerMediaId: nullable(event.target.value) }))}
                  className="h-9 w-full rounded-md border pl-9 pr-3 font-mono text-sm"
                />
              </div>
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="SEO title">
              <input
                value={form.seoTitle ?? ""}
                maxLength={160}
                onChange={(event) => setForm((current) => ({ ...current, seoTitle: nullable(event.target.value) }))}
                className="h-9 w-full rounded-md border px-3"
              />
            </Field>
            <Field label="Support hours">
              <input
                value={form.supportHours ?? ""}
                maxLength={500}
                onChange={(event) => setForm((current) => ({ ...current, supportHours: nullable(event.target.value) }))}
                className="h-9 w-full rounded-md border px-3"
                placeholder="Sat–Thu, 9am–6pm"
              />
            </Field>
          </div>

          <Field label="SEO description">
            <textarea
              value={form.seoDescription ?? ""}
              maxLength={320}
              rows={3}
              onChange={(event) => setForm((current) => ({ ...current, seoDescription: nullable(event.target.value) }))}
              className="w-full rounded-md border px-3 py-2"
            />
          </Field>

          <Field label="Return policy">
            <textarea
              value={form.returnPolicy ?? ""}
              maxLength={5000}
              rows={5}
              onChange={(event) => setForm((current) => ({ ...current, returnPolicy: nullable(event.target.value) }))}
              className="w-full rounded-md border px-3 py-2"
            />
          </Field>

          <div className="rounded-lg border p-4">
            <p className="font-medium">Public contact visibility</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Email: {profileQuery.data?.contactEmail ?? "not configured"} · Phone: {profileQuery.data?.contactPhone ?? "not configured"}
            </p>
            <div className="mt-3 flex flex-wrap gap-5">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.showContactEmail}
                  disabled={!profileQuery.data?.contactEmail}
                  onChange={(event) => setForm((current) => ({ ...current, showContactEmail: event.target.checked }))}
                />
                Show contact email
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.showContactPhone}
                  disabled={!profileQuery.data?.contactPhone}
                  onChange={(event) => setForm((current) => ({ ...current, showContactPhone: event.target.checked }))}
                />
                Show contact phone
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-end sm:justify-between">
            <Field label="Publication state">
              <select
                value={form.publicationStatus}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  publicationStatus: event.target.value as VendorDashboardProfileInput["publicationStatus"],
                }))}
                className="h-9 rounded-md border px-3"
              >
                <option value="draft">Draft — private</option>
                <option value="published">Published — public</option>
              </select>
            </Field>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              <Save className="mr-2 h-4 w-4" />
              {mutation.isPending ? "Saving…" : "Save store profile"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
