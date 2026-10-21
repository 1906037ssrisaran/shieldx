"use client";

import { motion, useReducedMotion } from "framer-motion";
import { AlertCircle, ArrowUpRight, type LucideIcon } from "lucide-react";

export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300/80">
          <span aria-hidden="true" className="h-px w-5 bg-gradient-to-r from-cyan-300/80 to-transparent" />
          {eyebrow}
        </p>
        <h1 className="text-[25px] font-semibold tracking-[-0.035em] text-white sm:text-[30px]">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-6 text-slate-400">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.section
      animate={{ opacity: 1, y: 0 }}
      className={`glass-panel rounded-2xl border border-white/[0.08] ${className}`}
      initial={reduceMotion ? false : { opacity: 0, y: 7 }}
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--spotlight-x", `${event.clientX - bounds.left}px`);
        event.currentTarget.style.setProperty("--spotlight-y", `${event.clientY - bounds.top}px`);
      }}
      transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
      whileHover={reduceMotion ? undefined : { y: -1 }}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div>
            <h2 className="text-[13px] font-semibold tracking-[0.005em] text-slate-100">{title}</h2>
            {subtitle && <p className="mt-1 text-[10px] text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </motion.section>
  );
}

export function MetricCard({
  label,
  value,
  icon: Icon,
  tone = "blue",
  detail,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "blue" | "cyan" | "violet" | "amber";
  detail: string;
}) {
  const reduceMotion = useReducedMotion();
  const tones = {
    blue: "border-[#c79545]/25 bg-[#e9b968]/[0.16] text-[#71511f]",
    cyan: "border-[#a8792e]/20 bg-[#f8d96b]/[0.18] text-[#76551e]",
    violet: "border-[#bdaa9b]/35 bg-[#e7dad0]/[0.48] text-[#5c4e43]",
    amber: "border-[#e9b968]/35 bg-[#f8d96b]/[0.2] text-[#76551e]",
  };
  return (
    <motion.article
      animate={{ opacity: 1, y: 0 }}
      className="metric-tile rounded-2xl border p-4 sm:p-5"
      initial={reduceMotion ? false : { opacity: 0, y: 7 }}
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--spotlight-x", `${event.clientX - bounds.left}px`);
        event.currentTarget.style.setProperty("--spotlight-y", `${event.clientY - bounds.top}px`);
      }}
      transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
      whileHover={reduceMotion ? undefined : { y: -2 }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">{label}</p>
        <span className={`grid h-8 w-8 place-items-center rounded-xl border ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-4 text-[27px] font-semibold tracking-[-0.04em] text-slate-50 [font-variant-numeric:tabular-nums]">
        {value}
      </p>
      <p className="mt-2 text-[10px] text-slate-400">{detail}</p>
    </motion.article>
  );
}

export function StatusMessage({
  title,
  description,
  loading = false,
  action,
}: {
  title: string;
  description: string;
  loading?: boolean;
  action?: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      aria-busy={loading}
      className={`flex items-start gap-3 rounded-xl border p-4 ${
        loading
          ? "border-cyan-300/10 bg-cyan-300/[0.025]"
          : "border-amber-300/10 bg-amber-300/[0.025]"
      }`}
      initial={reduceMotion ? false : { opacity: 0, y: 5 }}
      role={loading ? "status" : "alert"}
      transition={{ duration: reduceMotion ? 0 : 0.18 }}
    >
      {loading ? (
        <span aria-hidden="true" className="status-skeleton-mark mt-0.5 h-4 w-4 shrink-0 rounded-md" />
      ) : (
        <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-slate-200">{title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
        {loading ? (
          <div aria-hidden="true" className="mt-3 flex gap-2">
            <span className="status-skeleton-line h-1.5 w-20 rounded-full" />
            <span className="status-skeleton-line h-1.5 w-12 rounded-full [animation-delay:120ms]" />
          </div>
        ) : action ? <div className="mt-3">{action}</div> : null}
      </div>
    </motion.div>
  );
}

export function RiskBadge({ severity }: { severity: string }) {
  const normalized = severity.toLowerCase();
  const classes =
    normalized === "critical"
      ? "border-rose-400/20 bg-rose-400/[0.08] text-rose-300"
      : normalized === "high"
        ? "border-amber-400/20 bg-amber-400/[0.08] text-amber-300"
        : normalized === "medium"
          ? "border-yellow-400/20 bg-yellow-400/[0.06] text-yellow-200"
          : "border-emerald-400/15 bg-emerald-400/[0.06] text-emerald-300";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-wide ${classes}`}>
      <span className="h-1 w-1 rounded-full bg-current" />
      {severity}
    </span>
  );
}

export function LinkButton({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-300 hover:text-cyan-200" href={href}>
      {children}
      <ArrowUpRight className="h-3 w-3" />
    </a>
  );
}
