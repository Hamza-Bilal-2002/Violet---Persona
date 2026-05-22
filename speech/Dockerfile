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

# Note: we deliberately do NOT pre-download the Whisper weights at
# build time. Doing so caused builds to fail when the build host
# couldn't reach HuggingFace, and the ctranslate2 binary import
# during build sometimes failed on certain CPU/QEMU combos.
#
# app/main.py loads the model lazily on the first /transcribe
# request. First call will take ~30-60s downloading ~75MB; the
# weights persist in the named volume below across rebuilds.

COPY . .

EXPOSE 8002

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002", "--reload"]
