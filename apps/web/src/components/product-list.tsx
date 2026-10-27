"use client";

import { useEffect, useState } from "react";
import { ProductCard } from "@/components/product-card";
import { listProducts, toApiError } from "@/lib/api";
import type { ApiError, Product } from "@/lib/api";

export const UNAVAILABLE_MESSAGE = "Katalog sedang tidak tersedia. Coba lagi.";
export const RATE_LIMITED_MESSAGE = "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.";

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; items: Product[]; total: number };

const PAGE_SIZE = 12;

function messageFor(error: ApiError): string {
  return error.kind === "rate_limited" ? RATE_LIMITED_MESSAGE : UNAVAILABLE_MESSAGE;
}

function SkeletonGrid() {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 gap-4 @md:grid-cols-2 @3xl:grid-cols-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="animate-pulse rounded-card border border-border bg-surface p-1.5">
          <div className="aspect-square w-full rounded-bay bg-stone" />
          <div className="space-y-3 px-3 pb-3 pt-4">
            <div className="h-6 w-2/3 rounded-pill bg-stone" />
            <div className="h-4 w-1/3 rounded-pill bg-stone" />
            <div className="h-11 w-full rounded-pill bg-stone" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Client-side product list with explicit loading, empty, unavailable and
 * rate-limited states. `limit` caps the list for the contextual panel; when it
 * is omitted the list pages through the whole catalogue with "Muat lebih banyak".
 */
export function ProductList({
  limit,
  emptyText = "Belum ada produk",
  headingLevel = 3,
}: {
  limit?: number;
  emptyText?: string;
  headingLevel?: 2 | 3;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  // Bumping `attempt` re-runs the first-page request; "Coba lagi" uses it.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    listProducts({ limit: limit ?? PAGE_SIZE, offset: 0 })
      .then((page) => {
        if (active) setState({ status: "ready", items: page.items, total: page.total });
      })
      .catch((error: unknown) => {
        if (active) setState({ status: "error", error: toApiError(error) });
      });
    return () => {
      active = false;
    };
  }, [limit, attempt]);

  function retry() {
    setLoadMoreError(null);
    setState({ status: "loading" });
    setAttempt((current) => current + 1);
  }

  async function loadMore() {
    if (state.status !== "ready") return;
    const offset = state.items.length;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await listProducts({ limit: PAGE_SIZE, offset });
      setState((current) =>
        current.status === "ready"
          ? { status: "ready", items: [...current.items, ...page.items], total: page.total }
          : current,
      );
    } catch (error: unknown) {
      // Keep the products already shown; only the extra page failed.
      setLoadMoreError(messageFor(toApiError(error)));
    } finally {
      setLoadingMore(false);
    }
  }

  function renderState() {
    if (state.status === "loading") {
      return (
        <div role="status" aria-label="Memuat produk">
          <p className="sr-only">Memuat produk…</p>
          <SkeletonGrid />
        </div>
      );
    }

    if (state.status === "error") {
      return (
        <div className="flex flex-col items-start gap-4 rounded-card border border-border bg-surface p-6">
          <p role="alert" className="font-display text-[22px] leading-snug text-text">
            {messageFor(state.error)}
          </p>
          <button
            type="button"
            onClick={retry}
            className="min-h-11 rounded-pill bg-primary px-5 font-medium text-on-primary transition-opacity duration-200 hover:opacity-85"
          >
            Coba lagi
          </button>
        </div>
      );
    }

    if (state.items.length === 0) {
      return <p className="rounded-card border border-border bg-surface p-6 font-display text-[22px] text-text">{emptyText}</p>;
    }

    const canLoadMore = limit === undefined && state.items.length < state.total;

    return (
      <div className="space-y-6">
        <ul className="grid grid-cols-1 gap-4 @md:grid-cols-2 @3xl:grid-cols-3">
          {state.items.map((product, index) => (
            <li key={product.id} className="min-w-0">
              <ProductCard product={product} headingLevel={headingLevel} eager={index < 3} />
            </li>
          ))}
        </ul>
        {canLoadMore ? (
          <div className="flex flex-col items-start gap-2">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="min-h-11 rounded-pill border border-text bg-surface px-5 text-text transition-colors duration-200 hover:bg-stone disabled:opacity-60"
            >
              {loadingMore ? "Memuat…" : "Muat lebih banyak"}
            </button>
            <p className="text-sm text-muted">
              Menampilkan {state.items.length} dari {state.total} produk.
            </p>
            {loadMoreError ? (
              <p role="alert" className="text-sm text-text">
                {loadMoreError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return <div className="@container">{renderState()}</div>;
}
