FROM python:3.11-slim

WORKDIR /app

# fastembed runs the model through onnxruntime (CPU) — no torch, so the
# image stays lean and matches the ONNX posture of the speech/wake/tts
# services.

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the embedding model into the image so the first /embed
# call doesn't stall pulling ~130MB of ONNX weights from huggingface.
# To swap models, change BOTH this name AND MODEL_NAME in app/main.py
# (and the dim if it differs — bge-small-en-v1.5 is 384-dim).
ENV FASTEMBED_CACHE_PATH=/models
RUN mkdir -p /models && \
    python -c "from fastembed import TextEmbedding; TextEmbedding(model_name='BAAI/bge-small-en-v1.5')"

COPY . .

EXPOSE 8005

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8005", "--reload"]
