"use client";

import Link from "next/link";
import { useState } from "react";
import { ChatShell } from "@/components/chat-shell";
import { ProductHitList } from "@/components/product-hit-list";
import { ProductList } from "@/components/product-list";
import { SiteFrame, DEMO_LABEL } from "@/components/site-frame";
import type { ProductHit } from "@/lib/chat-api";
import type { AppMode } from "@/lib/config";

export { DEMO_LABEL };

/**
 * Customer assistant layout: chat on the left, contextual panel on the right. The
 * panel shows featured products until the assistant returns a product search; on
 * narrow screens it stacks directly below the chat, so results sit under the answer.
 */
export function HomeView({ mode }: { mode: AppMode }) {
  const [results, setResults] = useState<ProductHit[] | null>(null);

  return (
    <SiteFrame mode={mode} current="asisten">
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:items-start lg:grid-cols-[5fr_7fr] lg:gap-10">
        <ChatShell onResults={setResults} />
        <aside aria-labelledby="panel-heading" className="flex min-w-0 flex-col gap-4">
          {results === null ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="panel-heading" className="text-xl font-semibold text-text">
                  Produk untuk dilihat
                </h2>
                <Link href="/produk" className="inline-flex min-h-11 items-center text-primary underline">
                  Lihat semua produk
                </Link>
              </div>
              <ProductList limit={4} emptyText="Belum ada produk untuk ditampilkan." />
            </>
          ) : (
            <>
              <h2 id="panel-heading" className="text-xl font-semibold text-text">
                Produk yang cocok
              </h2>
              {results.length === 0 ? (
                <p className="rounded-card border border-border bg-surface p-4 text-text">
                  Tidak ada produk yang cocok dengan filter aktif.
                </p>
              ) : (
                <ProductHitList items={results} />
              )}
            </>
          )}
        </aside>
      </div>
    </SiteFrame>
  );
}
