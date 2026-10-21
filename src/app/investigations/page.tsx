"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, SlidersHorizontal } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageTitle, Panel, RiskBadge, StatusMessage } from "@/components/ui";
import { apiRequest, formatMoney, formatTime, type CaseRecord } from "@/lib/api";

export default function InvestigationsPage() {
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["cases"],
    queryFn: () => apiRequest<{ items: CaseRecord[] }>("/cases"),
  });
  const assignees = useQuery({
    queryKey: ["case-assignees"],
    queryFn: () => apiRequest<{ items: { id: string; label: string }[] }>("/users/assignees"),
  });
  const create = useMutation({
    mutationFn: () =>
      apiRequest<CaseRecord>("/cases", {
        method: "POST",
        body: JSON.stringify({ title }),
      }),
    onSuccess: async () => {
      setTitle("");
      setShowCreate(false);
      await client.invalidateQueries({ queryKey: ["cases"] });
    },
  });
  const ownerLabel = (owner: string) =>
    assignees.data?.items.find((assignee) => assignee.id === owner)?.label ?? owner;
  const visible = (list.data?.items ?? []).filter((item) =>
    `${item.id} ${item.title} ${item.subject} ${ownerLabel(item.owner)}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <AppShell>
      <PageTitle
        eyebrow="Investigation operations"
        title="Case workspace"
        description="Triage risk signals, coordinate case ownership, and preserve an evidence-led decision trail."
        action={
          <button className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2.5 text-xs font-medium text-white hover:bg-blue-500" onClick={() => setShowCreate((value) => !value)} type="button">
            <Plus className="h-3.5 w-3.5" /> New investigation
          </button>
        }
      />
      {showCreate && (
        <form className="mb-4 flex flex-col gap-3 rounded-xl border border-blue-400/20 bg-blue-500/[0.04] p-4 sm:flex-row" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
          <label className="flex-1 text-[10px] text-slate-400">Investigation title<input className="mt-1.5 w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-white outline-none focus:border-blue-400" onChange={(event) => setTitle(event.target.value)} placeholder="Describe the activity under review" required value={title} /></label>
          <button className="self-end rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white disabled:opacity-50" disabled={create.isPending || title.trim().length < 5} type="submit">{create.isPending ? "Creating…" : "Create case"}</button>
        </form>
      )}
      {create.isError && <div className="mb-4"><StatusMessage title="Case could not be created" description={create.error.message} /></div>}
      <Panel title="Active investigations" subtitle={`${visible.length} cases · tenant-authorized access`} action={<SlidersHorizontal className="h-4 w-4 text-slate-500" />}>
        <div className="flex items-center gap-2 border-b border-slate-800/60 px-5 py-3">
          <Search className="h-4 w-4 text-slate-500" />
          <input aria-label="Search investigations" className="w-full bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-600" onChange={(event) => setQuery(event.target.value)} placeholder="Search case, subject, or investigator…" value={query} />
        </div>
        {list.isError && <div className="p-5"><StatusMessage title="Investigation queue unavailable" description={list.error.message} action={<button className="text-[11px] text-cyan-300" onClick={() => void list.refetch()} type="button">Retry</button>} /></div>}
        {list.isLoading && <div className="p-5"><StatusMessage title="Loading investigations" description="Retrieving authorized case records." loading /></div>}
        {!list.isLoading && !list.isError && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="bg-slate-950/30 text-[9px] uppercase tracking-[0.14em] text-slate-600">
                <tr><th className="px-5 py-3 font-medium">Investigation</th><th className="px-3 py-3 font-medium">Priority</th><th className="px-3 py-3 font-medium">Score</th><th className="px-3 py-3 font-medium">Exposure</th><th className="px-3 py-3 font-medium">Status</th><th className="px-5 py-3 font-medium">Owner / updated</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {visible.map((item) => (
                  <tr className="data-row" key={item.id}>
                    <td className="px-5 py-4"><Link className="text-xs font-medium text-slate-200 hover:text-cyan-200" href={`/investigations/${item.id}`}>{item.title}</Link><p className="mt-1 text-[10px] text-slate-500">{item.id} · {item.subject}</p></td>
                    <td className="px-3 py-4"><RiskBadge severity={item.priority} /></td>
                    <td className="px-3 py-4 text-xs tabular-nums text-slate-200">{item.riskScore}<span className="ml-1 text-[9px] text-slate-600">/100</span></td>
                    <td className="px-3 py-4 text-xs tabular-nums text-slate-300">{formatMoney(item.amountMinor, item.currency)}</td>
                    <td className="px-3 py-4"><span className="rounded-full border border-slate-700 px-2 py-1 text-[9px] capitalize text-slate-400">{item.status.replace("_", " ")}</span></td>
                    <td className="px-5 py-4"><p className="text-[11px] text-slate-300">{ownerLabel(item.owner)}</p><p className="mt-1 text-[9px] text-slate-600">{formatTime(item.updatedAt)}</p></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && <p className="p-8 text-center text-xs text-slate-500">No investigations match this search.</p>}
          </div>
        )}
      </Panel>
    </AppShell>
  );
}
