import Link from "next/link";
import type { Evidence, TurnEnvelope } from "@/lib/chat-api";
import type { Order, Ticket } from "@/lib/api";
import { formatDateTime, formatIdr } from "@/lib/format";
import { orderStatusLabel, ticketStatusLabel } from "@/lib/labels";

const NEXT_ACTION_NOTES: Partial<Record<TurnEnvelope["next_action"], string>> = {
  clarify: "Asisten perlu informasi tambahan.",
  abstain: "Asisten belum menemukan sumber yang cukup untuk menjawab ini.",
  offer_escalation: "Jika belum terbantu, Anda bisa menghubungi staf dengan tombol Hubungi staf.",
};

/**
 * One assistant reply. Every string comes from the server and is rendered as text
 * (React escapes it); nothing here uses raw HTML. Citations open the source drawer.
 */
export function AssistantMessage({
  envelope,
  onOpenSource,
}: {
  envelope: TurnEnvelope;
  onOpenSource: (evidence: Evidence) => void;
}) {
  const note = NEXT_ACTION_NOTES[envelope.next_action];
  return (
    <div className="flex flex-col gap-3">
      <p className="whitespace-pre-wrap break-words">{envelope.answer}</p>

      {note ? <p className="text-sm text-muted">{note}</p> : null}

      {envelope.citations.length > 0 ? (
        <div>
          <p className="text-sm font-semibold text-text">Sumber</p>
          <ul aria-label="Sumber kutipan" className="mt-2 flex flex-col gap-2">
            {envelope.citations.map((evidence) => (
              <li key={evidence.chunk_id}>
                <button
                  type="button"
                  onClick={() => onOpenSource(evidence)}
                  className="min-h-11 w-full rounded-card border border-border bg-surface px-3 text-left text-text hover:bg-background"
                >
                  {evidence.title} · {evidence.section}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {envelope.order ? <OrderCard order={envelope.order} /> : null}
      {envelope.ticket ? <TicketCard ticket={envelope.ticket} /> : null}
    </div>
  );
}

function OrderCard({ order }: { order: Order }) {
  return (
    <section
      aria-labelledby={`order-${order.order_number}`}
      className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3"
    >
      <h3 id={`order-${order.order_number}`} className="font-semibold text-text">
        Pesanan {order.order_number}
      </h3>
      <p className="text-sm text-text">Status: {orderStatusLabel(order.status)}</p>
      {order.eta_text ? <p className="text-sm text-text">Perkiraan: {order.eta_text}</p> : null}
      {order.tracking_code ? <p className="text-sm text-text">Nomor lacak: {order.tracking_code}</p> : null}
      <ul className="flex flex-col gap-1 text-sm text-text">
        {order.items.map((item, index) => (
          <li key={`${item.product_name}-${item.size_eu}-${index}`}>
            {item.product_name}, EU {item.size_eu}, {item.quantity} pasang, {formatIdr(item.unit_price_idr)} per pasang
          </li>
        ))}
      </ul>
      <Link
        href={`/pesanan/${order.order_number}`}
        className="inline-flex min-h-11 items-center text-primary underline"
      >
        Lihat detail pesanan {order.order_number}
      </Link>
    </section>
  );
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  return (
    <section
      aria-labelledby={`ticket-${ticket.id}`}
      className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3"
    >
      <h3 id={`ticket-${ticket.id}`} className="font-semibold text-text">
        Permintaan dikirim ke staf
      </h3>
      <p className="text-sm text-text break-all">Nomor tiket: {ticket.id}</p>
      <p className="text-sm text-text">Status: {ticketStatusLabel(ticket.status)}</p>
      <p className="text-sm text-muted">Dibuat {formatDateTime(ticket.created_at)}</p>
    </section>
  );
}
