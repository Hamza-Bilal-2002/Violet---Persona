FROM python:3.11-slim

WORKDIR /app

# espeak-ng is Piper's phonemizer for English voices; without it
# synthesis fails at startup. wget is just for pulling the voice
# model at build time.

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        wget \
        espeak-ng \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the voice model into the image so the first
# /synthesize call doesn't stall pulling a ~60MB ONNX from
# huggingface. Voice choice — en_US-amy-medium — is a female
# US-English neural voice; quality/perf is the sweet spot for
# desktop CPU. Swap to en_GB-jenny_dioco-medium, en_US-libritts_r,
# or any other rhasspy/piper-voices model by adjusting both this
# block and VOICE_NAME in app/main.py.

ENV VOICE_NAME=en_US-amy-medium
RUN mkdir -p /models && \
    wget -O /models/${VOICE_NAME}.onnx \
      https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx && \
    wget -O /models/${VOICE_NAME}.onnx.json \
      https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json

COPY . .

EXPOSE 8004

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8004", "--reload"]
