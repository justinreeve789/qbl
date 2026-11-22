# Chatterbox text-to-speech for QBL: see server.py, and "Chatterbox" in
# docs/src/content/docs/developers/voices.md.
#
# The model is not in the image: the first start downloads it (about 3 GB for the multilingual
# model, plus 1.2 GB for the word aligner) into the chatterbox-models volume, so only once.
#
# CPU (default). For an NVIDIA GPU, build with QL_CHATTERBOX_TORCH=https://download.pytorch.org/whl/cu124
# in .env, and give the container the GPU (see docker-compose.yml).
ARG BASE_IMAGE=python:3.11-slim
FROM ${BASE_IMAGE}

ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir torch==2.6.0 torchaudio==2.6.0 --index-url "$TORCH_INDEX" \
    && pip install --no-cache-dir -r /tmp/requirements.txt \
    && pip install --no-cache-dir --no-deps chatterbox-tts==0.1.7

RUN useradd --create-home --uid 1000 app \
    && mkdir -p /models /voices \
    && chown app:app /models /voices
COPY --chown=app:app server.py /srv/server.py

USER app
WORKDIR /srv
ENV HF_HOME=/models/huggingface \
    TORCH_HOME=/models/torch \
    CHATTERBOX_VOICES_DIR=/voices \
    PYTHONUNBUFFERED=1 \
    PKUSEG_HOME=/models/pkuseg \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TQDM_DISABLE=1 \
    MALLOC_ARENA_MAX=2

EXPOSE 8004
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8004", "--workers", "1"]
