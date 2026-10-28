"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { listProducts, toApiError } from "@/lib/api";
import type { ApiError, Product } from "@/lib/api";
import {
  addLine,
  getCartSnapshot,
  getServerCartSnapshot,
  removeLine,
  setQuantity,
  subscribeCart,
  writeCart,
} from "@/lib/cart";
import type { CartLine } from "@/lib/cart";

export const UNAVAILABLE_MESSAGE = "Katalog sedang tidak tersedia. Coba lagi.";
export const RATE_LIMITED_MESSAGE = "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.";

export function catalogueErrorMessage(error: ApiError): string {
  return error.kind === "rate_limited" ? RATE_LIMITED_MESSAGE : UNAVAILABLE_MESSAGE;
}

export type CatalogueState =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; items: Product[] };

const PAGE = 50;
const MAX_PAGES = 10;

/** The whole public catalogue (paged through), with an explicit retry. */
export function useCatalogue(): { state: CatalogueState; retry: () => void } {
  const [state, setState] = useState<CatalogueState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      const items: Product[] = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await listProducts({ limit: PAGE, offset: items.length });
        items.push(...result.items);
        if (result.items.length === 0 || items.length >= result.total) break;
      }
      return items;
    }
    load()
      .then((items) => {
        if (active) setState({ status: "ready", items });
      })
      .catch((error: unknown) => {
        if (active) setState({ status: "error", error: toApiError(error) });
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((current) => current + 1);
  }, []);

  return { state, retry };
}

/** The demo cart, shared by every component in this tab and synced across tabs. */
export function useCart() {
  const lines = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerCartSnapshot);
  return {
    lines,
    add: (slug: string, sizeEu: number) => writeCart(addLine(getCartSnapshot(), slug, sizeEu)),
    update: (line: CartLine, quantity: number) => writeCart(setQuantity(getCartSnapshot(), line, quantity)),
    remove: (line: CartLine) => writeCart(removeLine(getCartSnapshot(), line)),
  };
}
