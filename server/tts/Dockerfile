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
# The first four back the bundled personalities; the rest are extra voices
# offered in Settings (the global voice override + the personality editor).
# Keep this list in sync with the label catalog in server/api/app/voices.py.
#
# Downloads are best-effort: a single missing/renamed upstream path logs a
# warning instead of failing the whole image build. Whatever lands in
# /models is what the api reports as installed (GET /voices).
# Layout: rhasspy/piper-voices  en/<locale>/<voice>/<quality>/...

ENV PIPER_BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main/en
RUN mkdir -p /models && \
    for spec in \
      "en_US-hfc_female-medium:en_US/hfc_female/medium" \
      "en_US-amy-medium:en_US/amy/medium" \
      "en_US-lessac-medium:en_US/lessac/medium" \
      "en_GB-jenny_dioco-medium:en_GB/jenny_dioco/medium" \
      "en_US-kristin-medium:en_US/kristin/medium" \
      "en_US-kathleen-low:en_US/kathleen/low" \
      "en_US-ljspeech-high:en_US/ljspeech/high" \
      "en_GB-alba-medium:en_GB/alba/medium" \
      "en_GB-southern_english_female-low:en_GB/southern_english_female/low" \
      "en_US-hfc_male-medium:en_US/hfc_male/medium" \
      "en_US-ryan-high:en_US/ryan/high" \
      "en_GB-alan-medium:en_GB/alan/medium" ; do \
        name="${spec%%:*}" ; path="${spec##*:}" ; \
        if wget -q -O "/models/${name}.onnx"      "${PIPER_BASE}/${path}/${name}.onnx" && \
           wget -q -O "/models/${name}.onnx.json" "${PIPER_BASE}/${path}/${name}.onnx.json" ; then \
          echo "voice ok: ${name}" ; \
        else \
          echo "WARN: could not fetch voice ${name} — skipping" ; \
          rm -f "/models/${name}.onnx" "/models/${name}.onnx.json" ; \
        fi ; \
    done

COPY . .

EXPOSE 8004

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8004", "--reload"]
