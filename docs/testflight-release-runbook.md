# 探记 HG · 纯原生 iOS 版 —— TestFlight 上架执行单

> 适用分支：`tanji-native-ios`（纯原生 SwiftUI 版，`ios/TanjiNative/`）
> Bundle ID：`com.ord.tanji` ｜ 显示名：探记 HG ｜ 与混合版（`com.tanji.hg`）沙盒隔离
>
> 混合版的清单见 [`appstore-release-checklist.md`](appstore-release-checklist.md)。
> 两者**不是同一个 App**：Bundle、代码路径、隐私清单、上架材料各自独立，
> 混合版的合规结论**不能**直接套用到纯原生版。

本文档基于 2026-11-28 的**本机实测**整理（Xcode 27.2 / macOS 27），
标注「已核实」的项都有实跑证据；标注「待确认」的项需在 App Store Connect 后台核对。

---

## 一、先明确：这次走 TestFlight，不是直接上架

TestFlight 的门槛比正式上架低，但**账号侧的前置条件一样要满足**：

| 能力 | 内部测试 | 外部测试 |
|---|---|---|
| 测试人数 | 最多 100 人（须是 App Store Connect 团队成员） | 最多 10,000 人 |
| 是否需审核 | **不需要** | 首个构建需要 Beta App Review |
| 用途 | 自测、快速验证 | 发给真实用户收集反馈 |

**建议路径**：先做内部测试（无需审核，最快）→ 真机验收通过 → 再开外部测试（走 Beta Review）。

---

## 二、本机实测结论：工程侧已就绪，账号侧是主要瓶颈

### 2.1 已核实（实跑验证，2026-11-28）

| 项 | 结论 | 证据 |
|---|---|---|
| Release 归档 | ✅ 通过 | `xcodebuild archive` → `** ARCHIVE SUCCEEDED **` |
| 归档产物 | ✅ `TanjiNative.app` 正常产出 | Bundle/版本/构建号三项均可 `PlistBuddy` 读取 |
| 隐私清单 | ✅ 已补齐并进包 | 归档产物内含 `PrivacyInfo.xcprivacy`，内容为 `UserDefaults`/`CA92.1` |
| App 图标 | ✅ 已转无 alpha | PNG colorType 由 6(RGBA) 改为 2(RGB)，`sips hasAlpha: no` |
| 只链接系统框架 | ✅ 无三方 SDK | `otool -L` 仅 Foundation/Charts/SQLite3/UIKit 等系统库 |
| 无网络请求 | ✅ 纯本地 | 全量 grep `URLSession`/`http://` 无命中 |
| 回归测试 | ✅ 191 项全绿 | `npm test`（Web 侧） |
| CI 覆盖 | ✅ 已补 | 新增 `privacy-native-ios` job，含 `tanji-native-ios` 分支触发 |
| 归档脚本编排 | ✅ 已验证 | 前置校验能拦非法 Team ID/版本号；走到真实归档并报出准确签名错误 |

### 2.2 你的开发者账号现状（2026-11-28 从本机描述文件解析，非推测）

| 项 | 实测值 | 来源 |
|---|---|---|
| Team ID | **`YC9UFHH73D`** | 三个描述文件的 `TeamIdentifier` / `ApplicationIdentifierPrefix` |
| 已注册的显式 App ID | `com.tanji.app`、`site.zai.aifishing` | 描述文件的 `application-identifier` |
| 已注册的通配符 App ID | `*`（有效期至 2027-11-26） | 描述文件 `e454e5ef-…` |
| 本机证书 | 只有 `Apple Development: fengyong@ustc.edu` + 一个第三方 `AISnap Local Signing` | `security find-identity` |
| Xcode 账号 | **未登录**（归档报 `No Accounts`） | 归档实测 |

> ⚠️ **`com.ord.tanji` 还没有注册**。上面两个显式 App ID 都不是它。
> 这正是你「找不到注册入口」时需要新建的那一个。
>
> ⚠️ 现有描述文件**全部是开发用**（`get-task-allow = true`），不能用于 TestFlight。
> 通配符 profile 也只是开发用途。

### 2.3 阻断项（不解决无法上传）

| # | 阻断项 | 现状 | 谁来解 |
|---|---|---|---|
| 1 | **注册 App ID `com.ord.tanji`** | ❌ 未注册（已注册的只有 `com.tanji.app`、`site.zai.aifishing`） | 开发者后台 → 标识符 → + |
| 2 | **Apple Distribution 证书** | ❌ 本机只有 Apple Development | Xcode → Settings → Accounts → Manage Certificates |
| 3 | **App Store Connect App 记录** | ❓ 未创建（Bundle `com.ord.tanji`） | ASC 后台 |
| 4 | **公网隐私政策 / 支持页** | ❌ 实测 `https://tanji-app-guvc.zai.site/privacy.html` 与 `support.html` 均 **HTTP 404** | 部署站点 |
| 5 | **真机业务验收** | ❌ Face ID、通知、相册、文件选择器默认目录等未验收 | 用户本人 |
| 6 | **ASC 认证凭据** | ❌ 本机无 `AuthKey_*.p8`，环境无 `ASC_*` 变量 | ASC → 用户与访问 → 密钥 |

> ⚠️ 阻断项 4 的 404 是**实测结论**（`curl -w '%{http_code}'`），不是推测。
> 混合版的 `testflight/release-runbook.txt` 里也记着同样的阻断，两条产品线共用这个站点。

> **TestFlight 不需要 App 截图**（2026-11-28 查 Apple 官方 TestFlight 页确认）：
> 外部测试只强制要求 **beta 描述** 与 **beta 审核信息**；
> 截图只有当 App 已有「已批准、待发布」的版本时才会附在测试者邀请里。
> 截图（6.9 英寸 iPhone）是**正式提审 App Store 时**才必须补的，
> 可以放到 TestFlight 跑通之后再做。

### 2.4 注册 App ID 的完整步骤（Apple 官方中文界面路径）

App ID 注册**不在 App Store Connect 里**，而在开发者后台的
「证书、标识符和描述文件」下（很多人找不到就是在这里点岔了）。

直达地址：<https://developer.apple.com/account/resources/identifiers/list>

1. 打开 <https://developer.apple.com/account/resources>（需登录你的开发者账号）。
2. 左侧边栏点 **「标识符」**（英文 Identifiers）。
3. 点左上角 **「+」**（添加按钮）。
4. 从选项列表选 **「App IDs」** → 点 **「继续」**。
5. 确认已自动选中 App ID 类型 → 点 **「继续」**。
6. **「描述」**栏填：`探记 HG 纯原生版`（仅自己看，可随意）。
7. **「套装 ID」**栏：
   - 选 **「显式 App ID」**（Explicit，**不要选通配符**）
   - 填 **`com.ord.tanji`**（必须与 Xcode 工程里的 `PRODUCT_BUNDLE_IDENTIFIER` 完全一致）
8. **「功能」**（Capabilities）：本 App 是纯本地工具，**不需要勾选任何额外功能**。
   精确 App ID 默认已启用「App 内购买项目」，但本 App 不做 IAP，可以不管。
9. 点 **「继续」** → 核对信息 → 点 **「注册」**。

> **所需职能：账户持有人（Account Holder）或管理（Admin）。**
> 若你看到的页面里没有「+」按钮或「App IDs」选项，说明当前登录的账号角色权限不足，
> 需要换成 Account Holder / Admin 账号操作。
>
> **Bundle ID 创建后不可修改。** 请确认填的是 `com.ord.tanji` 而不是 `com.tanji.hg`
> —— 那是混合版将来用的，别搞混。
>
> 官方文档：<https://developer.apple.com/cn/help/account/identifiers/register-an-app-id>

### 2.5 与混合版不同、需要单独确认的点

| 项 | 混合版 | 纯原生版 |
|---|---|---|
| Bundle ID | `com.tanji.hg` | `com.ord.tanji` |
| 受限 API 声明 | `FileTimestamp` / `C617.1`（来自 `@capacitor/filesystem` 依赖） | `UserDefaults` / `CA92.1`（自有代码 `AmountPrivacy.swift`、`DataStore.swift`） |
| ASC App 名 | 探记 HG（**与纯原生版重名**） | 探记 HG |
| SKU | — | `tanji-hg-ios-001`（`testflight/app-store-connect.json`） |

> 纯原生版**没有** `FileTimestamp` 声明需求：全量核查确认只用了
> `url.resourceValues(.fileSizeKey)`（取文件大小，非时间戳），
> 且 `ProcessInfo.processInfo` 只用于读 `arguments`，不是 `systemUptime`。
> 二进制符号表实测引用 `_OBJC_CLASS_$_NSUserDefaults`，与声明一致。

### 2.6 Bundle ID 决策：用 `com.ord.tanji`（2026-11-28 用户定案）

**最终决定：纯原生版使用 `com.ord.tanji`。**

三个仓库的 Bundle ID 归属（从各自 `project.pbxproj` / `project.yml` 实测）：

| Bundle ID | 归属 | 显示名 | 分支 | 状态 |
|---|---|---|---|---|
| `com.tanji.app` | 原 TanJi iOS 历史线 | 探记 | `native-app` | 历史线，**未上架** |
| **`com.ord.tanji`** | **原 TanJi App（壳版）→ 归属纯原生版** | **探记 HG** | `tanji-native` → `tanji-native-ios` | **本次上架用** |
| `com.tanji.hg` | 探记 HG 混合版（Capacitor） | 探记 HG | `tanji-native-hg` | 中间态，不单独上架 |
| ~~`ord.tanji`~~ | ~~纯原生版初版 Bundle ID~~ | — | — | **已废弃，未注册过** |

**改名的依据（关键前提：此前从未发布过任何版本）**

2026-11-28 全量核查，确认**此前没有任何版本被上传或上架**：

- 三个仓库均**无 `.ipa` / `.xcarchive` 上传产物**；
- 壳版 `tanji-native/testflight/release-runbook.txt` 顶部写着
  「以下三项未完成前**不要上传**或邀请外部测试者」，
  且 `app-store-connect.json` 的 `blockers` 明确列着
  「App Store Connect App 记录尚未创建」「本机尚未发现 Apple Distribution 证书」；
- 所有 `APP_STORE_URL` 常量均为空字符串占位（`src/app/env.js`），
  没有任何 `apps.apple.com/app/id...` 真实链接；
- 本机描述文件解析出的已注册 App ID 只有 `com.tanji.app` 与 `site.zai.aifishing`，
  **`com.ord.tanji` 从未注册过**。

→ 因此把 Bundle ID 从 `com.ord.tanji` 改成 `com.ord.tanji`
**不会影响任何已发布的版本**，因为根本不存在已发布的版本。
`com.ord.tanji` 也从未注册过，改名不浪费任何 App ID。

**这样定的好处**

1. **沿用已规划的 ID**——壳版 `tanji-native` 的发布材料里
   `com.ord.tanji` / SKU `tanji-ios-001` 已备好，ID 与既有规划一致，
   避免同一产品线出现两个 Bundle ID 的混乱。
2. **反域名规范**——`com.ord.tanji` 比 `com.ord.tanji` 更符合
   Apple 的反向域名惯例（`com` + 组织 + 应用名），也不会让用户误以为
   `com.ord.tanji` 是某个真实域名。
3. **不冲突**——`com.tanji.app`（原 TanJi iOS 历史线）与
   `com.tanji.hg`（混合版）都与它不同，三者沙盒互不影响。

**改名后必须同步核对的位置**（已全部改完）

| 位置 | 改动 |
|---|---|
| `ios/TanjiNative/project.yml` | `bundleIdPrefix: ord` → `com.ord`；三个 target 的 `PRODUCT_BUNDLE_IDENTIFIER` 同步改（含 `.tests` / `.uitests` 后缀） |
| `scripts/archive-testflight.sh` | 默认 `BUNDLE_ID` |
| `scripts/upload-testflight.sh` | 默认 `BUNDLE_ID` |
| `scripts/install-device-ios.sh` | 默认 `BUNDLE_ID` + 注释 |
| `testflight/app-store-connect.json` | `bundleId` 与 blocker 文案 |
| `README.md` / `AGENTS.md` / `ios/TanjiNative/README.md` | Bundle ID 说明 |

> ⚠️ **改名会换沙盒**：设备上已装的 `com.ord.tanji` 版（若已装）数据留在旧沙盒，
> 新 `com.ord.tanji` 是全新沙盒。旧数据用「设置 → 数据与备份 → 导入」迁移。
> 另：升级时**不要卸载**，卸载会删沙盒数据。
>
> ⚠️ **ASC 里的 App 名称不能与已存在的「探记」重名**。纯原生版显示名是
> 「探记 HG」，与壳版规划的「探记」不同名，可共存；
> 但混合版 `com.tanji.hg` 的显示名也是「探记 HG」——
> **纯原生版上架后，混合版那条线就不能再用「探记 HG」这个名字单独上架**。

---

## 三、执行顺序

### 步骤 1 · 账号侧一次性配置（需你在后台操作）

1. **注册 App ID `com.ord.tanji`** —— 详细步骤见 [§2.4](#24-注册-app-id-的完整步骤apple-官方中文界面路径)。
   一句话：开发者后台 → 「证书、标识符和描述文件」→ 左侧「标识符」→ 左上角 **+**
   → **App IDs** → 继续 → **显式 App ID** → 套装 ID 填 **`com.ord.tanji`** → 继续 → 注册。
   *（混合版的 `com.tanji.hg` 是另一个 ID，将来要单独注册；别填错。）*
2. **Xcode → Settings → Accounts** 登录你的开发者账号
   （Team ID 已知：`YC9UFHH73D`；Xcode 当前**未登录**，归档会报 `No Accounts`）。
3. **Manage Certificates** 创建 **Apple Distribution** 证书（当前本机只有 Development）。
4. **App Store Connect** 新建 App：
   - 名称 `探记 HG`、SKU `tanji-hg-ios-001`、主要语言 `zh-Hans`
   - 类别 `Business`、年龄分级 `4+`
   - 平台 **仅 iOS**（原生版 `TARGETED_DEVICE_FAMILY = 1`，只支持 iPhone，不支持 iPad）
   - 填 Bundle ID 时选刚注册的 **`com.ord.tanji`**
5. **填公网隐私政策与支持 URL**（先解决阻断项 4，URL 必须能返回 200）。
6. **App Privacy** 选择「不收集数据」（与 `PrivacyInfo.xcprivacy` 口径一致）。
7. **创建 App Store Connect API Key**（推荐）或准备 App 专用密码：
   - API Key → `testflight/app-store-connect.json` 里没有存密钥，
     按约定只通过环境变量传入，**不入库**。

> 付费买断上架还需：**Paid Apps Agreement** + 银行与税务信息。
> TestFlight 构建本身不要求付费。

### 步骤 2 · 部署公网法律页（解决阻断项 4）

`privacy.html` 与 `support.html` 必须返回 **HTTP 200** 且内容正确。
部署完成后本机验证：

```bash
curl -o /dev/null -w '%{http_code}\n' -L https://tanji-app-guvc.zai.site/privacy.html
curl -o /dev/null -w '%{http_code}\n' -L https://tanji-app-guvc.zai.site/support.html
```

### 步骤 3 · 本机检查

```bash
cd /Users/ola/drax-toolbox/tanji-native-ios
npm run check:release    # 跨平台资产检查（隐私清单 + 图标 + 脚本）
npm run testflight:ready # 就绪检查（证书 + 法律页 + 资产）
```

两个命令都会如实报出未满足项；`testflight:ready` 失败时**不要上传**。

### 步骤 4 · 归档

```bash
DEVELOPMENT_TEAM=<10位TeamID> npm run archive:testflight
```

脚本会：跑 `npm test` 与 `npm run ios:test` → `xcodegen generate` →
用 **Apple Distribution** 归档 → 校验 Bundle/版本/构建号 → 校验隐私清单在包内
→ 校验描述文件 `get-task-allow=false` → 导出 `app-store-connect` IPA →
输出 SHA-256。

产物在 `build/testflight/TanjiNative-<version>-<build>/`（不入库）。

> 本机 macOS 27 的 `sandbox-exec` 不可用，SwiftUI 宏展开需要
> `OTHER_SWIFT_FLAGS='$(inherited) -Xfrontend -disable-sandbox'`，
> 脚本已带，与 `scripts/install-device-ios.sh` 一致。

> **签名方式**：脚本不覆盖 `CODE_SIGN_IDENTITY`，靠 `CODE_SIGN_STYLE=Automatic`
> 让 Xcode 自动选证书。手动指定 identity 会触发
> `conflicting provisioning settings` 报错（2026-11-28 实测）。
> 因此 **Xcode 必须已登录开发者账号**，否则归档会报
> `No Accounts: Add a new account in Accounts settings`。

### 步骤 5 · 上传

```bash
export ASC_API_KEY=<Key ID>
export ASC_API_ISSUER=<Issuer ID>
export ASC_PRIVATE_KEY_PATH=<AuthKey_xxx.p8 的绝对路径>

npm run upload:testflight -- build/testflight/TanjiNative-1.0.0-<build>/ipa/<name>.ipa
```

脚本先 `altool --validate-app` 再 `--upload-app`。

> 工具现状（2026-11-28 实测）：本机 Xcode 27.2 的 `xcrun altool`（27.10.4）**仍可用**，
> Apple 官方「上传构建版本」文档当前仍列出 altool。
> 网上有「altool 已废弃」的说法，与官方文档不一致 —— 若日后 altool 失效，
> 替代路径是 **Transporter CLI** 或 **App Store Connect 的 Build Uploads API**，
> 届时只需替换 `scripts/upload-testflight.sh` 里的上传调用。

### 步骤 6 · 测试组

1. 等 ASC 处理完成（状态从「处理中」变为「可供测试」）。
2. **内部测试**：创建内部组 → 添加你自己（须是 ASC 团队成员）→ 分配构建。
   内部测试**无需审核**，最快拿到装机包。
3. 真机验收通过后，**外部测试**：创建外部组 → 填 Beta 描述与 What to Test →
   添加唯一测试者邮箱 → 首个构建提交 **Beta App Review** → 通过后发邀请。
4. 文案已备好：`testflight/` 下的 `beta-description.txt`、`what-to-test.txt`、
   `review-notes.txt`、`tester-invitation.txt`。

---

## 四、真机验收清单（提审前必须走完）

原生版目前**未做真机业务验收**，以下每项都要在真机上确认：

- [ ] 首次启动无崩溃，底部导航 5 个 Tab 可切换
- [ ] 新建订单 → 登记定金/尾款 → 本月成交额、待收款、逾期金额口径正确
- [ ] 行程页月历、未来 7 天、单日订单显示正确
- [ ] 通知授权 → 每日催收提醒按排程弹出
- [ ] Face ID 解锁隐藏金额；取消授权时有降级路径
- [ ] 导出 JSON / CSV / .db 到「文件」App 的「探记 HG」文件夹
- [ ] 导入 JSON：导入前有恢复点提示，导入后订单数/流水数一致
- [ ] 切后台 15 分钟再返回、强制关闭重开后数据仍在
- [ ] 相机拍门口照、相册选头像、定位记录与地图跳转

### 4.1 关于 `npm run ios:test` 当前失败

2026-11-28 实测：`npm run ios:test` 中 `TanjiNativeUITests.testSwitchesAcrossTabs`
失败（`Test crashed with signal kill`）。

**这与上架准备无关**：已用干净 `HEAD` 的独立 worktree 复现对比，
失败由工作区中并行的 Swift 在制品改动引起，不涉及本次新增的
隐私清单、图标与发布脚本。上架前需在 Swift 侧改动稳定后重跑一次确认。

临时绕过（仅用于验证发布链路，正式对外构建不要跳过）：

```bash
SKIP_TESTS=1 DEVELOPMENT_TEAM=<TeamID> npm run archive:testflight
```

---

## 五、后续版本

- 每个新构建用**更大且不重复**的 `BUILD_NUMBER`（构建号不可复用）。
- 重新归档 → 上传 → 等处理 → 在测试组分配新构建。
- 测试者点一下即可更新，覆盖安装保留沙盒数据；**不要卸载**（会丢记账数据）。
- TestFlight 构建 **90 天**后失效，到期前发新构建。
- 上架后 `APP_STORE_URL` 需填真实 App ID（当前为空，不留死链）。

---

## 六、参考来源

- 上传构建版本（altool / Transporter / ASC API）：<https://developer.apple.com/cn/help/app-store-connect/reference/upload-tools>
- TestFlight 总览：<https://developer.apple.com/testflight>
- 隐私清单文件：<https://developer.apple.com/documentation/bundleresources/privacy_manifest_files>
- Required Reason API 与原因码：<https://developer.apple.com/documentation/bundleresources/privacy_manifest_files/describing_use_of_required_reason_api>
- App Review Guidelines：<https://developer.apple.com/app-store/review/guidelines/>
