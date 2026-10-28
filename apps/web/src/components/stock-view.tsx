"use client";

import Image from "next/image";
import { useEffect, useId, useState } from "react";
import { ApiErrorNotice, SESSION_EXPIRED_MESSAGE } from "@/components/account-states";
import { MinusIcon, PlusIcon } from "@/components/icons";
import { StaffFrame } from "@/components/staff-frame";
import { StaffGate } from "@/components/staff-view";
import { ApiError, STOCK_MAX, getInventory, toApiError, updateVariantStock } from "@/lib/api";
import type { InventoryProduct, InventoryVariant } from "@/lib/api";
import type { AppMode } from "@/lib/config";
import { formatIdr } from "@/lib/format";
import { currentAccessToken } from "@/lib/supabase";

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; items: InventoryProduct[] };

export const STOCK_INVALID_MESSAGE = `Isi angka bulat 0 sampai ${STOCK_MAX.toLocaleString("id-ID")}.`;
export const STOCK_SAVED_MESSAGE = "Stok tersimpan.";
export const STOCK_SAVE_FAILED_MESSAGE = "Sebagian stok belum tersimpan. Periksa lalu coba simpan lagi.";

async function loadInventory(): Promise<LoadState> {
  try {
    const token = await currentAccessToken();
    if (token === null) throw new ApiError("unauthorized", "No session.", 401);
    return { status: "ready", items: await getInventory(token) };
  } catch (error: unknown) {
    return { status: "error", error: toApiError(error) };
  }
}

/** A draft value is valid when it is a whole number in range. */
function parseStock(raw: string): number | null {
  if (!/^\d{1,6}$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return value <= STOCK_MAX ? value : null;
}

/** Stock management for store staff: every size of every shoe, edited per product, audited. */
export function StockView({ mode }: { mode: AppMode }) {
  return (
    <StaffFrame mode={mode} current="stok">
      <section aria-labelledby="stock-heading" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
          <h1 id="stock-heading" className="font-display text-[clamp(36px,4.4vw,56px)] font-bold uppercase leading-[0.88] text-text">
            Stok <span className="text-quiet">per ukuran</span>
          </h1>
          <p className="max-w-[60ch] text-[15px] text-muted">
            Ukuran dengan stok 0 tampil &ldquo;habis&rdquo; di toko dan tidak pernah direkomendasikan asisten. Setiap perubahan
            tercatat di audit atas nama Anda.
          </p>
        </div>
        <StaffGate>
          <StockManager />
        </StaffGate>
      </section>
    </StaffFrame>
  );
}

export function StockManager() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [onlySoldOut, setOnlySoldOut] = useState(false);
  const searchId = useId();

  useEffect(() => {
    let active = true;
    void loadInventory().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [attempt]);

  if (state.status === "loading") {
    return <p role="status" className="text-muted">Memuat stok…</p>;
  }
  if (state.status === "error") {
    return (
      <ApiErrorNotice
        error={state.error}
        onRetry={() => {
          setState({ status: "loading" });
          setAttempt((current) => current + 1);
        }}
      />
    );
  }

  const needle = query.trim().toLocaleLowerCase("id");
  const shown = state.items.filter(
    (item) =>
      (needle === "" || item.name.toLocaleLowerCase("id").includes(needle)) &&
      (!onlySoldOut || item.variants.some((variant) => variant.stock === 0)),
  );
  const pairs = state.items.reduce((sum, item) => sum + item.variants.reduce((s, v) => s + v.stock, 0), 0);
  const soldOut = state.items.reduce((sum, item) => sum + item.variants.filter((v) => v.stock === 0).length, 0);
  const sizes = state.items.reduce((sum, item) => sum + item.variants.length, 0);

  function replaceProduct(next: InventoryProduct) {
    setState((current) =>
      current.status === "ready"
        ? { status: "ready", items: current.items.map((item) => (item.slug === next.slug ? next : item)) }
        : current,
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-card border border-border bg-surface p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={searchId} className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">
              Cari sepatu
            </label>
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-h-11 w-56 rounded-pill border border-quiet bg-surface px-4 text-text hover:border-text focus:border-text"
            />
          </div>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-pill border border-rule px-4 text-[15px] text-text has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-text">
            <input type="checkbox" checked={onlySoldOut} onChange={(event) => setOnlySoldOut(event.target.checked)} className="sr-only" />
            Ada ukuran habis
          </label>
        </div>
        <dl className="tabular flex gap-6 text-sm">
          <div>
            <dt className="text-muted">Total pasang</dt>
            <dd className="text-[20px] font-semibold text-text">{pairs.toLocaleString("id-ID")}</dd>
          </div>
          <div>
            <dt className="text-muted">Ukuran habis</dt>
            <dd className="text-[20px] font-semibold text-text">
              {soldOut} <span className="text-sm font-normal text-muted">dari {sizes}</span>
            </dd>
          </div>
        </dl>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-card border border-border bg-surface p-5 text-text">Tidak ada sepatu yang cocok.</p>
      ) : (
        <ul aria-label="Stok sepatu" className="flex flex-col gap-4">
          {shown.map((item) => (
            <li key={item.slug}>
              <ProductStock product={item} onSaved={replaceProduct} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Notice = { kind: "ok" | "error"; text: string } | null;

function ProductStock({ product, onSaved }: { product: InventoryProduct; onSaved: (next: InventoryProduct) => void }) {
  const headingId = useId();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [conflicts, setConflicts] = useState<Record<string, number>>({});

  const changed = product.variants.filter((v) => drafts[v.id] !== undefined && drafts[v.id] !== String(v.stock));
  const invalid = changed.filter((v) => parseStock(drafts[v.id] ?? "") === null);
  const total = product.variants.reduce((sum, v) => sum + v.stock, 0);

  function setDraft(variant: InventoryVariant, raw: string) {
    setNotice(null);
    setDrafts((current) => ({ ...current, [variant.id]: raw }));
  }

  function step(variant: InventoryVariant, delta: number) {
    const base = parseStock(drafts[variant.id] ?? String(variant.stock)) ?? variant.stock;
    setDraft(variant, String(Math.min(STOCK_MAX, Math.max(0, base + delta))));
  }

  async function save() {
    if (saving || changed.length === 0 || invalid.length > 0) return;
    setSaving(true);
    setNotice(null);
    setConflicts({});
    const token = await currentAccessToken();
    if (token === null) {
      setNotice({ kind: "error", text: SESSION_EXPIRED_MESSAGE });
      setSaving(false);
      return;
    }
    const updated = new Map(product.variants.map((v) => [v.id, v]));
    const nextConflicts: Record<string, number> = {};
    const settled = new Set<string>(); // saved, or superseded by another staff change
    let failed = false;
    for (const variant of changed) {
      const value = parseStock(drafts[variant.id] ?? "");
      if (value === null) continue;
      try {
        updated.set(variant.id, await updateVariantStock(variant.id, value, variant.stock, token));
        settled.add(variant.id);
      } catch (error: unknown) {
        failed = true;
        if (toApiError(error).status === 409) {
          nextConflicts[variant.id] = variant.size_eu;
          settled.add(variant.id);
        }
      }
    }
    // Reload the server's numbers so a conflict shows the value another staff member saved.
    const fresh = await loadInventory();
    const freshProduct = fresh.status === "ready" ? fresh.items.find((item) => item.slug === product.slug) : undefined;
    onSaved(freshProduct ?? { ...product, variants: product.variants.map((v) => updated.get(v.id) ?? v) });
    // Saved and conflicting drafts give way to the server value; other failures keep the typed value.
    setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !settled.has(id))));
    setConflicts(nextConflicts);
    const conflictSizes = Object.values(nextConflicts);
    setNotice(
      failed
        ? {
            kind: "error",
            text:
              conflictSizes.length > 0
                ? `Stok ukuran ${conflictSizes.join(", ")} sudah diubah staf lain. Angka terbaru ditampilkan; periksa lalu simpan lagi.`
                : STOCK_SAVE_FAILED_MESSAGE,
          }
        : { kind: "ok", text: STOCK_SAVED_MESSAGE },
    );
    setSaving(false);
  }

  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-bay bg-stone">
          {product.image_path ? (
            <Image src={product.image_path} alt="" fill sizes="64px" className="object-contain" />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="font-display text-[22px] font-medium leading-tight text-text">
            {product.name}
          </h2>
          <p className="tabular text-sm text-muted">
            {product.color ? `${product.color} · ` : ""}
            {formatIdr(product.price_idr)} · {total.toLocaleString("id-ID")} pasang
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {changed.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setDrafts({});
                setNotice(null);
              }}
              disabled={saving}
              className="min-h-11 rounded-pill border border-rule px-4 text-[15px] text-text transition-colors duration-200 hover:border-text disabled:opacity-60"
            >
              Batal
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || changed.length === 0 || invalid.length > 0}
            className="min-h-11 rounded-pill bg-primary px-5 text-[15px] font-medium text-on-primary transition-opacity duration-200 hover:opacity-85 disabled:opacity-40"
          >
            {saving ? "Menyimpan…" : changed.length > 0 ? `Simpan ${changed.length} perubahan` : "Simpan"}
          </button>
        </div>
      </div>

      <fieldset>
        <legend className="sr-only">Stok {product.name} per ukuran EU</legend>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-11">
          {product.variants.map((variant) => {
            const raw = drafts[variant.id] ?? String(variant.stock);
            const value = parseStock(raw);
            const dirty = drafts[variant.id] !== undefined && raw !== String(variant.stock);
            const bad = dirty && value === null;
            const zero = value === 0;
            const inputId = `stok-${variant.id}`;
            return (
              <li
                key={variant.id}
                data-size={variant.size_eu}
                className={`flex flex-col gap-1.5 rounded-bay border p-2 ${
                  bad ? "border-accent" : dirty ? "border-text" : "border-border"
                } ${zero ? "bg-stone" : "bg-surface"}`}
              >
                <label htmlFor={inputId} className="flex items-baseline justify-between text-sm text-text">
                  <span className="tabular font-semibold">EU {variant.size_eu}</span>
                  {zero ? <span className="text-[11px] font-semibold uppercase tracking-wide text-accent-ink">habis</span> : null}
                  <span className="sr-only">, stok</span>
                </label>
                <input
                  id={inputId}
                  inputMode="numeric"
                  value={raw}
                  onChange={(event) => setDraft(variant, event.target.value)}
                  aria-invalid={bad || undefined}
                  disabled={saving}
                  className="tabular min-h-11 w-full min-w-0 rounded-bay border border-quiet bg-surface px-2 text-center text-[17px] font-semibold text-text focus:border-text"
                />
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-label={`Kurangi stok EU ${variant.size_eu}`}
                    onClick={() => step(variant, -1)}
                    disabled={saving || (value ?? 0) <= 0}
                    className="inline-flex h-11 flex-1 items-center justify-center rounded-pill border border-rule bg-surface text-text hover:border-text disabled:opacity-30"
                  >
                    <MinusIcon />
                  </button>
                  <button
                    type="button"
                    aria-label={`Tambah stok EU ${variant.size_eu}`}
                    onClick={() => step(variant, 1)}
                    disabled={saving}
                    className="inline-flex h-11 flex-1 items-center justify-center rounded-pill border border-rule bg-surface text-text hover:border-text disabled:opacity-30"
                  >
                    <PlusIcon />
                  </button>
                </div>
                {conflicts[variant.id] !== undefined ? (
                  <p className="text-[12px] text-accent-ink">Diubah staf lain</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div aria-live="polite">
        {invalid.length > 0 ? (
          <p className="flex items-center gap-2 text-sm text-accent-ink">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
            {STOCK_INVALID_MESSAGE}
          </p>
        ) : notice ? (
          <p className={`flex items-center gap-2 text-sm ${notice.kind === "error" ? "text-accent-ink" : "text-text"}`}>
            {notice.kind === "error" ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
            {notice.text}
          </p>
        ) : null}
      </div>
    </article>
  );
}
