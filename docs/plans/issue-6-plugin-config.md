# Issue #6 執行計劃：讓 Plugin Config 與實際錄製能力一致

- Issue: [#6 Plugin config matches what recording actually does](https://github.com/studentmkp/vue-tracer/issues/6)
- 前置 Issue: #2 已關閉，`recordInstrumentedMutation()` 已成為 `__trace_set` / `__trace_update` / `__trace_call` / `__trace_delete` 共用的 mutation recording seam。
- 決策：採用 issue 允許的「先移除尚未生效的選項」路線，而不是在本次加入 event filtering 與 memory budgeting。

## 目標

公開的 Vite plugin interface 只保留目前確實有作用的選項：

- `enabled`
- `editor`
- `redact`

移除沒有實際效果的選項與文件宣稱：

- `events`
- `maxMemoryMB`
- `include`
- `exclude`
- `async`
- `computed`
- `watch`
- `pinia`

`redact` 必須繼續透過 transform 注入的 `__trace_configure()` 影響實際儲存的 mutation snapshot，且預設敏感欄位遮蔽行為不變。

> 注意：這裡只移除 **Vite plugin options** 的 `async`。`installTracing({ async: false })` 是 runtime installation interface，已有實際作用，不在本次移除範圍。

## 為什麼選擇移除，而不是現在實作

目前 `events` 與 `maxMemoryMB` 只從 plugin 傳進 transform，再由每個被 instrument 的 module 呼叫 `__trace_configure()` 儲存在 `redact.ts`；collector 完全沒有讀取它們。這是一個淺層、誤導性的 interface：呼叫端必須理解選項，但沒有得到對應行為。

本次先縮小 interface，原因如下：

1. Issue 明確接受移除未成熟選項。
2. `events` 需要先定義 interaction、mutation、component causality 等事件被排除時的關聯規則，不能只在 export/UI 階段過濾。
3. `maxMemoryMB` 需要明確的估算方式、淘汰單位與 policy（整條 trace、單一 event、或 snapshot），不應以不穩定的 `JSON.stringify().length` 草率充數。
4. 專案仍是 `0.0.1` early MVP；現在刪除虛假的 interface，比維持不生效的相容性更安全。

未來若重新加入這兩個選項，應由 collector/session lifecycle 的單一 retention/recording interface 實作，而不是繼續在 redaction module 中暫存。

## 現況摘要

### Plugin 與 transform

- `packages/vite-plugin/src/index.ts`
  - `ReactiveTracePluginOptions` 宣告八個目前未生效的選項。
  - `transform()` 只把 `redact`、`maxMemoryMB`、`events` 傳給 `transformCode()`。
- `packages/vite-plugin/src/transform.ts`
  - `TransformOptions` 包含 `maxMemoryMB`、`events`。
  - `buildConfigureCall()` 會把三者寫進 `__trace_configure()`。

### Runtime

- `packages/runtime/src/redact.ts`
  - `RuntimeTraceConfig` 同時承載 redaction 與未使用的 recording config。
  - `getRuntimeTraceConfig()` 沒有任何呼叫端。
  - `maxMemoryMB` / `events` 只被保存，collector 不會消費。
- `packages/runtime/src/collector.ts`
  - 所有事件仍直接 `trace.events.push(...)`。
  - export 與 overlay 查詢都讀同一份完整事件陣列，因此目前 plugin 選項不會限制 recording、overlay 或 export。

### 文件與測試

- `README.md` 的 quick-start、Plugin options 表格與 planned config 說明會讓使用者誤以為上述選項有效。
- `tests/redaction.test.ts` 目前主要驗證 configure call 被注入；其中 `maxMemoryMB: 50` 的 assertion 只證明字串存在，沒有證明任何 memory policy。

## 實作步驟

### 1. 縮小 Vite plugin 的公開 interface

修改 `packages/vite-plugin/src/index.ts`：

1. 從 `ReactiveTracePluginOptions` 刪除：
   - `include`
   - `exclude`
   - `events`
   - `async`
   - `computed`
   - `watch`
   - `pinia`
   - `maxMemoryMB`
2. 保留 `enabled`、`editor`、`redact`。
3. 呼叫 `transformCode()` 時只傳遞 `root` 與 `redact`。
4. 不改動 production instrumentation gate、plugin ordering warning 或 open-in-editor middleware。

完成後，TypeScript 使用者若傳入已移除的選項，應在 object-literal config 上得到 excess-property error，而不是得到看似成功但無效果的設定。

### 2. 讓 transform config 只負責 redaction

修改 `packages/vite-plugin/src/transform.ts`：

1. 從 `TransformOptions` 刪除 `maxMemoryMB` 與 `events`。
2. 簡化 `buildConfigureCall()`：
   - 沒有 `redact` 時回傳空字串。
   - 有 `redact` 時只產生 `__trace_configure({ redact: [...] })`。
3. 保留 function matcher serialization。
4. 保留 `__trace_configure` runtime import，因為 custom redaction 仍需要它。
5. 不更動 syntax instrumentation、source location 或 mutation helper 注入。

### 3. 將 runtime config module 收斂回 redaction 責任

修改 `packages/runtime/src/redact.ts`：

1. 將 `RuntimeTraceConfig` 縮小為只含 `redact`，或改名為更明確的 `RuntimeRedactConfig`。
2. 移除未使用的 `runtimeConfig` 狀態與 `getRuntimeTraceConfig()`。
3. `__trace_configure()` 仍維持 idempotent：相同 redaction config 被多個 instrumented module 重複執行時不應反覆重設。
4. `resetRedact()` 仍要同時重設 matcher 與 idempotence key，確保測試隔離。
5. 刪除「供 Plan 05 消費」等已失效註解。
6. 不改動 default sensitive keys、custom matcher precedence 或 `REDACTED` 值。

此步驟的 seam 仍是 `__trace_configure({ redact })`；呼叫端不需要知道 matcher compilation 與 default redaction 的 implementation。

### 4. 更新 README，停止宣稱未實作能力

修改 `README.md`：

1. 從 Vite config 範例移除：
   - `maxMemoryMB`
   - `events`
2. Plugin options 表格只列出：
   - `enabled`
   - `editor`
   - `redact`
3. 刪除「`include` / `exclude` / `async` / `computed` / `watch` / `pinia` exist on the options type」段落。
4. 保留並確認以下文件仍準確：
   - transform 目前處理的 syntax 清單。
   - `installTracing({ async: false })` 的 runtime 說明。
   - Pinia 自動註冊的 adapter 說明。
   - default redaction 與 privacy 說明。
5. 不新增未來選項承諾；需要時由後續 issue 重新設計並文件化。

### 5. 把測試從「有注入字串」提升到「實際效果」

修改 `tests/redaction.test.ts`，必要時新增 `tests/plugin-options.types.ts`：

#### Runtime effect tests

1. 保留 default redaction 測試，確認未提供 plugin/runtime config 時：
   - `password`、`token`、`secret`、`authorization`、`cookie` 及常見變體仍被遮蔽。
2. 新增或調整 custom redaction 測試，走完整 recording path：
   - 呼叫 `__trace_configure({ redact: ['**.ssn'] })`。
   - 註冊 reactive target 並透過 `__trace_set` 產生 mutation。
   - 斷言 collector 中的 `before` / `after` snapshot 已遮蔽。
   - 斷言 `exportTracesAsJSON()` 不包含原始 SSN。
3. 保留 function matcher 的效果測試。

#### Transform tests

1. 將原本含 `maxMemoryMB: 50` 的 injection test 改成只傳 `redact`。
2. 斷言輸出含 `__trace_configure` 與 matcher serialization。
3. 斷言未設定 `redact` 時不產生 configure call；instrumentation 本身仍正常產生。

#### Type-surface tests

若使用獨立 type fixture：

1. 驗證 `{ enabled, editor, redact } satisfies ReactiveTracePluginOptions` 可通過。
2. 對 `events`、`maxMemoryMB` 及其餘 planned flags 各使用 `@ts-expect-error`，確認它們不再屬於 interface。
3. 由 `tsc --noEmit` 驗證，避免只靠 runtime Vitest。

不要加入「runtime 接受但忽略未知欄位」的測試；目標是從公開型別與文件中真正移除，而不是靜默忽略。

### 6. 全域清理與驗證

執行全文搜尋，確認不存在殘留宣稱或 dead state：

```bash
rg -n "maxMemoryMB|events\?:|include\?:|exclude\?:|computed\?:|watch\?:|pinia\?:" \
  README.md packages tests
```

搜尋結果若仍出現一般事件集合、overlay filter 或 Vue `computed`/`watch` 功能，屬正常；需人工確認它們不是已移除的 plugin option。

執行：

```bash
npm test
npx tsc --noEmit
npm run build
```

並確認：

- 所有既有 mutation、component causality、async tracing、Pinia 與 redaction 測試通過。
- build 不再產生或依賴 `maxMemoryMB` / `events` config。
- README 範例可直接對應目前的 TypeScript interface。

## 驗收條件對照

| Issue #6 驗收條件 | 本計劃的完成方式 |
| --- | --- |
| `events` 限制 recording，或移除 | 從 plugin、transform、runtime config 與 README 移除 |
| `maxMemoryMB` 有 retention policy，或移除 | 從 plugin、transform、runtime config 與 README 移除 |
| planned flags 不得被文件宣稱為可用 | 從 `ReactiveTracePluginOptions` 與 README planned-surface 段落移除 |
| Redaction 預設仍生效 | 保留既有 default tests，並補完整 recording/export effect test |
| 測試不可只檢查 configure 被注入 | custom redaction 需經 mutation recording 與 export 驗證實際遮蔽結果 |

## 非目標

- 不在本次設計 event dependency semantics。
- 不在本次加入 memory size estimator、ring buffer 或 trace eviction policy。
- 不改 overlay 的互動式 filter；overlay filter 是查詢功能，不是 recording config。
- 不移除 runtime 的 `installTracing({ async })`。
- 不停用 computed、watch、Pinia 或 async tracing 的既有功能；只移除誤導性的 Vite plugin flags。
- 不改動 redaction 的 default keyword、matcher precedence 或 snapshot clone policy。

## 風險與注意事項

1. **名稱碰撞**：全文搜尋 `events`、`async`、`computed`、`watch` 會命中大量真正的 domain event 與 tracing 功能，清理時只能移除 plugin-option context。
2. **多 module configure**：每個 instrumented module 都可能執行相同 `__trace_configure({ redact })`，idempotence 必須保留。
3. **公開型別是 breaking change**：這是刻意的修正；目前版本為 `0.0.1`，而保留無效果選項的成本高於相容性收益。
4. **不要誤刪 runtime async option**：plugin 的 dead `async` 與 `installTracing()` 的有效 `async` 是不同 interface。
5. **測試隔離**：custom redaction 會修改 module-level config；每個相關測試需透過 `resetRedact()` 清理。

## 完成定義

- 公開 plugin interface 與 README 只承諾實際可用的三個選項。
- runtime 不再保存沒有消費者的 `events` / `maxMemoryMB`。
- custom 與 default redaction 經實際 mutation recording/export 測試證明仍生效。
- `npm test`、`npx tsc --noEmit`、`npm run build` 全部通過。
- `rg` 確認沒有殘留的 ghost-option 文件或型別宣告。

## 執行紀錄

已於 2026-07-10 執行本計劃。

### 實際變更

| 檔案 | 變更 |
| --- | --- |
| `packages/vite-plugin/src/index.ts` | `ReactiveTracePluginOptions` 只留 `enabled` / `editor` / `redact`；`transform()` 只傳 `root` 與 `redact` |
| `packages/vite-plugin/src/transform.ts` | `TransformOptions` 移除 `maxMemoryMB` / `events`；`buildConfigureCall()` 只在有 `redact` 時輸出；runtime import 清單改為按需加入 `__trace_configure` |
| `packages/runtime/src/redact.ts` | `RuntimeTraceConfig` → `RuntimeRedactConfig`；移除 `runtimeConfig` 與 `getRuntimeTraceConfig()` |
| `README.md` | 移除 quick-start 的 `maxMemoryMB` / `events` 註解、options 表格兩列與 planned-surface 段落 |
| `tests/redaction.test.ts` | custom matcher 測試改走完整 recording + export；新增「未設定 redact 時不注入 configure」測試 |
| `tests/plugin-options.types.ts`（新） | §44 type-surface fixture：對八個已移除選項各加一個 `@ts-expect-error` |
| `tests/plugin-options.types.test.ts`（新） | 以 `tsc` typecheck fixture，fixture 內任何診斷即失敗 |

### 驗證方式與結果

- `npm test` → 10 files / 149 tests passed。
- `npm run build` → playground production build 成功；`enabled: true` gate 未受影響。
- 反向驗證（mutation test）：暫時把 `events?: string[]` 加回 interface，`tests/plugin-options.types.test.ts` 立即以 `TS2578: Unused '@ts-expect-error' directive` 失敗，證明此 gate 不是空跑。
- ghost option 全文搜尋：除 fixture、測試與本文件外，`README.md`、`packages/` 已無殘留；`async?:` 只剩 runtime `installTracing()`（有效選項）。

### 與原計劃的差異

`npx tsc --noEmit` 在本 repo **本來就會失敗**：基線（stash 掉本次變更後）已有 5 個 `packages/runtime/src/*` 的既有錯誤，加上 playground / `tests/fixtures` 的 `.vue` 型別與 `allowImportingTsExtensions` 相關結構性錯誤。因此：

- 本次以「基線 vs 變更後」診斷 diff 驗證未新增錯誤（唯一差異是 `index.ts` 因刪行造成的行號位移）。
- 型別層驗證改由 `tests/plugin-options.types.test.ts` 執行 scoped `tsc`（`--ignoreConfig`）承擔：只檢查 fixture 的診斷，忽略既有基線錯誤。
- 既有基線錯誤（例如 `packages/runtime/src/types.ts` 引用了未定義的 `ReactiveType`）不在本次範圍，建議另開 issue。
