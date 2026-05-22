FROM python:3.11-slim

WORKDIR /app

# openwakeword pulls in onnxruntime; nothing native required beyond
# the wheel itself. gcc kept available as a safety net for any future
# transitive C extension. ffmpeg is NOT needed — we receive raw PCM
# from the renderer, no decoding step.

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the bundled wake-word models at build time so the
# first /ws connection doesn't stall pulling weights from the
# openwakeword release artifacts. The download is small (~30MB) and
# all models live under the openwakeword package's resources dir.

RUN python -c "from openwakeword.utils import download_models; download_models()"

COPY . .

EXPOSE 8003

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8003", "--reload"]
