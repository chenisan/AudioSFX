# AudioSFX — 開發計畫

> 本檔由 13soulMU session（2026-05-31）產出，供在 `D:\AudioSFX` 另開的 session 直接接手。
> 不依賴前一次對話 context，所有決策、PoC 結果、執行步驟都寫在這裡。

---

## 0. 一句話定位

**AudioSFX 是一套獨立、本地、非商業的「影片→音效」創作工具**：fork 13soulMU 的時間軸 + ffmpeg render 核心，接上本地 GPU 跑的 MMAudio（同步底聲）與 Sony Woosh（SFX：whoosh/punch/impact），在時間軸上對齊生成音效。

與 13soulMU **完全脫鉤的獨立 repo**。

---

## 1. 背景與關鍵決策（為什麼這樣做）

### 1.1 為什麼獨立成新專案，而不是整合進 13soulMU

- 需求原是「把 MMAudio + Woosh 整合進 13soulMU 的 workflow editor」。
- **致命卡點：兩個 model 的權重都是 CC BY-NC 4.0（僅限非商業）**：
  - MMAudio checkpoints：CC BY-NC 4.0
  - Sony Woosh open weights：CC-BY-NC
- 而 **13soulMU 是付費產品**（LINE Pay 年訂閱、Creator/Pro 收費方案）。把非商業權重接進付費產品 = 違反授權。
- 改走雲 API（fal/Replicate）**也救不了** —— 授權綁在「權重」本身，不是「在哪跑」。
- **結論（user 拍板）**：獨立開發一套非商業工具，把非商業 model 隔離於此，不污染 13soulMU 的商業授權。fork 13soulMU 的時間軸 + 核心來用。

### 1.2 其他已定案決策

| 項目 | 決定 |
|---|---|
| 複用策略 | **Fork 一份乾淨起點**（複製 13soulMU → 砍商業/AI生成/workflow → 留 timeline+render+core → 加音效層）。兩專案獨立演進，不共享 package。 |
| 範圍 | **MMAudio + Woosh 兩個都做** |
| 部署 | 本地 GPU（RTX 5060 Ti 16GB）。透過 **HTTP 服務邊界**呼叫 Python 推論（不直接 import OSS code，符合架構分層） |
| Port | 前端 **6300** / 後端 Express **6301** / Python 推論服務 **6302**（避開 13soulMU 的 6200/6201 與 Hyper-V 保留段 5541–5640） |
| 專案路徑 | `D:\AudioSFX` |

---

## 2. PoC 驗證結果 ✅（已完成，地基全通）

兩個 model 都已在本機 **RTX 5060 Ti 16GB / Blackwell sm_120** 實測跑通。

### 2.1 環境事實

- Python（系統）3.10.1、git 2.34、ffmpeg（winget，**僅 exe 無 DLL**）、uv 0.9.9、gh CLI 都在
- GPU：RTX 5060 Ti 16GB，可用 ~14GB，Driver 595.97 / CUDA 13.2
- **Blackwell sm_120 必須 cu128 級 PyTorch**（預設 pip torch 不含 sm_120 kernel）。已驗證 `torch 2.11.0+cu128`（MMAudio）與 `torch 2.8.0+cu128`（Woosh）皆 `cuda.get_device_capability()==(12,0)` 且 GPU matmul 實算成功。

### 2.2 MMAudio（video→audio 同步底聲）

- 位置：`D:\AudioSFX\engines\mmaudio`（已 clone + `pip install -e .`）
- 環境：`engines\mmaudio\.venv`（Python 3.10 venv）
- 權重：`engines\mmaudio\weights\mmaudio_large_44k_v2.pth`（4.12G，已下載）+ HF 快取的 CLIP(apple DFN5B) / Synchformer / BigVGAN v2
- **實測：5.87 GB VRAM**（官方稱 6GB，吻合），生成 `.flac` + 帶音 `.mp4` 成功
- License：code MIT，**權重 CC BY-NC 4.0**

### 2.3 Woosh（text→SFX；另有 video→audio）

- 位置：`D:\AudioSFX\engines\woosh`（已 clone + `uv sync --extra cuda`）
- 環境：`engines\woosh\.venv`（uv 管理，**Python 3.13**）
- 權重：**T2A + V2A 兩鏈都已下載解壓**到 `engines\woosh\checkpoints\`：`Woosh-AE`(844M) `Woosh-CLAP` `Woosh-DFlow`(1.3G) `TextConditionerA`（T2A）＋ `Woosh-VFlow-8s`(1.58G) `Woosh-DVFlow-8s` `TextConditionerV`(1.36G)（V2A）。
- **實測（全部跑通，生成 48kHz `.wav` ＋帶音 `.mp4`）**：
  - Woosh-DFlow（distilled T2A SFX，4-step）：**0.80 秒**
  - Woosh-VFlow（原始 V2A，float64 adaptive 70 步）：**8.24 秒**
  - Woosh-DVFlow（**distilled V2A，產品主力**）：**0.35 秒** ← 互動式體驗最佳
- 自帶 **FastAPI 推論服務**：`engines\woosh\api\api_server.py` ← 日後推論服務可直接基於它
- License：code MIT/Apache v2，**權重 CC-BY-NC**

### 2.4 ⚠️ Windows 關鍵坑（已解決，務必沿用）

**torchcodec 缺 FFmpeg shared DLL**。新版 torchaudio（2.8+）I/O 後端遷移到 torchcodec，而 torchcodec 需要 FFmpeg 的 `avutil/avcodec/avformat` 等 **shared DLL**；系統 winget ffmpeg 只有 static exe，會導致 `OSError: Could not load libtorchcodec_core8.dll`。

**解法**：已下載 FFmpeg shared build 到 `D:\AudioSFX\engines\ffmpeg-shared\bin`（DLL：avutil-60 / avcodec-62 / avformat-62，= FFmpeg 8.0，對應 torchcodec core8）。**任何呼叫 torch I/O 的 Python 進程，啟動前都要把這個 bin 加進 PATH**。

### 2.5 PoC 重現指令（新 session 可直接驗證）

```powershell
# MMAudio V2A
Set-Location 'D:\AudioSFX\engines\mmaudio'
$env:PATH = 'D:\AudioSFX\engines\ffmpeg-shared\bin;' + $env:PATH
& '.\.venv\Scripts\python.exe' demo.py --duration=8 `
    --video='training\example_videos\0B4dYTMsgHA_000130.mp4' --prompt='dog barking'
# 輸出 → engines\mmaudio\output\

# Woosh T2A SFX
Set-Location 'D:\AudioSFX\engines\woosh'
$env:PATH = 'D:\AudioSFX\engines\ffmpeg-shared\bin;' + $env:PATH
& '.\.venv\Scripts\python.exe' test_Woosh-DFlow.py
# 輸出 → engines\woosh\outputs\
```

---

## 3. 目標架構

```
┌─ 前端（fork 自 13soulMU 時間軸 UI；Vite :6300）──────┐
│  Timeline editor · Preview · Audio tracks            │
│  ＋ 新增 src/components/audio/：                       │
│     · GenerateSyncAudioModal（clip 右鍵「生成同步音」）│
│     · SfxPanel（text→SFX，落到剪輯點/beat）            │
└────────────────────────────────────────────────────────┘
        ↑ REST (Vite proxy → :6301)
┌─ 後端 Express（fork 自 13soulMU core；:6301）─────────┐
│  server/core/*  全留（projectManager/renderer/        │
│                 ffmpegBuilder/transitionBuilder…）     │
│  ＋ server/audio/：                                    │
│     · audioOrchestrator.ts（clip 時間 → audio track   │
│       對齊 + 多軌混音）                                │
│     · audioGenClient.ts（HTTP → :6302，submit/poll）   │
│  ＋ server/routes/audioGen.ts（SSE 進度，複用 Kling   │
│       的 submit→poll→download pattern）                │
└────────────────────────────────────────────────────────┘
        ↓ HTTP :6302（服務邊界，不直接 import OSS）
┌─ Python 推論服務（GPU，獨立 process）─────────────────┐
│  基於 engines\woosh\api\api_server.py 擴充：           │
│   /generate/mmaudio   → MMAudio V2A                    │
│   /generate/woosh/vflow → Woosh V2A                    │
│   /generate/woosh/sfx   → Woosh-DFlow T2A SFX          │
│  啟動前注入 ffmpeg-shared\bin 到 PATH                  │
└────────────────────────────────────────────────────────┘
```

**核心原則**：Python 推論獨立 process（GPU、依賴重，與 13soulMU 全域架構的 VibeVoice 同層）；Node 端只透過 HTTP 呼叫，model 換版/換 model 不動 Node。生成音檔一律落地 `data/projects/<id>/assets/`（沿用 13soulMU「外部 URL 必落地」原則）。

---

## 4. Fork 計畫（複製 / 砍 / 改）

### 4.1 怎麼 fork

```powershell
# 從 13soulMU 當前 working tree 複製（排除 .git/node_modules/data/dist/release）
robocopy 'D:\13soul-video-engine' 'D:\AudioSFX' /E `
  /XD .git node_modules data dist release release-builds 'engines' `
  /XF '*.log'
Set-Location 'D:\AudioSFX'
git init   # 全新獨立 repo，不帶 13soulMU history
```
> 注意：`engines\`（PoC 的 MMAudio/Woosh/ffmpeg-shared）已在 D:\AudioSFX，robocopy 時用 /XD 排除避免被覆蓋。

### 4.2 留（核心資產 = 時間軸 + render）

- `server/core/`：**全留**（types, projectManager, renderer, ffmpegBuilder, transitionBuilder, assRenderer, colorFillRenderer, subtitleExport, migration, mediaEngine, mediaTranscode, slideshowService, projectEvents, templateManager）
- `server/routes/`：留 `projects, assets, render, preview, templates, transcribe, tts, settings, stickers, realtime`
- `server/utils/`：`secretStore, whisper`
- `native/media-engine/`：Rust waveform/thumb/probe 全留
- `src/components/`：留 `timeline/, preview/, properties/, render/, common/, templates/`，`assets/`(AssetPanel/TTSPanel/SubtitlePanel/StickerPanel)，`layout/`(Resizer；Header/SettingsModal 要去掉 auth/billing 入口)
- `src/stores/`：projectStore 留，但**剝掉 AI workflow orchestration** 部分
- `src/utils/`、`src/hooks/`、`src/styles/`：留（用到再清）

### 4.3 砍（商業 / AI 生成 / workflow / 帳號）

**後端 routes**（對照 `server/index.ts` 掛載點刪除）：
`aiScripts, workflowRun, workflowLibrary, aiPipeline, sketchAssets, sketchGenerate, workflow, aiPrompt, refImageGen, videoGenerate, motionLibrary, storyboardStudio, billing, billingWebhook, billingLinepayConfirm, admin, auth`

**後端目錄**：`server/billing/`、`server/db/`、`server/ai/` 的影像影片 provider（videoGen, imageGen, geminiImageGen, sketch*, storyboard, motionLibrary, sceneToWorkflow…）、`server/mcp/`（初期不需要）

**前端**：`src/components/workflow/`（整包）、`src/components/storyboard/`（整包）、`src/components/auth/`、`src/components/billing/`、`src/components/admin/`、`src/components/ai/`（OneClickAiMvModal, SketchEditModal, BatchGenerateModal, PoseCanvas）

**前端入口**：`App.jsx` 目前用 `<AuthGate>` 包整個 app（第 6 行 import）→ 拿掉 AuthGate 包裹，直接 render 編輯器。

**依賴移除**（package.json）：`@anthropic-ai/sdk, @modelcontextprotocol/sdk, openai, @xyflow/react, better-sqlite3, bcrypt, cookie-parser`，確認 `three` 是否僅 PoseCanvas 用（是則移）。同步移除 electron-builder 的 billing 相關設定。

### 4.4 新增

- `server/audio/audioOrchestrator.ts`、`server/audio/audioGenClient.ts`
- `server/routes/audioGen.ts`
- `src/components/audio/`（GenerateSyncAudioModal、SfxPanel）
- `engines/`：已就位（MMAudio / Woosh / ffmpeg-shared）
- Python 推論服務（擴充 `engines/woosh/api/api_server.py` 或新寫薄 wrapper）

### 4.5 .gitignore 必加

```
node_modules/
data/
dist/
release/
engines/*/.venv/
engines/*/weights/
engines/*/checkpoints/
engines/*/downloads/
engines/*/outputs/
engines/*/output/
engines/ffmpeg-shared/
```
> engines 的程式（demo/test/api 腳本）可進 git，但 .venv / 權重 / ffmpeg DLL 不進（體積大、可重抓）。

---

## 5. 開發階段（建議順序）

1. **Fork + 砍骨架**：robocopy → git init → 砍上述清單 → 改 port 6300/6301 → 讓 timeline+preview+render 能 `npm run dev` 跑起來（這步主要工作量在拆 auth/billing/workflow 交織）。
2. **Python 推論服務**：把 MMAudio + Woosh 包成 FastAPI（:6302），三個端點（mmaudio / woosh-vflow / woosh-sfx）。啟動腳本注入 ffmpeg-shared PATH。實作 submit→poll→download（長任務）。下載 Woosh V2A 鏈權重（VFlow/DVFlow/TextConditionerV）。
3. **Node 音效層**：`audioGen` route + `audioGenClient` + `audioOrchestrator`。clip 右鍵「生成同步音」→ MMAudio/Woosh-VFlow → 落地 `data/projects/<id>/assets/` → 對齊放到 audio track。
4. **SFX 面板**：text→SFX（Woosh-DFlow，0.8s 超快）→ 落到剪輯點 / beat grid。
5. **匯出**：複用 ffmpeg render core 把混音 mux 回影片。

**MVP 第一刀**：階段 1–3（video→同步音整條通）。SFX 面板（階段 4）緊接。

---

## 6. 已知陷阱 / 必讀

- **ffmpeg DLL（最重要）**：任何 torch I/O 的 Python 進程啟動前必須 `$env:PATH = 'D:\AudioSFX\engines\ffmpeg-shared\bin;' + $env:PATH`，否則 torchcodec 載入失敗。Python 服務化時在 `os.add_dll_directory()` 或啟動腳本處理。
- **兩個 model 環境隔離**：MMAudio=`engines\mmaudio\.venv`(py3.10 venv)、Woosh=`engines\woosh\.venv`(py3.13 uv)。**torch 版本不同**（2.11 vs 2.8）、依賴不同，**不要合併成單一 venv**，否則衝突。Python 服務可分兩個 process（各自 venv）或選一個主力。
- **授權**：非商業（CC BY-NC）。本工具務必維持非商業定位，**不可接進任何收費產品**。README 要標明。
- **權重不進 git**（體積 GB 級）。新環境用 PoC 重現指令重抓（MMAudio 自動下載；Woosh 用 `gh release download v1.0.0 --repo SonyResearch/Woosh`）。
- **Woosh 權重 zip 內含 `checkpoints/` 巢狀層**：解壓到 `checkpoints/` 會變成 `checkpoints/checkpoints/MODEL/`，要把內層移正（PoC 時踩過，已寫成移正腳本）。repo 自帶的 `checkpoints/MODEL/config.yaml`(0MB) 是 placeholder，真權重 `weights.safetensors` 解壓後才有。T2A + V2A 兩鏈權重目前都已下載解壓並驗證完成。
- **V2A 速度差距大**：原始 VFlow（float64 adaptive）8.24 秒 vs distilled DVFlow 0.35 秒 —— 產品互動式生成務必用 **DVFlow distilled**，VFlow 原始版留給離線高品質需求。
- **HF symlink 警告**（Windows 無 Developer Mode）：無害，只是快取多佔空間。可設 `HF_HUB_DISABLE_SYMLINKS_WARNING=1` 消警告。
- **Port**：6300/6301/6302。避開 5541–5640（Hyper-V 保留）與 6200/6201（13soulMU）。
- 沿用 13soulMU 守則：**先規劃再動手**、commit 用具體檔案不用 `git add -A`、外部生成 URL 必落地、跑測試前先問。

---

## 7. 進度（2026-05-31 接手 session）

### 階段 1：Fork + 砍骨架 ✅ 完成並驗證
- robocopy fork（已排除 engines）→ 砍 auth/billing/db/mcp/AI/workflow/storyboard → port 6300/6301 → CORS 放寬。
- 前端 `npm run dev` 空殼跑通：建立/列出/刪除專案、前端 SPA、後端 health 全綠（BE 6301 NVENC GPU / FE 6300）。
- git init/commit 仍**未做**（留待後續 session）。
- 遺留：`README.md` 尚未加非商業 CC BY-NC 聲明；`projectStore.js` 內部殘留 AI workflow state（死碼）；`projects.ts` 留 inert 的 cost-log/cleanup-ai-files 端點；Realtime 的 OpenAI key 改走 `OPENAI_API_KEY` env（無 UI）。

### 階段 2：Python 推論服務 ✅ 完成並驗證
- **架構修正**：§3 想像的「單一 Python 服務掛 3 端點」不可行 —— MMAudio venv(py3.10/torch2.11) 與 Woosh venv(py3.13/torch2.8) 無法同 process。改為**兩個常駐 FastAPI 服務**（各自 venv，不改 OSS 原碼，薄 wrapper）：
  - `engines/woosh/audiosfx_api.py` **:6302** — `POST /generate/sfx`(T2A DFlow) + `POST /generate/v2a`(V2A DVFlow-8s)
  - `engines/mmaudio/audiosfx_api.py` **:6303** — `POST /generate`(V2A 同步底聲)
  - 啟動：`engines/start-woosh.ps1` / `engines/start-mmaudio.ps1`（注入 ffmpeg-shared PATH + 各 venv python）。
  - wrapper 頂部 `os.add_dll_directory(ffmpeg-shared\bin)` + `os.chdir(engine)`；模型 lazy-load 保溫；`_gpu_lock` 序列化。
- **實測**（端到端，回音檔 bytes）：sfx **0.73s**、v2a **3.91s**（含影格解碼+Synchformer，非 PoC 那 0.35s 的純 denoise）、mmaudio **11.62s**（8s/25步，載入 5.84GB）。音檔取樣率/時長皆正確（48k/48k/44.1k）。
- 端點為**同步**回 bytes；長任務 submit→poll 視 Phase 3 需要再加。video 用**檔案路徑**傳入（同機免上傳）。

### VRAM 策略 ✅ 已定案並驗證（方案 A）
- **量測（增量，16GB 卡）**：Woosh-DFlow(T2A) ~3.7GB；Woosh-DVFlow+Synchformer(V2A) **+8.5GB**（元兇）；MMAudio reserved ~8GB（allocated 5.84）。三者全載 = 15.5GB（爆邊緣）。
- **方案 A（採用）**：`MMAudio + Woosh-DFlow` **常駐**（穩態實測 ~13GB，~3GB headroom）；**DVFlow 按需**——與 MMAudio **互斥**，呼叫前先 evict MMAudio。DFlow 全程保溫（SFX 始終即時）。
- **服務端原語（已實作）**：兩服務都加 `POST /evict`（移 CPU + `empty_cache`）+ GPU↔CPU 升降；`/ping` 回報 `on_gpu`。
  - MMAudio `/evict`：整個移 CPU（釋放 ~5.8GB）。
  - Woosh `/evict`：預設只驅逐 `dvflow`+`synch`（釋放 ~8.5GB、**保留 DFlow**）；`{"models":["all"]}` 清全部。
- **互斥協調由 Node 負責（Phase 3）**：呼叫 DVFlow 前 → `POST mmaudio/evict`；呼叫 MMAudio 前（若 DVFlow 在）→ `POST woosh/evict`。
- **已驗證循環**：穩態 13.25GB → evict MMAudio(5GB) → DVFlow(13.5GB, 無 OOM) → evict DVFlow(5GB) → MMAudio 升回(11.7GB)。全程不破 16GB。

### 下一步：階段 3（Node 音效層）
1. `server/audio/audioGenClient.ts`（HTTP → 6302/6303 + 上面的 evict 互斥協調）+ `audioOrchestrator.ts` + `server/routes/audioGen.ts`（SSE 進度）。
2. clip 右鍵「生成同步音」→ 落地 `data/projects/<id>/assets/` → 對齊 audio track。
3. 服務啟動：Node 端可選擇 spawn `engines/start-{woosh,mmaudio}.ps1` 或假設已手動起。
4. 不確定的 domain 分層問題回看 13soulMU 的 `CLAUDE.md`「協作治理守則」。
