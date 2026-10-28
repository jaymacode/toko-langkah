"use client";

import Link from "next/link";
import { useId, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { NOT_CONFIGURED_MESSAGE } from "@/components/account-states";
import { SiteFrame } from "@/components/site-frame";
import { landingFor } from "@/components/sign-in-view";
import type { AppMode } from "@/lib/config";
import { getBrowserSupabase } from "@/lib/supabase";

export const MIN_PASSWORD_LENGTH = 8;
export const PASSWORD_MISMATCH_MESSAGE = "Kedua kata sandi tidak sama.";
export const PASSWORD_SHORT_MESSAGE = `Kata sandi minimal ${MIN_PASSWORD_LENGTH} karakter.`;
export const SIGN_UP_UNAVAILABLE_MESSAGE =
  "Pendaftaran belum bisa diproses sekarang (misalnya email konfirmasi gagal dikirim). Coba lagi nanti.";
export const SIGN_UP_RATE_LIMIT_MESSAGE = "Terlalu banyak percobaan pendaftaran. Tunggu sebentar lalu coba lagi.";
export const SIGN_UP_WEAK_PASSWORD_MESSAGE = "Kata sandi terlalu lemah. Gunakan kombinasi huruf dan angka yang lebih panjang.";
export const SIGN_UP_INVALID_EMAIL_MESSAGE = "Alamat email tidak valid.";
/** Same text whether or not the address already has an account, so the form reveals nothing. */
export const CHECK_EMAIL_MESSAGE =
  "Jika alamat ini bisa didaftarkan, kami sudah mengirim tautan konfirmasi ke email tersebut. Buka tautannya, lalu masuk.";

/** Maps a Supabase sign-up error to one message without revealing whether an account exists. */
export function signUpErrorMessage(error: { status?: number | undefined; code?: string | undefined }): string {
  if (error.status === 429 || error.code === "over_email_send_rate_limit") return SIGN_UP_RATE_LIMIT_MESSAGE;
  if (error.code === "weak_password") return SIGN_UP_WEAK_PASSWORD_MESSAGE;
  if (error.code === "email_address_invalid" || error.code === "validation_failed") return SIGN_UP_INVALID_EMAIL_MESSAGE;
  // An existing address is answered like a new one (check your email): no enumeration.
  if (error.code === "user_already_exists" || error.code === "email_exists") return CHECK_EMAIL_MESSAGE;
  return SIGN_UP_UNAVAILABLE_MESSAGE;
}

type Outcome = { kind: "check_email"; email: string } | null;

/**
 * Account registration through Supabase Auth. When the project confirms emails, the visitor gets a
 * "check your email" state; when it does not, they are signed in, made a customer of the demo store
 * by the API, and sent to their orders. Passwords are never stored or logged here.
 */
export function SignUpView({ mode }: { mode: AppMode }) {
  const router = useRouter();
  const auth = useAuth();
  const emailId = useId();
  const passwordId = useId();
  const confirmId = useId();
  const errorId = useId();
  const hintId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const notConfigured = auth.sessionStatus === "not_configured";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(PASSWORD_SHORT_MESSAGE);
      return;
    }
    if (password !== confirm) {
      setError(PASSWORD_MISMATCH_MESSAGE);
      return;
    }
    const supabase = getBrowserSupabase();
    if (supabase === null) {
      setError(NOT_CONFIGURED_MESSAGE);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const address = email.trim();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: address,
        password,
        options: { emailRedirectTo: `${window.location.origin}/masuk` },
      });
      if (signUpError) {
        const message = signUpErrorMessage(signUpError);
        if (message === CHECK_EMAIL_MESSAGE) {
          setOutcome({ kind: "check_email", email: address });
        } else {
          setError(message);
        }
        return;
      }
      setPassword("");
      setConfirm("");
      if (data.session) {
        // No email confirmation on this project: signed in now; the API makes the account a customer.
        router.push(await landingFor(data.session.access_token));
        return;
      }
      setOutcome({ kind: "check_email", email: address });
    } catch {
      setError(SIGN_UP_UNAVAILABLE_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  const inputClass = "min-h-11 rounded-bay border border-quiet bg-surface px-3 text-text hover:border-text focus:border-text";

  return (
    <SiteFrame mode={mode} current={null}>
      <div className="grid items-stretch gap-8 lg:grid-cols-[minmax(0,26rem)_1fr] lg:gap-14">
        <section aria-labelledby="signup-heading" className="flex w-full max-w-md flex-col gap-6 lg:py-6">
          <div>
            <h1 id="signup-heading" className="font-display text-[clamp(40px,6vw,72px)] font-bold uppercase leading-[0.86] text-text">
              Daftar
            </h1>
            <p className="mt-2 text-muted">
              Buat akun untuk bertanya ke asisten dan melihat pesanan Anda. Ini toko demo: jangan pakai kata sandi yang Anda
              gunakan di tempat lain.
            </p>
          </div>

          {notConfigured ? (
            <p role="status" className="rounded-card border border-border bg-surface p-5 text-text">
              {NOT_CONFIGURED_MESSAGE}
            </p>
          ) : outcome !== null ? (
            <div role="status" className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5 md:p-6">
              <h2 className="font-display text-[26px] font-medium leading-tight text-text">Cek email Anda</h2>
              <p className="text-text">{CHECK_EMAIL_MESSAGE}</p>
              <p className="break-all text-sm text-muted">{outcome.email}</p>
              <Link
                href="/masuk"
                className="inline-flex min-h-11 items-center self-start rounded-pill bg-primary px-5 font-medium text-on-primary transition-opacity duration-200 hover:opacity-85"
              >
                Ke halaman masuk
              </Link>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              aria-describedby={error ? errorId : undefined}
              className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5 md:p-6"
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
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor={passwordId} className="font-semibold text-text">
                  Kata sandi
                </label>
                <input
                  id={passwordId}
                  name="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  aria-describedby={hintId}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={error === PASSWORD_SHORT_MESSAGE || error === SIGN_UP_WEAK_PASSWORD_MESSAGE ? true : undefined}
                  className={inputClass}
                />
                <p id={hintId} className="text-sm text-muted">
                  Minimal {MIN_PASSWORD_LENGTH} karakter.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor={confirmId} className="font-semibold text-text">
                  Ulangi kata sandi
                </label>
                <input
                  id={confirmId}
                  name="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  aria-invalid={error === PASSWORD_MISMATCH_MESSAGE ? true : undefined}
                  className={inputClass}
                />
              </div>
              {error ? (
                <p id={errorId} role="alert" className="flex items-start gap-2 text-accent-ink">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  {error}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={pending}
                className="min-h-11 rounded-pill bg-primary px-5 font-medium text-on-primary transition-opacity duration-200 hover:opacity-85 disabled:opacity-60"
              >
                {pending ? "Mendaftarkan…" : "Buat akun"}
              </button>
              <p className="text-[15px] text-muted">
                Sudah punya akun?{" "}
                <Link href="/masuk" className="inline-flex min-h-11 items-center font-medium text-text underline underline-offset-4">
                  Masuk
                </Link>
              </p>
            </form>
          )}
        </section>
        <div aria-hidden="true" className="relative hidden min-h-[30rem] overflow-hidden rounded-card bg-stone lg:block">
          {/* CSS background, not <img>: hidden below lg, so phones never download it. */}
          <div className="absolute inset-0 bg-stone bg-[url(/products/kota-canvas.png)] bg-contain bg-center bg-no-repeat" />
        </div>
      </div>
    </SiteFrame>
  );
}
