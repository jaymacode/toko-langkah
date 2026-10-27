import type { TicketStatus } from "@/lib/api";

/**
 * Indonesian labels for order and ticket statuses. Unknown order statuses are
 * returned unchanged; React renders the string as text, so it is never parsed as HTML.
 * A Map keeps lookups off the prototype chain (no "constructor" surprises).
 */
const ORDER_STATUS_LABELS = new Map<string, string>([
  ["processing", "Diproses"],
  ["shipped", "Dikirim"],
  ["delivered", "Diterima"],
  ["cancelled", "Dibatalkan"],
]);

const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Terbuka",
  in_progress: "Ditangani",
  resolved: "Selesai",
};

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS.get(status) ?? status;
}

export function ticketStatusLabel(status: TicketStatus): string {
  return TICKET_STATUS_LABELS[status];
}

/** Audit actions are "ticket.status:<old>-><new>"; other actions are shown as recorded. */
export function auditActionLabel(action: string): string {
  const match = /^ticket\.status:(open|in_progress|resolved)->(open|in_progress|resolved)$/.exec(action);
  if (!match) return action;
  const from = match[1] as TicketStatus;
  const to = match[2] as TicketStatus;
  return `Status diubah dari ${ticketStatusLabel(from)} menjadi ${ticketStatusLabel(to)}`;
}

export function roleLabel(role: string): string {
  if (role === "user") return "Pelanggan";
  if (role === "assistant") return "Asisten";
  return role;
}
