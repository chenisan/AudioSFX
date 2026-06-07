# Third-Party Notices · 第三方授權聲明

AudioSFX 的程式碼以 **PolyForm Noncommercial License 1.0.0** 授權（見 [LICENSE](./LICENSE)）。
下列第三方元件以各自授權散布／使用。
AudioSFX's own source is under **PolyForm Noncommercial 1.0.0**; the third-party components below keep their own licenses.

---

## FFmpeg / ffprobe

AudioSFX **打包並以「獨立執行檔」方式呼叫** FFmpeg（`ffmpeg.exe` / `ffprobe.exe`）進行影音渲染與探測。
AudioSFX **bundles and invokes** FFmpeg (`ffmpeg.exe` / `ffprobe.exe`) **as a separate executable** for media rendering/probing.

- **Build**：gyan.dev Windows “essentials” build，FFmpeg 6.1.1，組態含 `--enable-gpl --enable-version3`。
- **授權 / License**：**GNU General Public License v3.0 (GPLv3)**。
  FFmpeg 二進位以 GPLv3 散布；AudioSFX 自身原始碼為另一份授權（PolyForm Noncommercial），僅以**獨立行程**呼叫 FFmpeg（GPL 所稱之 *mere aggregation*），不與其靜態／動態連結。
  The FFmpeg binaries are distributed under GPLv3; AudioSFX's own source is separately licensed and only calls FFmpeg as a separate process (*mere aggregation* under the GPL), not linked against it.
- **未修改原始碼 / No modification**：AudioSFX 不修改 FFmpeg 原始碼。
- **專案 / Project**：<https://ffmpeg.org>
- **對應原始碼 / Corresponding source**：<https://ffmpeg.org/download.html> · <https://www.gyan.dev/ffmpeg/builds/>
- **授權全文 / License text**：<https://www.gnu.org/licenses/gpl-3.0.html>
- 透過 npm `ffmpeg-static`（GPL-3.0-or-later）與 `ffprobe-static` 取得。
- 此 build **未啟用** `--enable-nonfree`，故可合法散布。NVENC（`h264_nvenc`）由 `--enable-nvenc/cuvid/ffnvcodec` 提供，非 nonfree。

> H.264 / H.265 等編解碼器之專利（如 MPEG-LA）獨立於軟體授權。AudioSFX 為**非商業**工具，相關商業／規模化專利議題不適用；若日後轉商業用途，請另諮詢法務。
> Codec patents (e.g. H.264/H.265, MPEG-LA) are separate from software licensing. AudioSFX is **non-commercial**, so commercial-scale patent concerns do not apply; consult counsel before any commercial use.

---

## AI 模型權重 · AI model weights（不隨本工具散布 / not bundled）

由使用者自行下載（見 [ENGINES.md](./ENGINES.md)）。User-installed (see ENGINES.md).

- **MMAudio** — github.com/hkchengrex/MMAudio：code MIT，**權重 CC BY-NC 4.0**。
- **Sony Woosh** — github.com/SonyResearch/Woosh：code MIT/Apache-2.0，**權重 CC-BY-NC**。

兩者權重皆**僅限非商業**，這也是 AudioSFX 維持非商業定位的原因。
Both weights are **non-commercial only**, which is why AudioSFX stays non-commercial.

---

## 字型 · Fonts

- **Noto Sans TC**（CJK 文字渲染）— SIL Open Font License 1.1。
