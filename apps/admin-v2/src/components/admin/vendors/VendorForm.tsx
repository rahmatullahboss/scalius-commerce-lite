import { type FormEvent, useEffect, useState } from "react";
import type { VendorDetail, VendorMutationInput, VendorStatus } from "~/lib/api-functions/vendors";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";

const vendorStatuses: VendorStatus[] = ["pending", "approved", "rejected", "suspended", "closed"];

interface VendorFormValues {
  name: string;
  slug: string;
  legalName: string;
  status: VendorStatus;
  ownerUserId: string;
  commissionPercent: string;
  contactEmail: string;
  contactPhone: string;
  businessAddress: string;
  district: string;
  upazila: string;
  pickupAddress: string;
}

export interface VendorFormProps {
  title: string;
  description: string;
  submitLabel: string;
  initialVendor?: VendorDetail;
  isSubmitting?: boolean;
  onSubmit: (data: VendorMutationInput) => void;
}

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function initialValues(vendor?: VendorDetail): VendorFormValues {
  const owner = vendor?.members.find((member) => member.role === "owner" && member.status === "active");
  const commissionRule = vendor?.commissionRules.find((rule) => rule.status === "active");
  const businessAddress = vendor?.addresses.find((address) => address.type === "business" && address.isDefault);
  const pickupAddress = vendor?.addresses.find((address) => address.type === "pickup" && address.isDefault);

  return {
    name: vendor?.name ?? "",
    slug: vendor?.slug ?? "",
    legalName: vendor?.legalName ?? "",
    status: vendor?.status ?? "pending",
    ownerUserId: owner?.userId ?? "",
    commissionPercent: String((commissionRule?.rateBps ?? 0) / 100),
    contactEmail: vendor?.contactEmail ?? "",
    contactPhone: vendor?.contactPhone ?? "",
    businessAddress: businessAddress?.addressLine1 ?? "",
    district: businessAddress?.district ?? pickupAddress?.district ?? "",
    upazila: businessAddress?.upazila ?? pickupAddress?.upazila ?? "",
    pickupAddress: pickupAddress?.addressLine1 ?? "",
  };
}

function nullableValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function VendorForm({
  title,
  description,
  submitLabel,
  initialVendor,
  isSubmitting = false,
  onSubmit,
}: VendorFormProps) {
  const [values, setValues] = useState<VendorFormValues>(() => initialValues(initialVendor));
  const [slugTouched, setSlugTouched] = useState(Boolean(initialVendor?.slug));

  useEffect(() => {
    setValues(initialValues(initialVendor));
    setSlugTouched(Boolean(initialVendor?.slug));
  }, [initialVendor]);

  function setField<K extends keyof VendorFormValues>(field: K, value: VendorFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function handleNameChange(value: string) {
    setField("name", value);
    if (!slugTouched) setField("slug", toSlug(value));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({
      name: values.name.trim(),
      slug: toSlug(values.slug),
      legalName: nullableValue(values.legalName),
      status: values.status,
      ownerUserId: nullableValue(values.ownerUserId),
      commissionBps: Math.round(Number(values.commissionPercent || 0) * 100),
      contactEmail: nullableValue(values.contactEmail),
      contactPhone: nullableValue(values.contactPhone),
      businessAddress: nullableValue(values.businessAddress),
      district: nullableValue(values.district),
      upazila: nullableValue(values.upazila),
      pickupAddress: nullableValue(values.pickupAddress),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="vendor-name">Vendor name</Label>
              <Input
                id="vendor-name"
                value={values.name}
                onChange={(event) => handleNameChange(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendor-slug">Slug</Label>
              <Input
                id="vendor-slug"
                value={values.slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setField("slug", toSlug(event.target.value));
                }}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendor-legal-name">Legal name</Label>
              <Input
                id="vendor-legal-name"
                value={values.legalName}
                onChange={(event) => setField("legalName", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendor-status">Status</Label>
              <select
                id="vendor-status"
                value={values.status}
                onChange={(event) => setField("status", event.target.value as VendorStatus)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {vendorStatuses.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendor-owner">Owner user ID</Label>
              <Input
                id="vendor-owner"
                value={values.ownerUserId}
                onChange={(event) => setField("ownerUserId", event.target.value)}
                placeholder="Optional existing user ID"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendor-commission">Commission rate (%)</Label>
              <Input
                id="vendor-commission"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={values.commissionPercent}
                onChange={(event) => setField("commissionPercent", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendor-email">Contact email</Label>
              <Input
                id="vendor-email"
                type="email"
                value={values.contactEmail}
                onChange={(event) => setField("contactEmail", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendor-phone">Contact phone</Label>
              <Input
                id="vendor-phone"
                value={values.contactPhone}
                onChange={(event) => setField("contactPhone", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendor-district">District</Label>
              <Input
                id="vendor-district"
                value={values.district}
                onChange={(event) => setField("district", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendor-upazila">Upazila</Label>
              <Input
                id="vendor-upazila"
                value={values.upazila}
                onChange={(event) => setField("upazila", event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="vendor-business-address">Business address</Label>
              <Textarea
                id="vendor-business-address"
                value={values.businessAddress}
                onChange={(event) => setField("businessAddress", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendor-pickup-address">Pickup address</Label>
              <Textarea
                id="vendor-pickup-address"
                value={values.pickupAddress}
                onChange={(event) => setField("pickupAddress", event.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button asChild type="button" variant="outline">
              <a href="/admin/vendors">Cancel</a>
            </Button>
            <Button type="submit" disabled={isSubmitting || !values.name.trim() || !toSlug(values.slug)}>
              {isSubmitting ? "Saving..." : submitLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
