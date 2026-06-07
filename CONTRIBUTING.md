# 參與貢獻 · Contributing

感謝你對 **AudioSFX** 有興趣！Thanks for your interest in **AudioSFX**.

> ⚠️ 本專案採 **PolyForm Noncommercial 1.0.0**（僅限非商業），且依賴的 MMAudio / Sony Woosh 權重為 CC BY-NC。貢獻內容須維持此非商業定位。
> This project is **non-commercial** (PolyForm Noncommercial 1.0.0); contributions must keep that non-commercial stance.

## 回報問題 · Reporting issues
- 先搜尋是否已有相同 issue。Search existing issues first.
- 用 issue 範本，附上重現步驟、預期/實際結果、環境（OS / GPU / Node 版本）。
  Use the issue templates; include repro steps, expected/actual results, and environment.

## 開發 · Development
```powershell
npm install
npm run dev          # 前端 :6300 / 後端 :6301
npm run typecheck    # 後端 TS
npm run test         # vitest
```
- AI 引擎安裝見 [ENGINES.md](./ENGINES.md)（生成音效才需要）。
- 架構與協作守則見 [CLAUDE.md] / `README.md`。Architecture & conventions in the README.

## 送 PR · Pull requests
1. 從 `main` 開分支。Branch off `main`.
2. 保持改動聚焦、小而清楚。Keep changes focused.
3. **預覽↔匯出鏡像**：音訊效果有兩份實作（`audioEngine.js` 預覽 ↔ `ffmpegBuilder.ts` 匯出），改一邊請同步另一邊。
   Audio effects have a preview/export mirror — update both sides.
4. `npm run typecheck` 與 `npm run build` 要過。Make sure typecheck + build pass.
5. commit 訊息具體；用 PR 範本。Write clear commits; use the PR template.

## 行為準則 · Code of conduct
參與即同意 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。
By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).
