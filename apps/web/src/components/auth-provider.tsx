"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getMe, toApiError } from "@/lib/api";
import type { ApiError, Me } from "@/lib/api";
import { getSupabaseConfig } from "@/lib/config";
import { currentAccessToken, getBrowserSupabase } from "@/lib/supabase";

export type SessionStatus = "loading" | "not_configured" | "signed_out" | "signed_in";
export type MeStatus = "idle" | "loading" | "ready" | "error";

export type AuthContextValue = {
  sessionStatus: SessionStatus;
  userId: string | null;
  email: string | null;
  me: Me | null;
  meStatus: MeStatus;
  meError: ApiError | null;
  /** True only when /me lists at least one staff store. Customer metadata never grants this. */
  isStaff: boolean;
  reloadMe: () => void;
  signOut: () => Promise<void>;
};

const DEFAULT_VALUE: AuthContextValue = {
  sessionStatus: "loading",
  userId: null,
  email: null,
  me: null,
  meStatus: "idle",
  meError: null,
  isStaff: false,
  reloadMe: () => undefined,
  signOut: async () => undefined,
};

const AuthContext = createContext<AuthContextValue>(DEFAULT_VALUE);

/**
 * Session and /me state for the whole app. Mounted once in the root layout so
 * there is a single auth subscription and a single /me request per sign-in.
 * Access tokens are read fresh (currentAccessToken) at call time, never stored here.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>(() =>
    getSupabaseConfig() === null ? "not_configured" : "loading",
  );
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [meStatus, setMeStatus] = useState<MeStatus>("idle");
  const [meError, setMeError] = useState<ApiError | null>(null);
  const [meAttempt, setMeAttempt] = useState(0);
  // The user whose /me is known or in flight. Token refreshes for the same user do not reset it.
  const knownUserId = useRef<string | null>(null);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (supabase === null) return;
    // supabase-js emits INITIAL_SESSION on subscribe, so no separate getSession call is needed.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session === null) {
        knownUserId.current = null;
        setSessionStatus("signed_out");
        setUserId(null);
        setEmail(null);
        setMe(null);
        setMeStatus("idle");
        setMeError(null);
        return;
      }
      setSessionStatus("signed_in");
      setEmail(session.user.email ?? null);
      if (knownUserId.current !== session.user.id) {
        knownUserId.current = session.user.id;
        setMeStatus("loading");
        setUserId(session.user.id);
      }
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  // /me is fetched once per signed-in user. Token refreshes do not refetch it.
  useEffect(() => {
    if (userId === null) return;
    let active = true;
    void (async () => {
      try {
        const token = await currentAccessToken();
        if (token === null) throw new Error("no session");
        const data = await getMe(token);
        if (!active) return;
        setMe(data);
        setMeError(null);
        setMeStatus("ready");
      } catch (error: unknown) {
        if (!active) return;
        setMe(null);
        setMeError(toApiError(error));
        setMeStatus("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, meAttempt]);

  const reloadMe = useCallback(() => {
    setMeStatus("loading");
    setMeAttempt((current) => current + 1);
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getBrowserSupabase();
    if (supabase === null) return;
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      sessionStatus,
      userId,
      email,
      me,
      meStatus,
      meError,
      isStaff: (me?.staff_stores.length ?? 0) > 0,
      reloadMe,
      signOut,
    }),
    [sessionStatus, userId, email, me, meStatus, meError, reloadMe, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
