"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { AssistantMessage } from "@/components/assistant-message";
import { NOT_CONFIGURED_MESSAGE, SignedOutNotice } from "@/components/account-states";
import { FilterChips } from "@/components/filter-chips";
import { SourceDrawer } from "@/components/source-drawer";
import type { DrawerSource } from "@/components/source-drawer";
import { ApiError, toApiError } from "@/lib/api";
import { createConversation, getConversation, getHealthProvider, sendTurn } from "@/lib/chat-api";
import type { ConversationMessage, Evidence, ProductFilters, ProductHit, TurnEnvelope } from "@/lib/chat-api";
import {
  ESCALATION_REQUEST_TEXT,
  FILTER_UPDATED_HINT,
  MAX_MESSAGE_LENGTH,
  RULES_PROVIDER_LABEL,
  SIGN_IN_PROMPT,
  clearStoredConversationId,
  filterChips,
  newClientMessageId,
  readStoredConversationId,
  removeFilter,
  sendFailure,
  storeConversationId,
} from "@/lib/chat";
import type { FilterChip, SendFailure } from "@/lib/chat";
import { currentAccessToken } from "@/lib/supabase";

/** An assistant row has an envelope when it came from this session's turn API, or plain text when restored. */
type LogEntry =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; text: string; envelope: TurnEnvelope | null };

/** Maps one stored transcript row (plain text) to a log entry. */
function restoredEntry(row: ConversationMessage, id: number): LogEntry {
  if (row.role === "user") return { id, role: "user", text: row.content };
  return { id, role: "assistant", text: row.content, envelope: null };
}

/** The last message that has not been answered yet. Retrying it reuses its client_message_id. */
type Pending = { clientMessageId: string; content: string };

function toDrawerSource(evidence: Evidence): DrawerSource {
  return {
    policyTitle: evidence.title,
    version: evidence.version,
    section: evidence.section,
    excerpt: evidence.excerpt,
  };
}

/**
 * Customer chat. Signed-out visitors see the sign-in prompt instead of the form.
 * Each send is one turn: the typed text stays until the server confirms the turn,
 * a retry reuses the same client_message_id, and only completed assistant answers
 * are announced to screen readers. Results from a product search are passed up
 * through onResults so the contextual panel can show them.
 */
export function ChatShell({ onResults }: { onResults?: (products: ProductHit[]) => void }) {
  const auth = useAuth();
  const inputId = useId();
  const hintId = useId();
  const headingId = useId();
  const nextIdRef = useRef(1);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Where keyboard focus goes after a filter chip is removed: another chip's key, "input", or null. */
  const focusAfterChipRemoveRef = useRef<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<LogEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [filters, setFilters] = useState<ProductFilters | null>(null);
  const [filterHint, setFilterHint] = useState(false);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [failure, setFailure] = useState<SendFailure | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [drawerSource, setDrawerSource] = useState<DrawerSource | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  /** The user whose stored conversation has been read back (or found missing) in this page load. */
  const [restoreDoneFor, setRestoreDoneFor] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const userId = auth.userId;
  const sessionStatus = auth.sessionStatus;
  // Restoring is shown while a stored id exists for this user and its read has not finished yet.
  const restoring =
    sessionStatus === "signed_in" && userId !== null && readStoredConversationId(userId) !== null && restoreDoneFor !== userId;
  const chips = filterChips(filters);

  // The provider label is read once from /health. If it fails, no label is shown.
  useEffect(() => {
    let active = true;
    getHealthProvider()
      .then((value) => {
        if (active) setProvider(value);
      })
      .catch(() => {
        // Label stays hidden; the chat still works.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages.length]);

  // Reload restore: a conversation id kept for this user in sessionStorage is read back
  // from the API. A 404 (deleted, or not this user's) clears the id so the next send starts fresh.
  useEffect(() => {
    if (userId === null || sessionStatus !== "signed_in") return;
    const storedId = readStoredConversationId(userId);
    if (storedId === null) return;
    let active = true;
    (async () => {
      try {
        const token = await currentAccessToken();
        if (token === null) throw new ApiError("unauthorized", "No session.", 401);
        const history = await getConversation(token, storedId);
        if (!active) return;
        const restored = history.messages.map((row) => restoredEntry(row, allocateId()));
        // A message sent while the transcript was loading stays in front; restored rows never replace it.
        setMessages((current) => (current.length === 0 ? restored : current));
      } catch (error: unknown) {
        if (!active) return;
        const apiError = toApiError(error);
        if (apiError.kind === "not_found") {
          clearStoredConversationId(userId);
        } else if (apiError.kind !== "unauthorized") {
          setRestoreError("Riwayat percakapan belum dapat dimuat. Pesan baru tetap bisa dikirim.");
        }
      } finally {
        if (active) setRestoreDoneFor(userId);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, sessionStatus]);

  function allocateId(): number {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    return id;
  }

  async function dispatch(content: string, clientMessageId: string) {
    if (userId === null) return;
    setSending(true);
    setFailure(null);
    setValidationError(null);
    setPending({ clientMessageId, content });
    try {
      const token = await currentAccessToken();
      if (token === null) throw new ApiError("unauthorized", "No session.", 401);

      let conversationId = readStoredConversationId(userId);
      if (conversationId === null) {
        conversationId = await createConversation(token);
        storeConversationId(userId, conversationId);
      }

      const envelope = await sendTurn(token, conversationId, {
        content,
        client_message_id: clientMessageId,
        filters,
      });

      setPending(null);
      setRestoreDoneFor(userId);
      setFilters(envelope.filters);
      setFilterHint(false);
      if (envelope.products.length > 0 || envelope.filters !== null) {
        onResults?.(envelope.products);
      }
      const userEntryId = allocateId();
      const assistantEntryId = allocateId();
      setMessages((current) => [
        ...current,
        { id: userEntryId, role: "user", text: content },
        { id: assistantEntryId, role: "assistant", text: envelope.answer, envelope },
      ]);
      setDraft((current) => (current.trim() === content ? "" : current));
      setAnnouncement(`Asisten: ${envelope.answer}`);
    } catch (error: unknown) {
      const apiError = toApiError(error);
      if (apiError.kind === "not_found") clearStoredConversationId(userId);
      setFailure(sendFailure(apiError));
    } finally {
      setSending(false);
    }
  }

  /** Sends text as one turn. Sending the same text again after a failure reuses its id. */
  function submitText(rawText: string) {
    if (sending) return;
    const content = rawText.trim();
    if (content === "") {
      setValidationError("Tulis pesan terlebih dahulu.");
      return;
    }
    const clientMessageId =
      pending !== null && pending.content === content ? pending.clientMessageId : newClientMessageId();
    void dispatch(content, clientMessageId);
  }

  function retry() {
    if (sending || pending === null) return;
    void dispatch(pending.content, pending.clientMessageId);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitText(draft);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline; IME composition is left alone.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submitText(draft);
    }
  }

  // Removing a chip with the keyboard would otherwise drop focus to the body. Focus the next
  // remaining chip, or the message box when none is left, once the chip list has re-rendered.
  useEffect(() => {
    const target = focusAfterChipRemoveRef.current;
    if (target === null) return;
    focusAfterChipRemoveRef.current = null;
    if (target === "input") {
      inputRef.current?.focus();
      return;
    }
    formRef.current?.querySelector<HTMLButtonElement>(`button[data-chip-key="${target}"]`)?.focus();
  }, [filters]);

  function removeChip(chip: FilterChip) {
    const remaining = filterChips(removeFilter(filters, chip.key));
    const index = chips.findIndex((candidate) => candidate.key === chip.key);
    const next = remaining[index] ?? remaining[index - 1] ?? null;
    focusAfterChipRemoveRef.current = next === null ? "input" : next.key;
    setFilters((current) => removeFilter(current, chip.key));
    setFilterHint(true);
  }

  const signedIn = auth.sessionStatus === "signed_in" && userId !== null;

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4">
      <div>
        <h1 id={headingId} className="text-2xl font-semibold text-text">
          Asisten TokoLangkah
        </h1>
        {provider === "rules" ? (
          <p className="mt-2 inline-block rounded-card border border-border bg-background px-3 py-1 text-sm text-text">
            {RULES_PROVIDER_LABEL}
          </p>
        ) : null}
        <p className="mt-2 text-muted">
          Tanyakan produk, ukuran, pesanan Anda, atau kebijakan toko. Jawaban menyertakan sumber bila tersedia.
        </p>
      </div>

      {auth.sessionStatus === "loading" ? (
        <p role="status" className="text-muted">
          Memuat…
        </p>
      ) : null}
      {auth.sessionStatus === "not_configured" ? (
        <p role="status" className="rounded-card border border-border bg-surface p-4 text-text">
          {NOT_CONFIGURED_MESSAGE}
        </p>
      ) : null}
      {auth.sessionStatus === "signed_out" ? <SignedOutNotice message={SIGN_IN_PROMPT} /> : null}

      {signedIn ? (
        <div className="flex flex-col rounded-card border border-border bg-surface">
          <div className="max-h-[50vh] min-h-48 overflow-y-auto p-4 lg:max-h-[60vh]">
            {restoring ? (
              <p role="status" className="text-muted">
                Memuat riwayat percakapan…
              </p>
            ) : null}
            {restoreError !== null ? (
              <p role="status" className="mb-3 text-sm text-text">
                {restoreError}
              </p>
            ) : null}
            {messages.length === 0 && !restoring ? (
              <p className="text-muted">Belum ada pesan. Tulis pesan di bawah untuk memulai.</p>
            ) : messages.length === 0 ? null : (
              <ol aria-label="Percakapan" className="flex flex-col gap-4">
                {messages.map((entry) => (
                  <li
                    key={entry.id}
                    className={
                      entry.role === "user"
                        ? "ml-auto max-w-[85%] rounded-card bg-primary px-4 py-3 text-white"
                        : "mr-auto max-w-[85%] rounded-card border border-border bg-background px-4 py-3 text-text"
                    }
                  >
                    <p className="text-sm font-semibold">{entry.role === "user" ? "Anda" : "Asisten"}</p>
                    <div className="mt-1">
                      {entry.role === "user" ? (
                        <p className="whitespace-pre-wrap break-words">{entry.text}</p>
                      ) : entry.envelope !== null ? (
                        <AssistantMessage
                          envelope={entry.envelope}
                          onOpenSource={(evidence) => setDrawerSource(toDrawerSource(evidence))}
                        />
                      ) : (
                        <p className="whitespace-pre-wrap break-words">{entry.text}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <div ref={logEndRef} />
          </div>

          <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-3 border-t border-border p-4">
            <FilterChips chips={chips} onRemove={removeChip} />
            {filterHint ? (
              <p role="status" className="text-sm text-muted">
                {FILTER_UPDATED_HINT}
              </p>
            ) : null}

            <label htmlFor={inputId} className="block font-semibold text-text">
              Tulis pesan
            </label>
            <p id={hintId} className="text-sm text-muted">
              Enter untuk kirim, Shift+Enter untuk baris baru.
            </p>
            <textarea
              id={inputId}
              ref={inputRef}
              name="message"
              rows={3}
              maxLength={MAX_MESSAGE_LENGTH}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              aria-describedby={hintId}
              aria-invalid={validationError !== null || failure !== null}
              className="w-full resize-y rounded-card border border-border bg-background p-3 text-text"
            />
            {validationError !== null || failure !== null ? (
              <p role="alert" className="text-sm text-text">
                {validationError ?? failure?.message}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={sending}
                className="min-h-11 rounded-card bg-primary px-5 font-semibold text-white hover:opacity-90 disabled:opacity-60"
              >
                {sending ? "Mengirim…" : "Kirim"}
              </button>
              {failure?.retryable && pending !== null ? (
                <button
                  type="button"
                  onClick={retry}
                  disabled={sending}
                  className="min-h-11 rounded-card border border-border bg-surface px-4 text-text hover:bg-background disabled:opacity-60"
                >
                  Coba kirim lagi
                </button>
              ) : null}
            </div>
          </form>

          <div className="flex flex-col gap-2 border-t border-border p-4">
            <button
              type="button"
              onClick={() => submitText(ESCALATION_REQUEST_TEXT)}
              disabled={sending}
              className="min-h-11 self-start rounded-card border border-border bg-background px-4 text-text hover:bg-surface disabled:opacity-60"
            >
              Hubungi staf
            </button>
            <p className="text-sm text-muted">Permintaan ini dicatat sebagai tiket dan dapat dilihat staf.</p>
          </div>
        </div>
      ) : null}

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {drawerSource !== null ? (
        <SourceDrawer open source={drawerSource} onClose={() => setDrawerSource(null)} />
      ) : null}
    </section>
  );
}
