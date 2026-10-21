"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Fingerprint, MapPin, Sparkles, Waves, Zap } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageTitle, Panel, StatusMessage } from "@/components/ui";
import { apiRequest, type AgentResult, type CaseRecord } from "@/lib/api";
import { useState } from "react";

const reasonLabels: Record<string, { title: string; description: string; icon: typeof Zap }> = {
  VELOCITY_SPIKE: { title: "Transaction velocity", description: "Several transfers occurred within a short observation window.", icon: Waves },
  SHARED_DEVICE: { title: "Device relationship", description: "A device fingerprint is associated with multiple accounts in this network.", icon: Fingerprint },
  NEW_BENEFICIARY: { title: "New beneficiary", description: "The outgoing transfer destination has no prior observed history for this account.", icon: Zap },
  LOCATION_ANOMALY: { title: "Location anomaly", description: "A sign-in region differs from the subject's recent activity pattern.", icon: MapPin },
};

type DetectionResult = {
  score: number;
  severity: string;
  alertThreshold: number;
  thresholdTriggered: boolean;
  ruleVersion: string;
  factors: { reasonCode: string; factor: string; points: number; evidenceRefs: string[] }[];
  unsupportedSignals: string[];
  unmappedSignals: string[];
  evidenceCoverage: number;
  decisionBoundary: string;
};

export default function ExplainabilityPage() {
  const [caseId, setCaseId] = useState("CASE-1042");
  const cases = useQuery({ queryKey: ["cases"], queryFn: () => apiRequest<{ items: CaseRecord[] }>("/cases") });
  const explain = useMutation({ mutationFn: () => apiRequest<AgentResult>(`/cases/${caseId}/agents/explain`, { method: "POST" }) });
  const detection = useMutation({ mutationFn: () => apiRequest<DetectionResult>(`/cases/${caseId}/detections/evaluate`, { method: "POST" }) });
  const selected = cases.data?.items.find((item) => item.id === caseId);
  const reasons = selected?.reasonCodes ?? [];

  return (
    <AppShell>
      <PageTitle eyebrow="Explainable intelligence" title="Make the risk legible." description="Translate machine-readable signals into a reviewable narrative. Observed facts, model inferences, and missing context remain distinct." action={<select aria-label="Choose case to explain" className="rounded-md border border-slate-800 bg-slate-900 px-2 py-2 text-[10px] text-slate-200" onChange={(event) => { setCaseId(event.target.value); explain.reset(); detection.reset(); }} value={caseId}>{(cases.data?.items ?? []).map((item) => <option key={item.id} value={item.id}>{item.id} · {item.subject}</option>)}</select>} />
      <div className="grid gap-4 2xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title="Signal decomposition" subtitle={selected ? `${selected.id} · score ${selected.riskScore}/100 · detection factors` : "Loading case signals"}>
          <div className="p-5">
            <div className="mb-5 flex items-end gap-3"><span className="text-5xl font-semibold tabular-nums text-white">{selected?.riskScore ?? "—"}</span><span className="pb-2 text-xs text-slate-500">Composite risk signal / 100</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-rose-400" style={{ width: `${selected?.riskScore ?? 0}%` }} /></div>
            <p className="mt-3 text-[10px] leading-5 text-slate-500">A prioritization signal—not a probability of guilt. Inspect each reason and its underlying evidence.</p>
            <button className="mt-4 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.045] px-3 py-2 text-[10px] font-medium text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-50" disabled={detection.isPending} onClick={() => detection.mutate()} type="button">{detection.isPending ? "Evaluating authorized evidence…" : "Evaluate with explainable rules"}</button>
            {detection.isError && <div className="mt-3"><StatusMessage title="Risk evaluation failed" description={detection.error.message} /></div>}
            {detection.data && <div className="mt-4 rounded-lg border border-cyan-300/10 bg-cyan-300/[0.025] p-3"><div className="flex items-baseline justify-between"><p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-200">Rules engine · {detection.data.ruleVersion}</p><p className="text-sm font-semibold text-white">{detection.data.score}/100 · {detection.data.severity}</p></div><p className="mt-2 text-[9px] text-slate-400">{detection.data.thresholdTriggered ? "Alert threshold met" : "Below alert threshold"} · {detection.data.alertThreshold}/100</p><div className="mt-3 space-y-2">{detection.data.factors.map((factor) => <div className="flex justify-between gap-3 text-[10px]" key={factor.reasonCode}><span className="text-slate-300">{factor.factor}<span className="ml-2 font-mono text-[8px] text-slate-600">{factor.evidenceRefs.join(", ")}</span></span><span className="shrink-0 text-cyan-200">+{factor.points}</span></div>)}</div>{detection.data.unsupportedSignals.length > 0 && <p className="mt-3 text-[9px] leading-5 text-amber-200">Not scored—supporting evidence missing: {detection.data.unsupportedSignals.join(", ")}</p>}<p className="mt-3 text-[9px] text-slate-500">{detection.data.decisionBoundary}</p></div>}
            <div className="mt-5 space-y-2">
              {reasons.map((reason) => {
                const item = reasonLabels[reason] ?? { title: reason.replaceAll("_", " ").toLowerCase(), description: "Configured detection reason requires analyst review.", icon: Sparkles };
                const Icon = item.icon;
                return <div className="flex gap-3 rounded-lg border border-slate-800/80 bg-slate-950/25 p-3" key={reason}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-cyan-300/10 bg-cyan-300/[0.04]"><Icon className="h-4 w-4 text-cyan-200" /></span><div><p className="text-[11px] font-medium capitalize text-slate-200">{item.title}</p><p className="mt-1 text-[10px] leading-5 text-slate-500">{item.description}</p><p className="mt-1 font-mono text-[8px] text-slate-600">{reason}</p></div></div>;
              })}
              {!reasons.length && <p className="text-xs text-slate-500">No reason codes attached to the selected case.</p>}
            </div>
          </div>
        </Panel>
        <Panel title="Evidence-led risk explanation" subtitle="Gemini-generated · authorized evidence · citations validated" action={<span className="rounded border border-violet-300/15 px-2 py-1 text-[9px] text-violet-200">Human review required</span>}>
          <div className="p-5">
            <button className="inline-flex items-center gap-2 rounded-lg border border-violet-300/20 bg-violet-300/[0.055] px-3 py-2.5 text-[10px] font-medium text-violet-200 hover:bg-violet-300/10 disabled:opacity-50" disabled={explain.isPending} onClick={() => explain.mutate()} type="button"><Sparkles className="h-4 w-4" />{explain.isPending ? "Interpreting case evidence…" : "Generate risk explanation"}</button>
            {explain.isError && <div className="mt-4"><StatusMessage title="Explanation could not be generated" description={explain.error.message} /></div>}
            {explain.data && <div className="mt-5 space-y-4">
              <p className="text-sm leading-7 text-slate-200">{explain.data.answer}</p>
              <div><p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-cyan-300">Evidence-linked claims</p>{explain.data.claims.map((claim, index) => <article className="mb-2 rounded-lg border border-slate-800 bg-slate-950/35 p-3" key={`${claim.text}-${index}`}><p className="text-[11px] leading-5 text-slate-300">{claim.text}</p><p className="mt-2 text-[9px] text-slate-500">{claim.classification.replaceAll("_", " ")} · {claim.evidenceRefs.join(", ")}</p></article>)}</div>
              {!!explain.data.uncertainties.length && <div className="rounded-lg border border-amber-300/15 bg-amber-300/[0.035] p-3"><p className="text-[9px] font-semibold uppercase tracking-widest text-amber-200">Confidence limits / unknowns</p>{explain.data.uncertainties.map((item) => <p className="mt-2 text-[10px] leading-5 text-slate-300" key={item}>{item}</p>)}</div>}
              {!!explain.data.recommendedActions.length && <div><p className="text-[9px] font-semibold uppercase tracking-widest text-emerald-300">Suggested verification</p>{explain.data.recommendedActions.map((item) => <p className="mt-2 text-[10px] leading-5 text-slate-300" key={item}>→ {item}</p>)}</div>}
              <p className="border-t border-slate-800 pt-3 text-[9px] text-violet-300">Run {explain.data.runId} · {explain.data.model} · Draft only</p>
            </div>}
            {!explain.data && !explain.isPending && !explain.isError && <p className="mt-5 text-xs leading-6 text-slate-500">Generate a case-specific narrative from authorized evidence. Unsupported citations are rejected by the API.</p>}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
