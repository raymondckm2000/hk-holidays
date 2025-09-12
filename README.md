# HK Holidays (2017–2026)

這個專案提供一個簡單月曆範本，可以顯示 **香港公眾假期／勞工假期** 資料。

## Screenshots
![Demo screenshot](docs/screenshot-placeholder.png)

👉 **GitHub Pages Demo**: [點此開啟](https://raymondckm2000.github.io/hk-holidays/)

## 功能
- 月曆檢視（標示假期）
- 年/月視圖切換
- 語言切換（中文 / English）

## 使用方式
1. 開啟 [Demo 頁面](https://raymondckm2000.github.io/hk-holidays/)。
2. 預設會載入 `data/company_holidays_ALL.json` 顯示假期。
3. 可透過選單切換年份、語言與視圖。
4. 如需離線預覽，可直接在瀏覽器開啟 `index.html`。

## 專案檔案
- `index.html` — 簡單月曆模板（類似 timeanddate 樣式）
- `hk_holidays_2017_2026.json` — 假期資料（2017–2026）
- `generate.js` — Node.js 抓取假期原始來源並生成 JSON

## Fetching holiday data

```
npm run fetch:holidays
```

上述指令會從 1823 等來源下載最新公司假期資料，
並把 JSON 檔寫入 `data/`，驗證報告寫入 `reports/`。
這兩個資料夾都設為 `.gitignore`，檔案不會被提交到版本控制中。

---
© 2025 raymondckm2000 — Demo project for HK holiday data
