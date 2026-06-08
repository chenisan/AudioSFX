<p align="center">
  <img src="src/assets/about-poster.png" width="440" alt="AudioSFX" />
</p>

<h1 align="center">AudioSFX</h1>

<p align="center">
  本地、非商業的「影片 → 音效」創作工具<br>
  A local, non-commercial <b>video → sound-effects</b> tool.
</p>

<p align="center">
  <a href="#繁體中文">繁體中文</a> · <a href="#english">English</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue" alt="license">
  <img src="https://img.shields.io/badge/platform-Windows-lightgrey" alt="platform">
  <img src="https://img.shields.io/badge/Electron%20%2B%20React%20%2B%20Node-informational" alt="stack">
</p>

---

## 繁體中文

> 設計製作 · **Isan（13soul）** — 全端設計工程師 · 影像及音樂創作人

### 這是什麼

你有一段沒有聲音（或只有原聲）的影片，想替它加上**對得準的音效**：whoosh、撞擊、腳步、玻璃碎、環境底聲…

AudioSFX 在你自己的電腦（本地 GPU）跑兩個 AI 模型生成音效，讓你在時間軸上對齊、混音，再用 ffmpeg 輸出成帶音效的影片。

- **Sony Woosh** — 文字／影片 → SFX（whoosh / punch / impact，超快）
- **MMAudio** — 影片 → 同步環境底聲（依畫面生成貼合的背景音）

> ⚠️ 兩個模型權重是 **CC BY-NC（僅限非商業）**，本工具維持非商業定位，不可接進收費產品。

### 特色

- 🎬 **9:16 直式時間軸編輯器** — 影片／音訊／文字多軌，拖移・裁切・分割
- 📚 **內建 CC0 音效庫** — 400+ 即用音效（Kenney.nl），**免引擎、即點即用**：撞擊／腳步／介面／電子／科技／物件
- 🤖 **三種音效生成入口** — 文字→SFX、影片→V2A 同步音、音軌指定位置生成
- 🎚 **DAW 風格混音** — 每軌 EQ / 壓縮器 / 限幅器（可拖曳浮動視窗）+ 母帶防爆 limiter
- 🖥 **浮動預覽窗** — 右下可拖／可調大小
- ⚡ **ffmpeg 渲染** — NVENC GPU 自動加速，匯出 MP4 / MOV / WebM / WAV
- 📦 **桌面安裝版** — Electron 打包，內嵌後端 + ffmpeg，動態 port
- 🧠 **AI 可控（MCP）** — 內建 MCP server，讓 **Claude / Codex 直接驅動編輯器**（建專案／生成音效／排時間軸）

### 安裝與啟動

**桌面版**：到 [Releases](https://github.com/chenisan/AudioSFX/releases) 下載 `AudioSFX Setup`，執行即可。

**開發模式**：
```powershell
npm install
npm run dev          # 前端 :6300 / 後端 :6301
```

**Python 推論引擎**（音效生成需要，GPU）— **首次需自行安裝（下載權重等），詳見 [ENGINES.md](./ENGINES.md)**。
裝好後從 UI 右上「引擎」面板啟動，或手動：
```powershell
pwsh engines/start-woosh.ps1     # :6302  Woosh
pwsh engines/start-mmaudio.ps1   # :6303  MMAudio
```
> 沒啟動引擎也能剪輯／匯出，只是不能生成音效。

**需求**：Node.js 20+、Windows、NVIDIA RTX GPU（音效生成）、ffmpeg。

### AI 控制（MCP）

內建 MCP server（`server/mcp-server.mts`）讓 **Claude / Codex 控制正在跑的編輯器**（建專案／生成音效／排時間軸）。在 repo 開 Claude Code 會偵測 `.mcp.json` 並詢問啟用 `audiosfx`；需後端在跑（`npm run dev`）。詳見 [Wiki](https://github.com/chenisan/AudioSFX/wiki)。

> 例：對 Claude 說「用 audiosfx 建 30 秒專案，生成 glass shatter 音效，加到音軌第 2 秒，存檔」。

### 使用教學

1. **建專案 + 匯入** — 專案 ▾ → 新建；把影片／音檔拖進視窗。
2. **時間軸剪輯** — 拖移・裁切・分割；軌道可改名／鎖定／靜音。選中軌靛紫、靜音軌琥珀。
3. **加音效**：頂部〰「音效」浮窗，兩個分頁——
   - **音效庫**（最快，免引擎）：選分類／搜尋 → ▶ 試聽 → 「＋軌」加到時間軸，或「素材」只匯入。
   - **AI 生成 — 文字 → SFX**：英文 prompt（如 `glass shatter`）→ 生成（需 Woosh 引擎）。
   - **影片 → V2A**：右鍵影片 clip → 生成同步底聲（MMAudio）。
   - **指定位置**：右鍵音軌空白 →「建立音效」（可命名）。
4. **混音** — 左欄「效果」分頁 → 選軌 → fader / M；「+ 加效果」→ EQ / 壓縮 / 限幅（**點名字開浮窗**）；Main Out 的 **LIMIT** 防爆母帶。
5. **預覽** — 頂部 🖥 開右下浮動預覽窗。
6. **匯出** — ⬆ 匯出 →（自動存檔）→ 關於作者 → 下一步 → 設定 → 匯出。成品右下角有「Isan 13soul」浮水印。

> 小技巧：`Ctrl+S` 存檔；改過前端 `Ctrl+Shift+R` 硬重整。

### 技術棧

| Layer | Tech |
|---|---|
| Frontend | React 18 · Vite 5 · TailwindCSS 3 · Zustand 4 |
| Backend | Node.js 20+ · Express 4 · TypeScript 5 |
| 音訊預覽 | Web Audio API |
| 渲染 | ffmpeg（fluent-ffmpeg），NVENC fallback |
| 推論 | MMAudio（py3.10）· Woosh（py3.13），各自 FastAPI |
| Native | Rust + napi-rs（波形／縮圖／probe） |
| Desktop | Electron + electron-builder |

### 授權

**PolyForm Noncommercial License 1.0.0** — 僅限**非商業**用途。詳見 [LICENSE](./LICENSE)。
依賴的 MMAudio / Sony Woosh 權重亦為 CC BY-NC。
本工具打包並以獨立執行檔呼叫 **FFmpeg（GPLv3）**；第三方授權與來源見 [NOTICE.md](./NOTICE.md)。

---

## English

> Designed & built by **Isan (13soul)** — full-stack design engineer · video & music creator

### What is this

Got a silent (or raw-audio) video clip and want **well-timed sound effects** — whooshes, impacts, footsteps, glass shatter, ambience?

AudioSFX runs two AI models on your own machine (local GPU) to generate SFX, lets you align and mix them on a timeline, then muxes everything back into the video with ffmpeg.

- **Sony Woosh** — text / video → SFX (whoosh / punch / impact, very fast)
- **MMAudio** — video → synced ambient bed (background audio that fits the footage)

> ⚠️ Both model weights are **CC BY-NC (non-commercial only)**. This tool stays non-commercial and must not ship inside any paid product.

### Features

- 🎬 **9:16 vertical timeline editor** — video / audio / text tracks; move, trim, split
- 📚 **Built-in CC0 SFX library** — 400+ ready-to-use sounds (Kenney.nl), **no engine needed, instant**: impacts / footsteps / UI / digital / sci-fi / foley
- 🤖 **Three ways to generate SFX** — text→SFX, video→V2A synced audio, generate at a track position
- 🎚 **DAW-style mixing** — per-track EQ / compressor / limiter (draggable floating editors) + master brickwall limiter
- 🖥 **Floating preview** — bottom-right, draggable & resizable
- ⚡ **ffmpeg rendering** — automatic NVENC GPU acceleration; export MP4 / MOV / WebM / WAV
- 📦 **Desktop build** — Electron-packaged with an embedded backend + ffmpeg, dynamic port
- 🧠 **AI-controllable (MCP)** — a built-in MCP server lets **Claude / Codex drive the editor** (create projects, generate SFX, arrange the timeline)

### Install & run

**Desktop**: download `AudioSFX Setup` from [Releases](https://github.com/chenisan/AudioSFX/releases) and run it.

**Dev**:
```powershell
npm install
npm run dev          # frontend :6300 / backend :6301
```

**Python inference engines** (needed for SFX generation, GPU) — **first-time setup (download weights, etc.) is on you: see [ENGINES.md](./ENGINES.md)**.
Once installed, start them from the "引擎" panel (top-right of the UI), or manually:
```powershell
pwsh engines/start-woosh.ps1     # :6302  Woosh
pwsh engines/start-mmaudio.ps1   # :6303  MMAudio
```
> Editing/exporting works without the engines — you just can't generate SFX.

**Requirements**: Node.js 20+, Windows, NVIDIA RTX GPU (for SFX generation), ffmpeg.

### AI control (MCP)

A built-in MCP server (`server/mcp-server.mts`) lets **Claude / Codex drive the running editor** (create projects, generate SFX, arrange the timeline). Opening the repo in Claude Code auto-detects `.mcp.json`; the backend must be running (`npm run dev`). See the [Wiki](https://github.com/chenisan/AudioSFX/wiki).

### Usage

1. **New project + import** — Project ▾ → New; drag a video/audio file into the window.
2. **Timeline editing** — move / trim / split; rename, lock, mute tracks. Selected track is indigo, muted track is amber.
3. **Add SFX**: top 〰 "音效" floating window has two tabs —
   - **Library** (fastest, no engine): pick a category / search → ▶ preview → "＋軌" to drop on the timeline, or "素材" to import only.
   - **AI generate — Text → SFX**: English prompt (e.g. `glass shatter`) → generate (needs the Woosh engine).
   - **Video → V2A**: right-click a video clip → generate synced ambience (MMAudio).
   - **At a position**: right-click empty audio track → "建立音效" (Create SFX, nameable).
4. **Mix** — left "效果" (Effects) tab → pick a track → fader / mute; "+ add effect" → EQ / compressor / limiter (**click the name to open a floating editor**); Main Out **LIMIT** for a master brickwall limiter.
5. **Preview** — top 🖥 toggles the floating preview window.
6. **Export** — ⬆ Export → (auto-save) → About → Next → settings → Export. The output carries an "Isan 13soul" watermark, bottom-right.

> Tips: `Ctrl+S` saves; hard-refresh with `Ctrl+Shift+R` after frontend changes.

### Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18 · Vite 5 · TailwindCSS 3 · Zustand 4 |
| Backend | Node.js 20+ · Express 4 · TypeScript 5 |
| Audio preview | Web Audio API |
| Rendering | ffmpeg (fluent-ffmpeg), NVENC fallback |
| Inference | MMAudio (py3.10) · Woosh (py3.13), each a FastAPI service |
| Native | Rust + napi-rs (waveform / thumbnail / probe) |
| Desktop | Electron + electron-builder |

### License

**PolyForm Noncommercial License 1.0.0** — **non-commercial** use only. See [LICENSE](./LICENSE).
The MMAudio / Sony Woosh weights it relies on are likewise CC BY-NC.
This tool bundles and invokes **FFmpeg (GPLv3)** as a separate executable; third-party licenses and sources are listed in [NOTICE.md](./NOTICE.md).

---

## 關於作者 · Author

**Isan（13soul）** — 全端設計工程師 · 影像及音樂創作人 / full-stack design engineer · video & music creator

- 官方網站 / Website · <https://www.poofone.com.tw/>
- Threads · <https://www.threads.com/@isan1314558>
- YouTube · <https://www.youtube.com/@13Neosoul>
- Instagram · <https://www.instagram.com/isan1314558/>
- Facebook 社團 / Group · <https://www.facebook.com/groups/26340062805675868>
