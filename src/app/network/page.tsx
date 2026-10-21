"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { RelationshipGraph } from "@/components/relationship-graph";
import { PageTitle, StatusMessage } from "@/components/ui";

export default function NetworkPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <StatusMessage
            title="Loading relationship intelligence"
            description="Preparing the case-linked network view."
            loading
          />
        </AppShell>
      }
    >
      <NetworkContent />
    </Suspense>
  );
}

function NetworkContent() {
  const search = useSearchParams();
  const caseId = search.get("caseId") ?? "CASE-1042";
  return (
    <AppShell>
      <PageTitle
        eyebrow={`ENTITY INTELLIGENCE / ${caseId}`}
        title="Trace the signal. See the network."
        description="Replay case chronology against evidence-linked account, device, merchant, and network relationships. Every highlighted connection resolves to a source reference; proximity is a lead—not proof."
      />
      <RelationshipGraph caseId={caseId} />
    </AppShell>
  );
}
