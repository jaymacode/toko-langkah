# TokoLangkah — commerce assistant demo
A fictional Indonesian footwear store with a customer assistant (store-policy answers with sources, exact product search, the signed-in customer's own orders, human handoff) and a staff escalation dashboard. All products, orders, policies and accounts are synthetic.

Status 2026-10-28: **locally complete, not deployed.** Default assistant: a deterministic, clearly labelled rules planner ("Asisten berbasis aturan (bukan AI) — mode demo"). The OpenAI provider has been exercised live (budget-guarded, spend ledger); full live AI evaluation is limited by the account's 50 requests/day cap. Evidence and limitations: docs/EXECPLAN.md (Outcomes), docs/STATUS.md, docs/THREAT_MODEL.md, docs/DEPLOYMENT.md.

## What works (verified)
- Catalogue with photos, IDR prices and in-stock sizes (no stock counts, no ratings).
- Chat (sign-in required): extractive policy answers with a source drawer (title, version, section, excerpt); "di bawah 500 ribu" → `< 500000`, "maksimal 500 ribu" → `<= 500000`; size must be in stock; removable filter chips; clarification for ambiguous budgets; no silent broadening; idempotent retries; 429/503 recovery that keeps typed text.
- Orders: customers see only their own orders; another customer's order number is indistinguishable from a missing one.
- Handoff: one durable ticket per request (concurrent retries → one row). While the conversation has an unresolved ticket, the assistant does not run: the customer's messages go to staff, staff reply from the console at `/staf` (`POST /staff/tickets/{id}/messages`, idempotent), and the chat shows the replies (polled every 5 s). Resolving the ticket hands the chat back to the assistant. Staff access is server-side membership only; status changes and replies are audited.
- Live on Supabase cloud: real sign-in, ES256/JWKS verification, RLS (`scripts/live_smoke.py` 16/16, `e2e:live` 5/5).

## Architecture
`apps/web` Next.js 16 + TypeScript + Tailwind 4 → `apps/api` FastAPI + Pydantic → Supabase Postgres (RLS) + Supabase Auth. The API verifies the JWT, then runs every user query inside a transaction as `anon`/`authenticated` with the verified `sub`, so RLS applies. The planner proposes tool calls; the backend validates arguments (`extra=forbid`), sets identity/store itself, and validates citations against evidence retrieved in the same turn. Details: docs/ARCHITECTURE.md, docs/contracts/.

## Prerequisites
Node 22+ with pnpm 9.15.9, Python 3.12 with uv 0.13.x, Docker (local PostgreSQL 17 + pgvector 0.8.0 for DB tests). On Windows use `python scripts/tasks.py <target>` (no GNU make needed) and keep the checkout path short or enable Win32 long paths — a checkout ~100+ characters deep pushes files inside `.venv` past the 260-character limit.

## Setup
1. `cp .env.example .env` and fill it locally (never commit it). Browser variables use only the Supabase URL and the `sb_publishable_` key.
2. `make setup`
3. Local database: `docker compose up -d --wait db`, `make db-migrate`, then `cd apps/api && DATABASE_URL=postgresql://postgres:postgres@localhost:54322/tokolangkah uv run python -m tokolangkah_api.admin.seed --target local`.
4. Supabase project (optional, admin): `make cloud-sync` applies migrations and seeds synthetic users; their random passwords are written only to gitignored `artifacts/demo-credentials.json`.
5. `make dev` → API http://localhost:8000, web http://localhost:3000 (both read the root `.env`).

## Commands
`scripts/tasks.py` is the source of truth; the Makefile wraps it.

| Target | What it runs | Exit codes |
|---|---|---|
| `make setup` | `pnpm install --frozen-lockfile`, `uv sync --frozen` | |
| `make dev` | local `db` container, API (port 8000), web (port 3000), root `.env` passed to both | |
| `make lint` | ESLint; ruff check + format check | |
| `make typecheck` | `tsc --noEmit`; `mypy --strict src` | |
| `make test` | `scripts/verify_kit.py`; Vitest; `pytest -m "not db"` | |
| `make test-db` | migrations + `pytest -m db` (RLS, auth, chat, tickets) against `DATABASE_URL` | 2 = BLOCKED (no URL or only skips) |
| `make e2e` | Playwright + axe against a production build with labelled test doubles | |
| `make eval` | deterministic fixture evals (parser, exact filters, retrieval with eval-only distractors, rules-planner plumbing); report in `artifacts/eval/` | 2 = BLOCKED (no URL) |
| `make eval-live` | live model evals | 2 = BLOCKED without OPENAI_API_KEY/OPENAI_MODEL and a nonzero LIVE_EVAL_BUDGET_USD |
| `make security` | bandit, pip-audit, `pnpm audit --prod`, repo secret scan | |
| `make build` | `next build`, secret scan of `.next/static`, API import smoke | |
| `make check` | lint → typecheck → test → security → build | |
| `make db-migrate` / `make db-reset` | psycopg migration runner (local auth shim only for local hosts, refused for Supabase) / drop + recreate the local DB (destructive) | 2 = REFUSED/BLOCKED |
| `make cloud-sync` | migrations + `seed --target supabase` for the project in `.env` | 2 = BLOCKED (missing .env keys) |
| `python scripts/live_smoke.py [API_URL]` | LIVE: Supabase sign-in → API (JWKS) → RLS/ticket/staff checks | 2 = BLOCKED |
| `pnpm --filter web e2e:live` | LIVE browser journeys, no doubles (`LIVE_VIDEO=1` records videos to `artifacts/verification/live/runs/`) | |
| `cd apps/api && uv run python -m tokolangkah_api.admin.loadcheck --turns 50` | in-process latency check (rules provider) → `artifacts/perf/` | 2 = BLOCKED (no URL) |
| `cd apps/api && uv run python -m tokolangkah_api.admin.embed` | embeds changed policy chunks + products in ONE batched OpenAI request (budget-guarded, ledger source `ingest`) | 2 = BLOCKED (no key/model/budget/URL) |
| `cd apps/api && uv run python -m tokolangkah_api.evals.run --mode retrieval-live` | recall@5 keyword vs hybrid, all queries in ONE embeddings request (`--mode retrieval-fixture` = fake embeddings, plumbing only) | 2 = BLOCKED |

## Known limitations
- Live model (`ASSISTANT_PROVIDER=openai`, gpt-6-luna) works end to end with a USD budget guard, but the OpenAI account first hit its 50 requests/day cap and then ran out of credit (`credit_balance_exhausted`), so Gate C AI-quality metrics are only partially measured (13 graded live turns). Hybrid retrieval (`RETRIEVAL_MODE=hybrid`, text-embedding-3-small, pgvector) is implemented and tested with fake embeddings; live ingest/eval is blocked by the same credit balance.
- Not deployed; GitHub CI is written but has not run (no remote). See docs/DEPLOYMENT.md, including the open "dedicated database role" hardening item.
- Store routes: `/` (storefront), `/produk` (filters in the URL), `/produk/[slug]`, `/keranjang` (browser-only demo cart; no payments, no order is created), `/asisten` (chat; `?tanya=` pre-fills the composer), `/bantuan` (help/FAQ: every active policy verbatim from `GET /policies`, searchable), `/pesanan`, `/masuk`, `/daftar` (sign-up), `/staf`.
- Registration: Supabase Auth sign-up from the browser; the API then makes the account a customer of the demo store (`POST /me/customer`, migration 0012, identity from the token only, staff never converted). The Supabase project currently requires email confirmation, and Supabase's built-in mailer only delivers to project team addresses, so for open demo sign-ups either disable "Confirm email" (Auth → Providers → Email) or configure SMTP.
- Own orders: "cek pesanan saya apa aja yang belum sampai" lists the signed-in customer's orders (tool `list_my_orders`, RLS) instead of asking for an order number.
- No SSE streaming (turns are request/response). A reloaded chat restores the transcript plus the latest filter chips and product panel (migration 0010).
- Supabase leaked-password protection needs the Pro plan; accepted for this synthetic demo (docs/THREAT_MODEL.md).
- Any OpenAI-compatible endpoint works: set OPENAI_BASE_URL (https only), e.g. OpenRouter with `nvidia/nemotron-3.5-super-vl:free` and `nvidia/nemotron-3.5-embed-8b:free` (see .env.example).

## Repository map
`apps/web` UI · `apps/api` API, assistant, evals, admin scripts · `db/migrations` SQL (RLS) · `db/local` local-only auth shim · `data` synthetic fixtures + eval cases · `docs` specs, contracts, threat model, deployment · `scripts` task runner, kit verifier, live smoke.
