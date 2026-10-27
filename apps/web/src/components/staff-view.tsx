"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { RefObject } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  ApiErrorNotice,
  NOT_CONFIGURED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  SignedOutNotice,
} from "@/components/account-states";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SiteFrame } from "@/components/site-frame";
import {
  ApiError,
  getStaffTicket,
  listStaffTickets,
  toApiError,
  updateStaffTicketStatus,
} from "@/lib/api";
import type { StaffTicketDetail, StaffTicketSummary, TicketStatus } from "@/lib/api";
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

export const STAFF_ONLY_MESSAGE = "Halaman ini khusus staf.";
export const STATUS_UPDATE_FAILED_MESSAGE = "Status belum berubah. Coba lagi.";
export const TICKET_NOT_FOUND_MESSAGE = "Tiket tidak ditemukan.";

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

/** Staff gate. Only /me with at least one staff store unlocks the dashboard. */
export function StaffView({ mode }: { mode: AppMode }) {
  return (
    <SiteFrame mode={mode} current="staf">
      <section aria-labelledby="staff-heading" className="flex flex-col gap-6">
        <div>
          <h1 id="staff-heading" className="text-2xl font-semibold text-text">
            Staf
          </h1>
          <p className="mt-2 text-muted">Tiket eskalasi dari pelanggan. Data demo, fiktif.</p>
        </div>
        <StaffGate />
      </section>
    </SiteFrame>
  );
}

function StaffGate() {
  const auth = useAuth();

  if (auth.sessionStatus === "loading") {
    return <p role="status" className="text-muted">Memuat…</p>;
  }
  if (auth.sessionStatus === "not_configured") {
    return <p role="status" className="rounded-card border border-border bg-surface p-4 text-text">{NOT_CONFIGURED_MESSAGE}</p>;
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
    return <p className="rounded-card border border-border bg-surface p-4 text-text">{STAFF_ONLY_MESSAGE}</p>;
  }
  return <StaffDashboard />;
}

/**
 * Ticket list with status filters, a detail panel with transcript and audit,
 * and status buttons. Status changes wait for the server: every status button is
 * disabled while a PATCH is in flight. Setting "resolved" needs confirmation.
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
    return () => {
      active = false;
    };
  }, [filter, listAttempt]);

  useEffect(() => {
    if (selectedId === null) return;
    let active = true;
    void loadDetail(selectedId).then((next) => {
      if (active) setDetail(next);
    });
    return () => {
      active = false;
    };
  }, [selectedId]);

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
      const [nextDetail, nextList] = await Promise.all([loadDetail(ticketId), loadList(filter)]);
      setDetail(nextDetail);
      setList(nextList);
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
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-start">
      <section aria-labelledby={listHeadingId} className="flex min-w-0 flex-col gap-4">
        <h2 id={listHeadingId} className="text-xl font-semibold text-text">
          Daftar tiket
        </h2>
        <div role="group" aria-label="Filter status" className="flex flex-wrap gap-2">
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
                    ? "min-h-11 rounded-card bg-primary px-4 font-semibold text-white"
                    : "min-h-11 rounded-card border border-border bg-surface px-4 text-text hover:bg-background"
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <TicketList list={list} selectedId={selectedId} onSelect={selectTicket} onRetry={retryList} />
      </section>

      <section aria-label="Detail tiket" className="flex min-w-0 flex-col gap-4">
        <TicketDetail
          detail={detail}
          pending={pending}
          actionError={actionError}
          announcement={announcement}
          headingRef={detailHeadingRef}
          onRequestStatus={requestStatus}
          onRetry={() => {
            if (selectedId !== null) selectTicket(selectedId);
          }}
        />
      </section>

      <ConfirmDialog
        open={confirmTarget === "resolved"}
        title="Tandai tiket sebagai selesai?"
        description="Tiket akan ditandai Selesai dan perubahan ini tercatat di riwayat audit atas nama Anda."
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
    return <p role="status" className="text-muted">Memuat tiket…</p>;
  }
  if (list.status === "error") {
    return <ApiErrorNotice error={list.error} onRetry={onRetry} />;
  }
  if (list.items.length === 0) {
    return <p className="rounded-card border border-border bg-surface p-4 text-text">Belum ada tiket untuk filter ini.</p>;
  }
  return (
    <ul aria-label="Tiket" className="flex flex-col gap-2">
      {list.items.map((ticket) => {
        const selected = ticket.id === selectedId;
        return (
          <li key={ticket.id} className="min-w-0">
            <button
              type="button"
              onClick={() => onSelect(ticket.id)}
              aria-current={selected ? "true" : undefined}
              className={
                selected
                  ? "flex min-h-11 w-full min-w-0 flex-col gap-1 rounded-card border-2 border-primary bg-surface p-3 text-left"
                  : "flex min-h-11 w-full min-w-0 flex-col gap-1 rounded-card border border-border bg-surface p-3 text-left hover:bg-background"
              }
            >
              <span className="font-semibold text-text break-words">{ticket.reason}</span>
              <span className="text-sm text-text">
                {ticketStatusLabel(ticket.status)}
                {ticket.customer_alias ? ` · ${ticket.customer_alias}` : ""}
              </span>
              <span className="text-sm text-muted">{formatDateTime(ticket.created_at)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function TicketDetail({
  detail,
  pending,
  actionError,
  announcement,
  headingRef,
  onRequestStatus,
  onRetry,
}: {
  detail: DetailState;
  pending: boolean;
  actionError: string | null;
  announcement: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onRequestStatus: (target: TicketStatus) => void;
  onRetry: () => void;
}) {
  if (detail.status === "idle") {
    return <p className="rounded-card border border-border bg-surface p-4 text-text">Pilih tiket untuk melihat detail.</p>;
  }
  if (detail.status === "loading") {
    return <p role="status" className="text-muted">Memuat detail tiket…</p>;
  }
  if (detail.status === "error") {
    if (detail.error.kind === "not_found") {
      return <p role="alert" className="rounded-card border border-border bg-surface p-4 text-text">{TICKET_NOT_FOUND_MESSAGE}</p>;
    }
    return <ApiErrorNotice error={detail.error} onRetry={onRetry} />;
  }

  const ticket = detail.ticket;
  return (
    <article aria-labelledby="ticket-detail-heading" className="flex min-w-0 flex-col gap-5 rounded-card border border-border bg-surface p-4 md:p-6">
      <div>
        <h2 id="ticket-detail-heading" ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-text outline-none">
          {ticket.reason}
        </h2>
        <p className="mt-1 break-all text-sm text-muted">ID tiket: {ticket.id}</p>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        <div className="sm:col-span-2">
          <dt className="text-sm text-muted">Ringkasan</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-text">{ticket.summary}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">Ubah status</p>
        <div role="group" aria-label="Ubah status tiket" className="flex flex-wrap gap-2">
          {(Object.keys(STATUS_ACTION_LABELS) as TicketStatus[])
            .filter((status) => status !== ticket.status)
            .map((status) => (
              <button
                key={status}
                type="button"
                disabled={pending}
                onClick={() => onRequestStatus(status)}
                className="min-h-11 rounded-card border border-border bg-background px-4 text-text hover:bg-surface disabled:opacity-60"
              >
                {STATUS_ACTION_LABELS[status]}
              </button>
            ))}
        </div>
        {pending ? <p role="status" className="text-sm text-muted">Menyimpan perubahan…</p> : null}
        {actionError ? (
          <p role="alert" className="text-text">
            {actionError}
          </p>
        ) : null}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>

      <section aria-labelledby="transcript-heading" className="flex flex-col gap-3">
        <h3 id="transcript-heading" className="text-lg font-semibold text-text">
          Percakapan
        </h3>
        {ticket.transcript.length === 0 ? (
          <p className="text-muted">Belum ada percakapan.</p>
        ) : (
          <ol aria-label="Percakapan" className="flex flex-col gap-2">
            {ticket.transcript.map((message, index) => (
              <li key={`${message.created_at}-${index}`} className="rounded-card border border-border bg-background p-3">
                <p className="text-sm font-semibold text-text">
                  {roleLabel(message.role)} <span className="font-normal text-muted">{formatDateTime(message.created_at)}</span>
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-text">{message.content}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="audit-heading" className="flex flex-col gap-3">
        <h3 id="audit-heading" className="text-lg font-semibold text-text">
          Riwayat audit
        </h3>
        {ticket.audit.length === 0 ? (
          <p className="text-muted">Belum ada catatan audit.</p>
        ) : (
          <ol aria-label="Riwayat audit" className="flex flex-col gap-2">
            {ticket.audit.map((event, index) => (
              <li key={`${event.created_at}-${index}`} className="text-sm text-text">
                <span className="break-words">{auditActionLabel(event.action)}</span>{" "}
                <span className="text-muted">{formatDateTime(event.created_at)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
