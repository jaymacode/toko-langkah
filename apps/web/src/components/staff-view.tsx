"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode, RefObject } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  ApiErrorNotice,
  NOT_CONFIGURED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  SignedOutNotice,
} from "@/components/account-states";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StaffFrame } from "@/components/staff-frame";
import {
  ApiError,
  getStaffTicket,
  listStaffTickets,
  postStaffReply,
  toApiError,
  updateStaffTicketStatus,
} from "@/lib/api";
import type { StaffTicketDetail, StaffTicketSummary, TicketStatus } from "@/lib/api";
import { MAX_MESSAGE_LENGTH, newClientMessageId } from "@/lib/chat";
import type { AppMode } from "@/lib/config";
import { formatDateTime } from "@/lib/format";
import { auditActionLabel, roleLabel, ticketStatusLabel } from "@/lib/labels";
import { currentAccessToken } from "@/lib/supabase";

type Filter = "all" | TicketStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "open", label: ticketStatusLabel("open") },
  { value: "in_progress", label: ticketStatusLabel("in_progress") },
  { value: "resolved", label: ticketStatusLabel("resolved") },
];

const STATUS_ACTION_LABELS: Record<TicketStatus, string> = {
  open: "Tandai Terbuka",
  in_progress: "Tandai Ditangani",
  resolved: "Tandai Selesai",
};

/** The open ticket is re-read this often so customer messages appear without a reload. */
export const DETAIL_POLL_MS = 5000;
const LIST_POLL_MS = 15000;

export const STAFF_ONLY_MESSAGE = "Halaman ini khusus staf.";
export const STATUS_UPDATE_FAILED_MESSAGE = "Status belum berubah. Coba lagi.";
export const TICKET_NOT_FOUND_MESSAGE = "Tiket tidak ditemukan.";
export const REPLY_FAILED_MESSAGE = "Balasan belum terkirim. Teks Anda masih ada; coba kirim lagi.";
export const REPLY_RESOLVED_MESSAGE = "Tiket ini sudah selesai, jadi asisten yang menjawab pelanggan. Buka kembali tiket untuk membalas.";
export const WAITING_LABEL = "Menunggu balasan";

type ListState =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; items: StaffTicketSummary[] };

type DetailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; ticket: StaffTicketDetail };

async function loadList(filter: Filter): Promise<ListState> {
  try {
    const token = await currentAccessToken();
    if (token === null) throw new ApiError("unauthorized", "No session.", 401);
    const page = await listStaffTickets(token, filter === "all" ? {} : { status: filter });
    return { status: "ready", items: page.items };
  } catch (error: unknown) {
    return { status: "error", error: toApiError(error) };
  }
}

async function loadDetail(ticketId: string): Promise<DetailState> {
  try {
    const token = await currentAccessToken();
    if (token === null) throw new ApiError("unauthorized", "No session.", 401);
    const ticket = await getStaffTicket(ticketId, token);
    return { status: "ready", ticket };
  } catch (error: unknown) {
    return { status: "error", error: toApiError(error) };
  }
}

function statusErrorMessage(error: ApiError): string {
  if (error.kind === "unauthorized") return SESSION_EXPIRED_MESSAGE;
  if (error.kind === "not_found") return TICKET_NOT_FOUND_MESSAGE;
  if (error.kind === "rate_limited") return "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.";
  return STATUS_UPDATE_FAILED_MESSAGE;
}

/** A customer is waiting when they spoke last on a ticket that is not resolved. */
function isWaiting(ticket: StaffTicketSummary): boolean {
  return ticket.status !== "resolved" && ticket.last_message_role === "user";
}

/** Staff gate. Only /me with at least one staff store unlocks the console. */
export function StaffView({ mode }: { mode: AppMode }) {
  return (
    <StaffFrame mode={mode} current="tiket">
      <section aria-labelledby="staff-heading" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
          <h1 id="staff-heading" className="font-display text-[clamp(36px,4.4vw,56px)] font-bold uppercase leading-[0.88] text-text">
            Tiket <span className="text-quiet">pelanggan</span>
          </h1>
          <p className="text-[15px] text-muted">Balas pelanggan dari sini. Selama tiket belum selesai, asisten tidak menjawab.</p>
        </div>
        <StaffGate>
          <StaffDashboard />
        </StaffGate>
      </section>
    </StaffFrame>
  );
}

/** Renders its children only for a signed-in staff member (/me with a staff store). */
export function StaffGate({ children }: { children: ReactNode }) {
  const auth = useAuth();

  if (auth.sessionStatus === "loading") {
    return <p role="status" className="text-muted">Memuat…</p>;
  }
  if (auth.sessionStatus === "not_configured") {
    return <p role="status" className="rounded-card border border-border bg-surface p-5 text-text">{NOT_CONFIGURED_MESSAGE}</p>;
  }
  if (auth.sessionStatus === "signed_out") {
    return <SignedOutNotice message="Masuk dengan akun staf untuk membuka halaman ini." />;
  }
  if (auth.meStatus === "idle" || auth.meStatus === "loading") {
    return <p role="status" className="text-muted">Memeriksa akses…</p>;
  }
  if (auth.meStatus === "error" && auth.meError !== null) {
    return <ApiErrorNotice error={auth.meError} onRetry={auth.reloadMe} />;
  }
  if (!auth.isStaff) {
    return <p className="rounded-card border border-border bg-surface p-5 text-text">{STAFF_ONLY_MESSAGE}</p>;
  }
  return <>{children}</>;
}

/**
 * Ticket queue with status filters, the selected ticket's conversation with a reply box, and its
 * status actions and audit trail. Status changes and replies wait for the server; resolving needs
 * confirmation. The open ticket and the queue refresh on a timer so new customer messages appear.
 */
export function StaffDashboard() {
  const [filter, setFilter] = useState<Filter>("all");
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [listAttempt, setListAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState>({ status: "idle" });
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [confirmTarget, setConfirmTarget] = useState<TicketStatus | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const listHeadingId = useId();

  useEffect(() => {
    let active = true;
    void loadList(filter).then((next) => {
      if (active) setList(next);
    });
    const timer = window.setInterval(() => {
      // Background refresh keeps the shown list on a failed poll.
      void loadList(filter).then((next) => {
        if (active && next.status === "ready") setList(next);
      });
    }, LIST_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [filter, listAttempt]);

  useEffect(() => {
    if (selectedId === null) return;
    let active = true;
    void loadDetail(selectedId).then((next) => {
      if (active) setDetail(next);
    });
    const timer = window.setInterval(() => {
      void loadDetail(selectedId).then((next) => {
        if (active && next.status === "ready") setDetail(next);
      });
    }, DETAIL_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selectedId]);

  const refreshAfterChange = useCallback(
    async (ticketId: string) => {
      const [nextDetail, nextList] = await Promise.all([loadDetail(ticketId), loadList(filter)]);
      setDetail(nextDetail);
      if (nextList.status === "ready") setList(nextList);
    },
    [filter],
  );

  function changeFilter(next: Filter) {
    if (next === filter) return;
    setFilter(next);
    setList({ status: "loading" });
  }

  function retryList() {
    setList({ status: "loading" });
    setListAttempt((current) => current + 1);
  }

  function selectTicket(ticketId: string) {
    setSelectedId(ticketId);
    setDetail({ status: "loading" });
    setActionError(null);
    setAnnouncement("");
  }

  async function changeStatus(target: TicketStatus) {
    if (pending || selectedId === null || detail.status !== "ready") return;
    const ticketId = selectedId;
    setPending(true);
    setActionError(null);
    setAnnouncement("");
    try {
      const token = await currentAccessToken();
      if (token === null) throw new ApiError("unauthorized", "No session.", 401);
      await updateStaffTicketStatus(ticketId, target, token);
      await refreshAfterChange(ticketId);
      setAnnouncement(`Status tiket diubah menjadi ${ticketStatusLabel(target)}.`);
      detailHeadingRef.current?.focus();
    } catch (error: unknown) {
      setActionError(statusErrorMessage(toApiError(error)));
    } finally {
      setPending(false);
    }
  }

  function requestStatus(target: TicketStatus) {
    if (target === "resolved") {
      setConfirmTarget("resolved");
      return;
    }
    void changeStatus(target);
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[21rem_minmax(0,1fr)] lg:items-start">
      <section
        aria-labelledby={listHeadingId}
        className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface p-3 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-8rem)]"
      >
        <div className="flex items-center justify-between gap-2 px-1 pt-1">
          <h2 id={listHeadingId} className="font-display text-[22px] font-medium leading-tight text-text">
            Antrean tiket
          </h2>
          {list.status === "ready" ? (
            <p className="tabular text-sm text-muted">
              {list.items.filter(isWaiting).length} menunggu
            </p>
          ) : null}
        </div>
        <div role="group" aria-label="Filter status" className="flex w-full flex-wrap gap-1 rounded-[26px] bg-stone p-1">
          {FILTERS.map((option) => {
            const active = filter === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => changeFilter(option.value)}
                className={
                  active
                    ? "min-h-11 flex-1 rounded-pill bg-primary px-3 text-[15px] font-medium text-on-primary"
                    : "min-h-11 flex-1 rounded-pill px-3 text-[15px] text-text transition-colors duration-200 hover:bg-surface"
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <div className="min-h-0 overflow-y-auto [scrollbar-width:thin]">
          <TicketList list={list} selectedId={selectedId} onSelect={selectTicket} onRetry={retryList} />
        </div>
      </section>

      <section aria-label="Detail tiket" className="flex min-w-0 flex-col gap-4">
        <TicketDetail
          detail={detail}
          pending={pending}
          actionError={actionError}
          announcement={announcement}
          headingRef={detailHeadingRef}
          onRequestStatus={requestStatus}
          onReplied={(ticketId) => refreshAfterChange(ticketId)}
          onRetry={() => {
            if (selectedId !== null) selectTicket(selectedId);
          }}
        />
      </section>

      <ConfirmDialog
        open={confirmTarget === "resolved"}
        title="Tandai tiket sebagai selesai?"
        description="Tiket akan ditandai Selesai dan perubahan ini tercatat di riwayat audit atas nama Anda. Setelah itu asisten kembali menjawab pelanggan."
        confirmLabel="Ya, tandai selesai"
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => {
          setConfirmTarget(null);
          void changeStatus("resolved");
        }}
      />
    </div>
  );
}

function TicketList({
  list,
  selectedId,
  onSelect,
  onRetry,
}: {
  list: ListState;
  selectedId: string | null;
  onSelect: (ticketId: string) => void;
  onRetry: () => void;
}) {
  if (list.status === "loading") {
    return <p role="status" className="px-1 text-muted">Memuat tiket…</p>;
  }
  if (list.status === "error") {
    return <ApiErrorNotice error={list.error} onRetry={onRetry} />;
  }
  if (list.items.length === 0) {
    return <p className="px-1 py-3 text-text">Belum ada tiket untuk filter ini.</p>;
  }
  return (
    <ul aria-label="Tiket" className="flex flex-col gap-1.5">
      {list.items.map((ticket) => {
        const selected = ticket.id === selectedId;
        const waiting = isWaiting(ticket);
        return (
          <li key={ticket.id} className="min-w-0">
            <button
              type="button"
              onClick={() => onSelect(ticket.id)}
              aria-current={selected ? "true" : undefined}
              className={
                selected
                  ? "flex min-h-11 w-full min-w-0 flex-col gap-1 rounded-bay bg-primary p-3.5 text-left text-on-primary"
                  : "flex min-h-11 w-full min-w-0 flex-col gap-1 rounded-bay p-3.5 text-left text-text transition-colors duration-200 hover:bg-stone"
              }
            >
              <span className="font-semibold break-words">{ticket.reason}</span>
              <span className={`flex flex-wrap items-center gap-x-2 text-sm ${selected ? "text-ink-muted" : "text-text"}`}>
                <span>{ticketStatusLabel(ticket.status)}</span>
                {ticket.customer_alias ? <span>· {ticket.customer_alias}</span> : null}
              </span>
              <span className={`flex flex-wrap items-center gap-x-3 text-sm ${selected ? "text-ink-muted" : "text-muted"}`}>
                <span className="tabular">{formatDateTime(ticket.last_message_at ?? ticket.created_at)}</span>
                {waiting ? (
                  <span className={`inline-flex items-center gap-1.5 font-medium ${selected ? "text-on-primary" : "text-accent-ink"}`}>
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
                    {WAITING_LABEL}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

type PendingReply = { clientMessageId: string; content: string };

function ReplyBox({ ticket, onReplied }: { ticket: StaffTicketDetail; onReplied: (ticketId: string) => Promise<void> }) {
  const inputId = useId();
  const hintId = useId();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingReply, setPendingReply] = useState<PendingReply | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const resolved = ticket.status === "resolved";

  async function send(content: string, clientMessageId: string) {
    setSending(true);
    setError(null);
    setPendingReply({ clientMessageId, content });
    try {
      const token = await currentAccessToken();
      if (token === null) throw new ApiError("unauthorized", "No session.", 401);
      await postStaffReply(ticket.id, { content, client_message_id: clientMessageId }, token);
      setPendingReply(null);
      setDraft((current) => (current.trim() === content ? "" : current));
      setAnnouncement("Balasan terkirim ke pelanggan.");
      await onReplied(ticket.id);
    } catch (caught: unknown) {
      const apiError = toApiError(caught);
      if (apiError.status === 409) {
        setError(REPLY_RESOLVED_MESSAGE);
        await onReplied(ticket.id);
      } else if (apiError.kind === "unauthorized") {
        setError(SESSION_EXPIRED_MESSAGE);
      } else {
        setError(REPLY_FAILED_MESSAGE);
      }
    } finally {
      setSending(false);
    }
  }

  function submit() {
    if (sending || resolved) return;
    const content = draft.trim();
    if (content === "") {
      setError("Tulis balasan terlebih dahulu.");
      return;
    }
    // Sending the same text again after a failure reuses its id, so the server never posts it twice.
    const clientMessageId =
      pendingReply !== null && pendingReply.content === content ? pendingReply.clientMessageId : newClientMessageId();
    void send(content, clientMessageId);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  if (resolved) {
    return (
      <p className="border-t border-border bg-background px-4 py-3 text-sm text-text">
        Tiket selesai: asisten kembali menjawab pelanggan. Tandai Ditangani untuk membalas lagi.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 border-t border-border bg-background p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <label htmlFor={inputId} className="font-medium text-text">
          Balas pelanggan
        </label>
        <p id={hintId} className="text-[13px] text-muted">
          Enter untuk kirim, Shift+Enter untuk baris baru.
        </p>
      </div>
      <div className="flex items-end gap-2">
        <textarea
          id={inputId}
          rows={2}
          maxLength={MAX_MESSAGE_LENGTH}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-describedby={hintId}
          aria-invalid={error !== null}
          className="min-h-11 w-full min-w-0 flex-1 resize-none rounded-bay border border-quiet bg-surface p-3 text-text transition-colors duration-200 hover:border-text focus:border-text"
        />
        <button
          type="submit"
          disabled={sending}
          className="min-h-11 rounded-pill bg-primary px-6 font-medium text-on-primary transition-opacity duration-200 hover:opacity-85 disabled:opacity-60"
        >
          {sending ? "Mengirim…" : "Kirim balasan"}
        </button>
      </div>
      {error !== null ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-accent-ink">
          <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          {error}
        </p>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </form>
  );
}

const BUBBLE: Record<string, string> = {
  user: "mr-auto max-w-[85%] rounded-[20px] rounded-bl-md bg-stone px-4 py-3 text-text",
  assistant: "mr-auto max-w-[85%] rounded-[20px] rounded-bl-md border border-border bg-surface px-4 py-3 text-text",
  staff: "ml-auto max-w-[85%] rounded-[20px] rounded-br-md bg-primary px-4 py-3 text-on-primary",
};

function TicketDetail({
  detail,
  pending,
  actionError,
  announcement,
  headingRef,
  onRequestStatus,
  onReplied,
  onRetry,
}: {
  detail: DetailState;
  pending: boolean;
  actionError: string | null;
  announcement: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onRequestStatus: (target: TicketStatus) => void;
  onReplied: (ticketId: string) => Promise<void>;
  onRetry: () => void;
}) {
  const logEndRef = useRef<HTMLDivElement>(null);
  const transcriptLength = detail.status === "ready" ? detail.ticket.transcript.length : 0;
  useEffect(() => {
    logEndRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [transcriptLength]);

  if (detail.status === "idle") {
    return (
      <p className="rounded-card border border-border bg-surface p-6 font-display text-[22px] leading-snug text-muted">
        Pilih tiket di antrean untuk membaca percakapan dan membalas.
      </p>
    );
  }
  if (detail.status === "loading") {
    return <p role="status" className="text-muted">Memuat detail tiket…</p>;
  }
  if (detail.status === "error") {
    if (detail.error.kind === "not_found") {
      return <p role="alert" className="rounded-card border border-border bg-surface p-5 text-text">{TICKET_NOT_FOUND_MESSAGE}</p>;
    }
    return <ApiErrorNotice error={detail.error} onRetry={onRetry} />;
  }

  const ticket = detail.ticket;
  return (
    <article aria-labelledby="ticket-detail-heading" className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_19rem] xl:items-start">
      <div className="flex min-w-0 flex-col overflow-hidden rounded-card border border-border bg-surface">
        <div className="border-b border-border px-5 py-4">
          <h2 id="ticket-detail-heading" ref={headingRef} tabIndex={-1} className="font-display text-[26px] font-medium leading-tight text-text outline-none">
            {ticket.reason}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {ticket.customer_alias ?? "Pelanggan"} · <span className="tabular">Tiket {ticket.id.slice(0, 8)}</span>
          </p>
        </div>
        <section aria-labelledby="transcript-heading" className="flex min-h-[20rem] flex-col">
          <h3 id="transcript-heading" className="sr-only">
            Percakapan
          </h3>
          <div className="max-h-[60vh] min-h-[16rem] flex-1 overflow-y-auto px-5 py-4 [scrollbar-width:thin]">
            {ticket.transcript.length === 0 ? (
              <p className="text-muted">Belum ada percakapan.</p>
            ) : (
              <ol aria-label="Percakapan" className="flex flex-col gap-3">
                {ticket.transcript.map((message, index) => (
                  <li key={`${message.created_at}-${index}`} data-role={message.role} className={BUBBLE[message.role] ?? BUBBLE.assistant}>
                    <p className="text-[12px] font-medium uppercase tracking-[0.08em]">
                      {roleLabel(message.role)}{" "}
                      <span className="font-normal normal-case tracking-normal opacity-80">{formatDateTime(message.created_at)}</span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words">{message.content}</p>
                  </li>
                ))}
              </ol>
            )}
            <div ref={logEndRef} />
          </div>
          <ReplyBox key={ticket.id} ticket={ticket} onReplied={onReplied} />
        </section>
      </div>

      <aside aria-label="Info tiket" className="flex min-w-0 flex-col gap-5 rounded-card border border-border bg-surface p-5">
        <dl className="grid grid-cols-2 gap-3 xl:grid-cols-1">
          <div>
            <dt className="text-sm text-muted">Status</dt>
            <dd className="mt-1 font-semibold text-text">{ticketStatusLabel(ticket.status)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Pelanggan</dt>
            <dd className="mt-1 text-text">{ticket.customer_alias ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Dibuat</dt>
            <dd className="mt-1 text-text">{formatDateTime(ticket.created_at)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Diperbarui</dt>
            <dd className="mt-1 text-text">{formatDateTime(ticket.updated_at)}</dd>
          </div>
          <div className="col-span-2 xl:col-span-1">
            <dt className="text-sm text-muted">Ringkasan</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words text-text">{ticket.summary}</dd>
          </div>
          <div className="col-span-2 xl:col-span-1">
            <dt className="text-sm text-muted">ID tiket</dt>
            <dd className="mt-1 break-all text-sm text-text">{ticket.id}</dd>
          </div>
        </dl>

        <div className="flex flex-col gap-2">
          <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Ubah status</p>
          <div role="group" aria-label="Ubah status tiket" className="flex flex-wrap gap-2">
            {(Object.keys(STATUS_ACTION_LABELS) as TicketStatus[])
              .filter((status) => status !== ticket.status)
              .map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={pending}
                  onClick={() => onRequestStatus(status)}
                  className="min-h-11 rounded-pill border border-text bg-surface px-4 text-[15px] text-text transition-colors duration-200 hover:bg-primary hover:text-on-primary disabled:opacity-60"
                >
                  {STATUS_ACTION_LABELS[status]}
                </button>
              ))}
          </div>
          {pending ? <p role="status" className="text-sm text-muted">Menyimpan perubahan…</p> : null}
          {actionError ? (
            <p role="alert" className="text-accent-ink">
              {actionError}
            </p>
          ) : null}
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </div>

        <section aria-labelledby="audit-heading" className="flex flex-col gap-3">
          <h3 id="audit-heading" className="font-display text-[20px] font-medium text-text">
            Riwayat audit
          </h3>
          {ticket.audit.length === 0 ? (
            <p className="text-muted">Belum ada catatan audit.</p>
          ) : (
            <ol aria-label="Riwayat audit" className="flex flex-col border-l border-rule pl-4">
              {ticket.audit.map((event, index) => (
                <li
                  key={`${event.created_at}-${index}`}
                  className="relative py-1.5 text-sm text-text before:absolute before:-left-[1.3rem] before:top-3 before:h-2 before:w-2 before:rounded-full before:bg-text"
                >
                  <span className="break-words">{auditActionLabel(event.action)}</span>{" "}
                  <span className="text-muted">{formatDateTime(event.created_at)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </aside>
    </article>
  );
}
