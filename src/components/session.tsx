"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getApps,
  initializeApp,
  type FirebaseApp,
} from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import { usePathname, useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";

type Role = "admin" | "fraud_analyst" | "compliance_officer" | "risk_manager";
type SessionContextValue = {
  ready: boolean;
  demo: boolean;
  authenticated: boolean;
  role: Role;
  email: string | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  chooseDemoRole: (role: Role) => void;
  signOutUser: () => Promise<void>;
};

type FirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
};

type Me = { role: Role; email: string | null };

const SessionContext = createContext<SessionContextValue | null>(null);
const demoMode =
  process.env.NEXT_PUBLIC_DEMO_MODE === "true" ||
  (process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_DEMO_MODE !== "false");

function firebaseConfig(): FirebaseConfig | null {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  const { apiKey, authDomain, projectId, appId } = config;
  if (
    !apiKey ||
    !authDomain ||
    !projectId ||
    !appId
  ) {
    return null;
  }
  return { apiKey, authDomain, projectId, appId };
}

function getFirebaseAuth(config: FirebaseConfig): Auth {
  const app: FirebaseApp =
    getApps().length > 0 ? getApps()[0] : initializeApp(config);
  return getAuth(app);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [role, setRole] = useState<Role>("fraud_analyst");
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (demoMode) {
      const selected =
        window.localStorage.getItem("shieldiq-demo-role") as Role | null;
      if (selected) setRole(selected);
      setAuthenticated(true);
      setReady(true);
      return;
    }

    const config = firebaseConfig();
    if (!config) {
      setError("Firebase Authentication is not configured for this environment.");
      setReady(true);
      return;
    }

    let active = true;
    const auth = getFirebaseAuth(config);
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      if (!active) return;
      setUser(nextUser);
      if (!nextUser) {
        setAuthenticated(false);
        setEmail(null);
        setReady(true);
        return;
      }
      try {
        const profile = await apiRequest<Me>("/auth/me");
        if (!active) return;
        setRole(profile.role);
        setEmail(profile.email ?? nextUser.email);
        setAuthenticated(true);
        setError(null);
      } catch {
        if (!active) return;
        setError("Your authenticated session could not be verified by ShieldIQ.");
        setEmail(nextUser.email);
        setAuthenticated(false);
      } finally {
        if (active) setReady(true);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (userEmail: string, password: string) => {
    const config = firebaseConfig();
    if (!config) throw new Error("Firebase Authentication is not configured.");
    const auth = getFirebaseAuth(config);
    const credential = await signInWithEmailAndPassword(
      auth,
      userEmail,
      password,
    );
    const idToken = await credential.user.getIdToken();
    await apiRequest<void>("/auth/session", {
      method: "POST",
      body: JSON.stringify({ idToken }),
    });
    const profile = await apiRequest<Me>("/auth/me");
    setRole(profile.role);
    setEmail(profile.email ?? credential.user.email);
    setAuthenticated(true);
    setError(null);
  }, []);

  const chooseDemoRole = useCallback((nextRole: Role) => {
    window.localStorage.setItem("shieldiq-demo-role", nextRole);
    setRole(nextRole);
  }, []);

  const signOutUser = useCallback(async () => {
    if (demoMode) {
      window.localStorage.removeItem("shieldiq-demo-role");
      setRole("fraud_analyst");
      setAuthenticated(true);
      return;
    }
    const config = firebaseConfig();
    if (config) {
      await apiRequest<void>("/auth/session", { method: "DELETE" });
      await signOut(getFirebaseAuth(config));
    }
    setAuthenticated(false);
    setEmail(null);
  }, []);

  const value = useMemo(
    () => ({
      ready,
      demo: demoMode,
      authenticated,
      role,
      email: email ?? user?.email ?? null,
      error,
      signIn,
      chooseDemoRole,
      signOutUser,
    }),
    [ready, authenticated, role, email, user, error, signIn, chooseDemoRole, signOutUser],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside AuthProvider");
  return context;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { ready, demo, authenticated, error } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (ready && !demo && !authenticated && pathname !== "/login") {
      router.replace("/login");
    }
  }, [ready, demo, authenticated, pathname, router]);

  if (pathname === "/login") return children;
  if (!ready || (!demo && !authenticated)) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#070B14] text-sm text-slate-400">
        {error ? (
          <p className="max-w-md px-6 text-center text-rose-300">{error}</p>
        ) : (
          <p>Verifying your ShieldIQ session…</p>
        )}
      </main>
    );
  }
  return children;
}
