# oaw-template

Aprico 的 LINE 官方帳號固定範本。客戶從這個範本建立自己的 repo，由**客戶自己的** GitHub Actions 在客戶自己的 Supabase 與 LINE 帳號裡開站。完整流程見 Aprico 的 `docs/SIMPLIFIED-FLOW.md`。

## 開站後客戶得到什麼

| 元件 | 內容 |
| --- | --- |
| `{px}-webhook` | LINE Webhook：選單回覆、文字或卡片、擁有者綁定、擁有者對話修改、秘書回覆 |
| `{px}-api` | LIFF 後端：驗證 LINE 登入後回傳會員卡、發布圖文選單（限擁有者） |
| 資料表 | `{px}_config`、`{px}_owner`、`{px}_members`、`{px}_pending`，全部開 RLS，只有 Edge Functions 能存取 |
| LIFF 頁 | GitHub Pages：會員卡、選單內頁、擁有者的「發布圖文選單」 |

`{px}` 是客戶自選的前綴（2–8 個小寫英數字），讓多個 OA 可以共用一個 Supabase 專案。

## 目錄

| 路徑 | 內容 |
| --- | --- |
| `oaw/config.json` | 初始設定（選單、歡迎詞、預設回覆）。只在第一次開站寫入資料庫，之後由擁有者在 OA 對話修改 |
| `template/supabase/` | Edge Functions 與資料表 SQL，開站時套上前綴 |
| `liff/` | LIFF 頁面；`config.js` 由開站流程產生 |
| `scripts/oaw-setup.mjs` | 開站腳本（在 Actions 裡執行） |
| `.github/workflows/oaw-setup.yml` | 開站；可重跑 |
| `.github/workflows/oaw-pages.yml` | `liff/` 有變更時重新發布 Pages |

## 開站需要的 Secrets 與 Variables

由 Aprico 建置頁在瀏覽器加密後寫入，客戶不用手動設定。

| 名稱 | 類型 | 必要 | 說明 |
| --- | --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Secret | ✅ | Supabase Access Token |
| `OAW_LINE_MSG_ID`、`OAW_LINE_MSG_SECRET` | Secret | ✅ | Messaging API Channel ID 與 Secret |
| `OAW_LINE_LOGIN_ID`、`OAW_LINE_LOGIN_SECRET` | Secret | ✅ | LINE Login Channel ID 與 Secret（LIFF 用） |
| `OAW_BIND_CODE` | Secret | | 6 位數擁有者綁定碼，24 小時有效 |
| `OAW_APRICO_KEY` | Secret | | 呼叫 Aprico 秘書與修改服務的金鑰 |
| `OAW_SB_DB_PASS` | Secret | | 新建 Supabase 專案的資料庫密碼；沒給就隨機產生 |
| `OAW_PX` | Variable | ✅ | 前綴 |
| `OAW_SB_REF` | Variable | | 使用既有 Supabase 專案；空白就新建 |
| `OAW_SB_ORG`、`OAW_SB_REGION` | Variable | | 新建專案的組織與區域（預設東京） |
| `OAW_APRICO_RUNTIME_URL`、`OAW_APRICO_DESIGN_URL` | Variable | | Aprico 秘書與修改服務的網址 |

LINE 不存長效 token：每次都用 Channel ID 與 Secret 換 15 分鐘的 stateless token。

## 開站流程（`oaw-setup.yml`）

1. 驗證 LINE 兩組 Channel（錯了就停止，什麼都不建立）
2. 建立或使用 Supabase 專案，建資料表，寫入初始設定與綁定碼雜湊
3. 建立或更新 LIFF app，網址指向本 repo 的 GitHub Pages
4. 寫入 Supabase secrets，部署兩支 Edge Functions
5. 設定 LINE Webhook 網址並測試
6. 產生 `liff/config.js`、`oaw/status.json`（只有公開值），發布 Pages

開站後擁有者在 OA 傳綁定碼，再開啟 LIFF 的「發布圖文選單」頁面完成選單。

## 開發

```bash
npm test   # 單元測試（Node 22，不連網）
OAW_PX=demo GITHUB_REPOSITORY=me/demo-oa node --experimental-strip-types scripts/oaw-setup.mjs --dry-run
```

## 舊文件

`docs/oaw-spec.md` 是先前精靈網頁的規格，已被 Aprico 的 `docs/SIMPLIFIED-FLOW.md` 取代。
