"""
WhisperX Forced Alignment Server
---------------------------------
Spuštění:
  pip install -r requirements.txt
  python alignment_server.py

Server poslouchá na http://localhost:8001
Endpoint: POST /align  (multipart: file, text, language)
"""

from fastapi import FastAPI, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import whisperx
import tempfile
import os
import sys

app = FastAPI(title="WhisperX Alignment Server", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── Detect best available device ──────────────────────────────────────────
import torch

if torch.cuda.is_available():
    DEVICE = "cuda"
    COMPUTE_TYPE = "float16"
elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
    DEVICE = "mps"
    COMPUTE_TYPE = "float32"   # MPS doesn't support int8
else:
    DEVICE = "cpu"
    COMPUTE_TYPE = "int8"

print(f"[alignment] Using device: {DEVICE} / compute_type: {COMPUTE_TYPE}", flush=True)

# ── Global model cache ────────────────────────────────────────────────────
whisper_model = None
align_cache: dict = {}   # language → (align_model, align_metadata)


@app.on_event("startup")
async def load_whisper():
    global whisper_model
    print("[alignment] Loading WhisperX base model...", flush=True)
    whisper_model = whisperx.load_model(
        "base",
        DEVICE,
        compute_type=COMPUTE_TYPE,
        language="cs",           # hint; overridden per-request if needed
    )
    print("[alignment] ✓ Model ready", flush=True)


def get_align_model(language: str):
    """Load and cache alignment model per language."""
    if language not in align_cache:
        print(f"[alignment] Loading align model for '{language}'...", flush=True)
        # MPS fallback: alignment models only support cpu/cuda
        align_device = "cpu" if DEVICE == "mps" else DEVICE
        model, metadata = whisperx.load_align_model(
            language_code=language,
            device=align_device,
        )
        align_cache[language] = (model, metadata)
        print(f"[alignment] ✓ Align model '{language}' ready", flush=True)
    return align_cache[language]


# ── Routes ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "device": DEVICE, "model_loaded": whisper_model is not None}


@app.post("/align")
async def align_audio(
    file: UploadFile,
    text: str = Form(...),
    language: str = Form("cs"),
):
    if whisper_model is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    ext = os.path.splitext(file.filename or "audio.mp3")[1] or ".mp3"
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Load audio (16kHz mono float32)
        audio = whisperx.load_audio(tmp_path)
        audio_duration = len(audio) / 16000.0

        # Build a single fake WhisperX segment from our known text.
        # Forced alignment will map each word to its precise position.
        fake_segments = [{
            "start": 0.0,
            "end": audio_duration,
            "text": text,
        }]

        align_model, align_metadata = get_align_model(language)
        align_device = "cpu" if DEVICE == "mps" else DEVICE

        result = whisperx.align(
            fake_segments,
            align_model,
            align_metadata,
            audio,
            align_device,
            return_char_alignments=False,
        )

        words = []
        for seg in result.get("segments", []):
            for w in seg.get("words", []):
                start = w.get("start")
                end   = w.get("end")
                if start is not None and end is not None:
                    words.append({
                        "word":  w["word"].strip(),
                        "start": round(float(start), 3),
                        "end":   round(float(end),   3),
                    })

        return {"words": words, "duration": round(audio_duration, 3)}

    except Exception as exc:
        print(f"[alignment] ERROR: {exc}", flush=True)
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


# ── Entry point ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001, log_level="info")
