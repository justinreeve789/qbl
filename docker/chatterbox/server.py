"""
QBL's Chatterbox text-to-speech service: the "chatterbox" container in docker-compose.yml.

Chatterbox (Resemble AI, MIT) speaks in the voice of a short reference clip, with a dial for how
much feeling goes into it (exaggeration). This server wraps it for QBL the way Kokoro-FastAPI wraps
Kokoro: the app sends a line and the name of a clip, and gets back an MP3 and, unlike Chatterbox
itself, the time of every word (found afterwards by forced alignment, torchaudio's MMS_FA), so the
game can light each word as it is said.

    GET    /health               200 when the model is loaded, 503 while it loads (the first start
                                 downloads it) or when it failed
    POST   /v1/speech            {"input", "voice", "language", "exaggeration", "cfg_weight",
                                 "temperature", "seed", "speed", "volume", "response_format",
                                 "return_timestamps"} -> {"audio": base64, "timestamps": [...], ...}
    POST   /v1/audio/speech      OpenAI-style, for other tools: answers with the audio itself
    GET    /v1/audio/voices      {"voices": [clip names]}
    PUT    /v1/voices/{name}     the body is a clip (any format ffmpeg reads): kept as {name}.wav
    DELETE /v1/voices/{name}

Clips live in CHATTERBOX_VOICES_DIR (/voices, a volume). A request without a voice uses the model's
own built-in voice. Settings (environment):

    CHATTERBOX_MODEL       multilingual (default; 23 languages), english (the original model) or
                           turbo (English, smaller and faster, no exaggeration)
    CHATTERBOX_DEVICE      auto (default), cpu, cuda or mps
    CHATTERBOX_WORD_TIMES  true (default) or false (no alignment model: about 1 GB less memory)
    CHATTERBOX_THREADS     CPU threads for torch; 0 (default) lets torch decide
    HF_HOME, TORCH_HOME    where the models are downloaded to (a volume, so only once)
"""

import base64
import ctypes
import gc
import logging
import os
import re
import subprocess
import threading
import unicodedata
import zlib
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Optional

import numpy as np
import torch
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

log = logging.getLogger("chatterbox")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

MODEL = os.getenv("CHATTERBOX_MODEL", "multilingual").strip().lower()
VOICES = Path(os.getenv("CHATTERBOX_VOICES_DIR", "/voices"))
WORD_TIMES = os.getenv("CHATTERBOX_WORD_TIMES", "true").strip().lower() not in ("0", "false", "no", "off")
THREADS = int(os.getenv("CHATTERBOX_THREADS", "0") or 0)
# Longer text is said in pieces of about this many characters, at sentence ends where it can be.
CHUNK = 280
NAME = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def pick_device() -> str:
    want = os.getenv("CHATTERBOX_DEVICE", "auto").strip().lower()
    if want and want != "auto":
        return want
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


DEVICE = pick_device()
if THREADS > 0:
    torch.set_num_threads(THREADS)

state = {"status": "loading", "error": None, "languages": []}
lock = threading.Lock()
tts = None
aligner = None
default_conds = None
# Prepared clips (the expensive part of using one), by path and modification time.
conds_cache: "OrderedDict[tuple, object]" = OrderedDict()


def load() -> None:
    global tts, aligner, default_conds
    try:
        if MODEL in ("multilingual", "mtl"):
            from chatterbox.mtl_tts import SUPPORTED_LANGUAGES, ChatterboxMultilingualTTS as Model
            languages = sorted(SUPPORTED_LANGUAGES)
        elif MODEL in ("english", "original", "chatterbox"):
            from chatterbox.tts import ChatterboxTTS as Model
            languages = ["en"]
        elif MODEL == "turbo":
            from chatterbox.tts_turbo import ChatterboxTurboTTS as Model
            languages = ["en"]
        else:
            raise ValueError(f'CHATTERBOX_MODEL is "{MODEL}"; it must be multilingual, english or turbo.')
        log.info("Loading Chatterbox (%s) on %s; the first start downloads it.", MODEL, DEVICE)
        tts = Model.from_pretrained(DEVICE)
        default_conds = tts.conds
        if WORD_TIMES:
            log.info("Loading the word aligner (MMS_FA).")
            aligner = Aligner(DEVICE)
        release_memory()
        state.update(status="ready", languages=languages)
        log.info("Ready: %s, %d languages, word timings %s.", MODEL, len(languages), "on" if aligner else "off")
    except Exception as e:  # reported by /health, so the container is marked unhealthy and says why
        log.exception("Chatterbox could not be loaded")
        state.update(status="error", error=f"{type(e).__name__}: {e}")


def release_memory() -> None:
    """Hands back what loading the weights left behind (about 1.5 GB), which glibc otherwise keeps."""
    gc.collect()
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except OSError:
        pass


def trimmed(wav: np.ndarray, rate: int, words: list) -> np.ndarray:
    """A take without what Chatterbox sometimes adds after the last word (a breath, a click, a stray
    syllable): cut a little after the last word the aligner found, else after the last sound, and
    faded out so the cut is not heard."""
    if words:
        end = int((words[-1]["end_time"] + 0.3) * rate)
    else:
        frame = int(rate * 0.02)
        loud = np.flatnonzero(np.sqrt(np.mean(wav[: len(wav) // frame * frame].reshape(-1, frame) ** 2, axis=1)) > 0.01) if len(wav) >= frame else []
        end = int((loud[-1] + 1) * frame + 0.2 * rate) if len(loud) else len(wav)
    if end >= len(wav):
        return wav
    wav = wav[:end].copy()
    fade = min(len(wav), int(rate * 0.03))
    wav[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)
    return wav


class Aligner:
    """When each word is said in a recording whose text is known (torchaudio's MMS_FA, any language
    written with spaces between words). Words it cannot spell in Latin letters are left out; the
    game spreads those over the gap between their neighbours."""

    # num2words' names for the languages Chatterbox speaks, where they differ.
    NUMBER_LANGS = {"pt": "pt_BR", "no": "no", "zh": None, "ja": None, "ms": None, "sw": None, "el": None}

    def __init__(self, device: str):
        import torchaudio
        from uroman import Uroman

        bundle = torchaudio.pipelines.MMS_FA
        # The aligner runs on the CPU unless there is a GPU: it is small next to Chatterbox.
        self.device = "cuda" if device == "cuda" else "cpu"
        self.model = bundle.get_model().to(self.device)
        self.tokenizer = bundle.get_tokenizer()
        self.align = bundle.get_aligner()
        self.rate = bundle.sample_rate
        self.letters = set(bundle.get_dict()) - {"-", "*"}
        self.uroman = Uroman()
        self.resample = torchaudio.functional.resample

    def spell(self, word: str, lang: str) -> str:
        """A word as the aligner knows it: lower-case Latin letters (and ')."""
        if any(c.isdigit() for c in word):
            word = re.sub(r"\d+(?:[.,]\d+)?", lambda m: self.number(m.group(0), lang), word)
        if any(ord(c) > 0x24F and c.isalpha() for c in word):
            try:
                word = self.uroman.romanize_string(word)
            except Exception:
                return ""
        word = unicodedata.normalize("NFKD", word.lower())
        word = "".join(c for c in word if c in self.letters)
        return word.strip("'")

    def number(self, digits: str, lang: str) -> str:
        code = self.NUMBER_LANGS.get(lang, lang)
        if code is None:
            return " "
        try:
            from num2words import num2words

            value = float(digits.replace(",", ".")) if re.search(r"[.,]", digits) else int(digits)
            return " " + num2words(value, lang=code) + " "
        except Exception:
            return " "

    def words(self, wav: np.ndarray, rate: int, text: str, lang: str) -> list:
        if lang in ("ja", "zh"):  # no spaces between words
            return []
        shown = text.split()
        spelt = [(i, re.sub(r"\s+", "", self.spell(w, lang))) for i, w in enumerate(shown)]
        spelt = [(i, s) for i, s in spelt if s]
        if not spelt:
            return []
        with torch.inference_mode():
            wave = self.resample(torch.from_numpy(wav).float().unsqueeze(0), rate, self.rate).to(self.device)
            emission, _ = self.model(wave)
            spans = self.align(emission[0], self.tokenizer([s for _, s in spelt]))
        seconds = wave.size(1) / emission.size(1) / self.rate
        return [
            {"word": shown[i], "start_time": round(span[0].start * seconds, 3), "end_time": round(span[-1].end * seconds, 3)}
            for (i, _), span in zip(spelt, spans)
        ]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    VOICES.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=load, daemon=True).start()
    yield


app = FastAPI(title="QBL Chatterbox", lifespan=lifespan, docs_url="/docs", redoc_url=None)


class SpeechRequest(BaseModel):
    input: str = Field(min_length=1, max_length=4000)
    # A clip in /voices, by name; empty for the model's own voice.
    voice: Optional[str] = None
    # BCP 47 ("en-US") or the bare language ("en").
    language: Optional[str] = "en"
    # How much feeling: 0.5 is even, 0.7 lively, 1 and above theatrical (and less steady).
    exaggeration: float = Field(0.5, ge=0.0, le=2.0)
    # How closely it keeps to the clip's pace: lower is slower and more deliberate.
    cfg_weight: float = Field(0.5, ge=0.0, le=1.0)
    temperature: float = Field(0.8, ge=0.05, le=5.0)
    # The same seed, voice and text give the same take; by default the seed comes from them.
    seed: Optional[int] = None
    speed: float = Field(1.0, ge=0.5, le=2.0)
    volume: float = Field(1.0, ge=0.1, le=4.0)
    response_format: Literal["mp3", "wav"] = "mp3"
    return_timestamps: bool = True


def require_ready() -> None:
    if state["status"] != "ready":
        detail = state["error"] or "The model is still loading (the first start downloads it)."
        raise HTTPException(503, detail)


def clip_path(name: str) -> Path:
    if not NAME.match(name):
        raise HTTPException(400, f'"{name}" is not a clip name: letters, digits, - and _ only.')
    for ext in ("wav", "mp3", "flac", "ogg", "m4a"):
        if (p := VOICES / f"{name}.{ext}").is_file():
            return p
    raise HTTPException(404, f'There is no voice clip called "{name}" in {VOICES}.')


def conditionals(voice: Optional[str], exaggeration: float):
    if not voice:
        if default_conds is None:
            raise HTTPException(400, "This model has no voice of its own: give a voice clip.")
        return default_conds
    path = clip_path(voice)
    key = (str(path), path.stat().st_mtime_ns)
    if key in conds_cache:
        conds_cache.move_to_end(key)
        return conds_cache[key]
    tts.prepare_conditionals(str(path), exaggeration=exaggeration)
    conds_cache[key] = tts.conds
    while len(conds_cache) > 128:
        conds_cache.popitem(last=False)
    return tts.conds


def pieces(text: str) -> list:
    """The text in pieces Chatterbox says well (it trails off after about 40 seconds): whole
    sentences of up to CHUNK characters, and a longer sentence cut at a comma or a space."""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= CHUNK:
        return [text]
    parts = []
    for sentence in re.split(r"(?<=[.!?…。！？])\s+", text):
        while len(sentence) > CHUNK:
            cut = max(sentence.rfind(", ", 0, CHUNK) + 1, sentence.rfind(" ", 0, CHUNK))
            cut = cut if cut > 0 else CHUNK
            parts.append(sentence[:cut].strip())
            sentence = sentence[cut:].strip()
        parts.append(sentence)
    out = []
    for part in parts:
        if out and len(out[-1]) + 1 + len(part) <= CHUNK:
            out[-1] += " " + part
        else:
            out.append(part)
    return [p for p in out if p]


def say(req: SpeechRequest) -> dict:
    require_ready()
    lang = (req.language or "en").split("-")[0].lower()
    if lang not in state["languages"]:
        if len(state["languages"]) == 1:
            raise HTTPException(400, f'The {MODEL} model only speaks English, not "{req.language}" (CHATTERBOX_MODEL=multilingual speaks 23 languages).')
        raise HTTPException(400, f'Chatterbox does not speak "{req.language}". It speaks: {", ".join(state["languages"])}.')
    seed = req.seed if req.seed is not None else zlib.crc32(f"{req.voice}|{req.input}".encode())
    rate = tts.sr
    gap = np.zeros(int(rate * 0.12), dtype=np.float32)
    audio, words, at = [], [], 0.0
    with lock:
        conds = conditionals(req.voice, req.exaggeration)
        for i, piece in enumerate(pieces(req.input)):
            tts.conds = conds
            torch.manual_seed(seed + i)
            np.random.seed((seed + i) % 2**32)
            kwargs = {"temperature": req.temperature}
            if MODEL != "turbo":
                kwargs.update(exaggeration=req.exaggeration, cfg_weight=req.cfg_weight)
            if MODEL in ("multilingual", "mtl"):
                kwargs["language_id"] = lang
            wav = tts.generate(piece, **kwargs).squeeze(0).cpu().numpy().astype(np.float32)
            timed = []
            if aligner is not None:
                try:
                    timed = aligner.words(wav, rate, piece, lang)
                except Exception:
                    log.exception("No word timings for %r", piece[:80])
            wav = trimmed(wav, rate, timed)
            if req.return_timestamps:
                words += [{**w, "start_time": round(w["start_time"] + at, 3), "end_time": round(w["end_time"] + at, 3)} for w in timed]
            if audio:
                audio.append(gap)
                at += len(gap) / rate
            audio.append(wav)
            at += len(wav) / rate
        release_memory()
    wav = np.concatenate(audio)
    if req.volume != 1.0:
        wav = np.clip(wav * req.volume, -1.0, 1.0)
    data = encode(wav, rate, req.response_format, req.speed)
    if req.speed != 1.0:
        words = [{**w, "start_time": round(w["start_time"] / req.speed, 3), "end_time": round(w["end_time"] / req.speed, 3)} for w in words]
    return {"audio": data, "format": req.response_format, "duration": round(len(wav) / rate / req.speed, 3), "timestamps": words, "seed": seed}


def encode(wav: np.ndarray, rate: int, fmt: str, speed: float) -> bytes:
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", str(rate), "-ac", "1", "-i", "-"]
    if speed != 1.0:
        args += ["-filter:a", f"atempo={speed}"]
    args += ["-c:a", "libmp3lame", "-q:a", "3", "-f", "mp3", "-"] if fmt == "mp3" else ["-c:a", "pcm_s16le", "-f", "wav", "-"]
    done = subprocess.run(args, input=wav.astype("<f4").tobytes(), capture_output=True, check=False)
    if done.returncode != 0:
        raise HTTPException(500, "ffmpeg could not encode the audio: " + done.stderr.decode(errors="replace")[:300])
    return done.stdout


@app.get("/health")
def health():
    body = {"status": "healthy" if state["status"] == "ready" else state["status"], "model": MODEL, "device": DEVICE, "word_times": aligner is not None, "languages": state["languages"]}
    if state["error"]:
        body["error"] = state["error"]
    return JSONResponse(body, status_code=200 if state["status"] == "ready" else 503)


@app.post("/v1/speech")
def speech(req: SpeechRequest):
    out = say(req)
    return {**out, "audio": base64.b64encode(out["audio"]).decode(), "voice": req.voice, "language": req.language, "model": MODEL}


class OpenAiRequest(BaseModel):
    model: Optional[str] = None
    input: str = Field(min_length=1, max_length=4000)
    voice: Optional[str] = None
    response_format: Literal["mp3", "wav"] = "mp3"
    speed: float = Field(1.0, ge=0.5, le=2.0)
    language: Optional[str] = "en"
    exaggeration: float = Field(0.5, ge=0.0, le=2.0)
    cfg_weight: float = Field(0.5, ge=0.0, le=1.0)


@app.post("/v1/audio/speech")
def openai_speech(req: OpenAiRequest):
    voice = None if req.voice in (None, "", "default", "alloy") else req.voice
    out = say(SpeechRequest(input=req.input, voice=voice, language=req.language, exaggeration=req.exaggeration, cfg_weight=req.cfg_weight, speed=req.speed, response_format=req.response_format, return_timestamps=False))
    return Response(out["audio"], media_type="audio/mpeg" if req.response_format == "mp3" else "audio/wav")


@app.get("/v1/audio/voices")
def voices():
    names = sorted({p.stem for p in VOICES.iterdir() if p.is_file() and NAME.match(p.stem)}) if VOICES.is_dir() else []
    return {"voices": names}


@app.put("/v1/voices/{name}")
async def upload(name: str, request: Request):
    if not NAME.match(name):
        raise HTTPException(400, f'"{name}" is not a clip name: letters, digits, - and _ only.')
    body = await request.body()
    if not body:
        raise HTTPException(400, "Send the clip as the body of the request.")
    if len(body) > 20 * 1024 * 1024:
        raise HTTPException(413, "A clip must be under 20 MB (10 to 20 seconds is plenty).")
    target = VOICES / f"{name}.wav"
    tmp = VOICES / f".{name}.uploading.wav"
    done = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", "-", "-ac", "1", "-ar", "24000", "-t", "40", str(tmp)], input=body, capture_output=True, check=False)
    if done.returncode != 0 or not tmp.is_file():
        tmp.unlink(missing_ok=True)
        raise HTTPException(400, "That is not audio ffmpeg can read: " + done.stderr.decode(errors="replace")[:300])
    seconds = (tmp.stat().st_size - 44) / 2 / 24000
    if seconds < 3:
        tmp.unlink(missing_ok=True)
        raise HTTPException(400, f"The clip is {seconds:.1f} seconds; Chatterbox needs at least 3 (10 to 20 is best).")
    for other in VOICES.glob(f"{name}.*"):
        other.unlink(missing_ok=True)
    tmp.rename(target)
    return {"voice": name, "seconds": round(seconds, 2)}


@app.delete("/v1/voices/{name}")
def delete(name: str):
    path = clip_path(name)
    for other in VOICES.glob(f"{name}.*"):
        other.unlink(missing_ok=True)
    return {"deleted": path.stem}
