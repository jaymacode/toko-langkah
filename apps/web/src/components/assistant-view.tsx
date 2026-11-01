"use client";

import Link from "next/link";
import { useState } from "react";
import { ChatShell } from "@/components/chat-shell";
import { ProductHitList } from "@/components/product-hit-list";
import { ProductList } from "@/components/product-list";
import { SiteFrame } from "@/components/site-frame";
import type { ProductHit } from "@/lib/chat-api";
import type { AppMode } from "@/lib/config";

/**
 * Customer assistant page (/asisten): chat on the left, contextual panel on the right. The
 * panel shows products until the assistant returns a product search; on narrow screens it
 * stacks directly below the chat, so results sit under the answer. `initialQuestion` comes
 * from ?tanya= (store pages link here with a question) and is only placed in the composer.
 */
export function AssistantView({ mode, initialQuestion = "" }: { mode: AppMode; initialQuestion?: string }) {
  const [results, setResults] = useState<ProductHit[] | null>(null);

  return (
    <SiteFrame mode={mode} current="asisten">
      <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:items-start lg:grid-cols-[5fr_7fr] lg:gap-12">
        <div className="min-w-0 lg:sticky lg:top-28">
          <ChatShell onResults={setResults} initialDraft={initialQuestion} />
        </div>
        <aside aria-labelledby="panel-heading" className="flex min-w-0 flex-col gap-4">
          {results === null ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                <h2 id="panel-heading" className="font-display text-[clamp(30px,3.4vw,44px)] font-bold uppercase leading-[0.9] text-text">
                  Produk untuk dilihat
                </h2>
                <Link
                  href="/produk"
                  className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-text px-4 text-[15px] text-text transition-colors duration-200 hover:bg-primary hover:text-on-primary"
                >
                  Lihat semua produk
                  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M4 12 12 4M5.5 4H12v6.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </div>
              <ProductList limit={4} emptyText="Belum ada produk untuk ditampilkan." />
            </>
          ) : (
            <>
              <h2 id="panel-heading" className="font-display text-[clamp(30px,3.4vw,44px)] font-bold uppercase leading-[0.9] text-text">
                Produk yang cocok
              </h2>
              {results.length === 0 ? (
                <p className="rounded-card border border-border bg-surface p-6 font-display text-[20px] text-text">
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
