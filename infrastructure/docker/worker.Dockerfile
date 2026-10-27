FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgomp1 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv==0.13.6
WORKDIR /app
COPY apps/worker-python/pyproject.toml apps/worker-python/uv.lock ./
RUN uv sync --frozen --no-dev
COPY apps/worker-python/app ./app
RUN useradd --uid 10001 --create-home worker && mkdir -p /media /models && chown worker:worker /media /models
USER worker
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
