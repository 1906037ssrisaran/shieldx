"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Bot,
  CircleHelp,
  Command,
  FileCheck2,
  Fingerprint,
  LayoutDashboard,
  LogOut,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings2,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { AuthGate, useSession } from "@/components/session";
import { apiRequest } from "@/lib/api";

const links: {
  label: string;
  href: string;
  icon: LucideIcon;
  group: string;
}[] = [
  { label: "Command center", href: "/", icon: LayoutDashboard, group: "Monitor" },
  { label: "Investigations", href: "/investigations", icon: Fingerprint, group: "Investigate" },
  { label: "Relationship intelligence", href: "/network", icon: Network, group: "Investigate" },
  { label: "Investigator AI", href: "/copilot", icon: Bot, group: "Investigate" },
  { label: "Explainability", href: "/explainability", icon: Sparkles, group: "Investigate" },
  { label: "Compliance", href: "/compliance", icon: FileCheck2, group: "Govern" },
  { label: "Risk simulation", href: "/simulation", icon: Activity, group: "Govern" },
  { label: "Administration", href: "/admin", icon: Settings2, group: "Govern" },
];

const roleLabels: Record<string, string> = {
  admin: "Platform admin",
  fraud_analyst: "Fraud analyst",
  compliance_officer: "Compliance officer",
  risk_manager: "Risk manager",
};

function Navigation({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary navigation" className={`space-y-6 ${collapsed ? "px-2" : "px-3"}`}>
      {["Monitor", "Investigate", "Govern"].map((group) => (
        <div key={group}>
          {!collapsed && <p className="mb-2 px-3 text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-600">{group}</p>}
          <div className="space-y-1">
            {links
              .filter((link) => link.group === group)
              .map(({ href, label, icon: Icon }) => {
                const active =
                  pathname === href ||
                  (href !== "/" && pathname.startsWith(href));
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    aria-label={collapsed ? label : undefined}
                    className={`group relative flex items-center gap-3 rounded-xl border px-3 py-2.5 text-[12px] transition-all ${
                      active
                        ? "border-indigo-300/20 bg-gradient-to-r from-blue-500/[0.13] to-violet-400/[0.055] font-medium text-slate-100 shadow-[inset_0_0_22px_rgba(168,121,46,0.07)]"
                        : "border-transparent text-slate-400 hover:border-white/[0.06] hover:bg-white/[0.035] hover:text-slate-100"
                    }`}
                    href={href}
                    key={href}
                    title={collapsed ? label : undefined}
                  >
                    {active && <span aria-hidden="true" className="absolute bottom-2 left-0 top-2 w-[2px] rounded-full bg-gradient-to-b from-cyan-200 to-violet-400 shadow-[0_0_10px_rgba(168,121,46,0.35)]" />}
                    <Icon className={`h-[17px] w-[17px] shrink-0 ${active ? "text-indigo-200" : "text-slate-500 group-hover:text-slate-300"}`} />
                    {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
                    {active && !collapsed && <span className="h-1.5 w-1.5 rounded-full bg-indigo-300 shadow-[0_0_9px_rgba(129,140,248,0.65)]" />}
                  </Link>
                );
              })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function IdentityMenu({ collapsed = false }: { collapsed?: boolean }) {
  const { role, email, demo, signOutUser } = useSession();
  const router = useRouter();
  return (
    <button
      aria-label={collapsed ? (demo ? `${email ?? "Operator"} · ${roleLabels[role]} · Demo` : "Sign out") : undefined}
      className={`flex w-full items-center gap-3 border-t border-white/[0.07] py-4 text-left hover:bg-white/[0.025] ${collapsed ? "justify-center px-2" : "px-5"}`}
      onClick={async () => {
        if (!demo) {
          await signOutUser();
          router.replace("/login");
        }
      }}
      title={demo ? "Local demo session" : "Sign out"}
      type="button"
    >
      <span className="grid h-8 w-8 place-items-center rounded-full border border-blue-300/20 bg-blue-400/10 text-xs font-semibold text-cyan-200">
        {email?.slice(0, 1).toUpperCase() ?? "S"}
      </span>
      {!collapsed && <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-slate-200">
          {email ?? "ShieldIQ operator"}
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-slate-500">
          {roleLabels[role]}
        </span>
      </span>}
      {demo && !collapsed ? (
        <span className="rounded border border-cyan-400/15 bg-cyan-400/5 px-1.5 py-1 text-[9px] uppercase tracking-wide text-cyan-300">
          Demo
        </span>
      ) : !demo ? (
        <LogOut className="h-4 w-4 text-slate-500" />
      ) : null}
    </button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { demo, role, chooseDemoRole } = useSession();
  const apiHealth = useQuery({
    queryKey: ["api-health"],
    queryFn: async () => {
      const response = await apiRequest<{ status: string; service: string }>("/health/ready");
      if (response.status !== "ready") throw new Error("The ShieldIQ API is not ready.");
      return response;
    },
    enabled: pathname !== "/login",
    refetchInterval: 30_000,
    retry: 1,
    staleTime: 10_000,
  });
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const reduceMotion = useReducedMotion();
  const paletteRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const isLogin = pathname === "/login";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && paletteOpen) {
        setPaletteOpen(false);
        setPaletteQuery("");
        return;
      }
      if (event.key === "Tab" && paletteOpen && paletteRef.current) {
        const focusable = paletteRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        const first = focusable.item(0);
        const last = focusable.item(focusable.length - 1);
        if (event.shiftKey && (document.activeElement === first || !paletteRef.current.contains(document.activeElement))) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !paletteRef.current.contains(document.activeElement))) {
          event.preventDefault();
          first?.focus();
        }
        return;
      }
      const target = event.target;
      const isEditing = target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !isEditing) {
        event.preventDefault();
        if (!paletteOpen && document.activeElement instanceof HTMLElement) {
          previousFocusRef.current = document.activeElement;
        }
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [paletteOpen]);

  useEffect(() => {
    if (paletteOpen) return;
    previousFocusRef.current?.focus();
    previousFocusRef.current = null;
  }, [paletteOpen]);

  function openPalette() {
    if (document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }
    setPaletteOpen(true);
  }

  function closePalette() {
    setPaletteOpen(false);
    setPaletteQuery("");
  }

  const filteredLinks = links.filter(({ label, group }) =>
    `${label} ${group}`.toLowerCase().includes(paletteQuery.trim().toLowerCase()),
  );

  if (isLogin) return <AuthGate>{children}</AuthGate>;

  return (
    <AuthGate>
      <div className="relative min-h-screen text-slate-100">
        <div aria-hidden="true" className="ambient-scene">
          <span className="ambient-orb ambient-orb-blue" />
          <span className="ambient-orb ambient-orb-violet" />
          <span className="ambient-orb ambient-orb-cyan" />
        </div>
        <motion.aside animate={{ width: collapsed ? 76 : 248 }} className={`shell-sidebar fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-white/[0.07] shadow-[18px_0_55px_rgba(0,0,0,0.2)] backdrop-blur-2xl xl:flex ${collapsed ? "w-[76px]" : "w-[248px]"}`} initial={false} transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}>
          <div className={`flex h-[72px] items-center ${collapsed ? "justify-between gap-1 px-1" : "justify-between px-5"}`}>
          <Link aria-label="ShieldIQ X command center" className="flex min-w-0 items-center gap-3" href="/">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-indigo-300/25 bg-gradient-to-br from-blue-500/20 to-violet-400/10 text-sm font-bold text-indigo-100">
              S
            </span>
            {!collapsed && <span>
              <span className="block text-sm font-semibold tracking-[0.15em]">
                SHIELD<span className="text-blue-400">IQ</span>
              </span>
              <span className="mt-0.5 block text-[9px] uppercase tracking-[0.17em] text-slate-600">
                Financial crime intelligence
              </span>
            </span>}
          </Link>
          <button aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white/[0.05] hover:text-slate-200" onClick={() => setCollapsed((value) => !value)} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} type="button">
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
          </div>
          <div className={`mx-3 mb-5 flex items-center rounded-xl border border-white/[0.07] bg-white/[0.025] py-2.5 ${collapsed ? "justify-center px-2" : "px-3"}`} title="Tenant-scoped workspace">
            <span className="flex min-w-0 items-center gap-2 text-[10px] text-slate-300">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-300/80 shadow-[0_0_10px_rgba(80,221,240,0.45)]" />
              {!collapsed && <span className="truncate">Tenant workspace</span>}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Navigation collapsed={collapsed} />
          </div>
          {!collapsed && <div className="px-5 py-3">
            <div className="flex items-center gap-2 text-[10px] text-slate-600">
              <CircleHelp className="h-3.5 w-3.5" />
              Evidence-first · Human-reviewed
            </div>
          </div>}
          <IdentityMenu collapsed={collapsed} />
        </motion.aside>

        <div className={`workspace-content relative z-10 min-h-screen transition-[padding] duration-300 ${collapsed ? "xl:pl-[108px]" : "xl:pl-[280px]"}`}>
          <header className="workspace-topbar sticky top-0 z-20 flex h-[72px] items-center gap-4 border-b border-white/[0.07] px-5 backdrop-blur-2xl sm:px-8">
            <div className="flex min-w-0 items-center gap-2 text-xs text-slate-500">
              <span className="font-semibold tracking-[0.12em] text-slate-400">SHIELD<span className="text-blue-400">IQ</span></span>
              <span className="text-slate-700">/</span>
              <span className="truncate text-slate-300">
                {links.find((link) =>
                  link.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(link.href),
                )?.label ?? "Investigation"}
              </span>
            </div>
            <button aria-label="Open command palette" className="mx-auto hidden w-full max-w-md items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5 text-left text-xs text-slate-500 shadow-[inset_0_1px_rgba(255,255,255,0.025)] transition hover:border-blue-300/20 hover:bg-white/[0.04] lg:flex" onClick={openPalette} type="button">
              <Search className="h-3.5 w-3.5" />
              <span className="flex-1">Navigate to a workspace…</span>
              <kbd className="rounded-md border border-white/[0.1] bg-black/20 px-1.5 py-0.5 text-[9px] text-slate-500">Ctrl K</kbd>
            </button>
            <div className="ml-auto flex items-center gap-3">
              {demo && (
                <label className="hidden items-center gap-2 text-[10px] text-slate-500 md:flex">
                  View as
                  <select
                    aria-label="Select demo role"
                    className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-[10px] text-slate-300 outline-none focus:border-blue-500"
                    onChange={(event) =>
                      chooseDemoRole(
                        event.target.value as
                          | "admin"
                          | "fraud_analyst"
                          | "compliance_officer"
                          | "risk_manager",
                      )
                    }
                    value={role}
                  >
                    <option value="fraud_analyst">Fraud analyst</option>
                    <option value="compliance_officer">Compliance officer</option>
                    <option value="risk_manager">Risk manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
              )}
              <span
                aria-label={
                  apiHealth.isLoading
                    ? "API health checking"
                    : apiHealth.isError
                      ? "API unavailable"
                      : "API ready"
                }
                className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] sm:flex ${
                  apiHealth.isError
                    ? "border-rose-400/20 bg-rose-400/[0.06] text-rose-200"
                    : apiHealth.isSuccess
                      ? "border-emerald-500/15 bg-emerald-500/[0.06] text-emerald-300"
                      : "border-slate-500/20 bg-slate-500/[0.06] text-slate-400"
                }`}
                title={
                  apiHealth.isError
                    ? "The ShieldIQ API health check failed. Workspace data may be unavailable."
                    : apiHealth.isSuccess
                      ? `API service: ${apiHealth.data.service}`
                      : "Checking ShieldIQ API readiness"
                }
              >
                {apiHealth.isError ? (
                  <AlertCircle aria-hidden="true" className="h-3 w-3" />
                ) : (
                  <span className={`h-1.5 w-1.5 rounded-full ${apiHealth.isSuccess ? "bg-emerald-400" : "bg-slate-500"}`} />
                )}
                {apiHealth.isError ? "API unavailable" : apiHealth.isSuccess ? "API ready" : "Checking API"}
              </span>
              <button aria-label="Open command palette" className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.025] text-slate-500 hover:border-cyan-300/20 hover:text-white lg:hidden" onClick={openPalette} type="button">
                <Command className="h-4 w-4" />
              </button>
            </div>
          </header>
          <nav aria-label="Mobile primary navigation" className="mobile-navigation flex gap-1 overflow-x-auto border-b border-slate-800/65 bg-[#0c111b] px-3 py-2 xl:hidden">
            {links.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href !== "/" && pathname.startsWith(href));
              return (
                <Link aria-current={active ? "page" : undefined} className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-[10px] ${active ? "bg-blue-500/[0.12] text-indigo-100" : "text-slate-500 hover:bg-white/[0.035] hover:text-slate-200"}`} href={href} key={href}>
                  <Icon className="h-3.5 w-3.5" />{label}
                </Link>
              );
            })}
          </nav>
          <motion.main animate={{ opacity: 1, y: 0 }} className="workspace-main workspace-enter mx-auto max-w-[1680px] px-5 py-7 sm:px-8 sm:py-9" initial={reduceMotion ? false : { opacity: 0, y: 8 }} key={pathname} transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}>
            {children}
          </motion.main>
          <footer className="flex items-center justify-between border-t border-slate-900 px-5 py-4 text-[10px] text-slate-600 sm:px-8">
            <span>ShieldIQ X · Financial Crime Investigation Platform</span>
            <span className="hidden items-center gap-1 sm:flex">Human review required <ArrowUpRight className="h-3 w-3" /></span>
          </footer>
        </div>
        {paletteOpen && (
          <div className="command-backdrop fixed inset-0 z-[60] flex items-start justify-center bg-black/65 px-4 pt-[14vh] backdrop-blur-sm" onClick={closePalette}>
            <section aria-label="Command palette" aria-modal="true" className="command-dialog w-full max-w-xl overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0b0e15]/95 shadow-[0_35px_120px_rgba(92,70,48,0.22),0_0_40px_rgba(233,185,104,0.1)] backdrop-blur-2xl" onClick={(event) => event.stopPropagation()} ref={paletteRef} role="dialog">
              <div className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-4">
                <Search className="h-4 w-4 shrink-0 text-cyan-300" />
                <input aria-label="Search workspace destinations" autoFocus className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600" onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Search workspace destinations…" value={paletteQuery} />
                <button aria-label="Close command palette" className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-white/[0.06] hover:text-white" onClick={closePalette} type="button"><X className="h-4 w-4" /></button>
              </div>
              <div className="max-h-[min(55vh,420px)] overflow-y-auto p-2">
                <p className="px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-600">Navigate</p>
                {filteredLinks.map(({ href, label, icon: Icon, group }) => (
                  <Link className="flex items-center gap-3 rounded-xl px-3 py-3 text-xs text-slate-300 hover:bg-blue-500/[0.09] hover:text-white" href={href} key={href} onClick={closePalette}>
                    <span className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.06] bg-white/[0.025]"><Icon className="h-4 w-4 text-cyan-200" /></span>
                    <span className="flex-1">{label}</span>
                    <span className="text-[9px] text-slate-600">{group}</span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-slate-600" />
                  </Link>
                ))}
                {!filteredLinks.length && <p className="px-3 py-8 text-center text-xs text-slate-500">No workspace matches that search.</p>}
              </div>
              <div className="flex items-center justify-between border-t border-white/[0.07] px-4 py-3 text-[9px] text-slate-600"><span>ShieldIQ X · Command center</span><span><kbd className="rounded border border-white/[0.1] px-1 py-0.5">ESC</kbd> to close</span></div>
            </section>
          </div>
        )}
      </div>
    </AuthGate>
  );
}
