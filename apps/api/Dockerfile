# TokoLangkah API container. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t tokolangkah-api .
# Configuration comes only from environment variables at runtime (never baked into the image).
FROM ghcr.io/astral-sh/uv:0.13.5 AS uv

FROM python:3.12.10-slim AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app/apps/api
COPY apps/api/pyproject.toml apps/api/uv.lock apps/api/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY apps/api/src ./src
RUN uv sync --frozen --no-dev

FROM python:3.12.10-slim
RUN useradd --create-home --uid 10001 app
WORKDIR /app/apps/api
COPY --from=build --chown=app:app /app/apps/api /app/apps/api
# The seed/migrate admin modules resolve repo-relative data; only migrations are needed at runtime
# for an operator-run `python -m tokolangkah_api.admin.migrate`. Fixtures are not shipped.
COPY --chown=app:app db/migrations /app/db/migrations
ENV PATH="/app/apps/api/.venv/bin:$PATH" PYTHONUNBUFFERED=1 APP_ENV=production
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"
CMD ["uvicorn", "tokolangkah_api.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
