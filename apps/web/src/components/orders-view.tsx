"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { ApiErrorNotice, NOT_CONFIGURED_MESSAGE, SignedOutNotice } from "@/components/account-states";
import { SiteFrame } from "@/components/site-frame";
import { listOrders, toApiError } from "@/lib/api";
import type { ApiError, Order } from "@/lib/api";
import type { AppMode } from "@/lib/config";
import { formatDateTime } from "@/lib/format";
import { orderStatusLabel } from "@/lib/labels";
import { currentAccessToken } from "@/lib/supabase";

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; items: Order[] };

export function OrdersView({ mode }: { mode: AppMode }) {
  return (
    <SiteFrame mode={mode} current="pesanan">
      <section aria-labelledby="orders-heading" className="flex flex-col gap-6">
        <div>
          <h1 id="orders-heading" className="font-display text-[clamp(40px,6vw,72px)] font-bold uppercase leading-[0.86] text-text">
            Pesanan Saya
          </h1>
          <p className="mt-2 text-muted">Pesanan pada akun yang sedang masuk.</p>
        </div>
        <OrdersList />
      </section>
    </SiteFrame>
  );
}

/** Own orders for the signed-in customer. Each row links to the order detail page. */
function OrdersList() {
  const auth = useAuth();
  const signedIn = auth.sessionStatus === "signed_in";
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Bumping `attempt` re-runs the request; "Coba lagi" uses it.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    void (async () => {
      try {
        const token = await currentAccessToken();
        if (token === null) throw new Error("no session");
        const page = await listOrders(token);
        if (active) setState({ status: "ready", items: page.items });
      } catch (error: unknown) {
        if (active) setState({ status: "error", error: toApiError(error) });
      }
    })();
    return () => {
      active = false;
    };
  }, [signedIn, attempt]);

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
    return <SignedOutNotice message="Masuk untuk melihat pesanan Anda." />;
  }
  if (state.status === "loading") {
    return <p role="status" className="text-muted">Memuat pesanan…</p>;
  }
  if (state.status === "error") {
    return <ApiErrorNotice error={state.error} onRetry={retry} />;
  }
  if (state.items.length === 0) {
    return <p className="rounded-card border border-border bg-surface p-5 text-text">Belum ada pesanan pada akun ini.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {state.items.map((order) => (
        <li key={order.order_number} className="min-w-0">
          <Link
            href={`/pesanan/${encodeURIComponent(order.order_number)}`}
            className="flex min-h-11 flex-col gap-1 rounded-card border border-border bg-surface p-5 hover:bg-background"
          >
            <span className="text-lg font-semibold text-text break-all">Pesanan {order.order_number}</span>
            <span className="text-sm text-text">Status: {orderStatusLabel(order.status)}</span>
            <span className="text-sm text-muted">Diperbarui {formatDateTime(order.updated_at)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
