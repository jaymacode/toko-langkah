import Link from "next/link";
import { RATE_LIMITED_MESSAGE } from "@/components/product-list";
import type { ApiError } from "@/lib/api";

export const NOT_CONFIGURED_MESSAGE = "Masuk belum tersedia pada konfigurasi aplikasi ini.";
export const ACCOUNT_UNAVAILABLE_MESSAGE = "Layanan sedang tidak tersedia. Coba lagi.";
export const SESSION_EXPIRED_MESSAGE = "Sesi Anda sudah berakhir. Masuk kembali untuk melanjutkan.";

/** Maps an API error to user-facing text. Unauthorized is handled by the caller as a signed-out state. */
export function accountErrorMessage(error: ApiError): string {
  if (error.kind === "rate_limited") return RATE_LIMITED_MESSAGE;
  if (error.kind === "not_configured") return NOT_CONFIGURED_MESSAGE;
  if (error.kind === "unauthorized") return SESSION_EXPIRED_MESSAGE;
  return ACCOUNT_UNAVAILABLE_MESSAGE;
}

/** Signed-out state with a link to the sign-in page. Used for signed-out and expired sessions. */
export function SignedOutNotice({ message }: { message: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <p className="text-text">{message}</p>
      <Link
        href="/masuk"
        className="mt-3 inline-flex min-h-11 items-center rounded-card bg-primary px-4 text-white hover:opacity-90"
      >
        Buka halaman masuk
      </Link>
    </div>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <p role="alert" className="text-text">
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 min-h-11 rounded-card bg-primary px-4 text-white hover:opacity-90"
      >
        Coba lagi
      </button>
    </div>
  );
}

/** Shows the signed-out notice for an unauthorized error, otherwise an error with retry. */
export function ApiErrorNotice({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  if (error.kind === "unauthorized") {
    return <SignedOutNotice message={SESSION_EXPIRED_MESSAGE} />;
  }
  return <ErrorNotice message={accountErrorMessage(error)} onRetry={onRetry} />;
}
