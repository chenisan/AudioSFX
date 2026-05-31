"""AudioSFX — MMAudio inference service (thin wrapper, does NOT modify OSS code).

Video→audio synchronized "底聲" via MMAudio (large_44k_v2, 44.1kHz).
Runs in the MMAudio venv (py3.10 / torch 2.11+cu128). Port 6303.

Hard requirements (see DEVELOPMENT_PLAN.md §6):
  - ffmpeg-shared\bin MUST be on the DLL search path BEFORE torch/torchcodec
    import, or torchcodec fails to load (MMAudio's load_video uses it).
  - cwd must be engines/mmaudio so all_model_cfg's relative weight paths +
    the HF cache resolve exactly like the verified PoC (demo.py).

Model is lazy-loaded on the first /generate and kept warm. A single Lock
serializes GPU access (one generation at a time).
"""
import os

# ── ffmpeg shared DLLs — must happen before torch import ──────────────────────
ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
FFMPEG_BIN = os.path.join(os.path.dirname(ENGINE_DIR), "ffmpeg-shared", "bin")
if os.path.isdir(FFMPEG_BIN):
    os.add_dll_directory(FFMPEG_BIN)
    os.environ["PATH"] = FFMPEG_BIN + os.pathsep + os.environ.get("PATH", "")
# Match the PoC's working directory so relative weight/cache paths resolve.
os.chdir(ENGINE_DIR)
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

import io
import logging
import tempfile
import time
import uuid
from threading import Lock
from typing import Optional

import torch
import torchaudio
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict

from mmaudio.eval_utils import ModelConfig, all_model_cfg, generate, load_video
from mmaudio.model.flow_matching import FlowMatching
from mmaudio.model.networks import MMAudio, get_my_mmaudio
from mmaudio.model.utils.features_utils import FeaturesUtils

torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("audiosfx.mmaudio")

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DTYPE = torch.bfloat16
VARIANT = "large_44k_v2"

_gpu_lock = Lock()
_model = {"net": None, "feature_utils": None, "seq_cfg": None, "sr": None, "on_gpu": False}


def _ensure_ready():
    """Lazy-load MMAudio once; promote back to GPU if it was evicted to CPU.

    VRAM strategy A (see DEVELOPMENT_PLAN §7): MMAudio + Woosh-DFlow stay warm
    together (~9.5GB). When Woosh-DVFlow (V2A) is needed, the orchestrator
    calls /evict here first to free ~5.8GB, then promotes MMAudio back later.
    """
    if _model["net"] is None:
        log.info("Loading MMAudio (%s) on %s ...", VARIANT, DEVICE)
        cfg: ModelConfig = all_model_cfg[VARIANT]
        cfg.download_if_needed()
        net: MMAudio = get_my_mmaudio(cfg.model_name).to(DEVICE, DTYPE).eval()
        net.load_weights(torch.load(cfg.model_path, map_location=DEVICE, weights_only=True))
        feat = FeaturesUtils(
            tod_vae_ckpt=cfg.vae_path,
            synchformer_ckpt=cfg.synchformer_ckpt,
            enable_conditions=True,
            mode=cfg.mode,
            bigvgan_vocoder_ckpt=cfg.bigvgan_16k_path,
            need_vae_encoder=False,
        ).to(DEVICE, DTYPE).eval()
        _model.update(net=net, feature_utils=feat, seq_cfg=cfg.seq_cfg,
                      sr=cfg.seq_cfg.sampling_rate, on_gpu=True)
        log.info("MMAudio loaded.")
    elif not _model["on_gpu"]:
        log.info("Promoting MMAudio back to %s ...", DEVICE)
        _model["net"].to(DEVICE)
        _model["feature_utils"].to(DEVICE)
        _model["on_gpu"] = True


def _evict():
    """Move MMAudio off the GPU (kept in CPU RAM for fast re-promotion)."""
    if _model["net"] is not None and _model["on_gpu"]:
        _model["net"].to("cpu")
        _model["feature_utils"].to("cpu")
        _model["on_gpu"] = False
        if DEVICE == "cuda":
            torch.cuda.empty_cache()
        log.info("MMAudio evicted to CPU.")


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    video_path: str
    prompt: str = ""
    negative_prompt: str = ""
    duration: float = 8.0
    num_steps: int = 25
    cfg_strength: float = 4.5
    seed: int = 42


app = FastAPI(title="AudioSFX MMAudio")


@app.get("/ping")
def ping():
    return {"status": "ok", "engine": "mmaudio", "device": DEVICE,
            "loaded": _model["net"] is not None, "on_gpu": _model["on_gpu"]}


@app.post("/evict")
def evict():
    """Free GPU VRAM (move MMAudio to CPU). Called by the orchestrator before
    a Woosh-DVFlow (V2A) generation, which needs the ~5.8GB MMAudio holds."""
    with _gpu_lock:
        _evict()
    return {"status": "ok", "on_gpu": _model["on_gpu"]}


@app.post("/generate")
def generate_audio(req: GenerateRequest):
    video_path = os.path.expanduser(req.video_path)
    if not os.path.isfile(video_path):
        raise HTTPException(status_code=400, detail=f"video_path not found: {video_path}")

    with _gpu_lock:
        try:
            _ensure_ready()
            net, feat, seq_cfg = _model["net"], _model["feature_utils"], _model["seq_cfg"]

            t0 = time.time()
            with torch.inference_mode():
                rng = torch.Generator(device=DEVICE)
                rng.manual_seed(req.seed)
                fm = FlowMatching(min_sigma=0, inference_mode="euler", num_steps=req.num_steps)

                video_info = load_video(video_path, req.duration)
                clip_frames = video_info.clip_frames.unsqueeze(0)
                sync_frames = video_info.sync_frames.unsqueeze(0)
                duration = video_info.duration_sec

                seq_cfg.duration = duration
                net.update_seq_lengths(seq_cfg.latent_seq_len, seq_cfg.clip_seq_len, seq_cfg.sync_seq_len)

                audios = generate(
                    clip_frames, sync_frames, [req.prompt],
                    negative_text=[req.negative_prompt],
                    feature_utils=feat, net=net, fm=fm, rng=rng,
                    cfg_strength=req.cfg_strength,
                )
            audio = audios.float().cpu()[0]
            gen_time = time.time() - t0
            log.info("Generated in %.2fs (duration=%.2fs)", gen_time, duration)
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            log.exception("MMAudio generation failed")
            raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")

    # Encode to flac via a temp file (robust across torchaudio backends), return bytes.
    tmp = os.path.join(tempfile.gettempdir(), f"mmaudio_{uuid.uuid4().hex}.flac")
    try:
        torchaudio.save(tmp, audio, _model["sr"])
        with open(tmp, "rb") as f:
            data = f.read()
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass

    return Response(
        content=data,
        media_type="audio/flac",
        headers={
            "X-Generation-Seconds": f"{gen_time:.2f}",
            "X-Sample-Rate": str(_model["sr"]),
            "X-Duration-Seconds": f"{duration:.2f}",
        },
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=6303, log_level="info")
