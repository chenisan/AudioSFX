# AudioSFX — Woosh inference service (:6302). Run from anywhere.
# Injects ffmpeg-shared\bin into PATH (torchcodec hard requirement) and launches
# the wrapper with the Woosh venv (py3.13 / torch 2.8+cu128).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot                       # ...\engines
$env:PATH = (Join-Path $root 'ffmpeg-shared\bin') + ';' + $env:PATH
Set-Location (Join-Path $root 'woosh')
& '.\.venv\Scripts\python.exe' 'audiosfx_api.py'
