import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { vendorDashboardTeamQueryOptions } from "~/lib/api-query-options/vendor-dashboard";
import {
  acceptVendorDashboardTeamInvite,
  createVendorDashboardTeamInvite,
  revokeVendorDashboardTeamInvite,
  updateVendorDashboardTeamMember,
  type VendorDashboardTeamMember,
  type VendorDashboardTeamMemberStatus,
  type VendorDashboardTeamRole,
} from "~/lib/api-functions/vendor-dashboard";
import { queryKeys } from "~/lib/query-keys";
import { formatMarketplaceDate } from "~/lib/marketplace-date";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

const TEAM_ROLES: VendorDashboardTeamRole[] = ["admin", "catalog", "fulfillment", "finance", "viewer"];

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`space-y-1 text-sm ${className}`}>
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function StatusLabel({ status }: { status: string }) {
  return <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium">{status}</span>;
}

export function SellerInviteAcceptancePanel({ onAccepted }: { onAccepted: (vendorId: string) => void }) {
  const queryClient = useQueryClient();
  const [credential, setCredential] = useState("");
  const mutation = useMutation({
    mutationFn: () => acceptVendorDashboardTeamInvite({ data: { token: credential.trim() } }),
    onSuccess: (result) => {
      setCredential("");
      toast.success("Seller invitation accepted");
      void queryClient.invalidateQueries({ queryKey: queryKeys.vendorDashboard.all });
      onAccepted(result.vendorId);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to accept seller invitation"),
  });

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <Field label="Seller invitation credential" className="flex-1">
          <input
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            className="h-9 w-full rounded-md border px-3 font-mono text-sm"
            placeholder="Paste the one-time invitation credential"
            autoComplete="off"
          />
        </Field>
        <Button onClick={() => mutation.mutate()} disabled={!credential.trim() || mutation.isPending}>
          <KeyRound className="mr-2 h-4 w-4" />
          {mutation.isPending ? "Accepting…" : "Accept invitation"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function VendorTeamPanel({ vendorId }: { vendorId: string }) {
  const queryClient = useQueryClient();
  const teamQuery = useQuery(vendorDashboardTeamQueryOptions({ vendorId }));
  const [inviteeEmail, setInviteeEmail] = useState("");
  const [role, setRole] = useState<VendorDashboardTeamRole>("viewer");
  const [expiresInHours, setExpiresInHours] = useState(168);
  const [oneTimeCredential, setOneTimeCredential] = useState<string | null>(null);

  const invalidateTeam = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.vendorDashboard.team({ vendorId }) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.vendorDashboard.context({ vendorId }) });
  };

  const inviteMutation = useMutation({
    mutationFn: () => createVendorDashboardTeamInvite({
      data: { vendorId, inviteeEmail: inviteeEmail.trim(), role, expiresInHours },
    }),
    onSuccess: (result) => {
      setInviteeEmail("");
      setOneTimeCredential(result.token);
      toast.success("Seller invitation created. Copy the credential now.");
      invalidateTeam();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to create invitation"),
  });

  const revokeMutation = useMutation({
    mutationFn: (inviteId: string) => revokeVendorDashboardTeamInvite({ data: { vendorId, inviteId } }),
    onSuccess: () => {
      toast.success("Seller invitation revoked");
      invalidateTeam();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to revoke invitation"),
  });

  const memberMutation = useMutation({
    mutationFn: (input: {
      membershipId: string;
      role?: VendorDashboardTeamRole;
      status?: VendorDashboardTeamMemberStatus;
    }) => updateVendorDashboardTeamMember({ data: { vendorId, ...input } }),
    onSuccess: () => {
      toast.success("Seller member updated");
      invalidateTeam();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to update seller member"),
  });

  async function copyCredential() {
    if (!oneTimeCredential) return;
    try {
      await navigator.clipboard.writeText(oneTimeCredential);
      toast.success("Invitation credential copied");
    } catch {
      toast.error("Could not copy automatically. Copy it from the field.");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5" />Invite seller team member</CardTitle>
          <p className="text-sm text-muted-foreground">
            Owner access cannot be granted here. The credential is shown once and is never stored in readable form.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_150px_auto] md:items-end">
            <Field label="Invitee email">
              <input
                value={inviteeEmail}
                onChange={(event) => setInviteeEmail(event.target.value)}
                className="h-9 w-full rounded-md border px-3"
                type="email"
                placeholder="member@example.com"
              />
            </Field>
            <Field label="Role">
              <select value={role} onChange={(event) => setRole(event.target.value as VendorDashboardTeamRole)} className="h-9 w-full rounded-md border px-3">
                {TEAM_ROLES.map((teamRole) => <option key={teamRole} value={teamRole}>{teamRole}</option>)}
              </select>
            </Field>
            <Field label="Expires (hours)">
              <input
                type="number"
                min={1}
                max={720}
                value={expiresInHours}
                onChange={(event) => setExpiresInHours(Number(event.target.value))}
                className="h-9 w-full rounded-md border px-3"
              />
            </Field>
            <Button onClick={() => inviteMutation.mutate()} disabled={!inviteeEmail.trim() || inviteMutation.isPending}>
              {inviteMutation.isPending ? "Creating…" : "Create invitation"}
            </Button>
          </div>
          {oneTimeCredential ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
              <p className="text-sm font-medium">Copy this one-time credential now</p>
              <p className="mt-1 text-xs">It disappears when this page state is lost and cannot be retrieved from the server.</p>
              <div className="mt-3 flex gap-2">
                <input readOnly value={oneTimeCredential} className="h-9 min-w-0 flex-1 rounded-md border bg-white px-3 font-mono text-sm" />
                <Button type="button" variant="outline" onClick={() => void copyCredential()}>
                  <Copy className="mr-2 h-4 w-4" />Copy
                </Button>
                <Button type="button" variant="ghost" onClick={() => setOneTimeCredential(null)}>Dismiss</Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Seller members</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {teamQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading seller team…</p> : null}
          {(teamQuery.data?.members ?? []).map((member) => (
            <VendorTeamMemberRow
              key={member.membershipId}
              member={member}
              pending={memberMutation.isPending}
              onUpdate={(input) => memberMutation.mutate({ membershipId: member.membershipId, ...input })}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Invitation history</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {(teamQuery.data?.invites ?? []).map((invite) => (
            <div key={invite.inviteId} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{invite.inviteeEmail}</p>
                <p className="text-sm text-muted-foreground">{invite.role} · {invite.status} · expires {formatMarketplaceDate(invite.expiresAt, "unknown")}</p>
              </div>
              {invite.status === "pending" ? (
                <Button variant="outline" size="sm" disabled={revokeMutation.isPending} onClick={() => revokeMutation.mutate(invite.inviteId)}>
                  Revoke
                </Button>
              ) : null}
            </div>
          ))}
          {!teamQuery.isLoading && (teamQuery.data?.invites.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No invitations yet.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function VendorTeamMemberRow({
  member,
  pending,
  onUpdate,
}: {
  member: VendorDashboardTeamMember;
  pending: boolean;
  onUpdate: (input: { role?: VendorDashboardTeamRole; status?: VendorDashboardTeamMemberStatus }) => void;
}) {
  const protectedOwner = member.role === "owner";
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <p className="font-medium">{member.name}</p>
        <p className="truncate text-sm text-muted-foreground">{member.email}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={member.role}
          disabled={protectedOwner || pending || member.status === "revoked"}
          onChange={(event) => onUpdate({ role: event.target.value as VendorDashboardTeamRole })}
          className="h-9 rounded-md border px-3 text-sm"
        >
          {protectedOwner ? <option value="owner">owner</option> : null}
          {TEAM_ROLES.map((teamRole) => <option key={teamRole} value={teamRole}>{teamRole}</option>)}
        </select>
        <StatusLabel status={member.status} />
        {!protectedOwner && member.status === "active" ? (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => onUpdate({ status: "suspended" })}>Suspend</Button>
        ) : null}
        {!protectedOwner && member.status === "suspended" ? (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => onUpdate({ status: "active" })}>Reactivate</Button>
        ) : null}
        {!protectedOwner && member.status !== "revoked" ? (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => onUpdate({ status: "revoked" })}>Revoke access</Button>
        ) : null}
      </div>
    </div>
  );
}
