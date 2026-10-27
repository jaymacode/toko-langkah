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
          <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Sumber</p>
          <ul aria-label="Sumber kutipan" className="mt-2 flex flex-wrap gap-2">
            {envelope.citations.map((evidence) => (
              <li key={evidence.chunk_id}>
                <button
                  type="button"
                  onClick={() => onOpenSource(evidence)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-rule bg-surface px-4 text-left text-[14px] text-text transition-colors duration-200 hover:border-text"
                >
                  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <path d="M4 1.75h5.5L12.5 4.75v9.5H4z" strokeLinejoin="round" />
                    <path d="M9.25 1.75v3.25h3.25M6 8.25h4.5M6 10.75h4.5" strokeLinecap="round" />
                  </svg>
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
      className="flex flex-col gap-2 border-t border-rule pt-3"
    >
      <h3 id={`order-${order.order_number}`} className="font-display text-[20px] font-medium text-text">
        Pesanan {order.order_number}
      </h3>
      <p className="text-sm text-text">Status: {orderStatusLabel(order.status)}</p>
      {order.eta_text ? <p className="text-sm text-text">Perkiraan: {order.eta_text}</p> : null}
      {order.tracking_code ? <p className="text-sm text-text">Nomor lacak: {order.tracking_code}</p> : null}
      <ul className="tabular flex flex-col gap-1 text-sm text-text">
        {order.items.map((item, index) => (
          <li key={`${item.product_name}-${item.size_eu}-${index}`}>
            {item.product_name}, EU {item.size_eu}, {item.quantity} pasang, {formatIdr(item.unit_price_idr)} per pasang
          </li>
        ))}
      </ul>
      <Link
        href={`/pesanan/${order.order_number}`}
        className="inline-flex min-h-11 items-center self-start rounded-pill bg-primary px-4 text-[14px] font-medium text-on-primary transition-opacity duration-200 hover:opacity-85"
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
      className="flex flex-col gap-1.5 border-t border-rule pt-3"
    >
      <h3 id={`ticket-${ticket.id}`} className="font-display text-[20px] font-medium text-text">
        Permintaan dikirim ke staf
      </h3>
      <p className="tabular text-sm text-text break-all">Nomor tiket: {ticket.id}</p>
      <p className="text-sm text-text">Status: {ticketStatusLabel(ticket.status)}</p>
      <p className="text-sm text-muted">Dibuat {formatDateTime(ticket.created_at)}</p>
    </section>
  );
}
