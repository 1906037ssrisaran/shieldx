"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, ArrowRight, Gauge, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PageTitle, Panel, StatusMessage } from "@/components/ui";
import { apiRequest, formatMoney, type AgentResult, type CaseRecord } from "@/lib/api";

type Simulation = {
  runId: string;
  caseId: string;
  horizonDays: number;
  fraudExpansionProbability: number;
  expectedLossMinor: number;
  currency: string;
  affectedAccounts: number;
  currentlyLinkedAccounts: number;
  recommendedAction: string;
  assumptions: string[];
  uncertainty: string;
  model: string;
  aiAssessment: AgentResult | null;
  aiAssessmentStatus: "generated" | "not_configured";
};

export default function SimulationPage() {
  const [caseId, setCaseId] = useState("CASE-1042");
  const [horizon, setHorizon] = useState(30);
  const [amount, setAmount] = useState(84725);
  const [containment, setContainment] = useState(65);
  const cases = useQuery({ queryKey: ["cases"], queryFn: () => apiRequest<{ items: CaseRecord[] }>("/cases") });
  const run = useMutation({
    mutationFn: () => apiRequest<Simulation>("/simulations", { method: "POST", body: JSON.stringify({ caseId, horizonDays: horizon, unmitigatedAmountMinor: Math.round(amount * 100), containmentRate: containment / 100 }) }),
  });

  return (
    <AppShell>
      <PageTitle eyebrow="Risk simulation lab" title="Model the next move." description="Compare transparent what-if assumptions against linked case context. Scenario outputs are illustrative and must never be represented as calibrated loss forecasts." />
      <div className="grid gap-4 2xl:grid-cols-[350px_1fr]">
        <Panel title="Scenario parameters" subtitle="Explicit assumptions · bounded 1–365 day horizon">
          <form className="space-y-5 p-5" onSubmit={(event) => { event.preventDefault(); run.mutate(); }}>
            <label className="block text-[10px] text-slate-400">Investigation<select className="mt-2 w-full rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2.5 text-xs text-slate-200" onChange={(event) => setCaseId(event.target.value)} value={caseId}>{(cases.data?.items ?? []).map((item) => <option key={item.id} value={item.id}>{item.id} · {item.subject}</option>)}</select></label>
            <label className="block text-[10px] text-slate-400">Scenario horizon <span className="float-right text-cyan-200">{horizon} days</span><input className="mt-3 w-full accent-blue-500" max={90} min={1} onChange={(event) => setHorizon(Number(event.target.value))} type="range" value={horizon} /></label>
            <label className="block text-[10px] text-slate-400">Unmitigated exposure (USD)<span className="mt-2 flex items-center rounded-md border border-slate-800 bg-slate-950/50 px-3"><span className="text-xs text-slate-600">$</span><input className="w-full bg-transparent px-2 py-2.5 text-xs text-slate-200 outline-none" min={0} onChange={(event) => setAmount(Number(event.target.value))} type="number" value={amount} /></span></label>
            <label className="block text-[10px] text-slate-400">Assumed containment effectiveness <span className="float-right text-cyan-200">{containment}%</span><input className="mt-3 w-full accent-blue-500" max={100} min={0} onChange={(event) => setContainment(Number(event.target.value))} type="range" value={containment} /></label>
            <button className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50" disabled={run.isPending} type="submit"><Activity className="h-4 w-4" />{run.isPending ? "Calculating scenario…" : "Run what-if simulation"}</button>
          </form>
        </Panel>
        <div className="space-y-4">
          {run.isError && <StatusMessage title="Simulation unavailable" description={run.error.message} />}
          {run.data ? (
            <>
              <section className="grid gap-3 sm:grid-cols-3">
                <div className="metric-tile rounded-2xl border border-rose-300/15 p-5"><p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">Expansion signal</p><p className="mt-4 text-3xl font-semibold tracking-tight tabular-nums text-rose-200">{(run.data.fraudExpansionProbability * 100).toFixed(1)}%</p><p className="mt-2 text-[9px] text-slate-500">Scenario heuristic · not calibrated</p></div>
                <div className="metric-tile rounded-2xl border border-amber-300/15 p-5"><p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">Expected exposure</p><p className="mt-4 text-3xl font-semibold tracking-tight tabular-nums text-amber-100">{formatMoney(run.data.expectedLossMinor, run.data.currency)}</p><p className="mt-2 text-[9px] text-slate-500">At {run.data.horizonDays} days · assumed recovery applied</p></div>
                <div className="metric-tile rounded-2xl border border-cyan-300/15 p-5"><p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">Potential impacted accounts</p><p className="mt-4 text-3xl font-semibold tracking-tight tabular-nums text-cyan-100">{run.data.affectedAccounts}</p><p className="mt-2 text-[9px] text-slate-500">{run.data.currentlyLinkedAccounts} linked now · heuristic projection</p></div>
              </section>
              <Panel title="Scenario interpretation" subtitle={`${run.data.model} · run ${run.data.runId}`}>
                <div className="space-y-4 p-5">
                  <div className="flex items-start gap-3 rounded-lg border border-blue-300/15 bg-blue-300/[0.035] p-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-200" /><div><p className="text-[10px] font-medium text-blue-100">Recommended analyst action</p><p className="mt-1.5 text-[11px] leading-5 text-slate-300">{run.data.recommendedAction}</p></div></div>
                  <div><p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-slate-400">Assumptions</p>{run.data.assumptions.map((item) => <p className="mt-1.5 text-[10px] text-slate-400" key={item}>• {item}</p>)}</div>
                  <p className="flex items-start gap-2 rounded-md bg-amber-300/[0.04] p-3 text-[10px] leading-5 text-amber-100/80"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{run.data.uncertainty}</p>
                  <a className="inline-flex items-center gap-1 text-[10px] text-cyan-300" href={`/investigations/${caseId}`}>Return to human investigation <ArrowRight className="h-3 w-3" /></a>
                </div>
              </Panel>
              {run.data.aiAssessment ? (
                <Panel title="Gemini future-impact assessment" subtitle="Evidence-grounded scenario reasoning · advisory only">
                  <div className="space-y-3 p-5">
                    <p className="text-xs leading-6 text-slate-200">{run.data.aiAssessment.answer}</p>
                    {run.data.aiAssessment.claims.map((claim, index) => <p className="rounded-lg border border-slate-800 bg-slate-950/30 p-3 text-[10px] leading-5 text-slate-300" key={`${claim.text}-${index}`}>{claim.text}<span className="mt-1 block text-[9px] text-cyan-300">{claim.classification.replaceAll("_", " ")} · {claim.evidenceRefs.join(", ")}</span></p>)}
                    {run.data.aiAssessment.uncertainties.map((item) => <p className="text-[10px] leading-5 text-amber-200" key={item}>Uncertainty · {item}</p>)}
                    {run.data.aiAssessment.recommendedActions.map((item) => <p className="text-[10px] leading-5 text-emerald-200" key={item}>Suggested · {item}</p>)}
                    <p className="border-t border-slate-800 pt-3 text-[9px] text-slate-500">{run.data.aiAssessment.model} · run {run.data.aiAssessment.runId} · scenario reasoning is not a calibrated forecast</p>
                  </div>
                </Panel>
              ) : (
                <StatusMessage title="Gemini assessment not configured" description="The deterministic scenario is available; configure Vertex AI on the API to generate evidence-grounded future-impact reasoning." />
              )}
            </>
          ) : (
            <Panel title="Scenario outcomes" subtitle="Exposure range and future network impact">
              <div className="grid min-h-72 place-items-center p-6 text-center"><div><Gauge className="mx-auto h-8 w-8 text-slate-600" /><p className="mt-3 text-xs text-slate-400">Configure a scenario to explore potential exposure.</p><p className="mt-1 text-[10px] text-slate-600">Inputs are explicit; the output reports assumptions and uncertainty.</p></div></div>
            </Panel>
          )}
        </div>
      </div>
    </AppShell>
  );
}
