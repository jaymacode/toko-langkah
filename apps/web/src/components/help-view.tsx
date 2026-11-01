"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { ArrowIcon, ChatIcon, PlusIcon } from "@/components/icons";
import { SiteFrame, assistantHref } from "@/components/site-frame";
import { listPolicies, toApiError } from "@/lib/api";
import type { ApiError, PublicPolicy } from "@/lib/api";
import type { AppMode } from "@/lib/config";
import { formatDateTime } from "@/lib/format";
import { catalogueErrorMessage } from "@/lib/use-store";

type State = { status: "loading" } | { status: "error"; error: ApiError } | { status: "ready"; items: PublicPolicy[] };

const HELP_EMPTY_SEARCH = "Tidak ada ketentuan yang memuat kata itu. Coba kata lain, atau tanyakan ke asisten.";

function normalise(text: string): string {
  return text.toLocaleLowerCase("id").normalize("NFKD");
}

/** Policy ids are used as page anchors (#policy-returns); keep them URL-safe. */
function anchorFor(id: string): string {
  return id.replace(/[^A-Za-z0-9-]/g, "-");
}

/**
 * Self-service help: every active store policy, verbatim, from GET /policies (the same text the
 * assistant cites). A search box narrows the sections; each policy has an anchor for direct links.
 * Nothing here is written by hand, so the page can never disagree with the assistant's sources.
 */
export function HelpView({ mode }: { mode: AppMode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const searchId = useId();
  const resultId = useId();

  useEffect(() => {
    let active = true;
    listPolicies()
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

  const needle = normalise(query.trim());
  const shown = useMemo(() => {
    if (state.status !== "ready") return [];
    if (needle === "") return state.items;
    return state.items
      .map((policy) => {
        const titleHit = normalise(policy.title).includes(needle);
        const sections = titleHit
          ? policy.sections
          : policy.sections.filter((section) => normalise(`${section.section} ${section.text}`).includes(needle));
        return { ...policy, sections };
      })
      .filter((policy) => policy.sections.length > 0);
  }, [state, needle]);
  const sectionCount = shown.reduce((sum, policy) => sum + policy.sections.length, 0);

  return (
    <SiteFrame mode={mode} current="bantuan">
      <div className="flex flex-col gap-10">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <h1 className="font-display text-[clamp(52px,9vw,112px)] font-bold uppercase leading-[0.82] text-text">
            Bantuan <span className="text-quiet">&amp; FAQ</span>
          </h1>
          <p className="max-w-[38ch] text-[17px] leading-snug text-muted md:pb-2 md:text-right">
            Ketentuan toko yang sama persis dengan yang dikutip asisten.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
          <aside aria-label="Topik bantuan" className="flex flex-col gap-5 lg:sticky lg:top-32">
            <div className="flex flex-col gap-2">
              <label htmlFor={searchId} className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">
                Cari di bantuan
              </label>
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="mis. retur, ongkir, ukuran"
                aria-describedby={resultId}
                className="min-h-11 rounded-pill border border-quiet bg-surface px-4 text-text placeholder:text-muted hover:border-text focus:border-text"
              />
            </div>
            {state.status === "ready" && state.items.length > 0 ? (
              <nav aria-label="Topik">
                <ul className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-1">
                  {state.items.map((policy) => (
                    <li key={policy.id}>
                      <a
                        href={`#${anchorFor(policy.id)}`}
                        className="inline-flex min-h-11 items-center rounded-pill border border-rule bg-surface px-4 text-[15px] text-text transition-colors duration-200 hover:border-text lg:w-full lg:rounded-bay lg:border-transparent lg:bg-transparent lg:px-3 lg:hover:bg-stone"
                      >
                        {policy.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
          </aside>

          <div className="flex min-w-0 flex-col gap-6">
            <p id={resultId} role="status" className="tabular text-[15px] text-muted">
              {state.status === "ready" && needle !== "" ? `${sectionCount} bagian cocok dengan “${query.trim()}”` : ""}
            </p>

            {state.status === "loading" ? (
              <p role="status" className="text-muted">
                Memuat bantuan…
              </p>
            ) : null}
            {state.status === "error" ? (
              <div className="flex flex-col items-start gap-4 rounded-card border border-border bg-surface p-6">
                <p role="alert" className="font-display text-[22px] leading-snug text-text">
                  {catalogueErrorMessage(state.error)}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setState({ status: "loading" });
                    setAttempt((current) => current + 1);
                  }}
                  className="min-h-11 rounded-pill bg-primary px-5 font-medium text-on-primary transition-opacity duration-200 hover:opacity-85"
                >
                  Coba lagi
                </button>
              </div>
            ) : null}
            {state.status === "ready" && state.items.length === 0 ? (
              <p className="rounded-card border border-border bg-surface p-6 text-text">Belum ada ketentuan toko yang aktif.</p>
            ) : null}
            {state.status === "ready" && state.items.length > 0 && shown.length === 0 ? (
              <p className="rounded-card border border-border bg-surface p-6 text-text">{HELP_EMPTY_SEARCH}</p>
            ) : null}

            {shown.map((policy) => (
              <section
                key={policy.id}
                id={anchorFor(policy.id)}
                aria-labelledby={`${anchorFor(policy.id)}-title`}
                className="scroll-mt-32 rounded-card border border-border bg-surface p-1.5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pb-3 pt-4 md:px-5">
                  <h2 id={`${anchorFor(policy.id)}-title`} className="font-display text-[26px] font-medium leading-tight text-text">
                    {policy.title}
                  </h2>
                  <p className="tabular text-sm text-muted">
                    Versi {policy.version} · berlaku {formatDateTime(policy.effective_at)}
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  {policy.sections.map((section) => (
                    <details
                      key={section.id}
                      open={needle !== "" || policy.sections.length === 1}
                      className="group rounded-bay bg-stone px-4 open:pb-4 md:px-5"
                    >
                      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 font-medium text-text [&::-webkit-details-marker]:hidden">
                        {section.section}
                        <PlusIcon className="h-4 w-4 shrink-0 transition-transform duration-200 group-open:rotate-45" />
                      </summary>
                      <p className="max-w-[68ch] whitespace-pre-wrap leading-relaxed text-text">{section.text}</p>
                    </details>
                  ))}
                </div>
              </section>
            ))}

            <section
              aria-labelledby="help-more-heading"
              className="grid gap-6 rounded-card bg-primary px-6 py-8 text-on-primary md:grid-cols-[1fr_auto] md:items-center md:px-8"
            >
              <div>
                <h2 id="help-more-heading" className="font-display text-[clamp(28px,3.4vw,40px)] font-bold uppercase leading-[0.9]">
                  Belum terjawab?
                </h2>
                <p className="mt-2 max-w-[48ch] text-ink-muted">
                  Asisten bisa mengecek pesanan Anda dan meneruskan pertanyaan ke staf bila perlu.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={assistantHref()}
                  className="inline-flex min-h-12 items-center gap-2 rounded-pill bg-on-primary px-5 text-[15px] font-medium text-text transition-opacity duration-200 hover:opacity-90"
                >
                  <ChatIcon className="h-4 w-4" />
                  Tanya asisten
                </Link>
                <Link
                  href="/pesanan"
                  className="inline-flex min-h-12 items-center gap-2 rounded-pill border border-ink-rule px-5 text-[15px] transition-colors duration-200 hover:border-on-primary"
                >
                  Cek pesanan
                  <ArrowIcon />
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </SiteFrame>
  );
}
