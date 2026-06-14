# English Runtime 21 — Web MVP

**▶ 線上 Demo：https://kyoyang.github.io/EnglishMVP/** （請用 Chrome / Edge 開啟並允許麥克風）

純前端（靜態）示範版，可直接以 GitHub Pages 執行，無需後端。取自《English Runtime 21》21 天小聊天特訓的 Day 1 內容片段。

## 功能
- **雙人對話跟讀**：瀏覽器 Web Speech 朗讀 A / B 兩個角色（僅一個英文語音時自動以音高區隔），可逐句播放 / 慢速。
- **發音評分**：以麥克風語音辨識轉錄你的跟讀，於本機用詞級 Levenshtein 對齊算出準確度並標色（綠=正確 / 黃=替換 / 紅=漏字）。
- **今日單字**：點喇叭朗讀例句。
- **背景音樂**：一首內建 mp3，可播放 / 暫停 / 停止 / 循環 / 調音量，並標註 BPM 與強度（跟讀/朗讀時自動暫停以免干擾）。

## 使用需求
- **Chrome 或 Edge**（語音朗讀與麥克風辨識需 Web Speech API），並允許麥克風權限。
- 需透過 http(s) 開啟（GitHub Pages 即可）；直接雙擊 `file://` 開啟時語音辨識可能受限。

## 部署到 GitHub Pages
Repo → Settings → Pages → Source 選 `main` 分支、`/ (root)` → 儲存，稍候即可由 `https://<帳號>.github.io/<repo>/` 開啟。

## 說明
此為精簡 demo；完整版（21 天課程、間隔複習、進度追蹤、桌面 App）為另一個專案。背景音樂為作者擁有授權之 AI 生成音樂。
