# AudioSFX — MMAudio inference service (:6303). Run from anywhere.
# Injects ffmpeg-shared\bin into PATH (torchcodec hard requirement) and launches
# the wrapper with the MMAudio venv (py3.10 / torch 2.11+cu128).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot                       # ...\engines
$env:PATH = (Join-Path $root 'ffmpeg-shared\bin') + ';' + $env:PATH
Set-Location (Join-Path $root 'mmaudio')
& '.\.venv\Scripts\python.exe' 'audiosfx_api.py'
