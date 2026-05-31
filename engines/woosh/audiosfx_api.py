"""AudioSFX — Woosh inference service (thin wrapper, does NOT modify OSS code).

Two endpoints, both 48kHz wav, running in the Woosh venv (py3.13 / torch 2.8+cu128):
  POST /generate/sfx  — text→SFX,  Woosh-DFlow distilled (~0.8s).  Mirrors test_Woosh-DFlow.py
  POST /generate/v2a  — video→audio, Woosh-DVFlow-8s distilled (~0.35s). Mirrors test_Woosh-DVFlow.py
Port 6302.

Hard requirements (see DEVELOPMENT_PLAN.md §6):
  - ffmpeg-shared\bin on the DLL search path BEFORE torch import (V2A's
    extract_video_frames uses torchcodec).
  - DVFlow-8s is a fixed 8-second model: V2A uses an 8s window (noise len 801).

Each model is lazy-loaded on first use and kept warm. A single Lock serializes
GPU access.
"""
import os

# ── ffmpeg shared DLLs — must happen before torch import ──────────────────────
ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
FFMPEG_BIN = os.path.join(os.path.dirname(ENGINE_DIR), "ffmpeg-shared", "bin")
if os.path.isdir(FFMPEG_BIN):
    os.add_dll_directory(FFMPEG_BIN)
    os.environ["PATH"] = FFMPEG_BIN + os.pathsep + os.environ.get("PATH", "")
os.chdir(ENGINE_DIR)
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")

import logging
import os.path as osp
import tempfile
import time
import uuid
from threading import Lock

import torch
import torchaudio
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict

from woosh.inference.flowmap_sampler import sample_euler
from woosh.model.flowmap_from_pretrained import FlowMapFromPretrained
from woosh.components.base import LoadConfig
from woosh.utils.video import SynchformerProcessor
from woosh.utils.videoio import extract_video_frames

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("audiosfx.woosh")

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
SR = 48000
DFLOW_PATH = osp.join(ENGINE_DIR, "checkpoints", "Woosh-DFlow")
DVFLOW_PATH = osp.join(ENGINE_DIR, "checkpoints", "Woosh-DVFlow-8s")

_gpu_lock = Lock()
_models = {"dflow": None, "dvflow": None, "synch": None}
_on_gpu = {"dflow": False, "dvflow": False, "synch": False}


def _ensure_dflow():
    """DFlow (T2A, ~3.7GB) — the always-warm SFX model in VRAM strategy A."""
    if _models["dflow"] is None:
        log.info("Loading Woosh-DFlow (T2A) on %s ...", DEVICE)
        _models["dflow"] = FlowMapFromPretrained(LoadConfig(path=DFLOW_PATH)).eval().to(DEVICE)
        _on_gpu["dflow"] = True
    elif not _on_gpu["dflow"]:
        _models["dflow"].to(DEVICE)
        _on_gpu["dflow"] = True
    return _models["dflow"]


def _ensure_dvflow():
    """DVFlow + Synchformer (V2A, ~8.5GB) — the heavy, on-demand pair. The
    orchestrator evicts MMAudio before invoking this (mutually exclusive)."""
    if _models["dvflow"] is None:
        log.info("Loading Woosh-DVFlow-8s (V2A) + Synchformer on %s ...", DEVICE)
        _models["dvflow"] = FlowMapFromPretrained(LoadConfig(path=DVFLOW_PATH)).eval().to(DEVICE)
        _models["synch"] = SynchformerProcessor(frame_rate=24).eval().to(DEVICE)
        _on_gpu["dvflow"] = _on_gpu["synch"] = True
    else:
        if not _on_gpu["dvflow"]:
            _models["dvflow"].to(DEVICE); _on_gpu["dvflow"] = True
        if not _on_gpu["synch"]:
            _models["synch"].to(DEVICE); _on_gpu["synch"] = True
    return _models["dvflow"], _models["synch"]


def _evict(names):
    """Move the named models off the GPU (kept in CPU RAM). Default target is
    the DVFlow+Synchformer pair — frees ~8.5GB while keeping DFlow warm."""
    moved = []
    for name in names:
        m = _models.get(name)
        if m is not None and _on_gpu[name]:
            m.to("cpu")
            _on_gpu[name] = False
            moved.append(name)
    if moved and DEVICE == "cuda":
        torch.cuda.empty_cache()
    log.info("Evicted to CPU: %s", moved or "(none on GPU)")
    return moved


def _normalize(x: torch.Tensor) -> torch.Tensor:
    m = torch.max(torch.abs(x))
    return x / (m if m > 1.0 else 1.0)


def _to_flac_bytes(wav: torch.Tensor) -> bytes:
    tmp = osp.join(tempfile.gettempdir(), f"woosh_{uuid.uuid4().hex}.wav")
    try:
        torchaudio.save(tmp, wav, sample_rate=SR)
        with open(tmp, "rb") as f:
            return f.read()
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


class SfxRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: str
    num_steps: int = 4
    cfg: float = 4.5
    seed: int | None = None


class V2aRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    video_path: str
    description: str = ""           # empty text is fine; or a description of the video
    num_steps: int = 4
    cfg: float = 3.0
    seed: int | None = None


app = FastAPI(title="AudioSFX Woosh")


class EvictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Default evicts the heavy V2A pair, keeping DFlow (SFX) warm. Use ["all"]
    # to clear everything.
    models: list[str] = ["dvflow", "synch"]


@app.get("/ping")
def ping():
    return {
        "status": "ok", "engine": "woosh", "device": DEVICE,
        "loaded": {k: v is not None for k, v in _models.items()},
        "on_gpu": dict(_on_gpu),
    }


@app.post("/evict")
def evict(req: EvictRequest = EvictRequest()):
    """Free GPU VRAM. Default target = DVFlow + Synchformer (~8.5GB), keeping
    DFlow warm so SFX stays instant. Pass {"models":["all"]} to clear all."""
    names = list(_models.keys()) if "all" in req.models else req.models
    with _gpu_lock:
        moved = _evict(names)
    return {"status": "ok", "evicted": moved, "on_gpu": dict(_on_gpu)}


@app.post("/generate/sfx")
def generate_sfx(req: SfxRequest):
    """Text→SFX via Woosh-DFlow (4-step distilled)."""
    with _gpu_lock:
        try:
            ldm = _ensure_dflow()
            gen = torch.Generator()
            if req.seed is not None:
                gen.manual_seed(req.seed)
            noise = torch.normal(0, 1, size=(1, 128, 501), generator=gen).to(DEVICE)
            t0 = time.perf_counter()
            with torch.inference_mode():
                cond = ldm.get_cond({"audio": None, "description": [req.prompt]}, no_dropout=True, device=DEVICE)
                x = sample_euler(model=ldm, noise=noise, cond=cond, num_steps=req.num_steps,
                                 renoise=[0, 0.5, 0.5, 0.3], cfg=req.cfg)
                wav = ldm.autoencoder.inverse(x).cpu()
            gen_time = time.perf_counter() - t0
            log.info("SFX generated in %.2fs", gen_time)
        except Exception as e:  # noqa: BLE001
            log.exception("Woosh SFX generation failed")
            raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")

    data = _to_flac_bytes(_normalize(wav[0]))
    return Response(content=data, media_type="audio/wav",
                    headers={"X-Generation-Seconds": f"{gen_time:.2f}", "X-Sample-Rate": str(SR)})


@app.post("/generate/v2a")
def generate_v2a(req: V2aRequest):
    """Video→audio via Woosh-DVFlow-8s (fixed 8s window, distilled)."""
    video_path = os.path.expanduser(req.video_path)
    if not osp.isfile(video_path):
        raise HTTPException(status_code=400, detail=f"video_path not found: {video_path}")

    with _gpu_lock:
        try:
            ldm, synch = _ensure_dvflow()
            gen = torch.Generator()
            if req.seed is not None:
                gen.manual_seed(req.seed)
            noise = torch.normal(0, 1, size=(1, 128, 801), generator=gen).to(DEVICE)
            t0 = time.perf_counter()
            with torch.inference_mode():
                frames, rate, _pts = extract_video_frames(video_path, start_time=0, end_time=8)
                frames = frames.to(DEVICE)
                features = synch(frames, rate)
                cond = ldm.get_cond(
                    {"audio": None, "description": [req.description], "synch_out": features["synch_out"]},
                    no_dropout=True, device=DEVICE,
                )
                x = sample_euler(model=ldm, noise=noise, cond=cond, num_steps=req.num_steps,
                                 renoise=[0, 0.5, 0.5, 0.3], cfg=req.cfg)
                wav = ldm.autoencoder.inverse(x).cpu()
            gen_time = time.perf_counter() - t0
            log.info("V2A generated in %.2fs", gen_time)
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            log.exception("Woosh V2A generation failed")
            raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")

    data = _to_flac_bytes(_normalize(wav[0]))
    return Response(content=data, media_type="audio/wav",
                    headers={"X-Generation-Seconds": f"{gen_time:.2f}", "X-Sample-Rate": str(SR),
                             "X-Duration-Seconds": "8.00"})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=6302, log_level="info")
