# TokoLangkah

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)
![FastAPI](https://img.shields.io/badge/FastAPI-0.162-009688?logo=fastapi&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ECF8E?logo=supabase&logoColor=white)

A demo commerce application for a fictional Indonesian footwear store: a product catalogue, a customer assistant that answers store-policy questions with sources, a customer's own order list, and a staff console for handling escalated conversations.

All products, orders, policies and accounts are synthetic.

![Customer assistant with active filters and matching products](assets/screenshots/asisten.png)

## Overview

TokoLangkah is a reference implementation of a customer-facing store assistant. Customers can browse footwear with IDR prices and size availability, ask the assistant about store policies and products in Indonesian, check the status of their own orders, and ask for a human. Every escalation becomes a durable ticket that staff can answer from a console, and the assistant stays out of the conversation until the ticket is resolved.

It is built for developers and reviewers who want to see how an AI-assisted customer service flow can be kept grounded and authorised: answers are extracted from versioned policy text with citations that the backend validates, product searches are exact, and every database read runs under row-level security as the signed-in user. The default assistant is a deterministic rules planner, so the demo runs without any model API key. An OpenAI-compatible model can be plugged in behind the same validation layer.

## Key features

**Customer storefront**
- Catalogue with product photos, IDR prices and in-stock EU sizes (no stock counts or ratings are shown to customers).
- Product filters in the URL (size, budget, sort), a size picker on the product page, and a browser-only demo cart. The cart does not take payment and does not create orders.
- Store help page (`/bantuan`) that shows every active policy verbatim, with search.

**Customer assistant (sign-in required)**
- Policy answers extracted from active policy versions, with a source drawer showing title, version, section and excerpt.
- Exact product search: budget phrases such as "di bawah 500 ribu" (below 500,000, exclusive) and "maksimal 500 ribu" (up to 500,000, inclusive) become hard filters; sizes must be in stock.
- Removable filter chips, clarification for ambiguous budgets, and no silent broadening of filters.
- Listing the signed-in customer's own orders (for example, orders that have not arrived yet) without asking for an order number.
- Idempotent message retries, and recovery from rate-limit and unavailable responses that keeps the typed text.

**Orders and accounts**
- Customers see only their own orders. Another customer's order number looks the same as a missing one.
- Sign-up through Supabase Auth; the API then registers the account as a customer of the demo store.

**Human handoff**
- One durable ticket per escalation request; concurrent retries create one row.
- While a ticket is unresolved, the assistant does not run. Customer messages go to staff, staff replies from the console, and the chat shows the replies (polled every 5 seconds).
- Resolving the ticket returns the conversation to the assistant.
- Staff access is checked server-side through store membership. Status changes and replies are audited.

**Staff console**
- Ticket queue with filters and a waiting count, conversation view, reply box, status controls and audit history (`/staf`).
- Stock management per size (`/staf/stok`), with optimistic concurrency so a concurrent change is never overwritten, and audit records.

## Screenshots

| Customer assistant (`/asisten`) | Staff console (`/staf`) |
|---|---|
| ![Customer assistant with active filters and matching products](assets/screenshots/asisten.png) | ![Staff ticket console with a conversation, reply box, status and audit](assets/screenshots/staf.png) |
| Policy and product questions with active filter chips and matching products. The UI labels this mode as a rules-based assistant (not AI). | Ticket queue, an escalated conversation, staff reply box, status controls and audit history. |

Screenshots were taken from a production build with `ASSISTANT_PROVIDER=rules`, signed in as synthetic accounts.

## Tech stack

| Layer | Technology |
|---|---|
| Web | Next.js 16, React 19, TypeScript, Tailwind CSS 4 (`apps/web`) |
| API | FastAPI, Pydantic 2, Python 3.12, uv (`apps/api`) |
| Database | Supabase PostgreSQL with row-level security; pgvector for hybrid retrieval |
| Auth | Supabase Auth; the API verifies ES256 JWTs against JWKS |
| Assistant | Deterministic rules planner (default); any OpenAI-compatible chat and embeddings endpoint (optional) |
| Testing | Vitest, Playwright with axe, pytest, psycopg-based database tests |

## Architecture

```mermaid
flowchart LR
    Browser --> Web["Next.js web (apps/web)"]
    Web --> API["FastAPI API (apps/api)"]
    API --> DB[("Supabase Postgres<br/>with RLS")]
    API --> Auth["Supabase Auth<br/>(JWT verification via JWKS)"]
    API -.optional.-> Model["OpenAI-compatible model<br/>(chat and embeddings)"]
```

- Every user query runs inside a transaction that switches to the `authenticated` role with the verified `sub` claim, so RLS applies. Requests use the non-owner role `tokolangkah_api` (migration 0007), not the table owner.
- The assistant proposes tool calls. The backend validates arguments (`extra=forbid`), sets the customer identity and store itself, and checks each citation against the evidence retrieved in the same turn.

## Getting started

### Prerequisites

- Node.js 22 (CI uses 22; `package.json` declares `>=20.9.0`) with pnpm 9.15.9
- Python 3.12 with uv 0.13.x
- Docker, for the local PostgreSQL 17 and pgvector 0.8.0 database used by `make dev` and the database tests
- On Windows, run the task runner directly with `python scripts/tasks.py <target>`; GNU make is not required. Keep the checkout path short or enable Win32 long paths. A checkout about 100 characters deep or more pushes files inside `.venv` past the 260-character Windows path limit.

### Setup

1. Clone the repository and enter it:

   ```bash
   git clone https://github.com/<username>/<repo>.git
   cd <repo>
   ```

2. Create a local environment file and fill it in. Never commit it.

   ```bash
   cp .env.example .env
   ```

   See [Environment variables](#environment-variables).

3. Install dependencies:

   ```bash
   make setup        # or: python scripts/tasks.py setup
   ```

4. Start the local database, apply migrations and seed synthetic data:

   ```bash
   docker compose up -d --wait db
   make db-migrate
   cd apps/api
   DATABASE_URL=postgresql://postgres:postgres@localhost:54322/tokolangkah uv run python -m tokolangkah_api.admin.seed --target local
   cd ../..
   ```

   The `DATABASE_URL` above uses the local-only default from `.env.example`. The inline variable syntax is for bash; on PowerShell, set `$env:DATABASE_URL` first.

5. Start the API and the web app:

   ```bash
   make dev          # or: python scripts/tasks.py dev
   ```

   - Web: http://localhost:3000
   - API: http://localhost:8000

   Both processes read the root `.env`.

Optional, for a Supabase cloud project (admin only): `make cloud-sync` applies the migrations and seeds synthetic users into the project configured in `.env`. The random passwords for those users are written only to `artifacts/demo-credentials.json`, which is gitignored.

### Environment variables

Only variable names are listed here. `.env.example` documents every variable and its purpose.

| Variable | Purpose |
|---|---|
| `APP_ENV`, `DEMO_MODE` | Runtime mode. The API refuses to start with `DEMO_MODE=true` or the rules provider when `APP_ENV=production`. |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Supabase project URL and publishable key (the only Supabase values the browser may receive). |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser copies of the two values above. |
| `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_APP_MODE` | Browser API base URL and app mode. |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin migrations and seeding only. Never used on the request path. |
| `DATABASE_URL` | Admin database connection (migrations, seed, tests). |
| `API_DATABASE_URL` | Request-path connection for the non-owner role `tokolangkah_api`. Required in production. |
| `ASSISTANT_PROVIDER` | `rules` (default, deterministic demo planner) or `openai`. |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | Optional model provider. `OPENAI_BASE_URL` may point to any OpenAI-compatible HTTPS endpoint. |
| `OPENAI_EMBEDDING_MODEL` | Embedding model for hybrid retrieval. |
| `RETRIEVAL_MODE` | `keyword` (default) or `hybrid`. |
| `LIVE_EVAL_BUDGET_USD` | Budget cap for live model runs. The default `0` blocks live runs. |
| `OPENAI_PRICE_INPUT_PER_MTOK`, `OPENAI_PRICE_OUTPUT_PER_MTOK`, `OPENAI_EMBEDDING_PRICE_PER_MTOK` | Conservative prices used by the budget guard. |
| `ALLOWED_ORIGINS`, `MAX_TOOL_CALLS` | CORS origins and the assistant's tool-call limit. |
| `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | Local Docker database settings. |

Only the publishable key may use a `NEXT_PUBLIC_` prefix. Never put a secret or service-role key in a browser variable.

## Commands

`scripts/tasks.py` is the source of truth. The `Makefile` wraps it. Run `make <target>` on Unix-like systems or `python scripts/tasks.py <target>` everywhere.

| Target | What it runs | Exit codes |
|---|---|---|
| `setup` | `pnpm install --frozen-lockfile`, `uv sync --frozen` | |
| `dev` | local `db` container, API (port 8000), web (port 3000) | |
| `lint` | ESLint; ruff check and ruff format check | |
| `typecheck` | `tsc --noEmit`; `mypy --strict src` | |
| `test` | `scripts/verify_kit.py`; Vitest; `pytest -m "not db"` | |
| `test-db` | migrations, then `pytest -m db` (RLS, auth, chat, tickets, staff, stock) against `DATABASE_URL` | 2 = BLOCKED (no URL, or only skips) |
| `e2e` | Playwright and axe against a production build with labelled test doubles | |
| `eval` | deterministic fixture evals (parser, exact filters, retrieval with eval-only distractors, rules-planner plumbing); report in `artifacts/eval/` | 2 = BLOCKED (no `DATABASE_URL`) |
| `eval-live` | live model evals | 2 = BLOCKED without model credentials and a nonzero `LIVE_EVAL_BUDGET_USD` |
| `security` | bandit, pip-audit, `pnpm audit --prod`, repository secret scan | |
| `build` | `next build`, secret scan of `.next/static`, API import smoke | |
| `check` | lint, typecheck, test, security, build | |
| `db-migrate` / `db-reset` | migration runner / drop and recreate the local database (destructive) | 2 = REFUSED or BLOCKED |
| `cloud-sync` | migrations and seed for the Supabase project in `.env` | 2 = BLOCKED (missing `.env` keys) |

Other commands:

```bash
# Live check against Supabase: sign-in, API (JWKS), RLS, ticket and staff checks
python scripts/live_smoke.py [API_URL]

# Live browser journeys against the deployed or running web app, no test doubles
pnpm --filter web e2e:live        # LIVE_VIDEO=1 records videos to artifacts/verification/live/runs/

# In-process latency check with the rules provider; results in artifacts/perf/
cd apps/api && uv run python -m tokolangkah_api.admin.loadcheck --turns 50

# Embed changed policy chunks and products in one batched request (budget-guarded)
cd apps/api && uv run python -m tokolangkah_api.admin.embed

# Retrieval recall@5, keyword vs hybrid, in one embeddings request
cd apps/api && uv run python -m tokolangkah_api.evals.run --mode retrieval-live
#   --mode retrieval-fixture uses fake embeddings and checks plumbing only
```

## Testing

Commands are listed above. The results below are the latest recorded runs on 2026-10-28 (Windows 11, Docker 29.8, Supabase Postgres 17).

| Area | Result |
|---|---|
| Lint, typecheck, unit tests, build (`check`) | Passing. Vitest 132 tests, pytest 381 tests (non-database). ESLint, ruff, tsc and mypy `--strict` clean. |
| Database tests (`test-db`) | 247 passed, including RLS, auth, orders, tickets, staff, chat, stock and failure modes. |
| Browser tests (`e2e`) | 93 tests passing, with axe checks (WCAG 2.1 AA) on 15 UI states showing 0 violations. Some screenshot specs are gated and skipped by default. |
| Live Supabase smoke (`scripts/live_smoke.py`) | 16/16 |
| Live browser journeys (`e2e:live`) | 5/5 against Supabase cloud, without test doubles |
| Retrieval recall@5 (live embeddings) | Keyword 27/28; hybrid 27/28 without distractors. With distractors, 28/28 for both. On this small catalogue, hybrid retrieval neither helps nor hurts. |
| Fixture evals (`eval`) | 74 cases; 58 executed in fixture mode and 16 covered by database tests. Exact filters 20/20. |
| Live model eval (OpenRouter, `nvidia/nemotron-3.5-super-vl:free`, dev split, 16 turns) | 11 pass, 5 errors (4 rate-limited by the free-tier limit, 1 invalid output). Citation precision 0.8 (4/5). The sample is small and not statistically meaningful. The holdout split has not been run. |
| Latency, rules provider, in process (50 turns, 0 errors) | p50 51–62 ms, p95 73–128 ms by intent. |
| Security checks (`security`) | bandit, pip-audit and `pnpm audit` clean; secret scan clean. |

Mock and live coverage: the rules planner, fake embeddings and test doubles cover most UI and failure-mode tests. The live checks above use real Supabase Auth and the real database. The live model results are limited as described.

## Project structure

```
apps/web/      Next.js storefront, assistant, staff console (Vitest, Playwright)
apps/api/      FastAPI API, assistant, retrieval, evals, admin scripts (pytest)
db/migrations/ SQL migrations 0001–0013, including RLS policies
db/local/      Local-only auth shim for the Docker database
data/          Synthetic fixtures, policies and eval cases
assets/        README screenshots
scripts/       Task runner, kit verifier, live smoke and live check scripts
```

## Status

- **Locally complete, not deployed.** Milestones M0–M6 are implemented and verified locally, and the Supabase cloud project has the migrations, seed and API role applied.
- **No CI pipeline in this repository.** Run the checks locally with `make check` (or `python scripts/tasks.py check`).
- **No deployment has been performed.**
- **Current assistant mode.** The default is the deterministic rules planner, which the UI labels as a rules-based assistant, not AI. An OpenAI-compatible model is supported, and it has been tested with a free OpenRouter model. That run was rate-limited and small (see Testing).

### Known limitations

- **Live model quality is only partly measured.** The OpenAI account first reached its request cap and then its credit limit. The later OpenRouter free-tier run was rate-limited, with 16 dev-split turns. The holdout split has not been run, and the AI-quality targets are not met or verified.
- **Free-tier model providers may log prompts.** `.env.example` notes that `:free` OpenRouter models log prompts upstream. Use only synthetic data with them.
- **Not deployed.** See Status.
- **Demo cart, no payments.** `/keranjang` is browser-only. Checkout reports that payment is unavailable and no order is created.
- **New sizes start at zero stock.** Sizes EU 35–45 were added on 2026-10-28, so the 32 new size variants start at stock 0 until staff set stock. Customers see only in-stock booleans.
- **No streaming.** Assistant turns are request and response. A reloaded chat restores the transcript and the latest filter chips and product panel.
- **Sign-up needs an email setup.** The Supabase project requires email confirmation, and Supabase's built-in mailer only delivers to project team addresses. For open demo sign-ups, disable "Confirm email" in Auth settings or configure SMTP. Browser sign-up has not been run against the live project; the registration path after sign-up was verified with an admin-created account.
- **Supabase leaked-password protection needs the Pro plan.** This is accepted for the synthetic demo and should be enabled before any real users sign up.
- **Accessibility checks are automated only.** axe, keyboard and focus tests, and 200% zoom approximations ran. A human screen-reader pass has not been done.
- **Stock page browser journey is not live-tested.** The live browser journey for `/staf/stok` has not been run. The stock API was checked live with `scripts/live_stock.py` (9/9).
- **Operational notes.** On Windows, stopped `dev` runs can leave orphaned uvicorn workers on port 8000. Stop Python processes whose command line contains `multiprocessing.spawn` before running `dev` again.


## Built with AI assistance

Implemented with the help of AI coding agents, from written product and architecture specs.

## Author

Jaya Saputra, Full-stack Developer
LinkedIn: https://linkedin.com/in/jayasssaputra
