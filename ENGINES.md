# AI 音效引擎安裝 · AI Engine Setup

<p align="center"><a href="#繁體中文">繁體中文</a> · <a href="#english">English</a></p>

> **編輯與匯出不需要引擎。** 只有「生成音效」需要這兩個本地 GPU 引擎。
> Editing & exporting work without engines — only **SFX generation** needs them.

---

## 繁體中文

AudioSFX 透過 HTTP 呼叫兩個獨立的本地推論服務來生成音效，它們**不隨安裝檔附帶**（權重數 GB、需 CUDA、授權 CC BY-NC），請依下列步驟自行安裝。

- **Sony Woosh** — 文字／影片 → SFX，:6302
- **MMAudio** — 影片 → 同步底聲，:6303

> ⚠️ 兩者權重皆 **CC BY-NC（僅限非商業）**。

### 需求
- **NVIDIA RTX GPU**（實測 RTX 5060 Ti 16GB；Blackwell sm_120 需 **cu128 級 PyTorch**，預設 pip torch 不含 sm_120 kernel）
- **Python 3.10**（MMAudio）＋ **Python 3.13**（Woosh）—— 兩個版本都要
- `git`、`uv`（Woosh 用）、`gh` CLI（抓 Woosh 權重）
- 磁碟空間：權重數 GB + 兩個 venv（torch cu128 各約 2.5GB）

> 兩個引擎的 venv **不可合併**（torch 版本/依賴衝突），各自獨立。

### 步驟 0 — ffmpeg shared DLL（兩引擎都需要）
torchaudio 2.8+ 的 I/O 走 torchcodec，需要 FFmpeg 的 **shared DLL**（系統 winget ffmpeg 只有 exe 無 DLL）。
下載 **FFmpeg 8.0 shared build**，把 `avutil-60 / avcodec-62 / avformat-62` 等 DLL 放到：
```
engines/ffmpeg-shared/bin/
```
`start-*.ps1` 會自動把這個資料夾注入 PATH。

### 步驟 1 — MMAudio（:6303 · Python 3.10）
```powershell
cd engines
git clone https://github.com/hkchengrex/MMAudio.git mmaudio
cd mmaudio
py -3.10 -m venv .venv
.\.venv\Scripts\activate
# Blackwell 必須 cu128 級 PyTorch
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
pip install -e .
```
- **權重**：首次執行自動下載 `weights/mmaudio_large_44k_v2.pth`（約 4.1GB）+ HuggingFace 快取（CLIP / Synchformer / BigVGAN）。手動：<https://huggingface.co/hkchengrex/MMAudio>
- 確認 AudioSFX 的 wrapper `engines/mmaudio/audiosfx_api.py` 在 mmaudio 根目錄（隨本 repo 提供）。
- 授權：code MIT，**權重 CC BY-NC 4.0**。詳官方 README。

### 步驟 2 — Sony Woosh（:6302 · Python 3.13）
```powershell
cd engines
git clone https://github.com/SonyResearch/Woosh.git woosh
cd woosh
uv sync --extra cuda                       # uv 建立 py3.13 venv + cu128 依賴
gh release download v1.0.0 --repo SonyResearch/Woosh   # 下載權重 zip
# 解壓權重到 checkpoints/
```
- **權重**：T2A（Woosh-AE / CLAP / DFlow / TextConditionerA）+ V2A（VFlow / DVFlow / TextConditionerV），解壓到 `engines/woosh/checkpoints/`。
- ⚠️ **巢狀層陷阱**：zip 內含 `checkpoints/` 層，解壓後會變 `checkpoints/checkpoints/<MODEL>/`，要把內層移正成 `checkpoints/<MODEL>/`。repo 自帶的 `config.yaml`(0MB) 是 placeholder，真權重是解壓出的 `weights.safetensors`。
- 確認 wrapper `engines/woosh/audiosfx_api.py` 在 woosh 根目錄。
- 授權：code MIT/Apache v2，**權重 CC-BY-NC**。詳官方 README。

### 步驟 3 — 啟動
UI 右上「引擎」面板按啟動，或手動：
```powershell
pwsh engines/start-woosh.ps1     # :6302
pwsh engines/start-mmaudio.ps1   # :6303
```
啟動後 App 的「音效」浮窗 Woosh 燈會轉綠，即可生成。

### VRAM 註記（16GB）
MMAudio + Woosh-DFlow 常駐約 13GB；Woosh DVFlow 與 MMAudio **互斥**（Node 呼叫前自動 evict 對方），全程不破 16GB。

---

## English

AudioSFX generates SFX by calling two local inference services over HTTP. They are **not bundled** with the installer (multi-GB weights, CUDA required, CC BY-NC licensed) — install them yourself as below.

- **Sony Woosh** — text / video → SFX, :6302
- **MMAudio** — video → synced ambience, :6303

> ⚠️ Both model weights are **CC BY-NC (non-commercial only)**.

### Requirements
- **NVIDIA RTX GPU** (tested on RTX 5060 Ti 16GB; Blackwell sm_120 needs **cu128-class PyTorch** — stock pip torch lacks the sm_120 kernel)
- **Python 3.10** (MMAudio) **and Python 3.13** (Woosh) — both versions
- `git`, `uv` (for Woosh), `gh` CLI (to fetch Woosh weights)
- Disk: several GB of weights + two venvs (~2.5GB cu128 torch each)

> The two venvs **must stay separate** (conflicting torch versions / deps).

### Step 0 — ffmpeg shared DLLs (needed by both)
torchaudio 2.8+ routes I/O through torchcodec, which needs FFmpeg **shared DLLs** (winget ffmpeg ships only the exe). Download an **FFmpeg 8.0 shared build** and drop `avutil-60 / avcodec-62 / avformat-62` etc. into:
```
engines/ffmpeg-shared/bin/
```
`start-*.ps1` injects this folder into PATH automatically.

### Step 1 — MMAudio (:6303 · Python 3.10)
```powershell
cd engines
git clone https://github.com/hkchengrex/MMAudio.git mmaudio
cd mmaudio
py -3.10 -m venv .venv
.\.venv\Scripts\activate
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
pip install -e .
```
- **Weights**: first run auto-downloads `weights/mmaudio_large_44k_v2.pth` (~4.1GB) + HF cache (CLIP / Synchformer / BigVGAN). Manual: <https://huggingface.co/hkchengrex/MMAudio>
- Keep AudioSFX's wrapper `engines/mmaudio/audiosfx_api.py` (shipped in this repo) at the mmaudio root.
- License: code MIT, **weights CC BY-NC 4.0**. See the official README.

### Step 2 — Sony Woosh (:6302 · Python 3.13)
```powershell
cd engines
git clone https://github.com/SonyResearch/Woosh.git woosh
cd woosh
uv sync --extra cuda
gh release download v1.0.0 --repo SonyResearch/Woosh
# unzip the weights into checkpoints/
```
- **Weights**: T2A (Woosh-AE / CLAP / DFlow / TextConditionerA) + V2A (VFlow / DVFlow / TextConditionerV), unzipped into `engines/woosh/checkpoints/`.
- ⚠️ **Nested-folder gotcha**: the zip contains a `checkpoints/` layer, so it extracts to `checkpoints/checkpoints/<MODEL>/` — move the inner layer up to `checkpoints/<MODEL>/`. The repo's bundled `config.yaml` (0MB) is a placeholder; the real weight is the extracted `weights.safetensors`.
- Keep the wrapper `engines/woosh/audiosfx_api.py` at the woosh root.
- License: code MIT/Apache v2, **weights CC-BY-NC**. See the official README.

### Step 3 — Launch
From the "引擎" panel (top-right of the UI), or manually:
```powershell
pwsh engines/start-woosh.ps1     # :6302
pwsh engines/start-mmaudio.ps1   # :6303
```
Once up, the Woosh dot in the "音效" window turns green and you can generate.

### VRAM note (16GB)
MMAudio + Woosh-DFlow stay resident at ~13GB; Woosh DVFlow and MMAudio are **mutually exclusive** (Node evicts the other before calling), staying under 16GB.
