# syntax=docker/dockerfile:1.7

FROM python:3.11-slim AS runtime

LABEL org.opencontainers.image.title="FinForge API" \
      org.opencontainers.image.description="FinForge FastAPI market data service" \
      org.opencontainers.image.licenses="MIT"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    FINFORGE_SETTINGS_FILE=/app/data/settings.json

WORKDIR /app

RUN groupadd --system --gid 10001 finforge \
    && useradd --system --uid 10001 --gid finforge --home-dir /app --shell /usr/sbin/nologin finforge \
    && mkdir -p /app/data \
    && chown -R finforge:finforge /app

COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

COPY --chown=finforge:finforge app.py services.py ./

USER finforge

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)" || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
