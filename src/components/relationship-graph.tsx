"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ChevronRight,
  CircleDot,
  Clock3,
  Pause,
  Play,
  RotateCcw,
  ScanSearch,
  Search,
  Share2,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import { apiRequest } from "@/lib/api";
import { Panel, RiskBadge, StatusMessage } from "@/components/ui";

type Entity = {
  id: string;
  type: string;
  label: string;
  risk: number;
  x: number;
  y: number;
};
type Relationship = {
  id: string;
  source: string;
  target: string;
  label: string;
  type: string;
  evidenceId: string;
};
type GraphData = {
  nodes: Entity[];
  edges: Relationship[];
  clusters: { id: string; label: string; nodeIds: string[]; risk: string }[];
};
type TimelineEvent = {
  id: string;
  time: string;
  type: string;
  title: string;
  description: string;
};
type CaseData = { timeline: TimelineEvent[] };
type EntityData = { entity: Entity; emphasized: boolean; dimmed: boolean };
type EntityNode = Node<EntityData>;

function riskColor(risk: number) {
  if (risk >= 90) return "#b54a43";
  if (risk >= 70) return "#a8792e";
  return "#7b8c70";
}

function minimapNodeColor(data: unknown) {
  if (typeof data !== "object" || data === null || !("entity" in data)) return "#a49485";
  const entity = data.entity;
  if (typeof entity !== "object" || entity === null || !("risk" in entity) || typeof entity.risk !== "number") {
    return "#a49485";
  }
  return riskColor(entity.risk);
}

function EntityCard({ data, selected }: NodeProps<EntityNode>) {
  const reduceMotion = useReducedMotion();
  const { entity, emphasized, dimmed } = data;
  const color =
    entity.risk >= 90
      ? "border-rose-400/35 shadow-[0_0_26px_rgba(244,63,94,0.13)]"
      : entity.risk >= 70
        ? "border-amber-300/30 shadow-[0_0_20px_rgba(245,158,11,0.10)]"
        : "border-slate-700/90";
  const iconColor =
    entity.risk >= 90 ? "text-rose-300" : entity.risk >= 70 ? "text-amber-300" : "text-cyan-300";
  return (
    <motion.div
      animate={{ scale: selected ? 1.025 : 1 }}
      className={`entity-node min-w-[172px] rounded-2xl border bg-[#0a0e17]/95 px-3.5 py-3 backdrop-blur-xl ${color} ${selected ? "ring-1 ring-cyan-200/80" : ""} ${emphasized ? "entity-node-emphasized" : ""} ${dimmed ? "entity-node-dimmed" : ""}`}
      transition={{ duration: reduceMotion ? 0 : 0.18 }}
      whileHover={reduceMotion ? undefined : { y: -2 }}
    >
      <Handle className="!h-1.5 !w-1.5 !border-0 !bg-cyan-300" position={Position.Left} type="target" />
      <div className="flex items-center justify-between gap-3">
        <div className={`grid h-8 w-8 place-items-center rounded-xl border border-white/[0.06] bg-white/[0.035] text-[9px] font-semibold uppercase ${iconColor}`}>
          {entity.type.slice(0, 3)}
        </div>
        <span className={`text-[9px] font-semibold tabular-nums ${iconColor}`}>
          {entity.risk}<span className="ml-0.5 text-slate-600">RISK</span>
        </span>
      </div>
      <p className="mt-3 text-[11px] font-medium text-slate-100">{entity.label}</p>
      <p className="mt-1.5 text-[8px] uppercase tracking-[0.17em] text-slate-500">{entity.type} entity</p>
      <Handle className="!h-1.5 !w-1.5 !border-0 !bg-cyan-300" position={Position.Right} type="source" />
    </motion.div>
  );
}

const nodeTypes = { entity: EntityCard };

function formatEventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

export function RelationshipGraph({ caseId = "CASE-1042" }: { caseId?: string }) {
  const reduceMotion = useReducedMotion();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<Entity | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Relationship | null>(null);
  const [focusedCluster, setFocusedCluster] = useState<string | null>(null);
  const [focusRevision, setFocusRevision] = useState(0);
  const [activeEventIndex, setActiveEventIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);

  const graph = useQuery({
    queryKey: ["graph", caseId],
    queryFn: () => apiRequest<GraphData>(`/cases/${caseId}/graph`),
  });
  const caseDetails = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => apiRequest<CaseData>(`/cases/${caseId}`),
  });
  const timeline = useMemo(
    () => [...(caseDetails.data?.timeline ?? [])].sort((left, right) => Date.parse(left.time) - Date.parse(right.time)),
    [caseDetails.data?.timeline],
  );
  const activeEvent = activeEventIndex >= 0 ? timeline[activeEventIndex] : null;
  const observedEvidence = useMemo(
    () => new Set(timeline.slice(0, activeEventIndex + 1).map((event) => event.id)),
    [timeline, activeEventIndex],
  );
  const isReplayActive = activeEventIndex >= 0;

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setActiveEventIndex((index) => Math.min(index + 1, timeline.length - 1));
    }, 1250);
    return () => window.clearInterval(timer);
  }, [isPlaying, timeline.length]);

  useEffect(() => {
    if (isPlaying && activeEventIndex >= timeline.length - 1) setIsPlaying(false);
  }, [activeEventIndex, isPlaying, timeline.length]);

  const elements = useMemo(() => {
    const sourceNodes = graph.data?.nodes ?? [];
    const sourceEdges = graph.data?.edges ?? [];
    const matches = new Set(
      sourceNodes
        .filter((node) => (filter === "all" || node.type === filter) && (!search || node.label.toLowerCase().includes(search.toLowerCase())))
        .map((node) => node.id),
    );
    const context = new Set<string>();
    for (const edge of sourceEdges) {
      if (matches.has(edge.source) || matches.has(edge.target)) {
        context.add(edge.source);
        context.add(edge.target);
      }
    }
    const included = filter === "all" && !search ? null : new Set([...matches, ...context]);
    const focusIds = new Set(graph.data?.clusters.find((cluster) => cluster.id === focusedCluster)?.nodeIds ?? []);
    const nodes: EntityNode[] = sourceNodes
      .filter((node) => !included || included.has(node.id))
      .map((entity) => {
        const isDimmedByFocus = focusIds.size > 0 && !focusIds.has(entity.id);
        const isEmphasizedByReplay =
          isReplayActive &&
          sourceEdges.some(
            (edge) =>
              observedEvidence.has(edge.evidenceId) &&
              (edge.source === entity.id || edge.target === entity.id),
          );
        return {
          id: entity.id,
          type: "entity",
          position: { x: entity.x, y: entity.y },
          data: { entity, emphasized: isEmphasizedByReplay, dimmed: isDimmedByFocus },
          style: { opacity: isDimmedByFocus ? 0.22 : 1, transition: "opacity 300ms ease" },
        };
      });
    const visible = new Set(nodes.map((node) => node.id));
    const edges: Edge[] = sourceEdges
      .filter((edge) => visible.has(edge.source) && visible.has(edge.target))
      .map((edge) => {
        const activeNow = Boolean(activeEvent && edge.evidenceId === activeEvent.id);
        const seenInReplay = observedEvidence.has(edge.evidenceId);
        const isDimmedByFocus = focusIds.size > 0 && !(focusIds.has(edge.source) && focusIds.has(edge.target));
        const isDimmedByReplay = isReplayActive && !seenInReplay;
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.label,
          animated: activeNow || (!isReplayActive && edge.type === "transfer"),
          style: {
            stroke: activeNow ? "#a8792e" : edge.type === "transfer" ? "#c79545" : "#bdaa9b",
            strokeWidth: activeNow ? 3 : edge.type === "transfer" ? 1.8 : 1.25,
            opacity: Math.min(isDimmedByFocus ? 0.12 : 1, isDimmedByReplay ? 0.16 : 1),
            filter: activeNow ? "drop-shadow(0 0 6px rgba(168,121,46,.42))" : undefined,
            transition: "opacity 300ms ease, stroke 300ms ease",
          },
          labelStyle: { fill: activeNow ? "#67481e" : "#706257", fontSize: 8, fontWeight: 600 },
          labelBgStyle: { fill: "#f7f3ef", fillOpacity: 0.96 },
          labelBgPadding: [4, 3] as [number, number],
        };
      });
    return { nodes, edges };
  }, [graph.data, filter, search, focusedCluster, activeEvent, observedEvidence, isReplayActive]);

  const visibleNodeIds = useMemo(() => new Set(elements.nodes.map((node) => node.id)), [elements.nodes]);
  const currentEventEdges = useMemo(
    () => graph.data?.edges.filter((edge) => edge.evidenceId === activeEvent?.id) ?? [],
    [graph.data?.edges, activeEvent?.id],
  );

  function focusCluster(clusterId: string) {
    setFocusedCluster((current) => (current === clusterId ? null : clusterId));
    setSearch("");
    setFilter("all");
    setFocusRevision((revision) => revision + 1);
    setSelected(null);
    setSelectedEdge(null);
  }

  function selectTimelineEvent(index: number) {
    setIsPlaying(false);
    setActiveEventIndex(index);
    const event = timeline[index];
    const relationship = graph.data?.edges.find((edge) => edge.evidenceId === event?.id);
    setSelectedEdge(relationship ?? null);
    setSelected(null);
  }

  function toggleReplay() {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (!timeline.length) return;
    if (activeEventIndex >= timeline.length - 1) setActiveEventIndex(-1);
    setIsPlaying(true);
  }

  function resetReplay() {
    setIsPlaying(false);
    setActiveEventIndex(-1);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {[
          { label: "Entities in scope", value: graph.data?.nodes.length ?? (graph.isError ? "—" : "…"), icon: CircleDot, tone: "text-cyan-200" },
          { label: "Evidence relationships", value: graph.data?.edges.length ?? (graph.isError ? "—" : "…"), icon: Waypoints, tone: "text-blue-200" },
          { label: "Candidate clusters", value: graph.data?.clusters.length ?? (graph.isError ? "—" : "…"), icon: Activity, tone: "text-amber-200" },
          { label: "Time-ordered events", value: caseDetails.data ? timeline.length : caseDetails.isError ? "—" : "…", icon: Clock3, tone: "text-violet-200" },
        ].map(({ label, value, icon: Icon, tone }) => (
          <div className="graph-stat" key={label}>
            <Icon aria-hidden="true" className={`h-4 w-4 ${tone}`} />
            <span className="min-w-0">
              <strong className="block text-lg font-semibold tabular-nums text-slate-100">{value}</strong>
              <span className="block truncate text-[9px] uppercase tracking-[0.14em] text-slate-500">{label}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]">
        <Panel
          className="graph-panel overflow-hidden"
          title="Relationship intelligence"
          subtitle="Evidence-linked entity topology · select a node, edge, or event to inspect provenance"
          action={
            <span className="flex items-center gap-1.5 rounded-full border border-cyan-300/15 bg-cyan-300/[0.05] px-2.5 py-1 text-[9px] text-cyan-100">
              <Share2 aria-hidden="true" className="h-3 w-3" />
              {graph.data ? `${elements.nodes.length} visible` : graph.isError ? "Unavailable" : "Loading topology"}
            </span>
          }
        >
          <div className="flex flex-wrap items-center gap-2 border-y border-slate-800/70 bg-[#080c14]/65 p-3">
            <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5">
              <Search aria-hidden="true" className="h-3.5 w-3.5 text-slate-500" />
              <input
                aria-label="Search graph entities"
                className="w-full bg-transparent text-[10px] text-slate-200 outline-none placeholder:text-slate-600"
                onChange={(event) => {
                  setFocusedCluster(null);
                  setSearch(event.target.value);
                }}
                placeholder="Find an account, device, IP…"
                value={search}
              />
            </label>
            <select
              aria-label="Filter graph entity type"
              className="rounded-xl border border-white/[0.08] bg-[#090b11] px-3 py-2.5 text-[10px] text-slate-300"
              onChange={(event) => {
                setFocusedCluster(null);
                setFilter(event.target.value);
              }}
              value={filter}
            >
              <option value="all">All entities</option>
              <option value="account">Accounts</option>
              <option value="device">Devices</option>
              <option value="merchant">Merchants</option>
              <option value="ip">IP addresses</option>
              <option value="phone">Phones</option>
              <option value="email">Emails</option>
            </select>
            {focusedCluster && (
              <button
                className="rounded-lg border border-cyan-300/20 px-2.5 py-2 text-[9px] text-cyan-100 hover:bg-cyan-300/10"
                onClick={() => setFocusedCluster(null)}
                type="button"
              >
                Clear focus
              </button>
            )}
          </div>

          {graph.isError && (
            <div className="p-4">
              <StatusMessage title="Relationship graph unavailable" description={graph.error.message} action={<button className="text-[10px] text-cyan-300" onClick={() => void graph.refetch()} type="button">Retry</button>} />
            </div>
          )}
          {graph.isLoading && (
            <div aria-label="Loading relationship graph" className="graph-loading h-[560px] p-6">
              <div className="graph-skeleton-orbit" />
              <div className="graph-skeleton-node graph-skeleton-node-a" />
              <div className="graph-skeleton-node graph-skeleton-node-b" />
              <div className="graph-skeleton-node graph-skeleton-node-c" />
              <p className="absolute bottom-5 left-5 text-[10px] uppercase tracking-[0.18em] text-slate-500">Assembling authorized evidence topology…</p>
            </div>
          )}
          {graph.data && graph.data.nodes.length === 0 && (
            <div className="grid h-[360px] place-items-center p-8 text-center">
              <div>
                <ScanSearch aria-hidden="true" className="mx-auto h-8 w-8 text-slate-600" />
                <p className="mt-4 text-sm font-medium text-slate-300">No linked entities returned</p>
                <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">There is no relationship topology for this case yet. This view does not infer or fabricate missing links.</p>
              </div>
            </div>
          )}
          {graph.data && graph.data.nodes.length > 0 && (
            <>
              <div className="graph-flow relative h-[min(68vh,680px)] min-h-[500px] w-full bg-[radial-gradient(ellipse_at_50%_48%,rgba(233,185,104,0.16),transparent_62%)]">
                <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 rounded-lg border border-white/[0.07] bg-[#060a12]/80 px-3 py-2 text-[9px] uppercase tracking-[0.13em] text-slate-400 backdrop-blur">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(0,212,255,.8)]" />
                  {isReplayActive ? "Evidence replay" : "Observed topology"}
                  {activeEvent && <span className="ml-1 font-mono text-cyan-100">{formatEventTime(activeEvent.time)}</span>}
                </div>
                <ReactFlow
                  key={focusRevision}
                  edges={elements.edges}
                  fitView
                  fitViewOptions={{ padding: focusedCluster ? 0.45 : 0.22 }}
                  nodes={elements.nodes}
                  nodeTypes={nodeTypes}
                  onEdgeClick={(_, edge) => {
                    setSelected(null);
                    setSelectedEdge(graph.data?.edges.find((item) => item.id === edge.id) ?? null);
                  }}
                  onNodeClick={(_, node) => {
                    setSelected(node.data.entity);
                    setSelectedEdge(null);
                  }}
                  onPaneClick={() => {
                    setSelected(null);
                    setSelectedEdge(null);
                  }}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background color="#dfd4ca" gap={32} size={1} variant={BackgroundVariant.Dots} />
                  <Controls className="!overflow-hidden !rounded-lg !border !border-slate-700 !bg-slate-900 [&>button]:!border-slate-700 [&>button]:!bg-slate-900 [&>button]:!fill-slate-300" />
                  <MiniMap className="!border !border-slate-700 !bg-slate-950" nodeColor={(node) => minimapNodeColor(node.data)} maskColor="rgba(247,243,239,0.75)" />
                </ReactFlow>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/70 bg-[#080c14]/80 px-4 py-3">
                <div className="flex items-center gap-4 text-[9px] text-slate-500">
                  <span><i className="mr-1.5 inline-block w-5 border-t-2 border-blue-400" />Transfer</span>
                  <span><i className="mr-1.5 inline-block w-5 border-t border-slate-500" />Shared attribute</span>
                  <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-rose-400" />Elevated risk signal</span>
                </div>
                <p className="flex items-center gap-1 text-[9px] text-slate-500"><ShieldCheck className="h-3 w-3 text-cyan-300/80" />Proximity is a lead—not proof.</p>
              </div>
            </>
          )}
        </Panel>

        <aside className="space-y-4">
          <Panel title="Investigation replay" subtitle="Chronology from case events · linked evidence only">
            <div className="p-4">
              <div className="flex items-center gap-2">
                <button
                  aria-label={isPlaying ? "Pause investigation replay" : "Play investigation replay"}
                  className="flex h-9 flex-1 items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.08] text-[10px] font-medium text-cyan-100 transition hover:bg-cyan-300/[0.14] disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!timeline.length}
                  onClick={toggleReplay}
                  type="button"
                >
                  {isPlaying ? <Pause aria-hidden="true" className="h-3.5 w-3.5" /> : <Play aria-hidden="true" className="h-3.5 w-3.5" />}
                  {isPlaying ? "Pause replay" : timeline.length > 0 && activeEventIndex >= timeline.length - 1 ? "Replay again" : "Replay evidence"}
                </button>
                <button aria-label="Reset investigation replay" className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.08] text-slate-400 transition hover:border-white/20 hover:text-white" onClick={resetReplay} type="button">
                  <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between text-[9px] text-slate-500">
                <span>{activeEventIndex < 0 ? "Ready to replay" : `Event ${activeEventIndex + 1} of ${timeline.length}`}</span>
                <span>UTC chronology</span>
              </div>
              <div aria-label="Replay progress" className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuemax={Math.max(timeline.length, 1)} aria-valuemin={0} aria-valuenow={timeline.length ? activeEventIndex + 1 : 0}>
                <div className="h-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-300 to-violet-400 transition-[width] duration-500" style={{ width: `${timeline.length ? ((activeEventIndex + 1) / timeline.length) * 100 : 0}%` }} />
              </div>
              {!timeline.length && (
                <p className="mt-3 text-[10px] leading-5 text-slate-500">
                  {caseDetails.isError ? "Case chronology is unavailable. Graph evidence remains available, but replay is disabled." : "Waiting for case chronology…"}
                </p>
              )}
              {activeEvent && (
                <div aria-live="polite" className="mt-3 rounded-xl border border-cyan-300/10 bg-cyan-300/[0.035] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[10px] font-medium leading-4 text-slate-100">{activeEvent.title}</p>
                    <ChevronRight aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
                  </div>
                  <p className="mt-1.5 text-[9px] leading-4 text-slate-400">{activeEvent.description}</p>
                  <p className="mt-2 font-mono text-[9px] text-cyan-200/80">{activeEvent.id}</p>
                  {!currentEventEdges.length && <p className="mt-2 text-[9px] text-amber-200/80">No graph edge references this event; it is shown as chronology context only.</p>}
                </div>
              )}
            </div>
            <div className="max-h-[255px] overflow-y-auto border-t border-slate-800/70 p-3">
              {caseDetails.isError && <p className="px-1 py-2 text-[10px] text-amber-200/80">Case chronology could not be loaded.</p>}
              {caseDetails.isLoading && <p className="px-1 py-2 text-[10px] text-slate-500">Loading event chronology…</p>}
              {timeline.map((event, index) => {
                const isActive = index === activeEventIndex;
                const linked = graph.data?.edges.some((edge) => edge.evidenceId === event.id) ?? false;
                return (
                  <motion.button
                    animate={{ x: isActive ? 2 : 0 }}
                    aria-current={isActive ? "step" : undefined}
                    className={`group relative flex w-full gap-3 rounded-lg px-2 py-2.5 text-left transition ${isActive ? "bg-cyan-300/[0.07]" : "hover:bg-white/[0.035]"}`}
                    key={`${event.id}-${event.time}`}
                    onClick={() => selectTimelineEvent(index)}
                    type="button"
                    transition={{ duration: reduceMotion ? 0 : 0.16 }}
                    whileTap={reduceMotion ? undefined : { scale: 0.99 }}
                  >
                    <span className="relative mt-0.5 flex w-3 shrink-0 justify-center">
                      {index !== timeline.length - 1 && <span className="absolute top-3 h-full w-px bg-slate-800" />}
                      <span className={`relative z-[1] mt-0.5 h-2 w-2 rounded-full border ${isActive ? "border-cyan-200 bg-cyan-300 shadow-[0_0_10px_rgba(0,212,255,.7)]" : linked ? "border-blue-300/70 bg-blue-400/50" : "border-slate-700 bg-slate-800"}`} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[9px] font-medium text-slate-300">{event.title}</span>
                        <span className="shrink-0 font-mono text-[8px] text-slate-600">{formatEventTime(event.time)}</span>
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 text-[8px] uppercase tracking-[0.12em] text-slate-600">
                        {linked ? <><span className="h-1 w-1 rounded-full bg-cyan-300" />Graph-linked evidence</> : "Chronology context"}
                      </span>
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </Panel>

          <Panel title="Candidate communities" subtitle="Signals for analyst review · not verified rings">
            <div className="space-y-2 p-3">
              {(graph.data?.clusters ?? []).map((cluster) => {
                const focused = focusedCluster === cluster.id;
                const validIds = cluster.nodeIds.filter((id) => graph.data?.nodes.some((node) => node.id === id));
                return (
                  <button
                    aria-pressed={focused}
                    className={`w-full rounded-xl border p-3 text-left transition ${focused ? "border-cyan-300/30 bg-cyan-300/[0.07]" : "border-rose-300/10 bg-rose-300/[0.025] hover:border-rose-300/20 hover:bg-rose-300/[0.05]"}`}
                    key={cluster.id}
                    onClick={() => focusCluster(cluster.id)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-medium text-slate-200">{cluster.label}</span>
                      <RiskBadge severity={cluster.risk} />
                    </div>
                    <p className="mt-2 text-[9px] text-slate-500">{validIds.length} linked entities · select to focus</p>
                    <p className="mt-2 text-[9px] leading-4 text-amber-200/75">Candidate topology; verify source records before action.</p>
                  </button>
                );
              })}
              {graph.isLoading && <p className="p-2 text-[10px] text-slate-500">Resolving candidate communities…</p>}
              {graph.isError && <p className="p-2 text-[10px] text-amber-200/75">Communities unavailable while the graph service is offline.</p>}
              {graph.data && !graph.data.clusters.length && <p className="p-2 text-[10px] text-slate-500">No candidate communities returned.</p>}
            </div>
          </Panel>

          <Panel title={selectedEdge ? "Selected relationship" : "Selected entity"} subtitle="Source provenance and analyst context">
            <div className="min-h-[126px] p-4">
              {selectedEdge ? (
                <>
                  <p className="text-[12px] font-medium text-slate-100">{selectedEdge.label}</p>
                  <p className="mt-1 text-[9px] uppercase tracking-widest text-slate-500">{selectedEdge.type} relationship</p>
                  <p className="mt-3 text-[10px] leading-5 text-slate-400">Evidence reference: <span className="font-mono text-cyan-200">{selectedEdge.evidenceId || "Not provided"}</span></p>
                  <p className="mt-1 text-[9px] leading-4 text-slate-500">Validate the source record and observation time before interpreting this link.</p>
                </>
              ) : selected ? (
                <>
                  <p className="text-[12px] font-medium text-slate-100">{selected.label}</p>
                  <p className="mt-1 text-[9px] uppercase tracking-widest text-slate-500">{selected.type} entity · {selected.id}</p>
                  <div className="mt-3 flex items-center justify-between"><span className="text-[10px] text-slate-500">Risk signal</span><RiskBadge severity={selected.risk >= 90 ? "critical" : selected.risk >= 70 ? "high" : "medium"} /></div>
                  <p className="mt-2 text-[9px] leading-4 text-slate-500">Risk prioritizes review; it is not a finding of wrongdoing.</p>
                </>
              ) : selectedEdge === null && activeEvent ? (
                <>
                  <p className="text-[11px] font-medium text-slate-200">{activeEvent.title}</p>
                  <p className="mt-2 text-[9px] leading-4 text-slate-500">{currentEventEdges.length ? "Select the highlighted edge to inspect its relationship." : "This timeline event has no matching graph evidence reference."}</p>
                  <p className="mt-2 font-mono text-[9px] text-cyan-200/80">{activeEvent.id}</p>
                </>
              ) : (
                <p className="text-[10px] leading-5 text-slate-500">Select a node, relationship, or timeline event to inspect its evidence context.</p>
              )}
            </div>
          </Panel>

          {graph.data && search && !elements.nodes.some((node) => node.data.entity.label.toLowerCase().includes(search.toLowerCase())) && (
            <p className="px-1 text-[9px] text-slate-500">{visibleNodeIds.size} entities shown with connected context.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
