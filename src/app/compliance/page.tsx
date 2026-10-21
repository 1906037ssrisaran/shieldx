"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileCheck2, FileText, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PageTitle, Panel, StatusMessage } from "@/components/ui";
import { apiRequest, type CaseRecord } from "@/lib/api";

type Report = {
  id: string;
  caseId: string;
  reportType: string;
  version: number;
  status: string;
  content: {
    answer: string;
    claims: { text: string; evidenceRefs: string[]; classification: string }[];
    uncertainties: string[];
    recommendedActions: string[];
  };
  evidenceRefs: string[];
};

export default function CompliancePage() {
  const [caseId, setCaseId] = useState("CASE-1042");
  const [reportType, setReportType] = useState("sar");
  const [report, setReport] = useState<Report | null>(null);
  const queryClient = useQueryClient();
  const cases = useQuery({ queryKey: ["cases"], queryFn: () => apiRequest<{ items: CaseRecord[] }>("/cases") });
  const generate = useMutation({
    mutationFn: () => apiRequest<Report>(`/cases/${caseId}/reports`, { method: "POST", body: JSON.stringify({ reportType }) }),
    onSuccess: setReport,
  });
  const review = useMutation({
    mutationFn: () => apiRequest<Report>(`/cases/${caseId}/reports/${report?.id}/review`, { method: "POST", body: JSON.stringify({ decision: "approved", comment: "Reviewed for synthetic hackathon demonstration." }) }),
    onSuccess: setReport,
  });
  const [exportError, setExportError] = useState<string | null>(null);

  async function exportReport(format: "json" | "html" | "pdf") {
    if (!report) return;
    setExportError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";
      const headers = new Headers();
      if (
        process.env.NEXT_PUBLIC_DEMO_MODE === "true" ||
        (process.env.NODE_ENV === "development" &&
          process.env.NEXT_PUBLIC_DEMO_MODE !== "false")
      ) {
        headers.set("X-Demo-Role", window.localStorage.getItem("shieldiq-demo-role") ?? "fraud_analyst");
      }
      const response = await fetch(`${apiBase}/cases/${caseId}/reports/${report.id}/export?format=${format}`, { headers, credentials: "include" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? `Export failed (${response.status})`);
      }
      const file = await response.blob();
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${report.id}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      await queryClient.invalidateQueries({ queryKey: ["reports"] });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Report export failed.");
    }
  }

  return (
    <AppShell>
      <PageTitle eyebrow="Compliance & reporting" title="A report you can trace." description="Generate a cited report draft, review the evidence and gaps, then approve a specific version before controlled export." action={<span className="flex items-center gap-1.5 rounded-full border border-emerald-400/15 bg-emerald-400/[0.045] px-2.5 py-1.5 text-[9px] text-emerald-200"><ShieldCheck className="h-3 w-3" />Approval gate enforced</span>} />
      <div className="grid gap-4 2xl:grid-cols-[0.75fr_1.25fr]">
        <Panel title="Create a report draft" subtitle="Gemini-generated from case-authorized evidence">
          <div className="space-y-4 p-5">
            <label className="block text-[10px] text-slate-400">Investigation<select className="mt-2 w-full rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2.5 text-xs text-slate-200" onChange={(event) => { setCaseId(event.target.value); setReport(null); }} value={caseId}>{(cases.data?.items ?? []).map((item) => <option key={item.id} value={item.id}>{item.id} · {item.subject} · {item.title}</option>)}</select></label>
            <label className="block text-[10px] text-slate-400">Report type<select className="mt-2 w-full rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2.5 text-xs text-slate-200" onChange={(event) => setReportType(event.target.value)} value={reportType}><option value="sar">Suspicious Activity Report (SAR) draft</option><option value="investigation">Investigation report</option><option value="executive">Executive summary</option><option value="regulatory">Regulatory report draft</option></select></label>
            <div className="rounded-lg border border-amber-300/15 bg-amber-300/[0.035] p-3"><p className="text-[10px] font-medium text-amber-200">Draft—not a filing</p><p className="mt-1.5 text-[9px] leading-5 text-slate-400">All narrative requires authorized compliance review. No report is submitted to a regulator by ShieldIQ.</p></div>
            <button className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50" disabled={generate.isPending} onClick={() => generate.mutate()} type="button"><FileText className="h-4 w-4" />{generate.isPending ? "Drafting from evidence…" : "Generate cited report draft"}</button>
            {generate.isError && <StatusMessage title="Report generation failed" description={generate.error.message} />}
          </div>
        </Panel>
        <Panel title={report ? `${report.reportType.toUpperCase()} · ${report.id}` : "Review workspace"} subtitle={report ? `Version ${report.version} · ${report.status} · ${report.evidenceRefs.length} cited evidence sources` : "Generate a report draft to inspect its reasoning and sources"} action={report && <span className={`rounded-full border px-2 py-1 text-[9px] uppercase ${report.status === "approved" ? "border-emerald-300/20 text-emerald-200" : "border-amber-300/20 text-amber-200"}`}>{report.status}</span>}>
          {report ? <div className="p-5">
            <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-4"><p className="whitespace-pre-wrap text-xs leading-7 text-slate-300">{report.content.answer}</p></div>
            <div className="mt-5"><p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-cyan-300">Evidence citations</p><div className="flex flex-wrap gap-2">{report.evidenceRefs.map((reference) => <span className="rounded border border-cyan-300/15 bg-cyan-300/[0.04] px-2 py-1 font-mono text-[9px] text-cyan-200" key={reference}>{reference}</span>)}</div></div>
            {report.content.uncertainties.length > 0 && <div className="mt-5 rounded-lg border border-amber-300/15 bg-amber-300/[0.035] p-3"><p className="text-[9px] font-semibold uppercase tracking-widest text-amber-200">Missing / uncertain information</p>{report.content.uncertainties.map((item) => <p className="mt-2 text-[10px] leading-5 text-slate-300" key={item}>{item}</p>)}</div>}
            {report.content.recommendedActions.length > 0 && <div className="mt-4"><p className="text-[9px] font-semibold uppercase tracking-widest text-emerald-300">Analyst follow-up</p>{report.content.recommendedActions.map((item) => <p className="mt-2 text-[10px] leading-5 text-slate-400" key={item}>→ {item}</p>)}</div>}
            <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-800 pt-4">
              {report.status === "draft" ? <button className="inline-flex items-center gap-2 rounded-md bg-emerald-600/90 px-3 py-2 text-[10px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50" disabled={review.isPending} onClick={() => review.mutate()} type="button"><FileCheck2 className="h-3.5 w-3.5" />{review.isPending ? "Recording review…" : "Approve reviewed draft"}</button> : <span className="flex items-center gap-1.5 self-center text-[10px] text-emerald-200"><ShieldCheck className="h-3.5 w-3.5" />Approved by authorized compliance role</span>}
              {(["pdf", "html", "json"] as const).map((format) => <button className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-2 text-[10px] text-slate-300 hover:border-blue-400/30 disabled:cursor-not-allowed disabled:opacity-40" disabled={report.status !== "approved"} key={format} onClick={() => void exportReport(format)} type="button"><Download className="h-3 w-3" />{format.toUpperCase()}</button>)}
            </div>
            {review.isError && <p className="mt-3 text-[10px] text-rose-300">{review.error.message}</p>}
            {exportError && <p className="mt-3 text-[10px] text-rose-300">{exportError}</p>}
          </div> : <div className="grid min-h-64 place-items-center p-6 text-center"><div><FileCheck2 className="mx-auto h-7 w-7 text-slate-600" /><p className="mt-3 text-xs text-slate-400">No draft selected</p><p className="mt-1 text-[10px] text-slate-600">Generated reports remain editable and unapproved until reviewer action.</p></div></div>}
        </Panel>
      </div>
    </AppShell>
  );
}
