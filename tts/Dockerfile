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
# huggingface. Voice choice — en_US-hfc_female-medium — is a
# slightly younger-sounding female US-English neural voice. To
# swap, change BOTH the ENV below AND the two URL paths to match
# the rhasspy/piper-voices repo layout (en/<locale>/<voice>/<quality>/...)
# AND the VOICE_NAME constant in app/main.py.

ENV VOICE_NAME=en_US-hfc_female-medium
RUN mkdir -p /models && \
    wget -O /models/${VOICE_NAME}.onnx \
      https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx && \
    wget -O /models/${VOICE_NAME}.onnx.json \
      https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx.json

COPY . .

EXPOSE 8004

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8004", "--reload"]
