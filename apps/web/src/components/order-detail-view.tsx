"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { ApiErrorNotice, NOT_CONFIGURED_MESSAGE, SignedOutNotice } from "@/components/account-states";
import { SiteFrame } from "@/components/site-frame";
import { getOrder, toApiError } from "@/lib/api";
import type { ApiError, Order } from "@/lib/api";
import type { AppMode } from "@/lib/config";
import { formatIdr } from "@/lib/format";
import { formatDateTime } from "@/lib/format";
import { orderStatusLabel } from "@/lib/labels";
import { currentAccessToken } from "@/lib/supabase";

/** Same text for "not yours" and "does not exist", so the page reveals nothing about other customers. */
export const ORDER_NOT_FOUND_MESSAGE = "Pesanan tidak ditemukan";

type LoadState =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; order: Order };

export function OrderDetailView({ mode, orderNumber }: { mode: AppMode; orderNumber: string }) {
  return (
    <SiteFrame mode={mode} current="pesanan">
      <OrderDetail orderNumber={orderNumber} />
    </SiteFrame>
  );
}

function OrderDetail({ orderNumber }: { orderNumber: string }) {
  const auth = useAuth();
  const signedIn = auth.sessionStatus === "signed_in";
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    void (async () => {
      try {
        const token = await currentAccessToken();
        if (token === null) throw new Error("no session");
        const order = await getOrder(orderNumber, token);
        if (active) setState({ status: "ready", order });
      } catch (error: unknown) {
        if (!active) return;
        const apiError = toApiError(error);
        setState(apiError.kind === "not_found" ? { status: "not_found" } : { status: "error", error: apiError });
      }
    })();
    return () => {
      active = false;
    };
  }, [signedIn, orderNumber, attempt]);

  function retry() {
    setState({ status: "loading" });
    setAttempt((current) => current + 1);
  }

  if (auth.sessionStatus === "loading") {
    return <p role="status" className="text-muted">Memuat…</p>;
  }
  if (auth.sessionStatus === "not_configured") {
    return <p role="status" className="rounded-card border border-border bg-surface p-5 text-text">{NOT_CONFIGURED_MESSAGE}</p>;
  }
  if (!signedIn) {
    return <SignedOutNotice message="Masuk untuk melihat detail pesanan." />;
  }
  if (state.status === "loading") {
    return <p role="status" className="text-muted">Memuat pesanan…</p>;
  }
  if (state.status === "not_found") {
    return (
      <section aria-labelledby="order-heading" className="flex flex-col gap-4">
        <h1 id="order-heading" className="font-display text-[clamp(40px,6vw,72px)] font-bold uppercase leading-[0.86] text-text">
          {ORDER_NOT_FOUND_MESSAGE}
        </h1>
        <Link href="/pesanan" className="inline-flex min-h-11 items-center text-text underline decoration-rule underline-offset-4 hover:decoration-text">
          Kembali ke daftar pesanan
        </Link>
      </section>
    );
  }
  if (state.status === "error") {
    return <ApiErrorNotice error={state.error} onRetry={retry} />;
  }

  const { order } = state;
  return (
    <article aria-labelledby="order-heading" className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/pesanan" className="inline-flex min-h-11 items-center text-text underline decoration-rule underline-offset-4 hover:decoration-text">
          Kembali ke daftar pesanan
        </Link>
        <h1 id="order-heading" className="font-display text-[clamp(40px,6vw,72px)] font-bold uppercase leading-[0.86] text-text break-all">
          Pesanan {order.order_number}
        </h1>
      </div>

      <dl className="grid grid-cols-1 gap-4 rounded-card border border-border bg-surface p-5 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted">Status</dt>
          <dd className="mt-1 font-semibold text-text">{orderStatusLabel(order.status)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Diperbarui</dt>
          <dd className="mt-1 text-text">{formatDateTime(order.updated_at)}</dd>
        </div>
        {order.tracking_code ? (
          <div>
            <dt className="text-sm text-muted">Kode pelacakan</dt>
            <dd className="mt-1 break-all text-text">{order.tracking_code}</dd>
          </div>
        ) : null}
        {order.eta_text ? (
          <div>
            <dt className="text-sm text-muted">Perkiraan</dt>
            <dd className="mt-1 text-text">{order.eta_text}</dd>
          </div>
        ) : null}
      </dl>

      <section aria-labelledby="order-items-heading" className="flex flex-col gap-3">
        <h2 id="order-items-heading" className="font-display text-[26px] font-medium leading-tight text-text">
          Barang
        </h2>
        <ul className="flex flex-col gap-3">
          {order.items.map((item, index) => (
            <li
              key={`${item.product_name}-${item.size_eu}-${index}`}
              className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-surface p-5"
            >
              <span className="font-semibold text-text break-words">{item.product_name}</span>
              <span className="text-sm text-muted">
                Ukuran EU {item.size_eu} · Jumlah {item.quantity}
              </span>
              <span className="text-text">Harga satuan {formatIdr(item.unit_price_idr)}</span>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
