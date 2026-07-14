# E-Recall Chromium 擴充功能

此資料夾可直接以 Chrome 或 Edge 的「載入未封裝項目」安裝。它只提供**登入後的手機載具查詢**；網站版仍維持 CSV 與 QR Code 的本機手動比對。

## 安裝與設定

1. 先在 Netlify 部署主網站，並啟用 **Identity**。
2. 於 Netlify 的 Environment variables 設定 `EINVOICE_APP_ID` 與 `EINVOICE_API_KEY`（Production scope）。
3. 在 Chrome 開啟 `chrome://extensions`，啟用「開發人員模式」，選擇「載入未封裝項目」，選取這個 `extension/` 資料夾。
4. 在擴充功能的「設定」填入 Netlify 網站 HTTPS 網址，並同意該單一網站權限。
5. 使用 Netlify Identity 帳號登入後，才會顯示載具查詢畫面。

## 隱私與權限

- `EINVOICE_API_KEY` 僅存在 Netlify Function 環境變數；不會打包到擴充功能。
- Netlify Identity access token 僅放在 `chrome.storage.session`，關閉瀏覽器工作階段即清除。
- 手機條碼與載具密碼僅在按下查詢時以 HTTPS 傳給 Function，完成後立即清空密碼輸入欄，不寫入任何 Chrome storage。
- 擴充功能採用 optional host permission；使用者只會授權設定頁指定的單一服務網址。

## Netlify Identity 設定

在 Netlify 專案的 **Configuration → Identity** 啟用 Identity。建議將 Registration 設為 **Invite only**，由管理者邀請可使用載具查詢的人員；這可避免公開帳號被用來消耗財政部 API 配額。
