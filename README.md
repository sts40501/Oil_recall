# E-Recall 電子發票毒油回收快速查詢系統

一個專為台灣消費者設計的優質、高互動性單頁網頁應用程式 (SPA)，旨在協助使用者透過電子發票資訊，快速查詢所購買的產品是否受到「中聯油脂案」毒油事件的波及。

## 🌟 核心功能

1. **發票 QR Code 掃描比對**：
   - 整合 `html5-qrcode` 程式庫，可直接使用手機或電腦視訊鏡頭掃描發票 QR Code。
   - 支援手動複製發票 QR Code 字串進行解析。
   - **100% 本地端解析**，保障隱私。

2. **手機載具發票比對（雙重方案）**：
   - **方案 A (CSV 檔案匯入)**：直接匯入從財政部電子發票平台下載的「消費明細」CSV，在本地端瀏覽器沙盒中直接完成歷史發票比對。
   - **方案 B (登入載具自動比對)**：介接財政部「查詢載具發票明細 API」。正式部署時將 AppID/APIKey 保留於伺服器環境變數，使用者只需輸入載具條碼與密碼即可查詢當次明細；前端不會保存載具密碼。

3. **手動產品關鍵字比對**：
   - 支援多重條件篩選（縣市地區、下架大廠品牌、比對資料庫類型）。
   - 快速篩檢單一食品或店家是否被食藥署稽查列管。

4. **毒油流向視覺化圖表**：
   - 以精緻的視覺化節點呈現受污染原料油（313 及 315 號油槽）流向福壽、福懋、泰山等大廠，並衍生出哪些終端產品的關係鏈。

5. **食藥署官方完整下架明細**：
   - 內建 440 項官方公告之預防性下架品項。
   - 內建 489 筆油脂下游業者稽查清單。
   - 新增泰山企業於 115/07/12 公開的 4,691 筆下游流向紀錄，含好市多、鬍鬚張、王品、瓦城、爭鮮等可搜尋業者及批號。
   - 支援分頁與關鍵字即時篩選。

---

## 🛠️ 專案架構

- `index.html`：網頁主體結構（包含 RWD 與 SEO 標籤）。
- `style.css`：採用深色模式（Dark Mode）、霓虹漸層警示與毛玻璃效果（Glassmorphism）的視覺設計。
- `app.js`：核心比對邏輯、發票 QR Code/CSV 解析器、流向圖繪製。
- `server.js`：Node.js 後端代理伺服器（用於方案 B 對財政部 API 進行簽章與轉發）。
- `netlify.toml`：Netlify 部署與路由重新導向（Redirects）設定檔。
- `netlify/functions/`：Netlify 無伺服器函數（Serverless Functions），包含 `carrierHeader`、`carrierDetail`、`health`。
- `data/`：食藥署公告資料庫（`recall_list.json`、`downstream_vendors.json`）。
  另含泰山公開附件擷取的 `taisun_downstream_20260712.json`；來源批次會在介面中分開標示，避免誤認為食藥署最終裁定名單。

---

## 🚀 啟動與部署指引

### 1. 本地端開啟（僅使用靜態網頁、掃描與 CSV 匯入）
直接於瀏覽器中雙擊開啟 [index.html](index.html) 即可使用。

### 2. 啟動本地 Node.js 代理伺服器（方案 B 載具比對）
本機需安裝 Node.js 環境，於終端機執行：
```bash
# 安裝依賴
npm install

# 正式環境：將財政部核發的憑證僅放在伺服器端
export EINVOICE_APP_ID='your-app-id'
export EINVOICE_API_KEY='your-api-key'

# 啟動代理伺服器 (預設 Port 3000)
npm start
```

### 3. 部署至 Netlify 雲端
本專案已完全相容 Netlify Serverless Functions，無須維護實體伺服器即可完美執行後端載具 API！

#### 方法 A：連動 Git 儲存庫自動建置（推薦）
1. 將專案推送至 GitHub 等儲存庫。
2. 登入 Netlify 點選 **Add new site** -> 連動該儲存庫。
3. **建置設定**：
   - Build command: *留空*
   - Publish directory: `.`
   - Functions directory: `netlify/functions` (Netlify 會自動讀取 `netlify.toml`，通常無須手動填寫)
4. 點選 Deploy 即可上線。

#### 方法 B：使用 Netlify CLI 本地模擬開發
```bash
# 安裝 Netlify CLI
npm install -g netlify-cli

# 啟動模擬環境
netlify dev
```
*伺服器將在 `http://localhost:8888` 啟動，自動轉發前端所有的 `/api/*` 請求。*

在 Netlify 部署時，請於 Site configuration → Environment variables 設定 `EINVOICE_APP_ID` 與 `EINVOICE_API_KEY`，不要將金鑰寫入 HTML、JavaScript 或 Git 儲存庫。未設定時，介面仍可使用 CSV 與 QR Code 本地比對，也可在「開發者設定」暫時輸入自己的憑證。

---

## ⚠️ 免責聲明
本系統之產品及業者清單彙整自中華民國衛生福利部食品藥物管理署官方公告（截至 115/07/09）及泰山企業 115/07/12 公開流向附件。流向紀錄不等同個別消費品已檢出不合格；查詢結果僅供參考，請以食藥署專區、業者公告與商品批號為準。
