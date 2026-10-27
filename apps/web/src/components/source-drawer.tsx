"use client";

import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
/** A policy excerpt to show. Static samples set isSample; retrieved evidence does not. */
export type DrawerSource = {
  isSample?: boolean;
  policyTitle: string;
  version: string;
  section: string;
  excerpt: string;
};

export type SourceDrawerProps = {
  open: boolean;
  onClose: () => void;
  source: DrawerSource;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog showing a policy source. Focus moves into the dialog on open,
 * Tab cycles inside it, Escape closes it, and focus returns to the element that
 * opened it.
 */
export function SourceDrawer({ open, onClose, source }: SourceDrawerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const container = dialogRef.current;
    if (!container) return;
    const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) {
      event.preventDefault();
      container.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === container)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-text/40 p-0 md:items-center md:p-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-drawer-title"
        aria-describedby="source-drawer-body"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex max-h-full w-full flex-col overflow-y-auto rounded-t-card bg-surface p-5 shadow-lg md:max-w-lg md:rounded-card md:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-muted">
              {source.isSample
                ? "Sumber contoh (statis, bukan data langsung)"
                : "Kutipan dari kebijakan toko yang berlaku"}
            </p>
            <h2 id="source-drawer-title" className="mt-1 text-xl font-semibold text-text">
              {source.policyTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 shrink-0 rounded-card border border-border px-3 text-text hover:bg-background"
          >
            Tutup
          </button>
        </div>

        <dl id="source-drawer-body" className="mt-5 grid gap-4 text-text">
          <div>
            <dt className="text-sm text-muted">Versi kebijakan</dt>
            <dd className="mt-1">{source.version}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Bagian</dt>
            <dd className="mt-1">{source.section}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Kutipan</dt>
            <dd className="mt-1 leading-relaxed">{source.excerpt}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
