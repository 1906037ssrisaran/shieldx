"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Banknote,
  CircleAlert,
  Fingerprint,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Panel, PageTitle, MetricCard, RiskBadge, StatusMessage } from "@/components/ui";
import { apiRequest, formatMoney, formatTime, type CaseRecord } from "@/lib/api";

type DashboardData = {
  asOf: string;
  window: string;
  freshness: string;
  fraudExposureMinor: number | null;
  moneySavedMinor: number | null;
  activeCases: number;
  criticalAlerts: number;
  trend: { date: string; exposure: number; prevented: number }[];
  heatmap: { region: string; count: number; risk: string }[];
  recommendation: string;
  recommendationCaseId: string | null;
};
type Alert = {
  id: string;
  caseId: string;
  subject: string;
  type: string;
  score: number;
  severity: string;
  createdAt: string;
  amountMinor: number;
  currency: string;
};

function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-700 bg-[#111927] px-3 py-2 shadow-xl">
      <p className="mb-1 text-[10px] text-slate-400">{label}</p>
      {payload.map((item) => (
        <p className="text-xs text-slate-200" key={item.name}>
          <span style={{ color: item.color }}>● </span>
          {item.name}: ${item.value.toLocaleString()}k
        </p>
      ))}
    </div>
  );
}

export function Dashboard() {
  const summary = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiRequest<DashboardData>("/dashboard/summary"),
  });
  const alerts = useQuery({
    queryKey: ["alerts"],
    queryFn: () => apiRequest<{ items: Alert[] }>("/alerts?limit=8"),
  });
  const cases = useQuery({
    queryKey: ["cases"],
    queryFn: () => apiRequest<{ items: CaseRecord[] }>("/cases"),
  });
  const maxHeatmapCount = Math.max(...(summary.data?.heatmap ?? []).map((region) => region.count), 1);

  return (
    <>
      <PageTitle
        eyebrow="Executive command center · tenant-scoped"
        title="Risk, in context."
        description="Portfolio exposure, active investigations, and emerging financial-crime signals in one operational view."
        action={
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-[10px] text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
            {summary.data?.window ?? (summary.isLoading ? "Loading window…" : "Window unavailable")}
            <span className="mx-1 h-3 w-px bg-slate-700" />
            {summary.data?.freshness ?? (summary.isLoading ? "Loading data…" : "Freshness unavailable")}
          </div>
        }
      />

      {(summary.isError || alerts.isError || cases.isError) && (
        <StatusMessage
          title="Command center data is unavailable"
          description={
            summary.error?.message ??
            alerts.error?.message ??
            cases.error?.message ??
            "Check the API service and your access."
          }
          action={
            <button
              className="text-[11px] font-medium text-cyan-300"
              onClick={() => {
                void summary.refetch();
                void alerts.refetch();
                void cases.refetch();
              }}
              type="button"
            >
              Retry data
            </button>
          }
        />
      )}
      {summary.isLoading && <StatusMessage title="Loading portfolio signals" description="Retrieving tenant-scoped risk metrics." loading />}

      {summary.data && (
        <div className="dashboard-content">
          <section aria-label="Investigation queue and recent alerts" className="dashboard-queue grid gap-4 2xl:grid-cols-[1.25fr_1fr]">
            <Panel
              title="Investigation queue"
              subtitle="Open and active cases · tenant-authorized access"
              action={<Link className="text-[10px] text-blue-300 hover:text-cyan-200" href="/investigations">Open case workspace →</Link>}
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[650px] text-left">
                  <thead className="text-[9px] uppercase tracking-[0.14em] text-slate-600">
                    <tr>
                      <th className="px-5 py-3 font-medium">Case / subject</th>
                      <th className="px-3 py-3 font-medium">Risk signal</th>
                      <th className="px-3 py-3 font-medium">Exposure</th>
                      <th className="px-3 py-3 font-medium">Owner</th>
                      <th className="px-5 py-3 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {(cases.data?.items ?? []).slice(0, 4).map((item) => (
                      <tr className="data-row" key={item.id}>
                        <td className="px-5 py-3.5">
                          <Link className="text-xs font-medium text-slate-200 hover:text-cyan-200" href={`/investigations/${item.id}`}>{item.title}</Link>
                          <p className="mt-1 text-[10px] text-slate-500">{item.id} · {item.subject}</p>
                        </td>
                        <td className="px-3 py-3.5"><div className="flex items-center gap-2"><span className="text-xs tabular-nums text-slate-200">{item.riskScore}</span><RiskBadge severity={item.priority} /></div></td>
                        <td className="px-3 py-3.5 text-xs tabular-nums text-slate-300">{formatMoney(item.amountMinor, item.currency)}</td>
                        <td className="px-3 py-3.5 text-[11px] text-slate-400">{item.owner}</td>
                        <td className="px-5 py-3.5 text-[10px] text-slate-500">{formatTime(item.updatedAt)}</td>
                      </tr>
                    ))}
                    {!cases.isLoading && !cases.data?.items.length && (
                      !cases.isError && <tr><td className="px-5 py-8 text-center text-xs text-slate-500" colSpan={5}>No cases match your access scope.</td></tr>
                    )}
                    {cases.isLoading && <tr><td className="px-5 py-8 text-center text-xs text-slate-500" colSpan={5}>Loading authorized case records…</td></tr>}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title="Recent risk signals" subtitle="Evidence-linked alerts · newest first">
              <div className="divide-y divide-slate-800/60">
                {(alerts.data?.items ?? []).map((alert) => (
                  <Link className="data-row flex items-center gap-3 px-5 py-3.5" href={`/investigations/${alert.caseId}`} key={alert.id}>
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-cyan-300/10 bg-cyan-300/[0.04]"><CircleAlert className="h-4 w-4 text-cyan-200" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium text-slate-200">{alert.type}</span>
                      <span className="mt-1 block text-[9px] text-slate-500">{alert.id} · {alert.subject} · {formatTime(alert.createdAt)}</span>
                    </span>
                    <span><RiskBadge severity={alert.severity} /></span>
                    <span className="text-right"><span className="block text-xs font-semibold tabular-nums text-slate-200">{alert.score}</span><span className="text-[9px] text-slate-500">score</span></span>
                  </Link>
                ))}
                {!alerts.isLoading && !alerts.data?.items.length && (
                  !alerts.isError && <p className="px-5 py-8 text-center text-xs text-slate-500">No alert signals in your scope.</p>
                )}
                {alerts.isLoading && <p className="px-5 py-8 text-center text-xs text-slate-500">Loading authorized alert signals…</p>}
              </div>
            </Panel>
          </section>

          <section aria-label="Executive key performance indicators" className="dashboard-kpis grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            <MetricCard
              label="Active exposure"
              value={summary.data.fraudExposureMinor === null ? "—" : formatMoney(summary.data.fraudExposureMinor)}
              icon={Banknote}
              tone="blue"
              detail="Reported exposure aggregate"
            />
            <MetricCard
              label="Funds safeguarded"
              value={summary.data.moneySavedMinor === null ? "—" : formatMoney(summary.data.moneySavedMinor)}
              icon={ShieldCheck}
              tone="cyan"
              detail="Reported aggregate"
            />
            <MetricCard
              label="Open investigations"
              value={summary.data.activeCases.toString()}
              icon={Fingerprint}
              tone="violet"
              detail="Within your authorized scope"
            />
            <MetricCard
              label="Critical alerts"
              value={
                summary.data.criticalAlerts.toString()
              }
              icon={CircleAlert}
              tone="amber"
              detail="Reported count"
            />
          </section>

          <section className="dashboard-analytics grid gap-4 2xl:grid-cols-[1.65fr_1fr]">
            <Panel
              className="dashboard-hero"
              title="Exposure trajectory"
              subtitle="Observed exposure vs. funds safeguarded · daily aggregate"
              action={
                <span className="rounded-md border border-slate-800 px-2 py-1 text-[9px] text-slate-500">
                  Last 7 days
                </span>
              }
            >
              <div className="h-[240px] px-2 pb-3 pt-5 sm:h-[285px]">
                {summary.data.trend.length ? (
                  <ResponsiveContainer height="100%" width="100%">
                    <AreaChart data={summary.data.trend} margin={{ top: 5, right: 12, left: -16, bottom: 0 }}>
                      <defs>
                        <linearGradient id="exposureFill" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="#C79545" stopOpacity={0.24} />
                          <stop offset="95%" stopColor="#C79545" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="preventedFill" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="#A58F7F" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#A58F7F" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#DED4CA" strokeDasharray="3 5" vertical={false} />
                      <XAxis axisLine={false} dataKey="date" tick={{ fill: "#827366", fontSize: 10 }} tickLine={false} />
                      <YAxis axisLine={false} tick={{ fill: "#827366", fontSize: 10 }} tickFormatter={(value: number) => `$${value}k`} tickLine={false} />
                      <Tooltip content={<TrendTooltip />} />
                      <Area dataKey="exposure" fill="url(#exposureFill)" name="Exposure" stroke="#C79545" strokeWidth={2} type="monotone" />
                      <Area dataKey="prevented" fill="url(#preventedFill)" name="Safeguarded" stroke="#A58F7F" strokeWidth={1.6} type="monotone" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="grid h-full place-items-center text-xs text-slate-500">No trend data for this tenant yet.</p>
                )}
              </div>
              <div className="flex gap-5 border-t border-slate-800/70 px-5 py-3 text-[10px] text-slate-500">
                <span><i className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-blue-400" />Exposure</span>
                <span><i className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-cyan-300" />Safeguarded</span>
                <span className="ml-auto">As of {new Date(summary.data.asOf).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </Panel>

            <Panel title="Regional signal heatmap" subtitle="Relative alert concentration · tenant-scoped">
              <div className="space-y-3 px-5 py-5">
                {summary.data.heatmap.length ? (
                  <div className="grid grid-cols-2 gap-2">
                    {summary.data.heatmap.map((region) => {
                      const activeCells = Math.min(8, Math.max(0, Math.round((region.count / maxHeatmapCount) * 8)));
                      const tone = region.risk === "high"
                        ? { cell: "bg-rose-300", tint: "border-rose-300/15 bg-rose-300/[0.045]", label: "text-rose-200" }
                        : region.risk === "elevated"
                          ? { cell: "bg-amber-300", tint: "border-amber-300/15 bg-amber-300/[0.04]", label: "text-amber-100" }
                          : { cell: "bg-cyan-300", tint: "border-cyan-300/12 bg-cyan-300/[0.035]", label: "text-cyan-100" };
                      return (
                        <div className={`rounded-xl border p-3 ${tone.tint}`} key={region.region}>
                          <div className="flex items-start justify-between gap-2">
                            <span className="truncate text-[10px] font-medium text-slate-200">{region.region}</span>
                            <span className={`shrink-0 text-[9px] font-semibold uppercase tracking-wide ${tone.label}`}>{region.risk}</span>
                          </div>
                          <div aria-hidden="true" className="mt-3 grid grid-cols-8 gap-1">
                            {Array.from({ length: 8 }, (_, index) => (
                              <span className={`h-1.5 rounded-sm ${index < activeCells ? tone.cell : "bg-white/[0.06]"}`} key={index} style={{ opacity: index < activeCells ? (index < activeCells / 2 ? 0.9 : 0.45) : 1 }} />
                            ))}
                          </div>
                          <p className="mt-2 text-[9px] tabular-nums text-slate-500">{region.count} observed signals</p>
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="text-xs text-slate-500">No regional aggregation available.</p>}
                <div className="intelligence-card mt-6 rounded-2xl border p-3.5">
                  <div className="flex gap-2">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
                    <div>
                      <p className="text-[11px] font-medium text-violet-200">Investigation signal</p>
                      <p className="mt-1.5 text-[11px] leading-5 text-slate-400">{summary.data.recommendation}</p>
                      {summary.data.recommendationCaseId && <Link className="mt-2 inline-block text-[10px] text-violet-300 hover:text-violet-200" href={`/investigations/${summary.data.recommendationCaseId}`}>Open linked case →</Link>}
                    </div>
                  </div>
                </div>
              </div>
            </Panel>
          </section>

          <section aria-label="Investigation workflow" className="dashboard-path investigation-path flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] px-4 py-3.5 sm:px-5">
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">Investigation workflow</p>
              <p className="mt-1 text-[11px] text-slate-300">Move from a risk signal to source-backed review.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className="rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-[10px] text-slate-300 hover:border-indigo-300/25 hover:text-indigo-100" href="/investigations">Cases</Link>
              <Link className="rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-[10px] text-slate-300 hover:border-indigo-300/25 hover:text-indigo-100" href="/network">Relationships</Link>
              <Link className="rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-[10px] text-slate-300 hover:border-indigo-300/25 hover:text-indigo-100" href="/compliance">Compliance review</Link>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
