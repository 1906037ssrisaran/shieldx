import { getApps } from "firebase/app";
import { getAuth } from "firebase/auth";

export type ApiError = Error & { status?: number; code?: string };

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";
const demoMode =
  process.env.NEXT_PUBLIC_DEMO_MODE === "true" ||
  (process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_DEMO_MODE !== "false");

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (demoMode) {
    const role =
      typeof window === "undefined"
        ? "fraud_analyst"
        : window.localStorage.getItem("shieldiq-demo-role") ??
          "fraud_analyst";
    headers.set("X-Demo-Role", role);
    headers.set("X-Demo-User", `demo-${role}`);
  } else if (typeof window !== "undefined") {
    const app = getApps()[0];
    const user = app ? getAuth(app).currentUser : null;
    if (user) {
      headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
    }
  }

  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : `Request failed (${response.status})`;
    const error = new Error(message) as ApiError;
    error.status = response.status;
    if (
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "code" in payload.error &&
      typeof payload.error.code === "string"
    ) {
      error.code = payload.error.code;
    }
    throw error;
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function formatMoney(minor: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export type CaseRecord = {
  id: string;
  title: string;
  status: string;
  priority: string;
  riskScore: number;
  owner: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  alertId: string | null;
  amountMinor: number;
  currency: string;
  subject: string;
  reasonCodes: string[];
  evidenceCount: number;
};

export type Evidence = {
  id: string;
  type: string;
  title: string;
  observedAt: string;
  source: string;
  summary: string;
  confidence: string;
};

export type AgentResult = {
  answer: string;
  claims: {
    text: string;
    evidenceRefs: string[];
    classification: string;
  }[];
  uncertainties: string[];
  recommendedActions: string[];
  runId: string;
  model: string;
  reviewStatus: string;
};
