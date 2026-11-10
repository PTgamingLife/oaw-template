# OAW 規格書 v0.1 — 精靈網頁 + 客戶自己的 GitHub Actions

> 狀態:**草稿,待確認**。確認前不寫程式。
> 標 ❓ = 需實測;標 🟡 = 待你決定。

---

## 0. 目標與原則

| 原則 | 做法 |
|---|---|
| 所有權歸客戶 | repo、網站(Pages)、Supabase、LINE OA 全在客戶帳號 |
| 金鑰不經過開發者 | 精靈是純靜態頁,所有 API 由客戶手機瀏覽器直連 GitHub;其餘由客戶 repo 的 Actions 執行 |
| 只有手機也能完成 | 精靈頁全程手機友善;沒有終端機;切 App 不會斷(進度存在客戶 GitHub) |
| 可重跑 | 每個步驟都是「有就更新、沒有就建立」,失敗按「重試」即可 |
| AI 不碰金鑰 | 階段二 AI 只改設定檔,套用由 Actions 讀 Secrets 執行 |

---

## 1. 客戶需要準備的帳號

| 帳號 | 費用 | 用途 |
|---|---|---|
| GitHub | 免費 | 放 repo、Actions 執行開站、Pages 放 LIFF 網頁 |
| Supabase | 免費(每個組織最多 2 個免費專案) | 資料庫 + Edge Functions |
| LINE 官方帳號 + LINE Developers | 免費 | OA、Messaging API、LINE Login(LIFF) |

---

## 2. 整體架構

```
[客戶手機瀏覽器] 精靈網頁(你的 GitHub Pages,純靜態,不收任何資料)
   │  W1~W6:只呼叫 api.github.com(支援瀏覽器 CORS)
   ▼
[客戶 GitHub]  {repo} ← 由 PTgamingLife/oaw-template 產生
   ├ Actions Secrets(加密存放所有金鑰)
   ├ Actions:oaw-setup / oaw-verify / oaw-apply / oaw-pages
   └ Pages:https://{客戶帳號}.github.io/{repo}/liff/
   │
   ▼ Actions 呼叫
[客戶 Supabase]  資料表 + {px}-webhook + {px}-api + secrets
[客戶 LINE]      Webhook URL、LIFF app、圖文選單
```

---

## 3. 前綴 `{px}`:客戶自選

- 規則:2–8 字元,小寫英數,字母開頭(例:`shop`、`cafe1`)
- 為什麼:免費 Supabase 只有 2 個專案,客戶可能把多個 OA 裝進同一個專案,前綴避免撞名

| 位置 | 命名 | 例(px=cafe) |
|---|---|---|
| repo 預設名稱 | `{px}-oa` | `cafe-oa` |
| 資料表 | `{px}_xxx` | `cafe_members` |
| Edge Functions | `{px}-webhook`、`{px}-api` | `cafe-webhook` |
| Supabase secrets | `{PX}_LINE_MSG_ID` 等 | `CAFE_LINE_MSG_ID` |
| 圖文選單名稱 / LIFF 描述 | `{px}-main` | `cafe-main` |
| GitHub Secrets | **固定** `OAW_*`(repo 本身已一專案一 repo,不需前綴) | `OAW_LINE_MSG_ID` |

---

## 4. 精靈頁面細節

共 10 頁,上方進度點 ●●○○○。每頁底部固定「上一步 / 下一步」。輸入值只存在**頁面記憶體**;
為了切 App 回來不遺失,非機密欄位存 `sessionStorage`,**機密欄位不存**(回來若頁面被系統重載,需重貼)。

### P0 歡迎
- 標題:「10 分鐘,把你的 LINE 官方帳號接上會員系統」
- 準備清單:GitHub / Supabase / LINE 三個帳號(各附註冊連結)
- 隱私說明(固定文案):「你貼的金鑰只會從你的手機直接送進你自己的 GitHub,開發者看不到。本頁原始碼公開:{連結}」
- 按鈕:開始

### P1 基本設定
| 欄位 | 預設 | 檢查 |
|---|---|---|
| 前綴 `{px}` | 空 | 規則見 §3,即時提示 |
| OA 顯示名稱 | 空 | 1–20 字 |
| LIFF 主題色 🟡 | `#06C755` | 色票 6 選 1 + 自訂 |
| Supabase 專案 | 「新建」 | 新建 / 使用既有(填 project ref,20 碼小寫) |
| Supabase 區域 | 東京 `ap-northeast-1` | 東京 / 新加坡 |

### P2 GitHub 金鑰
1. 按鈕「開啟 GitHub 產生金鑰頁」→
   `https://github.com/settings/tokens/new?scopes=repo,workflow&description=OAW-{px}`(classic,權限已預勾 ❓)
2. 圖示教學:滑到最下 → Generate token → 複製
3. 貼上欄位 → 「驗證」:`GET /user` + 讀 `x-oauth-scopes` 標頭
   - ✅「已連線:{login}」/ ❌「金鑰錯誤」/ ❌「缺少 workflow 權限,請重新產生」
4. 欄位:repo 名稱(預設 `{px}-oa`)→ 檢查是否已存在,存在則提示改名或「沿用(重跑)」

### P3 Supabase 金鑰
1. 按鈕「開啟 Supabase 金鑰頁」→ `https://supabase.com/dashboard/account/tokens`
2. 圖示教學:Generate new token → 名稱 `OAW` → 複製
3. 貼上 → 格式檢查(`sbp_` 開頭)。真正驗證在 Actions S2 ❓(若 Supabase API 允許瀏覽器呼叫,改為當場驗證)

### P4 LINE Messaging API(4 個值的前 2 個)
截圖步驟:
1. LINE Official Account Manager → 設定 → Messaging API → 啟用 → 選/建 Provider(**記住名稱**)
2. LINE Developers → 該 Provider → Messaging API channel → Basic settings
3. 複製 **Channel ID**(數字)、**Channel secret**(32 碼)

檢查:ID 為 10 位數字、secret 為 32 碼十六進位;真正驗證在 Actions S8。

### P5 LINE Login(LIFF 用)
截圖步驟:
1. LINE Developers → **同一個 Provider** → Create a new channel → LINE Login
2. App types 勾 **Web app**
3. 複製 Channel ID、Channel secret
4. ⚠️ 頁面上方狀態從 Developing 改 **Published**(不改的話一般使用者打不開 LIFF)
5. (選做)Linked LINE Official Account 選這個 OA

### P6 確認
- 列出所有設定,金鑰遮罩顯示 `sbp_••••3f2a`
- 列出將建立的東西:repo、Pages、Supabase 專案/資料表/2 個 Function、Webhook、LIFF、圖文選單
- 按鈕:**一鍵開站**

### P7 進度
即時清單,每項 ⏳ / ✅ / ❌(❌ 顯示原因 + 「重試」):

| # | 步驟 | 誰執行 |
|---|---|---|
| W1 | 確認 GitHub 帳號 | 瀏覽器 |
| W2 | 從範本建立 repo | 瀏覽器 |
| W3 | 等 repo 就緒 | 瀏覽器 |
| W4 | 加密寫入 Secrets / Variables | 瀏覽器 |
| W5 | 開啟 Pages | 瀏覽器 |
| W6 | 觸發 oaw-setup | 瀏覽器 |
| S1–S13 | Actions 各步驟(§6) | 客戶 Actions,精靈每 5 秒輪詢 job steps |

頁面關掉再開:輸入 repo 名稱 → 讀 `oaw/status.json` 接續顯示。

### P8 手動收尾(LINE 不開放 API 的部分)
截圖步驟:OA Manager → 設定 → 回應設定
- Webhook:**開**
- 自動回應訊息:**關**
- 加入好友的歡迎訊息:**關**(改由程式送)

按鈕「我完成了,測試」→ 觸發 `oaw-verify` → ✅ Webhook 測試成功 / ❌ 顯示 LINE 回傳的錯誤

### P9 完成
- 加好友 QR(`https://line.me/R/ti/p/@{basicId}`)+ 按鈕
- LIFF 網址 + 「用 LINE 開啟」
- repo 連結
- 🔒 收尾提醒:「刪除剛才的 GitHub 金鑰」→ `https://github.com/settings/tokens`(Supabase 金鑰保留在你的 GitHub Secrets,階段二要用)
- 下一步:「開始設計你的 OA」→ 階段二說明(§8)

---

## 5. 瀏覽器端動作(只打 api.github.com)

| # | API | 備註 |
|---|---|---|
| W1 | `GET /user` | 取 login |
| W2 | `POST /repos/PTgamingLife/oaw-template/generate` `{owner, name, private:false}` | Pages 免費版需公開 |
| W3 | 輪詢 `GET /repos/{o}/{r}/contents/oaw` | 最多 60 秒 |
| W4 | `GET /actions/secrets/public-key` → libsodium sealed box 加密 → `PUT /actions/secrets/{name}`;非機密用 `POST /actions/variables` | libsodium 從 cdnjs 載入,鎖版本 |
| W5 | `POST /repos/{o}/{r}/pages` `{build_type:"workflow"}` | 已開則略過 |
| W6 | `POST /actions/workflows/oaw-setup.yml/dispatches` `{ref:"main"}` → 輪詢 runs / jobs | 新 repo 的 Actions 可能需數秒才可觸發 ❓ |

### Secrets / Variables 一覽

| 名稱 | 類型 | 來源 | 用途 |
|---|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Secret | P3 | Supabase CLI |
| `OAW_SB_DB_PASS` | Secret | 瀏覽器隨機產生 32 碼 | 建專案用;P9 顯示一次讓客戶自存 |
| `OAW_LINE_MSG_ID` / `OAW_LINE_MSG_SECRET` | Secret | P4 | Messaging API |
| `OAW_LINE_LOGIN_ID` / `OAW_LINE_LOGIN_SECRET` | Secret | P5 | LIFF / ID token 驗證 |
| `OAW_PX`、`OAW_NAME`、`OAW_THEME`、`OAW_SB_REGION`、`OAW_SB_REF` | Variable | P1 | 非機密設定 |

GitHub token **不寫入任何地方**,只在瀏覽器記憶體。

---

## 6. GitHub Actions

### oaw-setup.yml(workflow_dispatch;全部可重跑)

| # | 步驟 | 做法 |
|---|---|---|
| S1 | 準備環境 | checkout、`supabase/setup-cli`、python |
| S2 | 驗證 Supabase 金鑰 | `supabase projects list`;失敗 → 「Supabase 金鑰錯誤」 |
| S3 | 建或選專案 | `OAW_SB_REF` 空 → `projects create {px}-oa`(第一個組織)→ 輪詢至 ACTIVE_HEALTHY → 寫回 Variable `OAW_SB_REF`;免費額度滿 → 明確錯誤「請刪一個專案或改用既有專案」 |
| S4 | 套用前綴 | `oaw/render.py` 把範本中的 `__px__`/`__PX__` 換成實際前綴,產生 `supabase/` 並 commit(之後 AI 改的就是這份實檔) |
| S5 | 建資料表 | `supabase link` → `db push` |
| S6 | 部署 Functions | `{px}-webhook`(`--no-verify-jwt`)、`{px}-api` |
| S7 | 設 Supabase secrets | `{PX}_LINE_MSG_ID/SECRET`、`{PX}_LINE_LOGIN_ID/SECRET` |
| S8 | 驗證 LINE | Messaging ID+Secret 換 stateless token;`GET /v2/bot/info` 取 basicId、名稱 |
| S9 | 設 Webhook | `PUT /v2/bot/channel/webhook/endpoint` → `https://{ref}.supabase.co/functions/v1/{px}-webhook` |
| S10 | 建/更新 LIFF | Login ID+Secret 換 stateless token;`GET /liff/v1/apps` 找描述 `{px}-main`,有則更新、無則新增;endpoint = Pages 的 `/liff/`,view = full,scope = openid profile |
| S11 | 圖文選單 | 刪名稱 `{px}-main` 的舊選單 → 建立 → 上傳圖 → 設為預設 |
| S12 | 寫前端設定 | `liff/config.js`:supabase url、anon key(`projects api-keys`)、liffId、px、主題色 → commit → 觸發 oaw-pages |
| S13 | 寫狀態 | `oaw/status.json`(只含公開值:basicId、LIFF 網址、各步驟結果、webhook 測試結果)→ commit,供精靈讀取 |

錯誤訊息一律寫進 `status.json` 的 `oaw_error`(中文、不含金鑰),精靈直接顯示。

### 其他 workflow

| 檔案 | 觸發 | 做什麼 |
|---|---|---|
| `oaw-verify.yml` | 手動(P8 按鈕) | `POST /v2/bot/channel/webhook/test` → 更新 status.json |
| `oaw-pages.yml` | push 到 `liff/**` | 部署 Pages |
| `oaw-apply.yml` | push 到 `oaw/**`、`supabase/**` | 階段二套用:db push、functions deploy、圖文選單/訊息同步 |

---

## 7. 預設 OA:通用版(最小可用)

| 元件 | 內容 |
|---|---|
| 資料表 | `{px}_members`(line_user_id、名稱、頭像、加入時間、會員編號);`{px}_settings`(歡迎訊息、關鍵字回覆 JSON) — 開 RLS,前端不直連,只經 Function |
| `{px}-webhook` | 驗 `X-Line-Signature` → follow:建會員 + 送歡迎訊息;message:比對關鍵字回覆;其他忽略 |
| `{px}-api` | LIFF 帶 ID token → 呼叫 LINE verify(client_id = Login ID)→ 回傳會員資料 |
| 圖文選單 | 2 格:「會員卡」(開 LIFF)/「聯絡我們」(送出文字) |
| LIFF | 會員卡頁:頭像、名稱、會員編號、加入日期;套用主題色 |
| 設定檔 | `oaw/richmenu.json` + `richmenu.png`、`oaw/messages.json` |

---

## 8. 階段二:客戶 + AI 設計 OA

- 客戶用 AI 編輯自己的 repo;push 後 `oaw-apply` 自動套用,用手機加好友即可看到結果
- AI 可改:`oaw/*.json`、`oaw/richmenu.png`、`liff/`、`supabase/migrations/`、`supabase/functions/`
- repo 內附 `CLAUDE.md` 規則:不讀取或輸出任何 Secret、不改 `.github/workflows/`、新資料表必須用 `{px}_` 前綴並開 RLS
- 🟡 AI 用誰的帳號(見 §12)

---

## 9. 安全設計

1. 精靈純靜態、原始碼公開、以 tag 固定版本部署;第三方程式只有 libsodium(cdnjs 鎖版本 + SRI)
2. GitHub token 只在記憶體;不寫 storage、不送第三方
3. 所有機密在瀏覽器以 repo 公鑰加密後才離開手機
4. Actions log:所有金鑰用 `::add-mask::`;status.json 只寫公開值
5. LINE token 用 stateless(15 分鐘),不存長效 token
6. Webhook 驗簽、LIFF 驗 ID token;資料表 RLS 全開
7. 開站完成提醒刪除 GitHub token

---

## 10. 常見錯誤與提示

| 情況 | 精靈顯示 |
|---|---|
| GitHub token 缺權限 | 「金鑰少了 workflow 權限,請用上方按鈕重新產生」 |
| repo 名稱已存在 | 「已有同名 repo:改名,或選擇沿用並重跑」 |
| Supabase 免費額度滿 | 「Supabase 免費專案已滿 2 個:請刪一個,或回 P1 改用既有專案」 |
| LINE ID/Secret 錯 | 「LINE Messaging 金鑰錯誤,請回 P4 重新複製」 |
| Login channel 未 Published | 「LIFF 只有你自己能開:請把 Login channel 改成 Published」 |
| Webhook 測試失敗 | 顯示 LINE 原始錯誤 + 「確認 P8 的 Webhook 已開啟」 |

---

## 11. 待實測 ❓

1. classic token 網址能否預勾 `repo,workflow`
2. 從範本產生的 repo,Actions 是否立即可被 `dispatches` 觸發
3. Supabase Management API 是否允許瀏覽器呼叫(可行則 P3 當場驗證)
4. Login channel 的 stateless token 能否用於 LIFF Server API(搜尋結果顯示可以)
5. Webhook 開關是否必須手動(第三方資料說必須)

---

## 12. 待你決定 🟡

1. **配色**:你回「不用選」— 我的理解是:精靈本身用中性黑白灰,**LIFF 主題色由客戶在 P1 自選**。對嗎?
2. **階段二 AI 用誰的**:(a) 客戶自己的 Claude 帳號 / (b) 你提供(你的帳號經客戶授權改他的 repo)
3. **Supabase 預設區域**:東京 or 新加坡
4. **精靈網頁放哪**:`oaw-template` 的 Pages(原始碼公開、方便客戶查核)— 建議如此
