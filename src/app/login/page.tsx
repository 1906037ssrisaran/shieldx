"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Fingerprint, ShieldCheck, Sparkles } from "lucide-react";
import { useSession } from "@/components/session";

const roles = [
  ["fraud_analyst", "Fraud analyst"],
  ["compliance_officer", "Compliance officer"],
  ["risk_manager", "Risk manager"],
  ["admin", "Platform admin"],
] as const;

export default function LoginPage() {
  const { demo, signIn, chooseDemoRole, error: sessionError } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nextPath, setNextPath] = useState("/");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("next");
    if (requested?.startsWith("/") && !requested.startsWith("//")) {
      setNextPath(requested);
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      router.replace(nextPath);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="command-login relative grid min-h-screen overflow-hidden text-white lg:grid-cols-[1.05fr_0.95fr]">
      <div aria-hidden="true" className="pointer-events-none absolute -left-48 -top-48 h-[38rem] w-[38rem] rounded-full bg-blue-600/[0.11] blur-[130px]" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-72 right-[-10rem] h-[42rem] w-[42rem] rounded-full bg-violet-700/[0.09] blur-[150px]" />
      <section className="relative hidden flex-col justify-between border-r border-slate-800/70 p-12 lg:flex xl:p-16">
        <Link className="flex items-center gap-3" href="/">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-blue-300/20 bg-blue-400/10 font-bold text-cyan-200">S</span>
          <span className="text-sm font-semibold tracking-[0.18em]">SHIELD<span className="text-blue-400">IQ</span></span>
        </Link>
        <div className="max-w-xl">
          <p className="mb-5 text-[10px] font-semibold uppercase tracking-[0.23em] text-cyan-300">Financial crime intelligence</p>
          <h1 className="text-5xl font-semibold leading-[1.1] tracking-tight xl:text-6xl">
            Every signal has a story.
            <span className="mt-2 block bg-gradient-to-r from-blue-400 to-cyan-200 bg-clip-text text-transparent">Find the evidence.</span>
          </h1>
          <p className="mt-6 max-w-lg text-sm leading-7 text-slate-400">
            Investigate connected risk, understand why it matters, and keep every decision accountable.
          </p>
          <div className="mt-10 grid max-w-md gap-3">
            {[
              [Fingerprint, "Explainable risk signals"],
              [Sparkles, "Evidence-grounded Gemini"],
              [ShieldCheck, "Human-approved outcomes"],
            ].map(([Icon, label]) => {
              const Mark = Icon as typeof Fingerprint;
              return <div className="flex items-center gap-3 text-xs text-slate-400" key={label as string}><Mark className="h-4 w-4 text-cyan-300" />{label as string}</div>;
            })}
          </div>
        </div>
        <p className="text-[10px] text-slate-600">ShieldIQ X · Byte Us · Google Cloud AI Builder Cup</p>
      </section>
      <section className="relative flex min-h-screen items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <p className="text-sm font-semibold tracking-[0.18em]">SHIELD<span className="text-blue-400">IQ</span></p>
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Secure analyst access</p>
          <h2 className="mt-3 text-2xl font-semibold">Sign in to ShieldIQ</h2>
          <p className="mt-2 text-xs leading-5 text-slate-500">Your organization’s Firebase identity is verified by the ShieldIQ API.</p>

          {!demo && (
            <form className="mt-8 space-y-4" onSubmit={submit}>
              <label className="block text-xs text-slate-300">
                Work email
                <input autoComplete="username" className="mt-2 w-full rounded-lg border border-slate-700/80 bg-slate-900/50 px-3 py-3 text-sm text-white outline-none transition focus:border-blue-400" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
              </label>
              <label className="block text-xs text-slate-300">
                Password
                <input autoComplete="current-password" className="mt-2 w-full rounded-lg border border-slate-700/80 bg-slate-900/50 px-3 py-3 text-sm text-white outline-none transition focus:border-blue-400" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
              </label>
              {(error || sessionError) && <p aria-live="polite" className="rounded-lg border border-rose-400/20 bg-rose-400/[0.06] p-3 text-xs text-rose-200">{error ?? sessionError}</p>}
              <button className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50" disabled={busy} type="submit">
                {busy ? "Verifying identity…" : "Continue securely"} {!busy && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>
          )}

          {demo && (
            <div className="mt-8 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.035] p-4">
              <p className="text-xs font-medium text-cyan-100">Synthetic investigation environment</p>
              <p className="mt-1.5 text-[11px] leading-5 text-slate-400">Choose a demo role to explore role-based workflow behavior. This local-only mode is rejected by the API outside development.</p>
              <div className="mt-4 grid gap-2">
                {roles.map(([value, label]) => (
                  <button
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-3 text-left text-xs text-slate-200 transition hover:border-blue-400/40 hover:bg-blue-500/[0.06]"
                    key={value}
                    onClick={() => {
                      chooseDemoRole(value);
                      router.replace("/");
                    }}
                    type="button"
                  >
                    {label}<ArrowRight className="h-3.5 w-3.5 text-slate-500" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="mt-7 text-center text-[10px] leading-5 text-slate-600">
            Access is monitored. AI-generated analysis is advisory and requires authorized review.
          </p>
        </div>
      </section>
    </main>
  );
}
