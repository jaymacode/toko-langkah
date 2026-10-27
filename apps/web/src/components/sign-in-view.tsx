"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { NOT_CONFIGURED_MESSAGE } from "@/components/account-states";
import { SiteFrame } from "@/components/site-frame";
import type { AppMode } from "@/lib/config";
import { getBrowserSupabase } from "@/lib/supabase";

export const INVALID_CREDENTIALS_MESSAGE = "Email atau kata sandi salah.";
export const SIGN_IN_UNAVAILABLE_MESSAGE = "Tidak dapat masuk sekarang. Coba lagi nanti.";
export const SIGN_IN_RATE_LIMIT_MESSAGE = "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.";

/**
 * Maps a Supabase auth error to one message. Every credential-related 4xx
 * (wrong password, unknown email, unconfirmed account) gets the same text, so the
 * form never reveals whether an account exists.
 */
export function signInErrorMessage(error: { status?: number | undefined }): string {
  if (error.status === 429) return SIGN_IN_RATE_LIMIT_MESSAGE;
  if (typeof error.status === "number" && error.status >= 400 && error.status < 500) {
    return INVALID_CREDENTIALS_MESSAGE;
  }
  return SIGN_IN_UNAVAILABLE_MESSAGE;
}

/** Email and password sign-in through the Supabase Auth API. The password is never stored or logged. */
export function SignInView({ mode }: { mode: AppMode }) {
  const router = useRouter();
  const auth = useAuth();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notConfigured = auth.sessionStatus === "not_configured";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const supabase = getBrowserSupabase();
    if (supabase === null) {
      setError(NOT_CONFIGURED_MESSAGE);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(signInErrorMessage(signInError));
        setPassword("");
        return;
      }
      router.push("/pesanan");
    } catch {
      setError(SIGN_IN_UNAVAILABLE_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  return (
    <SiteFrame mode={mode} current={null}>
      <section aria-labelledby="signin-heading" className="mx-auto flex max-w-md flex-col gap-6">
        <div>
          <h1 id="signin-heading" className="text-2xl font-semibold text-text">
            Masuk
          </h1>
          <p className="mt-2 text-muted">
            Masuk dengan akun demo untuk melihat pesanan Anda. Akun ini fiktif.
          </p>
        </div>

        {notConfigured ? (
          <p role="status" className="rounded-card border border-border bg-surface p-4 text-text">
            {NOT_CONFIGURED_MESSAGE}
          </p>
        ) : (
          <form
            onSubmit={handleSubmit}
            aria-describedby={error ? errorId : undefined}
            className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 md:p-6"
          >
            <div className="flex flex-col gap-2">
              <label htmlFor={emailId} className="font-semibold text-text">
                Email
              </label>
              <input
                id={emailId}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={error ? true : undefined}
                className="min-h-11 rounded-card border border-border bg-background px-3 text-text"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor={passwordId} className="font-semibold text-text">
                Kata sandi
              </label>
              <input
                id={passwordId}
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={error ? true : undefined}
                className="min-h-11 rounded-card border border-border bg-background px-3 text-text"
              />
            </div>
            {error ? (
              <p id={errorId} role="alert" className="text-text">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 rounded-card bg-primary px-4 font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Memeriksa…" : "Masuk"}
            </button>
          </form>
        )}
      </section>
    </SiteFrame>
  );
}
