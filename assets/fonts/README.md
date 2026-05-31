# Bundled Fonts

Drop Noto Sans TC `.ttf` here. `fontDetect.ts` searches this folder first (before the user's Windows Fonts), so the Electron installer ships with a predictable CJK font even on machines that lack it.

## Required files (any one is enough; ordered by preference)

1. `NotoSansTC-Bold.ttf`
2. `NotoSansTC-Regular.ttf`
3. `NotoSansTC-VF.ttf` (variable font)

## Where to get them

Google Fonts → https://fonts.google.com/noto/specimen/Noto+Sans+TC → "Get font" → download the ZIP → extract the static `.ttf` files into this folder.

Direct source (GitHub, Apache-2.0 / OFL):
https://github.com/notofonts/noto-cjk/tree/main/Sans/OTF/TraditionalChinese

## Electron packaging note

In the Electron build, this folder is copied to `process.resourcesPath/assets/fonts/`. `fontDetect.ts` already handles both paths — no code change needed at packaging time.
