FROM python:3.11-slim

WORKDIR /app

# ffmpeg + libsndfile are required by faster-whisper to decode the
# WebM/Opus blobs the renderer posts in. gcc covers any C ext that
# pip wheels can't supply.

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the Whisper "tiny" weights at build time so the first
# transcribe request isn't a ~75MB cold-start stall. The runtime
# loader hits the same on-disk cache.

RUN python -c "from faster_whisper import WhisperModel; WhisperModel('tiny', device='cpu', compute_type='int8')"

COPY . .

EXPOSE 8002

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002", "--reload"]
