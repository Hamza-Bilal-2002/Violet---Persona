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

# Pre-download the voice models into the image so the first /synthesize
# call for a voice doesn't stall pulling a ~60MB ONNX from huggingface.
# One voice per personality (see server/config/personalities/*.json):
#   en_US-hfc_female-medium  angry_gf (default)
#   en_US-amy-medium         cheerful
#   en_US-lessac-medium      calm
#   en_GB-jenny_dioco-medium tsundere
# To add a voice: add a fetch line here (rhasspy/piper-voices layout
# en/<locale>/<voice>/<quality>/...) and reference it in a personality.

ENV PIPER_BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main/en
RUN mkdir -p /models && \
    for spec in \
      "en_US-hfc_female-medium:en_US/hfc_female/medium" \
      "en_US-amy-medium:en_US/amy/medium" \
      "en_US-lessac-medium:en_US/lessac/medium" \
      "en_GB-jenny_dioco-medium:en_GB/jenny_dioco/medium" ; do \
        name="${spec%%:*}" ; path="${spec##*:}" ; \
        wget -O "/models/${name}.onnx"      "${PIPER_BASE}/${path}/${name}.onnx" && \
        wget -O "/models/${name}.onnx.json" "${PIPER_BASE}/${path}/${name}.onnx.json" ; \
    done

COPY . .

EXPOSE 8004

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8004", "--reload"]
