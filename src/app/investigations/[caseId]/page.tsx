"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, Clock3, Network, Plus, Sparkles } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AgentResult, apiRequest, formatMoney, formatTime, type CaseRecord, type Evidence } from "@/lib/api";
import { PageTitle, Panel, RiskBadge, StatusMessage } from "@/components/ui";

type TimelineItem = { id: string; time: string; type: string; title: string; description: string };
type Transaction = { id: string; time: string; from: string; to: string; amountMinor: number; currency: string; channel: string; status: string; risk: string; evidenceId: string };
type Detail = { case: CaseRecord; evidence: Evidence[]; notes: { id: string; body: string; authorId: string; createdAt: string }[]; transactions: Transaction[]; timeline: TimelineItem[] };
type Assignee = { id: string; label: string };

export default function CaseWorkbenchPage() {
  const params = useParams<{ caseId: string }>();
  const caseId = params.caseId;
  const [note, setNote] = useState("");
  const [brief, setBrief] = useState<AgentResult | null>(null);
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => apiRequest<Detail>(`/cases/${caseId}`),
  });
  const assignees = useQuery({
    queryKey: ["case-assignees"],
    queryFn: () => apiRequest<{ items: Assignee[] }>("/users/assignees"),
  });
  const patchCase = useMutation({
    mutationFn: (body: { status?: string; owner?: string; expectedVersion: number }) =>
      apiRequest<CaseRecord>(`/cases/${caseId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["case", caseId] });
      await client.invalidateQueries({ queryKey: ["cases"] });
    },
  });
  const createNote = useMutation({
    mutationFn: () => apiRequest(`/cases/${caseId}/notes`, { method: "POST", body: JSON.stringify({ body: note }) }),
    onSuccess: async () => {
      setNote("");
      await client.invalidateQueries({ queryKey: ["case", caseId] });
    },
  });
  const generateBrief = useMutation({
    mutationFn: () => apiRequest<AgentResult>(`/cases/${caseId}/agents/brief`, { method: "POST" }),
    onSuccess: setBrief,
  });
  const caseDetail = detail.data;
  const caseData = caseDetail?.case;
  const timeEvents = useMemo(() => [...(detail.data?.timeline ?? [])].sort((a, b) => a.time.localeCompare(b.time)), [detail.data?.timeline]);

  return (
    <AppShell>
      <Link className="mb-5 inline-flex items-center gap-2 text-[11px] text-slate-500 hover:text-slate-200" href="/investigations"><ArrowLeft className="h-3.5 w-3.5" /> Back to investigation queue</Link>
      {detail.isLoading && <StatusMessage title="Loading case evidence" description="Retrieving the authorized case record and timeline." loading />}
      {detail.isError && <StatusMessage title="Case could not be opened" description={detail.error.message} action={<button className="text-[11px] text-cyan-300" onClick={() => void detail.refetch()} type="button">Retry</button>} />}
      {caseDetail && caseData && (
        <>
          <PageTitle
            eyebrow={`${caseData.id} · ${caseData.subject}`}
            title={caseData.title}
            description={`Created ${formatTime(caseData.createdAt)} · ${caseData.evidenceCount} evidence sources · ${formatMoney(caseData.amountMinor, caseData.currency)} exposure`}
            action={<RiskBadge severity={caseData.priority} />}
          />
          <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2.5 text-[10px]">
            <span className="text-slate-500">Case status</span>
            <select aria-label="Case status" className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-[10px] text-slate-200" onChange={(event) => patchCase.mutate({ status: event.target.value, expectedVersion: caseData.version })} value={caseData.status}>
              <option value="open">Open</option><option value="investigating">Investigating</option><option value="under_review">Under review</option><option value="closed">Closed</option>
            </select>
            <span className="ml-3 text-slate-500">Assigned to</span>
            <select aria-label="Case owner" className="max-w-52 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-[10px] text-slate-200" disabled={patchCase.isPending || assignees.isLoading} onChange={(event) => { if (event.target.value !== caseData.owner) patchCase.mutate({ owner: event.target.value, expectedVersion: caseData.version }); }} value={caseData.owner}>
              {!assignees.data?.items.some((item) => item.id === caseData.owner) && <option value={caseData.owner}>{caseData.owner}</option>}
              {(assignees.data?.items ?? []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            {assignees.isError && <span className="text-rose-300">Assignees unavailable: {assignees.error.message}</span>}
            {patchCase.isError && <span className="text-rose-300">{patchCase.error.message}</span>}
            <span className="ml-auto flex items-center gap-1 text-slate-500"><Clock3 className="h-3 w-3" />Updated {formatTime(caseData.updatedAt)}</span>
          </div>

          <div className="grid gap-4 2xl:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-4">
              <Panel title="Investigation timeline" subtitle="Chronological activity reconstruction with source-linked events" action={<span className="rounded border border-slate-800 px-2 py-1 text-[9px] text-slate-500">{timeEvents.length} events</span>}>
                <div className="relative space-y-0 px-5 py-4">
                  <div aria-hidden="true" className="absolute bottom-7 left-[31px] top-7 w-px bg-gradient-to-b from-cyan-400/30 via-blue-400/20 to-transparent" />
                  {timeEvents.map((event) => (
                    <div className="relative flex gap-4 py-3" key={event.id}>
                      <span className={`z-10 mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${event.type === "alert" ? "border-rose-400/30 bg-rose-400/10" : "border-cyan-400/25 bg-[#0B111D]"}`}><span className={`h-1.5 w-1.5 rounded-full ${event.type === "alert" ? "bg-rose-300" : "bg-cyan-300"}`} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-medium text-slate-200">{event.title}</p><time className="text-[9px] text-slate-500">{formatTime(event.time)}</time></div>
                        <p className="mt-1 text-[10px] leading-5 text-slate-500">{event.description}</p>
                        <span className="mt-1.5 inline-block rounded bg-slate-900 px-1.5 py-1 text-[8px] uppercase tracking-wide text-slate-600">{event.type} · {event.id}</span>
                      </div>
                    </div>
                  ))}
                  {!timeEvents.length && <p className="pl-8 text-xs text-slate-500">No timeline events available.</p>}
                </div>
              </Panel>

              <Panel title="Transaction explorer" subtitle="Source-system records · values shown in USD">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left">
                    <thead className="text-[9px] uppercase tracking-wide text-slate-600"><tr><th className="px-5 py-3 font-medium">Transaction</th><th className="px-3 py-3 font-medium">Flow</th><th className="px-3 py-3 font-medium">Amount</th><th className="px-3 py-3 font-medium">Channel</th><th className="px-5 py-3 font-medium">Signal</th></tr></thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {(caseDetail.transactions ?? []).map((tx) => <tr key={tx.id}><td className="px-5 py-3"><p className="text-[10px] text-slate-300">{tx.id}</p><p className="mt-1 text-[9px] text-slate-600">{formatTime(tx.time)}</p></td><td className="px-3 py-3 text-[10px] text-slate-400">{tx.from} → {tx.to}</td><td className="px-3 py-3 text-[10px] tabular-nums text-slate-200">{formatMoney(tx.amountMinor, tx.currency)}</td><td className="px-3 py-3 text-[10px] text-slate-500">{tx.channel}</td><td className="px-5 py-3"><RiskBadge severity={tx.risk} /></td></tr>)}
                    </tbody>
                  </table>
                  {!caseDetail.transactions.length && <p className="p-5 text-xs text-slate-500">No transaction records linked to this case.</p>}
                </div>
              </Panel>
            </div>

            <div className="space-y-4">
              <Panel title="Evidence locker" subtitle="Provenance and confidence for linked records" action={<span className="text-[9px] text-slate-500">{caseDetail.evidence.length} records</span>}>
                <div className="divide-y divide-slate-800/60">
                  {caseDetail.evidence.map((item) => (
                    <article className="px-5 py-3.5" key={item.id}>
                      <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-medium text-slate-200">{item.title}</p><p className="mt-1 text-[9px] text-slate-500">{item.source} · {formatTime(item.observedAt)}</p></div><span className="rounded border border-cyan-400/10 bg-cyan-400/[0.04] px-1.5 py-1 text-[8px] text-cyan-200">{item.confidence.replace("_", " ")}</span></div>
                      <p className="mt-2 text-[10px] leading-5 text-slate-400">{item.summary}</p>
                      <p className="mt-1 text-[9px] font-mono text-slate-600">{item.id}</p>
                    </article>
                  ))}
                  {!caseDetail.evidence.length && <p className="p-5 text-xs text-slate-500">No evidence records linked.</p>}
                </div>
              </Panel>

              <Panel title="Investigator briefing" subtitle="Gemini · evidence-cited draft" action={<Sparkles className="h-4 w-4 text-violet-300" />}>
                <div className="p-5">
                  <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-violet-300/20 bg-violet-300/[0.06] px-3 py-2.5 text-xs font-medium text-violet-200 hover:bg-violet-300/10 disabled:opacity-50" disabled={generateBrief.isPending} onClick={() => generateBrief.mutate()} type="button">
                    <Bot className="h-4 w-4" />{generateBrief.isPending ? "Reviewing authorized evidence…" : "Generate case briefing"}
                  </button>
                  {generateBrief.isError && <div className="mt-3"><StatusMessage title="Briefing unavailable" description={generateBrief.error.message} /></div>}
                  {brief && <div className="mt-4 space-y-3">
                    <div className="rounded-lg border border-violet-300/10 bg-violet-300/[0.035] p-3"><p className="text-[11px] leading-6 text-slate-300">{brief.answer}</p><p className="mt-2 text-[9px] text-violet-300">AI draft · {brief.model} · Human review required</p></div>
                    {brief.claims.map((claim, index) => <div className="border-l border-cyan-400/30 pl-3" key={`${claim.evidenceRefs.join("-")}-${index}`}><p className="text-[10px] leading-5 text-slate-300">{claim.text}</p><p className="mt-1 text-[9px] text-cyan-300">Evidence: {claim.evidenceRefs.join(", ")}</p></div>)}
                    {brief.uncertainties.map((value) => <p className="text-[10px] leading-5 text-amber-200" key={value}>Unknown: {value}</p>)}
                  </div>}
                </div>
              </Panel>

              <Panel title="Analyst notes" subtitle="Case notes are tenant-scoped and audit logged">
                <div className="space-y-3 p-5">
                  {(caseDetail.notes ?? []).map((item) => <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-3" key={item.id}><p className="text-[11px] leading-5 text-slate-300">{item.body}</p><p className="mt-2 text-[9px] text-slate-600">{item.authorId} · {formatTime(item.createdAt)}</p></div>)}
                  <form onSubmit={(event) => { event.preventDefault(); createNote.mutate(); }}><label className="sr-only" htmlFor="case-note">Add investigation note</label><textarea className="min-h-20 w-full resize-y rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-blue-400/50" id="case-note" onChange={(event) => setNote(event.target.value)} placeholder="Record an observation or next step…" value={note} /><div className="mt-2 flex items-center justify-between"><span className="text-[9px] text-slate-600">Notes are part of the case audit trail.</span><button className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1.5 text-[10px] text-slate-200 disabled:opacity-50" disabled={createNote.isPending || note.trim().length < 2} type="submit"><Plus className="h-3 w-3" />Add note</button></div></form>
                  {createNote.isError && <p className="text-[10px] text-rose-300">{createNote.error.message}</p>}
                </div>
              </Panel>
              <Link className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/30 p-3 text-[11px] text-slate-400 hover:text-cyan-200" href={`/network?caseId=${caseId}`}><Network className="h-4 w-4 text-cyan-300" />Explore relationship intelligence graph</Link>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
