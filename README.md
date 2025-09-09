# HK Holidays (2017–2026)

這個專案提供一個前端示範頁，可以顯示和編輯 **香港公眾假期／勞工假期** 資料。

## Screenshots
![Demo screenshot](docs/screenshot-placeholder.png)

👉 **GitHub Pages Demo**: [點此開啟](https://raymondckm2000.github.io/hk-holidays/)

## 功能
- 月曆檢視（標示假期）
- 篩選公眾／勞工假期
- 語言切換（中文 / English / 雙語）
- 年度列表編輯模式（可新增、刪除、修改假期）
- 本地 JSON 匯入／下載
- 驗證假期資料完整性

## 使用方式
1. 開啟 [Demo 頁面](https://raymondckm2000.github.io/hk-holidays/)。
2. 預設會嘗試載入 `hk_holidays_2017_2026.json`，若失敗可手動拖放 JSON 檔。
3. 切換至「年度列表/編輯」分頁可調整假期資料。
4. 如需離線預覽，可直接在瀏覽器開啟 `index.html`。

## 專案檔案
- `index.html` — 前端示範頁
- `calendar-template.html` — 簡單月曆模板（類似 timeanddate 樣式）
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
