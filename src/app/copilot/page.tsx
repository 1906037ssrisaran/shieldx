"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Bot, FileSearch, Send, Sparkles, UserRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageTitle, Panel, StatusMessage } from "@/components/ui";
import { apiRequest, type AgentResult, type CaseRecord } from "@/lib/api";

type Message = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  claims?: AgentResult["claims"];
  uncertainties?: string[];
  recommendedActions?: string[];
  model?: string;
  createdAt: string;
};

const suggestions = [
  "Why was this transaction flagged?",
  "Show the strongest evidence and remaining unknowns.",
  "Recommend the next verification step.",
  "Summarize the linked entity relationships.",
];

export default function CopilotPage() {
  const [caseId, setCaseId] = useState("CASE-1042");
  const [question, setQuestion] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const queryClient = useQueryClient();
  const cases = useQuery({
    queryKey: ["cases"],
    queryFn: () => apiRequest<{ items: CaseRecord[] }>("/cases"),
  });
  const history = useQuery({
    queryKey: ["copilot", caseId],
    queryFn: () =>
      apiRequest<{ items: Message[] }>(
        `/cases/${caseId}/copilot/messages`,
      ),
    enabled: Boolean(caseId),
  });
  const send = useMutation({
    mutationFn: (text: string) =>
      apiRequest<AgentResult & { conversationId: string }>(
        `/cases/${caseId}/copilot/messages`,
        {
          method: "POST",
          body: JSON.stringify({ question: text, conversationId }),
        },
      ),
    onSuccess: async (result) => {
      setConversationId(result.conversationId);
      setQuestion("");
      await queryClient.invalidateQueries({ queryKey: ["copilot", caseId] });
    },
  });

  useEffect(() => {
    if (history.data?.items.length && !conversationId) {
      setConversationId(history.data.items[0].conversationId);
    }
  }, [history.data, conversationId]);

  function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (question.trim()) send.mutate(question.trim());
  }

  const messages = history.data?.items ?? [];
  const selectedCase = cases.data?.items.find((item) => item.id === caseId);

  return (
    <AppShell>
      <PageTitle
        eyebrow="Investigator copilot · Vertex AI Gemini"
        title="Reason with the evidence."
        description="Ask case-scoped questions. Gemini receives only authorized, minimized case evidence; every factual response is validated against its source references."
        action={
          <label className="text-[10px] text-slate-500">Active case
            <select aria-label="Choose active case" className="ml-2 rounded-md border border-slate-800 bg-slate-900 px-2 py-2 text-[10px] text-slate-200" onChange={(event) => { setCaseId(event.target.value); setConversationId(undefined); }} value={caseId}>
              {(cases.data?.items ?? []).map((item) => <option key={item.id} value={item.id}>{item.id} · {item.subject}</option>)}
            </select>
          </label>
        }
      />
      <div className="grid gap-4 2xl:grid-cols-[1fr_290px]">
        <Panel title="Case-scoped investigation conversation" subtitle={selectedCase ? `${selectedCase.title} · ${selectedCase.evidenceCount} evidence sources in case` : "Select an authorized investigation"} action={<span className="flex items-center gap-1 rounded-full border border-violet-300/15 bg-violet-300/[0.04] px-2 py-1 text-[9px] text-violet-200"><Sparkles className="h-3 w-3" />Gemini · grounded mode</span>}>
          <div aria-live="polite" className="flex min-h-[430px] max-h-[60vh] flex-col gap-4 overflow-y-auto p-4 sm:p-6">
            {history.isLoading && <StatusMessage title="Loading conversation" description="Retrieving case-scoped chat history." loading />}
            {history.isError && <StatusMessage title="Conversation unavailable" description={history.error.message} />}
            {!messages.length && !history.isLoading && (
              <div className="m-auto max-w-md text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-violet-300/20 bg-violet-300/[0.06]"><Bot className="h-5 w-5 text-violet-200" /></span>
                <p className="mt-4 text-sm font-medium text-slate-200">Start with the evidence, not a guess.</p>
                <p className="mt-2 text-xs leading-5 text-slate-500">Ask about the risk rationale, related entities, unknowns, or the next verification step.</p>
              </div>
            )}
            {messages.map((message) => (
              <article className={`flex gap-3 ${message.role === "user" ? "justify-end" : ""}`} key={message.id}>
                {message.role === "assistant" && <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-violet-300/15 bg-violet-300/[0.05]"><Sparkles className="h-3.5 w-3.5 text-violet-200" /></span>}
                <div className={`max-w-[88%] rounded-xl border p-3.5 ${message.role === "user" ? "border-blue-400/15 bg-blue-400/[0.06]" : "border-slate-800 bg-slate-950/30"}`}>
                  <p className="whitespace-pre-wrap text-[11px] leading-6 text-slate-300">{message.content}</p>
                  {message.role === "assistant" && message.claims?.map((claim, index) => <div className="mt-3 border-l border-cyan-300/25 pl-3" key={`${message.id}-${index}`}><p className="text-[10px] leading-5 text-slate-400">{claim.text}</p><p className="mt-1 flex flex-wrap gap-1">{claim.evidenceRefs.map((reference) => <span className="rounded border border-cyan-300/10 bg-cyan-300/[0.035] px-1.5 py-0.5 font-mono text-[8px] text-cyan-200" key={reference}>{reference}</span>)}</p></div>)}
                  {message.uncertainties?.map((item) => <p className="mt-2 text-[10px] text-amber-200" key={item}>Uncertain: {item}</p>)}
                  {message.recommendedActions?.map((item, index) => <p className="mt-2 text-[10px] text-emerald-200" key={`${message.id}-action-${index}`}>Next step: {item}</p>)}
                  {message.model && <p className="mt-3 text-[8px] uppercase tracking-widest text-violet-300">AI draft · {message.model} · human review</p>}
                </div>
                {message.role === "user" && <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-slate-700 bg-slate-800/60"><UserRound className="h-3.5 w-3.5 text-slate-400" /></span>}
              </article>
            ))}
            {send.isPending && <div className="flex items-center gap-2 pl-10 text-[10px] text-violet-200"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-300" />Reviewing evidence and preparing a cited response…</div>}
            {send.isError && <StatusMessage title="Gemini response unavailable" description={send.error.message} action={<button className="text-[10px] text-cyan-300" onClick={() => send.mutate(question)} type="button">Retry last question</button>} />}
          </div>
          {!messages.length && (
            <div className="flex flex-wrap gap-2 border-t border-slate-800/70 px-4 py-3 sm:px-6">
              {suggestions.map((item) => <button className="rounded-full border border-slate-800 px-2.5 py-1.5 text-[9px] text-slate-400 hover:border-violet-300/20 hover:text-violet-200" key={item} onClick={() => setQuestion(item)} type="button">{item}</button>)}
            </div>
          )}
          <form className="flex items-end gap-2 border-t border-slate-800/70 p-3 sm:p-4" onSubmit={ask}>
            <label className="sr-only" htmlFor="copilot-question">Ask the investigator copilot</label>
            <textarea className="max-h-32 min-h-11 flex-1 resize-y rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-3 text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-violet-300/30" id="copilot-question" onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (question.trim() && !send.isPending) send.mutate(question.trim()); } }} placeholder="Ask about this investigation…" value={question} />
            <button aria-label="Send question" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-blue-600 text-white transition hover:bg-blue-500 disabled:opacity-40" disabled={!question.trim() || send.isPending} type="submit"><Send className="h-4 w-4" /></button>
          </form>
        </Panel>
        <aside className="space-y-4">
          <Panel title="Investigation context" subtitle="Constrained retrieval scope">
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-2 text-[10px] text-slate-400"><FileSearch className="h-3.5 w-3.5 text-cyan-300" />Authorized case evidence only</div>
              <p className="text-[10px] leading-5 text-slate-500">No unrestricted web, SQL, or write tools are exposed to the model. Claims with unrecognized evidence references are rejected.</p>
              <Link className="inline-flex items-center gap-1 text-[10px] text-cyan-300" href={`/investigations/${caseId}`}>Open source case <ArrowUpRight className="h-3 w-3" /></Link>
            </div>
          </Panel>
          <Panel title="Analyst review" subtitle="AI output remains advisory">
            <div className="space-y-2 p-4 text-[10px] leading-5 text-slate-400"><p>• Confirm each cited fact against its source.</p><p>• Separate a candidate relationship from verified ownership.</p><p>• Record the human decision in the case notes.</p><p>• Do not submit AI text as a regulatory filing without approval.</p></div>
          </Panel>
        </aside>
      </div>
    </AppShell>
  );
}
