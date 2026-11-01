import { ApiError } from "@/lib/api";
import type { ProductFilters } from "@/lib/chat-api";
import { formatIdr } from "@/lib/format";

/** Matches the turn API limit: content 1..2000 characters (docs/contracts/M4.md). */
export const MAX_MESSAGE_LENGTH = 2000;

/** Sent by the "Hubungi staf" control through the same turn API as any other message. */
export const ESCALATION_REQUEST_TEXT = "Saya ingin bicara dengan staf.";

export const RULES_PROVIDER_LABEL = "Asisten berbasis aturan";
export const SIGN_IN_PROMPT = "Masuk untuk bertanya kepada asisten. Katalog produk tetap bisa dilihat tanpa masuk.";
export const FILTER_UPDATED_HINT = "Filter diperbarui, kirim pesan untuk mencari ulang.";
export const SESSION_EXPIRED_CHAT_MESSAGE = "Sesi Anda sudah berakhir. Masuk kembali untuk melanjutkan.";
export const CONVERSATION_NOT_FOUND_MESSAGE = "Percakapan tidak ditemukan. Kirim lagi untuk memulai percakapan baru.";
export const GENERIC_SEND_FAILED_MESSAGE = "Pesan belum terkirim. Teks Anda masih ada, coba kirim lagi.";
export const SERVICE_UNAVAILABLE_MESSAGE =
  "Asisten belum dapat dihubungi. Teks Anda masih ada, coba kirim lagi.";

export type FilterKey = "category" | "price_lt" | "price_lte" | "size_eu" | "color";

export type FilterChip = {
  key: FilterKey;
  /** Visible Indonesian label, e.g. "< Rp 500.000". */
  label: string;
  /** Accessible name of the remove button. */
  removeLabel: string;
};

/** Chips for every set filter that the customer can remove. Keywords are shown in the answer, not as chips. */
export function filterChips(filters: ProductFilters | null): FilterChip[] {
  if (filters === null) return [];
  const chips: FilterChip[] = [];
  const add = (key: FilterKey, label: string) => {
    chips.push({ key, label, removeLabel: `Hapus filter ${label}` });
  };
  if (filters.price_lt !== null) add("price_lt", `< ${formatIdr(filters.price_lt)}`);
  if (filters.price_lte !== null) add("price_lte", `≤ ${formatIdr(filters.price_lte)}`);
  if (filters.size_eu !== null) add("size_eu", `Ukuran ${filters.size_eu}`);
  if (filters.color !== null) add("color", `Warna ${filters.color}`);
  if (filters.category !== null) add("category", `Kategori ${filters.category}`);
  return chips;
}

/** Returns the filters without one chip. Null when nothing is left to send. */
export function removeFilter(filters: ProductFilters | null, key: FilterKey): ProductFilters | null {
  if (filters === null) return null;
  const next: ProductFilters = { ...filters };
  next[key] = null;
  const empty =
    next.category === null &&
    next.price_lt === null &&
    next.price_lte === null &&
    next.size_eu === null &&
    next.color === null &&
    next.keywords.length === 0 &&
    next.unparsed_budget === null;
  return empty ? null : next;
}

/** Storage key for the conversation id, scoped per signed-in user. */
export function conversationStorageKey(userId: string): string {
  return `tokolangkah.conversation.${userId}`;
}

/** Per-viewer convenience only: sessionStorage can be blocked, so every access is guarded. */
export function readStoredConversationId(userId: string): string | null {
  try {
    return window.sessionStorage.getItem(conversationStorageKey(userId));
  } catch {
    return null;
  }
}

export function storeConversationId(userId: string, conversationId: string): void {
  try {
    window.sessionStorage.setItem(conversationStorageKey(userId), conversationId);
  } catch {
    // Storage unavailable: the next send creates a new conversation instead.
  }
}

export function clearStoredConversationId(userId: string): void {
  try {
    window.sessionStorage.removeItem(conversationStorageKey(userId));
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export function newClientMessageId(): string {
  return crypto.randomUUID();
}

export type SendFailure = {
  message: string;
  /** True when a retry button may resend the same message with the same client_message_id. */
  retryable: boolean;
};

/** Maps a failed turn to one user-facing message. The typed text is always kept by the caller. */
export function sendFailure(error: ApiError): SendFailure {
  if (error.kind === "rate_limited") {
    const seconds = error.retryAfterSeconds;
    return {
      message:
        seconds !== null
          ? `Terlalu banyak pesan, coba lagi dalam ${seconds} detik.`
          : "Terlalu banyak pesan, coba lagi beberapa saat lagi.",
      retryable: false,
    };
  }
  if (error.kind === "unauthorized") return { message: SESSION_EXPIRED_CHAT_MESSAGE, retryable: false };
  if (error.kind === "not_found") return { message: CONVERSATION_NOT_FOUND_MESSAGE, retryable: true };
  if (error.kind === "service_unavailable" || error.kind === "network") {
    return { message: SERVICE_UNAVAILABLE_MESSAGE, retryable: true };
  }
  if (error.kind === "invalid_response" || error.kind === "invalid_json") {
    return { message: "Balasan asisten tidak dapat ditampilkan. Coba kirim lagi.", retryable: true };
  }
  return { message: GENERIC_SEND_FAILED_MESSAGE, retryable: true };
}
