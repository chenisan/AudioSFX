# AudioSFX

> 本地、非商業的「影片 → 音效」創作工具。
> A local, non-commercial **video → sound-effects** tool. Generate AI SFX on your own GPU, align them on a timeline, and mux back into the video.

![license](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)
![platform](https://img.shields.io/badge/platform-Windows-lightgrey)
![stack](https://img.shields.io/badge/Electron%20%2B%20React%20%2B%20Node-informational)

設計製作 · **Isan（13soul）** — 全端設計工程師 · 影像及音樂創作人

---

## 這是什麼

你有一段沒有聲音（或只有原聲）的影片，想替它加上**對得準的音效**：whoosh、撞擊、腳步、玻璃碎、環境底聲…

AudioSFX 在你自己的電腦（本地 GPU）跑兩個 AI 模型生成音效，讓你在時間軸上對齊、混音，再用 ffmpeg 輸出成帶音效的影片。

- **Sony Woosh** — 文字／影片 → SFX（whoosh / punch / impact，超快）
- **MMAudio** — 影片 → 同步環境底聲（依畫面生成貼合的背景音）

> ⚠️ 兩個模型權重是 **CC BY-NC（僅限非商業）**，本工具維持非商業定位，不可接進收費產品。LICENSE 採 PolyForm Noncommercial 1.0.0。

---

## 特色

- 🎬 **9:16 直式時間軸編輯器** — 影片／音訊／文字多軌，拖移・裁切・分割
- 🤖 **三種音效生成入口** — 文字→SFX、影片→V2A 同步音、音軌指定位置生成
- 🎚 **DAW 風格混音** — 每軌 EQ / 壓縮器 / 限幅器（可拖曳浮動視窗編輯）+ 母帶防爆 limiter
- 🖥 **浮動預覽窗** — 右下可拖／可調大小，預覽即所得
- ⚡ **ffmpeg 渲染** — NVENC GPU 自動加速，匯出 MP4 / MOV / WebM / WAV
- 📦 **桌面安裝版** — Electron 打包，內嵌後端 + ffmpeg，動態 port

---

## 架構

```
React UI (src/)  ──REST──▶  Express 後端 (server/)  ──HTTP──▶  Python 推論 (engines/)
時間軸・預覽・效果           core 編輯/渲染規則              Woosh :6302 / MMAudio :6303
Web Audio 預覽引擎           ffmpeg 渲染 (NVENC)             各自 venv，/evict 互斥
                            Rust napi 原生模組（波形/縮圖/probe）
```

外部生成的音檔一律落地 `data/projects/<id>/assets/`，成為素材；時間軸上的是 clip。

---

## 安裝與啟動

### 開發模式
```powershell
npm install
npm run dev          # 前端 :6300 / 後端 :6301
```
開 **http://localhost:6300**。

### Python 推論引擎（音效生成需要，GPU）
UI 右上「引擎」面板按啟動，或手動：
```powershell
pwsh engines/start-woosh.ps1     # :6302  Woosh
pwsh engines/start-mmaudio.ps1   # :6303  MMAudio
```
> 沒啟動引擎也能剪輯／匯出，只是不能生成音效。

### 桌面安裝版
```powershell
npm run electron:pack    # 產出 release/win-unpacked/AudioSFX.exe（免安裝資料夾版）
npm run electron:dist    # 產出 NSIS 安裝檔
```

**需求**：Node.js 20+、Windows、NVIDIA RTX GPU（音效生成；實測 RTX 5060 Ti 16GB）、ffmpeg。

---

## 使用教學

### 1. 建專案 + 匯入
頂部「專案 ▾」→ 新建。把影片／音檔**直接拖進視窗**，會列在左欄「素材」。

### 2. 時間軸剪輯
拖 clip 移動、拖兩端裁切、分割切斷。軌道頭可改名／鎖定／隱藏／**M 靜音**。
- 選中的軌 → **靛紫底 + 左緣紫條**；靜音的軌 → **暖琥珀底**。
- 左上「**全部靜音**」一鍵切換所有音／視軌。

### 3. 生成音效（三種入口）

| 入口 | 用途 | 怎麼開 |
|---|---|---|
| **文字 → SFX** | 用英文描述生一顆音效 | 頂部〰「音效」浮窗 → prompt → 生成 |
| **影片 → V2A** | 依畫面生貼合的同步底聲 | 右鍵影片 clip → 生成同步音效 |
| **音軌指定位置** | 在某個時間點生 SFX | 右鍵音軌空白 →「建立音效」（可命名） |

文字描述用**英文**，例：`sword swing whoosh`、`glass shatter`、`heavy footsteps`。生成後落地「素材」，拖到音軌對齊到動作那一幀。

### 4. 混音與效果
左欄「效果」分頁 → **先選一條軌**：
- **Channel Strip**：dB 推桿（雙擊回 0dB）+ post-FX meter + M 靜音。
- **INSERTS**：「+ 加效果」→ EQ（5 段）/ 壓縮器 / 限幅器，**點效果名開浮動視窗**調參。
- **Main Out**（釘在底部）：主音量 + OUT 表 + CLIP 燈 + **LIMIT 防爆母帶**（預覽＝匯出同步）。

### 5. 預覽
頂部 🖥「預覽」開右下浮動預覽窗（可拖／可調大小，位置記住）。

### 6. 匯出
頂部 ⬆「匯出」→（自動存檔）→ **關於作者** →「下一步」→ 設定（格式／解析度／FPS／範圍）→ 匯出。
成品右下角會有「Isan 13soul」浮水印。

### 小技巧
- **`Ctrl+S`** 存檔（編輯只在記憶體，不存會丟）。
- 改過前端畫面沒更新 → **`Ctrl+Shift+R`** 硬重整。

---

## 技術棧

| Layer | Tech |
|---|---|
| Frontend | React 18 · Vite 5 · TailwindCSS 3 · Zustand 4 |
| Backend | Node.js 20+ · Express 4 · TypeScript 5 |
| 音訊預覽 | Web Audio API（track bus = plugin host） |
| 渲染 | ffmpeg（fluent-ffmpeg），NVENC fallback |
| 推論 | MMAudio（py3.10 / torch cu128）· Woosh（py3.13 / torch cu128），各自 FastAPI |
| Native | Rust + napi-rs（波形／縮圖／probe） |
| Desktop | Electron + electron-builder |

---

## 授權

**PolyForm Noncommercial License 1.0.0** — 僅限**非商業**用途。詳見 [LICENSE](./LICENSE)。
本工具依賴的 MMAudio / Sony Woosh 模型權重亦為 CC BY-NC，請勿用於任何收費產品。

---

## 關於作者

**Isan（13soul）** — 全端設計工程師 · 影像及音樂創作人

- 官方網站 · <https://www.poofone.com.tw/>
- Threads · <https://www.threads.com/@isan1314558>
- YouTube · <https://www.youtube.com/@13Neosoul>
- Instagram · <https://www.instagram.com/isan1314558/>
- Facebook 社團 · <https://www.facebook.com/groups/26340062805675868>
