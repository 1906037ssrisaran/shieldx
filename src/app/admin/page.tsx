"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Activity, LockKeyhole, Save, Users2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/components/session";
import { PageTitle, Panel, StatusMessage } from "@/components/ui";
import { apiRequest } from "@/lib/api";

type Policy = { alertThreshold: number; reviewRequired: boolean; version: number; editable: boolean };
type AuditEvent = { eventId: string; actorId: string; actorRole: string; action: string; resourceType: string; resourceId: string; occurredAt: string; outcome: string };
type UserRole = "admin" | "fraud_analyst" | "compliance_officer" | "risk_manager";
type User = { id: string; email: string; role: UserRole; status: "active" | "suspended" };

function parseUserRole(value: string): UserRole | null {
  if (value === "admin" || value === "fraud_analyst" || value === "compliance_officer" || value === "risk_manager") return value;
  return null;
}

function parseUserStatus(value: string): User["status"] | null {
  if (value === "active" || value === "suspended") return value;
  return null;
}

export default function AdminPage() {
  const [threshold, setThreshold] = useState(75);
  const queryClient = useQueryClient();
  const { demo } = useSession();
  const policy = useQuery({ queryKey: ["admin-policy"], queryFn: () => apiRequest<Policy>("/admin/policy") });
  const events = useQuery({ queryKey: ["audit-events"], queryFn: () => apiRequest<{ items: AuditEvent[] }>("/admin/audit/events?limit=40") });
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => apiRequest<{ items: User[] }>("/admin/users") });
  useEffect(() => {
    if (policy.data) setThreshold(policy.data.alertThreshold);
  }, [policy.data]);
  const save = useMutation({
    mutationFn: () => apiRequest<Policy>("/admin/policy", { method: "PATCH", body: JSON.stringify({ alertThreshold: threshold, reviewRequired: true, expectedVersion: effectivePolicy?.version ?? 1 }) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["admin-policy"] }); await queryClient.invalidateQueries({ queryKey: ["audit-events"] }); },
  });
  const updateUser = useMutation({
    mutationFn: ({ userId, role, status }: { userId: string; role: UserRole; status: User["status"] }) =>
      apiRequest(`/admin/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: JSON.stringify({ role, status }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      await queryClient.invalidateQueries({ queryKey: ["audit-events"] });
    },
  });
  const effectivePolicy = policy.data;

  return (
    <AppShell>
      <PageTitle eyebrow="Platform governance" title="Access, policy & accountability." description="Manage tenant-scoped roles and inspect policy changes and sensitive investigation activity." action={<span className="flex items-center gap-1.5 rounded-full border border-emerald-400/15 px-2.5 py-1.5 text-[9px] text-emerald-200"><LockKeyhole className="h-3 w-3" />Admin-only view</span>} />
      {(policy.isError || events.isError || users.isError) && <StatusMessage title="Some governance data is unavailable" description={policy.error?.message ?? events.error?.message ?? users.error?.message ?? "Check the service connection."} />}
      <div className="mt-4 grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-4">
          <Panel title="Detection policy" subtitle="Versioned tenant configuration">
            <div className="space-y-4 p-5">
              <label className="block text-[10px] text-slate-400">Alert review threshold <span className="float-right text-cyan-200">{effectivePolicy?.alertThreshold ?? threshold}</span><input className="mt-3 w-full accent-blue-500" max={100} min={1} onChange={(event) => setThreshold(Number(event.target.value))} type="range" value={effectivePolicy?.editable ? threshold : effectivePolicy?.alertThreshold ?? threshold} /></label>
              <div className="flex items-center justify-between rounded-md border border-slate-800 px-3 py-2.5"><span className="text-[10px] text-slate-300">Human review required</span><span className="text-[9px] text-emerald-300">{effectivePolicy?.reviewRequired ? "Enforced" : "Disabled"}</span></div>
              <p className="text-[9px] leading-5 text-slate-600">The versioned threshold controls alert triage in the explainable rules engine. Human review remains mandatory; demo mode is read-only.</p>
              <button className="flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-[10px] font-medium text-white disabled:opacity-40" disabled={!effectivePolicy?.editable || save.isPending || threshold === effectivePolicy?.alertThreshold} onClick={() => save.mutate()} type="button"><Save className="h-3.5 w-3.5" />{save.isPending ? "Saving…" : "Save policy"}</button>
              {save.isError && <p className="text-[10px] text-rose-300">{save.error.message}</p>}
            </div>
          </Panel>
          <Panel title="Tenant roles" subtitle={`${users.data?.items.length ?? 0} provisioned users`} action={<Users2 className="h-4 w-4 text-slate-500" />}>
            <div className="divide-y divide-slate-800/60">
              {(users.data?.items ?? []).map((user) => <div className="flex flex-wrap items-center gap-3 px-4 py-3" key={user.id}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-800 text-[10px] text-slate-300">{user.email?.slice(0, 1).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-[10px] text-slate-200">{user.email}</span><span className="mt-1 block truncate font-mono text-[8px] text-slate-600">{user.id}</span></span><select aria-label={`Role for ${user.email}`} className="rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-[9px] text-slate-300 disabled:opacity-50" disabled={demo || updateUser.isPending} onChange={(event) => { const role = parseUserRole(event.target.value); if (role) updateUser.mutate({ userId: user.id, role, status: user.status }); }} value={user.role}><option value="admin">Admin</option><option value="fraud_analyst">Fraud analyst</option><option value="compliance_officer">Compliance officer</option><option value="risk_manager">Risk manager</option></select><select aria-label={`Status for ${user.email}`} className="rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-[9px] text-slate-300 disabled:opacity-50" disabled={demo || updateUser.isPending} onChange={(event) => { const status = parseUserStatus(event.target.value); if (status) updateUser.mutate({ userId: user.id, role: user.role, status }); }} value={user.status}><option value="active">Active</option><option value="suspended">Suspended</option></select></div>)}
              {!users.data?.items.length && <p className="p-4 text-[10px] text-slate-500">No users in the tenant.</p>}
            </div>
            {updateUser.isError && <p className="border-t border-slate-800 p-3 text-[10px] text-rose-300">{updateUser.error.message}</p>}
            {demo && <p className="border-t border-slate-800 p-3 text-[9px] text-slate-500">User and policy controls are read-only in synthetic demo mode.</p>}
          </Panel>
        </div>
        <Panel title="Audit event stream" subtitle="Tenant-scoped · append-only application events" action={<span className="flex items-center gap-1 text-[9px] text-cyan-200"><Activity className="h-3 w-3" />{events.data?.items.length ?? 0} events</span>}>
          {events.isLoading ? <div className="p-4"><StatusMessage title="Loading audit events" description="Reading the authorized tenant trail." loading /></div> : (
            <div className="max-h-[620px] overflow-auto">
              <table className="w-full min-w-[620px] text-left">
                <thead className="sticky top-0 bg-[#0B111D] text-[8px] uppercase tracking-widest text-slate-600"><tr><th className="px-4 py-3 font-medium">Action / resource</th><th className="px-3 py-3 font-medium">Actor</th><th className="px-3 py-3 font-medium">Outcome</th><th className="px-4 py-3 font-medium">Timestamp</th></tr></thead>
                <tbody className="divide-y divide-slate-800/60">
                  {(events.data?.items ?? []).map((event) => <tr key={event.eventId}><td className="px-4 py-3"><p className="text-[10px] text-slate-200">{event.action}</p><p className="mt-1 font-mono text-[8px] text-slate-600">{event.resourceType} · {event.resourceId}</p></td><td className="px-3 py-3"><p className="text-[9px] text-slate-300">{event.actorId}</p><p className="mt-1 text-[8px] capitalize text-slate-600">{event.actorRole.replaceAll("_", " ")}</p></td><td className="px-3 py-3 text-[9px] text-emerald-300">{event.outcome}</td><td className="px-4 py-3 text-[8px] text-slate-500">{new Date(event.occurredAt).toLocaleString()}</td></tr>)}
                </tbody>
              </table>
              {!events.data?.items.length && <p className="p-8 text-center text-[10px] text-slate-500">No audit events recorded in this session.</p>}
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
