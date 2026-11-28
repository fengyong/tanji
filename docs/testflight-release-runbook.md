# 探记 · 纯原生 iOS 版 —— TestFlight 上架执行单

> 📌 **要正式提交 App Store 审核，请看另一份文档：
> [`docs/appstore-submission-checklist.md`](./appstore-submission-checklist.md)**
> —— 那里有完整的硬阻塞清单（中国区备案/豁免、税务银行、定价、截图、
> 年龄分级问卷）与执行顺序。本文聚焦 TestFlight 与直装路线。

> 适用分支：`tanji-native-ios`（纯原生 SwiftUI 版，`ios/TanjiNative/`）
> Bundle ID：`com.ord.tanji.app` ｜ 显示名：探记 ｜ 与混合版（`com.tanji.hg`）沙盒隔离
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
| 已注册的显式 App ID | `com.tanji.app`、`site.zai.aifishing`（描述文件实测）；**`com.ord.tanji.app`**（2026-11-28 用户在开发者后台确认已注册，名称「ios」） | 描述文件的 `application-identifier` + 开发者后台 App IDs 列表 |
| 已注册的通配符 App ID | `*`（有效期至 2027-11-26） | 描述文件 `e454e5ef-…` |
| 本机证书 | `Apple Development: fengyong@ustc.edu`（有效期至 2027-11-22）+ **`Apple Distribution: yong feng (YC9UFHH73D)`**（2026-11-28 已装，有效期至 2027-11-28）+ 一个第三方 `AISnap Local Signing` | `security find-identity` |
| Xcode 账号 | **未登录**（归档报 `No Accounts`） | 归档实测 |

> ✅ **`com.ord.tanji.app` 已注册**（App ID 名称「ios」，2026-11-28 用户确认）。
> 开发者后台「标识符 → App IDs」列表中已可见，**不需要再新建**。
>
> ⚠️ 通配符 profile（`iOS Team Provisioning Profile: *`）与 `Apple Development` 证书
> 是**开发用**（`get-task-allow = true`），只能用于直装到指定设备。
> 上传 TestFlight 用的是另两份：**`Apple Distribution: yong feng (YC9UFHH73D)`**
> + **「探记 App Store」** 描述文件（`get-task-allow = false`，
> UUID `c81dd139-e905-4422-89da-d1f669fade91`），两者均已装好并实测可用。

### 2.3 阻断项（不解决无法上传）

| # | 阻断项 | 现状 | 谁来解 |
|---|---|---|---|
| 1 | **注册 App ID `com.ord.tanji.app`** | ✅ 已注册（名称「ios」） | 已完成 |
| 2 | **Apple Distribution 证书** | ✅ 已装（`Apple Distribution: yong feng (YC9UFHH73D)`，私钥配对成功） | 已完成 |
| 3 | **App Store Connect App 记录** | ✅ 已创建（2026-11-28 用户完成，名称「探记」，Bundle `com.ord.tanji.app`） | 已完成 |
| 4 | **公网隐私政策 / 支持页** | ✅ 已部署，实测两个 URL 均 **HTTP 200** | 已完成 |
| 5 | **App Store 分发描述文件** | ✅ 已创建并安装（名称「探记 App Store」，`get-task-allow=false`） | 已完成 |
| 6 | **归档产出可上传 IPA** | ✅ 已实跑产出（手动签名路线，Distribution 证书链验证通过） | 已完成 |
| 7 | **上传凭据** | ✅ API Key 已创建（`4C52J4ML4Q`），私钥在 `~/.config/tanji/` | 已完成 |
| 8 | **真机业务验收** | ❌ Face ID、通知、相册、文件选择器默认目录等未验收 | 用户本人 |
| 9 | **App Store 正式提审材料** | ❌ 9 项待补（文案 / 截图 / 审核联系信息 / 定价 / 上架可用性 / 年龄分级 …） | 本方（清单见 `appstore-submission-checklist.md`） |
| 10 | **第二位内部测试员加入团队** | 🕐 团队邀请已发出，2026-11-28 23:11 复查仍未接受，到期 2026-12-01 22:05 | 对方本人 |

> 📌 原表里的「首个外部构建的 Beta App Review」已移出阻塞表：
> 当前走的是**内部测试组**，内部测试不需要 Beta 审核；
> 只有将来开外部测试组时才需要，而那一步排在正式提审之后。
>
> ✅ 阻断项 4 已闭环：2026-11-28 ZCode 重新部署 `main` 后，
> `privacy.html` 与 `support.html` 实测均返回 **HTTP 200**，
> 内容抽查含「隐私政策」「支持」与 `fengyong@ustc.edu`。
> 混合版 `tanji-native/testflight/release-runbook.txt` 里记的还是旧的 404 状态，两条产品线共用该站点。

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
6. **「描述」**栏填：`探记 iOS`（仅自己看，可随意）。
7. **「套装 ID」**栏：
   - 选 **「显式 App ID」**（Explicit，**不要选通配符**）
   - 填 **`com.ord.tanji.app`**（必须与 Xcode 工程里的 `PRODUCT_BUNDLE_IDENTIFIER` 完全一致）
8. **「功能」**（Capabilities）：本 App 是纯本地工具，**不需要勾选任何额外功能**。
   精确 App ID 默认已启用「App 内购买项目」，但本 App 不做 IAP，可以不管。
9. 点 **「继续」** → 核对信息 → 点 **「注册」**。

> **所需职能：账户持有人（Account Holder）或管理（Admin）。**
> 若你看到的页面里没有「+」按钮或「App IDs」选项，说明当前登录的账号角色权限不足，
> 需要换成 Account Holder / Admin 账号操作。
>
> **Bundle ID 创建后不可修改。** 请确认填的是 `com.ord.tanji.app` 而不是 `com.tanji.hg`
> —— 那是混合版将来用的，别搞混。
>
> 官方文档：<https://developer.apple.com/cn/help/account/identifiers/register-an-app-id>

### 2.5 与混合版不同、需要单独确认的点

| 项 | 混合版 | 纯原生版 |
|---|---|---|
| Bundle ID | `com.tanji.hg` | `com.ord.tanji.app` |
| 受限 API 声明 | `FileTimestamp` / `C617.1`（来自 `@capacitor/filesystem` 依赖） | `UserDefaults` / `CA92.1`（自有代码 `AmountPrivacy.swift`、`DataStore.swift`） |
| ASC App 名 | 探记 HG（与纯原生版**不重名**，可共存） | **探记** |
| SKU | — | `tanji-ios-001`（`testflight/app-store-connect.json`，2026-11-28 用户在 ASC 创建时填入） |

> 纯原生版**没有** `FileTimestamp` 声明需求：全量核查确认只用了
> `url.resourceValues(.fileSizeKey)`（取文件大小，非时间戳），
> 且 `ProcessInfo.processInfo` 只用于读 `arguments`，不是 `systemUptime`。
> 二进制符号表实测引用 `_OBJC_CLASS_$_NSUserDefaults`，与声明一致。

### 2.6 Bundle ID 决策：用 `com.ord.tanji.app`（2026-11-28 用户定案）

**最终决定：纯原生版使用 `com.ord.tanji.app`。**

三个仓库的 Bundle ID 归属（从各自 `project.pbxproj` / `project.yml` 实测）：

| Bundle ID | 归属 | 显示名 | 分支 | 状态 |
|---|---|---|---|---|
| `com.tanji.app` | 原 TanJi iOS 历史线 | 探记 | `native-app` | 历史线，**未上架** |
| **`com.ord.tanji.app`** | **纯原生版（SwiftUI）** | **探记** | **`tanji-native-ios`** | **本次上架用；App ID 已注册（名称「ios」）** |
| `com.tanji.hg` | 探记 HG 混合版（Capacitor） | 探记 HG | `tanji-native-hg` | 中间态，不单独上架 |
| `com.olatanji.app` | 真机调试用的开发版 | — | — | 开发用，不上架 |
| ~~`ord.tanji`~~ | ~~纯原生版初版 Bundle ID~~ | — | — | 已废弃，未注册过 |
| ~~`com.ord.tanji`~~ | ~~中间方案~~ | — | — | 已废弃，未注册过 |

**改名的依据（关键前提：此前从未发布过任何版本）**

2026-11-28 全量核查，确认**此前没有任何版本被上传或上架**：

- 三个仓库均**无 `.ipa` / `.xcarchive` 上传产物**；
- 壳版 `tanji-native/testflight/release-runbook.txt` 顶部写着
  「以下三项未完成前**不要上传**或邀请外部测试者」，
  且 `app-store-connect.json` 的 `blockers` 明确列着
  「App Store Connect App 记录尚未创建」「本机尚未发现 Apple Distribution 证书」；
- 所有 `APP_STORE_URL` 常量均为空字符串占位（`src/app/env.js`），
  没有任何 `apps.apple.com/app/id...` 真实链接；
- 本机描述文件解析出的已注册 App ID 有 `com.tanji.app` 与 `site.zai.aifishing`；
  `com.ord.tanji.app` 于 2026-11-28 由用户在本轮注册完成（名称「ios」）。

→ 因此把 Bundle ID 从 `ord.tanji` 改成 `com.ord.tanji.app`
**不会影响任何已发布的版本**，因为根本不存在已发布的版本。
`ord.tanji` 与中间方案 `com.ord.tanji` 都从未注册过，改名不浪费任何 App ID。

**这样定的好处**

1. **沿用已规划的 ID**——壳版 `tanji-native` 的发布材料里规划的正是
   `com.ord.tanji` / SKU `tanji-ios-001`，本次定的 `com.ord.tanji.app`
   与它同源，避免同一产品线出现两个不相关 Bundle ID 的混乱。
2. **反域名规范**——`com.ord.tanji.app` 比 `ord.tanji` 更符合
   Apple 的反向域名惯例（`com` + 组织 + 应用名），也不会让用户误以为
   `ord.tanji` 是某个真实域名。
3. **不冲突**——`com.tanji.app`（原 TanJi iOS 历史线）与
   `com.tanji.hg`（混合版）都与它不同，三者沙盒互不影响。

**改名后必须同步核对的位置**（已全部改完）

| 位置 | 改动 |
|---|---|
| `ios/TanjiNative/project.yml` | `bundleIdPrefix` 改为 `com.ord.tanji.app`；三个 target 的 `PRODUCT_BUNDLE_IDENTIFIER` 同步改（含 `.tests` / `.uitests` 后缀） |
| `scripts/archive-testflight.sh` | 默认 `BUNDLE_ID` |
| `scripts/upload-testflight.sh` | 默认 `BUNDLE_ID` |
| `scripts/install-device-ios.sh` | 默认 `BUNDLE_ID` + 注释 |
| `testflight/app-store-connect.json` | `bundleId` 与 blocker 文案 |
| `README.md` / `AGENTS.md` / `ios/TanjiNative/README.md` | Bundle ID 说明 |

> ⚠️ **改名会换沙盒**：设备上已装的旧版（`ord.tanji` 或 `com.ord.tanji`，若已装）
> 数据留在旧沙盒，新 `com.ord.tanji.app` 是全新沙盒。
> 旧数据用「设置 → 数据与备份 → 导入」迁移。
> 另：升级时**不要卸载**，卸载会删沙盒数据。
>
> ⚠️ **「探记」这个名称的归属（2026-11-28 用户定）**：
> 纯原生版的 App Store 名称与桌面显示名都定为 **「探记」**。
> - ASC 里**当前没有任何已创建的 App 记录**，所以「探记」这个名字**没被占用**，
>   可以直接用（壳版 `com.ord.tanji` 规划的名称也是「探记」，但它的记录从未创建）；
> - 混合版 `com.tanji.hg` 的显示名是「探记 HG」，与「探记」**不同名，可共存**；
> - 原生版与混合版若都要单独上架，「探记 HG」归混合版、「探记」归纯原生版。
>   但既然纯原生版是最终形态，混合版大概率不单独上架。

### 2.7 创建 Apple Distribution 证书（本机已备好 CSR）

**当前状态（2026-11-28 实测）**：本机只有 `Apple Development: fengyong@ustc.edu`，
**没有 Apple Distribution**。`npm run testflight:ready` 会因此报
「✗ 本机缺少 Apple Distribution 证书」。

**两条路任选其一。推荐路线 A**（Xcode 一键，私钥与证书的配对由 Xcode 自动完成）。

#### 路线 A · Xcode 自动创建（推荐）

1. 先在 Xcode 登录账号：**Xcode → Settings → Accounts → + → Apple ID**，
   登录 `fengyong@ustc.edu`。
   > ⚠️ 登录后确认右上角团队显示为 **`勇 冯 (YC9UFHH73D)`**。
   > 若显示 **「Personal Team」**，说明用的是免费开发者账号，
   > 免费账号**无法分发到 App Store / TestFlight**（描述文件 7 天过期、
   > 证书列表里根本没有 Apple Distribution 选项），
   > 必须先在 <https://developer.apple.com/programs/> 加入付费开发者计划。
2. **Xcode → Settings → Accounts → Manage Certificates**，
   在左下角 **+** 里选 **Apple Distribution**（不要选 *Apple Development*）。
3. 点 **Create**，Xcode 会自动生成 CSR、提交、下载并安装证书到钥匙串。
4. 验证：

```bash
security find-identity -v -p codesigning | grep 'Apple Distribution'
```

#### 路线 B · 开发者后台手动创建（本机已备好 CSR）

若你更想在网页后台操作，**CSR 文件与私钥已经生成好了**：

| 文件 | 路径 |
|---|---|
| CSR（上传用） | `build/certs/tanji-distribution.certSigningRequest` |
| 私钥（已导入登录钥匙串） | `build/certs/tanji-distribution.key` |

1. 打开证书页：<https://developer.apple.com/account/resources/certificates/list>
   （直连创建页：<https://developer.apple.com/account/resources/certificates/create>）
2. 点 **+** → **Software** 分类下选 **Apple Distribution** → **Continue**。
3. 上传 CSR：点 **Choose File**，选
   `build/certs/tanji-distribution.certSigningRequest` → **Continue**。
4. 点 **Download** 得到 `Apple Distribution: yong feng (YC9UFHH73D).cer`。
5. **双击该 `.cer` 文件**导入钥匙串 → 选「登录」钥匙串 → 「添加」。
   > ⚠️ 私钥**必须**与证书在同一钥匙串才能签名。
   > 本机的私钥已用 `security import` 导入登录钥匙串（实测 `1 key imported`），
   > 且已用自签证书做过 `codesign` 实测，**配对机制验证通过**。
   > 若双击导入后 `find-identity` 仍不显示，用备用命令：

```bash
security import ~/Downloads/Apple\ Distribution*.cer -k ~/Library/Keychains/login.keychain-db
```

6. 验证（两条都要有输出）：

```bash
security find-identity -v -p codesigning | grep 'Apple Distribution'
security find-certificate -c 'Apple Distribution' -Z | grep 'SHA-256 hash'
```

> 🔒 **私钥安全**：`build/certs/tanji-distribution.key` 是本机私钥明文文件。
> 它已在 `.gitignore` 的 `build/` 规则内**不会入库**，但请勿上传到任何网盘或代码托管。
> 证书创建完成后可以删除该文件（钥匙串里已有副本）：

```bash
rm -f build/certs/tanji-distribution.key
```

#### ⚠️ 关于免费账号的重要提醒

Xcode 本机记录的团队信息是：

```
teamID = YC9UFHH73D
teamName = 勇 冯 (Personal Team)
isFreeProvisioningTeam = 1
```

`isFreeProvisioningTeam = 1` 通常代表**免费账号**。但免费账号**无法**在
App Store Connect 创建 App 记录——而你已于 2026-11-28 成功创建了
`com.ord.tanji.app` 的 App 记录，说明该账号**具备付费账号权限**，
这个 `isFreeProvisioningTeam` 标记是 Xcode 本地缓存的旧值。
**因此不要被它误导**：直接按路线 A 走，若 Manage Certificates 里
真的没有 Apple Distribution 选项，再去确认付费会员状态。

#### 证书创建后的验证门槛

```bash
cd /Users/ola/drax-toolbox/tanji-native-ios
npm run testflight:ready
```

通过后（隐私清单 + 图标 + 证书 + 两个法律页 URL 全部 ✓）才能进入归档。

### 2.8 创建 App Store 分发描述文件（当前唯一阻断项）

**为什么卡在这里（2026-11-28 实测）**

证书到位后实跑归档，产物签名是这样的：

```
Authority=Apple Development: fengyong@ustc.edu (DFVF2R4K8Y)   ← 开发证书，不是 Distribution
描述文件 = iOS Team Provisioning Profile: *                   ← 通配符开发 profile
get-task-allow = true                                          ← 开发标志，TestFlight 不收
```

`scripts/archive-testflight.sh` 的守卫会拦下并报
「归档使用了开发描述文件，不能用于 TestFlight。」

根因：**Xcode 里没有登录任何 Apple ID**（实测钥匙串无账号凭据、
`DVTDeveloperAccountManagerAppleIDLists` 为空）。自动签名在没有账号时
无法向 Apple 拉取 App Store 分发描述文件，只能回落到本机已有的
开发用 profile。本机现有三个 profile 全是开发用途（`get-task-allow = true`）：

| 描述文件 | App ID | 类型 |
|---|---|---|
| `29cf5a64-…` | `com.tanji.app` | 开发 |
| `b34d1c2f-…` | `site.zai.aifishing` | 开发 |
| `e454e5ef-…` | `*` | 开发（通配符） |

**两条路，任选其一。路线 1 最省事。**

#### 路线 1 · 登录 Xcode，让 Xcode 自动管理（推荐）

1. **Xcode → Settings → Accounts → + → Apple ID**，登录 `fengyong@ustc.edu`。
2. 确认右上角团队显示 **`勇 冯 (YC9UFHH73D)`**。
3. 登录后 Xcode 会自动为 `com.ord.tanji.app` 创建并下载
   **App Store Connect** 类型的分发描述文件（前提是 App ID 与
   ASC App 记录都已就位——本项目两者都已满足）。
4. 之后直接跑归档脚本，Xcode 会自动选用 Distribution 证书 +
   分发描述文件。

> ⚠️ **2026-11-28 21:16 实测：光在 Accounts 面板里看到账号还不够。**
> 用户在 Settings → Apple Accounts 里确认账号已登录、团队显示
> `yong feng`（Admin 角色），但重跑归档**仍然**回落到开发描述文件。
> 登录态没有真正生效的判据（全部实测）：
>
> | 检查项 | 期望值 | 登录后实测值 |
> |---|---|---|
> | `defaults read com.apple.dt.Xcode DVTDeveloperAccountManagerAppleIDLists` | 非空 | **仍为空** |
> | `defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier` | `isFreeProvisioningTeam = 0`，团队名无 `(Personal Team)` 后缀 | **仍是 `isFreeProvisioningTeam = 1` / `(Personal Team)`** |
> | 钥匙串中的 Xcode 账号凭据 | 存在 `AC_PASSWORD` 类条目 | **查不到任何 Xcode 凭据**（只有 Cursor 的 `Apple_2`，无关） |
> | `~/Library/Developer/Xcode/UserData/Provisioning Profiles/` | 新增 App Store profile | **仍只有原来 3 个开发 profile** |
>
> 结论：Accounts 面板里的「Sign In」可能只完成了系统层登录，
> **没有完成 Xcode 的开发者身份认证**（需要双因素验证码）。
> 判定标准就一条 —— 上表第一项 `DVTDeveloperAccountManagerAppleIDLists`
> 变为非空，才算真正登录成功。
>
> 若登录后仍是空，依次尝试：
> 1. 完全退出 Xcode（⌘Q）后重开，再看 Accounts 面板；
> 2. 改用 **Xcode → Settings → Accounts → + → Apple ID → 手动登录**，
>    输入账号密码并走完**双因素验证码**（Apple 的 2FA 需用另一台设备
>    或「设置 → Apple 账号」里取 6 位验证码）；
> 3. 若提示「该 Apple ID 未加入付费开发者计划」，说明账号只有
>    免费权限 —— 但本项目已在 ASC 成功创建 App 记录，
>    按理是付费账号，因此更可能是登录未完成而非权限不足。

#### 路线 2 · 开发者后台手动创建

1. 打开 <https://developer.apple.com/account/resources/profiles/list>
2. 点 **+** → **Distribution** 下选 **App Store Connect** → **Continue**
3. **App ID** 选 `com.ord.tanji.app` → **Continue**
4. **证书**选 `Apple Distribution: yong feng (YC9UFHH73D)` → **Continue**
5. **名称**填 `探记 App Store` → **Generate** → **Download**
6. **双击下载的 `.mobileprovision`** 导入 Xcode
   （或双击后选「登录」钥匙串）
7. **把文件放进 Xcode 的描述文件目录**。双击导入有时不落盘，需手工放：
   ```bash
   T=$(mktemp -d); security cms -D -i ~/Downloads/<下载的文件名> > "$T/p.plist"
   UUID=$(/usr/libexec/PlistBuddy -c "Print :UUID" "$T/p.plist")
   cp ~/Downloads/<下载的文件名> \
     ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/$UUID.mobileprovision
   rm -rf "$T"
   ```
   > ⚠️ macOS 下载会把中文文件名截断成 `_App_Store.mobileprovision`，
   > 属正常现象，不影响内容（内容以 `Name` 字段为准，即「探记 App Store」）。

#### ✅ 手动签名路线：Xcode 不登录也能归档

**2026-11-28 实测结论**：本机 Xcode 的开发者身份**始终没登录成功**
（账号数组恒为空），但走「后台手动创建描述文件 + 手动签名」这条路线
**完全可行**，已实跑产出可上传的 IPA。

关键点：自动签名（`CODE_SIGN_STYLE=Automatic`）依赖 Xcode 登录，
没登录就会回落到开发 profile；而**手动签名（`CODE_SIGN_STYLE=Manual`）
不需要 Xcode 登录**，只要描述文件已装好。

`scripts/archive-testflight.sh` 已支持这条路线：

```bash
cd /Users/ola/drax-toolbox/tanji-native-ios
PROVISIONING_PROFILE_SPECIFIER="探记 App Store" \
DEVELOPMENT_TEAM=YC9UFHH73D npm run archive:testflight
```

`PROVISIONING_PROFILE_SPECIFIER` 填的是描述文件里的 **Name**
（不是文件名），脚本会自动切到手动签名并锁定
`CODE_SIGN_IDENTITY="Apple Distribution"`，导出阶段也会自动带上
`provisioningProfiles` 字典——否则会报
`No profiles for 'com.ord.tanji.app' were found`。

`npm run testflight:ready` 在这个状态下会给出提示而不是报错：

```
! Xcode 未完成开发者身份登录，但已装好分发描述文件，可走手动签名路线：
  PROVISIONING_PROFILE_SPECIFIER="探记 App Store" DEVELOPMENT_TEAM=YC9UFHH73D npm run archive:testflight
```

**验证描述文件到位**

```bash
for f in ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/*.mobileprovision; do
  T=$(mktemp -d); security cms -D -i "$f" > "$T/p.plist" 2>/dev/null
  printf '%s | %s | get-task-allow=%s\n' \
    "$(/usr/libexec/PlistBuddy -c 'Print :Name' "$T/p.plist" 2>/dev/null)" \
    "$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$T/p.plist" 2>/dev/null)" \
    "$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:get-task-allow' "$T/p.plist" 2>/dev/null)"
  rm -rf "$T"
done
```

需要看到一条 `get-task-allow=false` 且 App ID 为
`YC9UFHH73D.com.ord.tanji.app` 的记录。

**验证归档真的用了分发签名**

```bash
cd /Users/ola/drax-toolbox/tanji-native-ios
PROVISIONING_PROFILE_SPECIFIER="探记 App Store" \
DEVELOPMENT_TEAM=YC9UFHH73D npm run archive:testflight
```

脚本会自动校验描述文件的 `get-task-allow=false`，
不满足会直接报错退出，不会产出可上传的 IPA。

**核验产出的 IPA**

```bash
cd build/testflight/TanjiNative-1.0.0-<build>
unzip -p ipa/TanjiNative.ipa Payload/TanjiNative.app/embedded.mobileprovision > /tmp/p.plist
security cms -D -i /tmp/p.plist | /usr/libexec/PlistBuddy -c 'Print :Name' /dev/stdin
codesign -dvvv Payload/TanjiNative.app 2>&1 | grep Authority
```

期望看到 `Apple Distribution: yong feng (YC9UFHH73D)` 作为签发者。

---

## 三、执行顺序

### 步骤 1 · 账号侧一次性配置（需你在后台操作）

1. **注册 App ID `com.ord.tanji.app`** —— ✅ **已完成**（名称「ios」）。
   若之后需要重建，步骤见 [§2.4](#24-注册-app-id-的完整步骤apple-官方中文界面路径)。
2. **App Store Connect 新建 App** —— ✅ **已完成**（2026-11-28 用户创建）。
   名称 `探记`、Bundle `com.ord.tanji.app`。
3. **Xcode → Settings → Accounts** 登录你的开发者账号
   （Team ID 已知：`YC9UFHH73D`；本机**始终未登录成功**，但已改走手动签名路线，
   不再是阻断项 —— 见 §2.8）。
4. **创建 Apple Distribution 证书** —— ✅ **已完成**（2026-11-28 用户创建）。
   本机已实测装好：`Apple Distribution: yong feng (YC9UFHH73D)`，
   私钥配对成功（`security find-identity` 列为 valid identity）。
5. **创建 App Store 分发描述文件** —— ✅ **已完成**（2026-11-28 用户在后台创建，
   名称「探记 App Store」，UUID `c81dd139-e905-4422-89da-d1f669fade91`，
   `get-task-allow=false`，有效期至 2027-11-28）。
   完整步骤见 [§2.8](#28-创建-app-store-分发描述文件当前唯一阻断项)。
6. **填公网隐私政策与支持 URL** —— ✅ **已完成**（两个 URL 实测 HTTP 200）。
7. **App Privacy** 选择「不收集数据」（与 `PrivacyInfo.xcprivacy` 口径一致）。
8. **创建 App Store Connect API Key**（推荐）或准备 App 专用密码：
   - API Key → `testflight/app-store-connect.json` 里没有存密钥，
     按约定只通过环境变量传入，**不入库**。

> 付费买断上架还需：**Paid Apps Agreement** + 银行与税务信息。
> TestFlight 构建本身不要求付费。

### 步骤 2 · 部署公网法律页（解决阻断项 4）

#### 现状诊断（2026-11-28 实测）

| 项 | 状态 |
|---|---|
| 源文件 | ✅ 都在 `tanji` 仓库根目录：`privacy.html`（9.2KB）、`support.html`（8.8KB） |
| 内容 | ✅ 邮箱占位符已替换为 `fengyong@ustc.edu`；已覆盖通知/定位/照片/SQLite/导出等原生版用到的全部数据类型 |
| 线上 | ✅ **已部署**（2026-11-28 ZCode 完成）：两个 URL 均 **HTTP 200**，内容抽查含「隐私政策」/「支持」/ `fengyong@ustc.edu`；首页已带法律页入口 |
| 结论 | ✅ 已解决。诊断为「线上跑的是旧版本」，重新部署 `main` 后修复 |

站点托管在 **ZCode Sites**（`zai.site` 为其托管域名，每个项目一个子域名，
`x-fc-request-id` 响应头指向阿里云 FC）。部署走 ZCode 的一键发布，
仓库里**没有**部署脚本或 CI deploy job，所以是从 ZCode 客户端/网页端发布的。

#### 部署步骤

**A. 确认 `main` 分支已推送**（法律页在 `main` 上，`d74ffd4` 提交已把邮箱占位符换成真实邮箱）

```bash
cd /Users/ola/drax-toolbox/tanji
git fetch origin && git log --oneline -1 origin/main
git status -sb          # 应显示 main...origin/main 且无未推送提交
```

**B. 在 ZCode 里重新发布**

1. 打开 ZCode（桌面版或网页端），选中 **`tanji` 项目**；
2. 确认部署分支为 **`main`**（AGENTS.md 明确：「`main` 线上部署即此分支」）；
3. 点「发布 / Deploy / 一键部署」，等待完成；
4. 若站点有缓存（响应头带 `cache-control: no-cache`，一般无碍），
   部署后用无痕窗口验证一次。

> ⚠️ `lab` 分支对应另一个域名 `tanji-lab-1v7g.zai.site`，
> **不要发布到 lab 站点**——法律页要挂在正式站 `tanji-app-guvc.zai.site` 下。

**C. 验证（本机跑，两条都要 200）**

```bash
for p in privacy.html support.html; do
  printf '%s -> ' "$p"
  curl -s -o /dev/null -w '%{http_code}\n' -L "https://tanji-app-guvc.zai.site/$p"
done
```

**D. 内容抽查**（确认返回的是探记页面而非错误页）

```bash
curl -s -L https://tanji-app-guvc.zai.site/privacy.html | grep -o '隐私政策' | head -1
curl -s -L https://tanji-app-guvc.zai.site/support.html | grep -o '支持' | head -1
```

> 📋 **可直接交给 ZCode 的任务单**：见 [`zcode-deploy-request.md`](zcode-deploy-request.md)，
> 里面是自包含的部署说明与验收清单，ZCode 不需要读本仓库也能直接执行。

#### 如果不想动 ZCode：备选方案

把两个 HTML 放到任意静态托管（GitHub Pages / 对象存储 / 任意 CDN），
然后在 ASC 里填那个新 URL 即可——**ASC 只要求 URL 能返回 200 且内容是隐私政策**，
不要求与主站同域。

> 不过优先走 ZCode 重新部署 `main`：实测本地 `main` 的 `index.html`
> 已经带上了 `privacy.html` / `support.html` 两个菜单链接（第 1424 / 1429 行），
> 而线上 v0.4 首页**一个都没有**。重新部署会同时修好「法律页 404」
> 和「主站无法律入口」两件事，比手工另找托管更省事。

> 本机**没有** `aliyun` / `s` / `fcli` 等阿里云部署 CLI，
> 所以无法从命令行直接发 FC，需要走 ZCode 的发布界面。

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

> **签名方式**：默认走 `CODE_SIGN_STYLE=Automatic`，由 Xcode 自动选证书；
> 手动指定 identity 会触发 `conflicting provisioning settings` 报错
> （2026-11-28 实测）。但自动签名**要求 Xcode 已登录开发者账号**，
> 本机登录始终未成功，因此实际使用的是手动签名路线：
>
> ```bash
> PROVISIONING_PROFILE_SPECIFIER="探记 App Store" \
> DEVELOPMENT_TEAM=YC9UFHH73D npm run archive:testflight
> ```
>
> 详见 [§2.8](#28-创建-app-store-分发描述文件当前唯一阻断项)。

### 步骤 5 · 创建上传凭据（App Store Connect API Key）

> ✅ **已完成**（2026-11-28）。API Key 已创建并成功上传首个构建：
>
> | 项 | 值 |
> |---|---|
> | Key ID | `4C52J4ML4Q` |
> | Issuer ID | `b2f4cab0-dc59-485e-859c-e0180c7bf08d` |
> | 私钥 | `~/.config/tanji/AuthKey_4C52J4ML4Q.p8`（600 权限，仓库外） |
> | 环境文件 | `~/.config/tanji/asc.env`（600 权限，仓库外） |
>
> **Key ID 与 Issuer ID 不是机密**（Apple 的 API 本来就要求客户端持有），
> 记录在 `testflight/app-store-connect.json` 里便于查阅；
> **只有 `.p8` 私钥是机密**，不入库、不外传。
>
> 日常上传用：
>
> ```bash
> source ~/.config/tanji/asc.env
> npm run upload:testflight -- <IPA 路径>
> ```

**ASC 就是 App Store Connect**：<https://appstoreconnect.apple.com/>

上传构建需要 API 凭据。**API Key** 是推荐方式（比 App 专用密码更好撤销、权限更细）。

#### 创建步骤

1. 登录 <https://appstoreconnect.apple.com/>
2. 顶部导航点 **「用户与访问」**（Users and Access）
3. 切到 **「整合」**（Integrations）标签页
4. 左侧栏 **「密钥」** 下选 **「App Store Connect API」**
5. 确认选中的是 **「Team Keys」**（团队密钥）
6. 点 **「+」**（首次则点「生成 API 密钥」）
7. 填写：
   - **名称**：如 `探记上传`（仅自己看用）
   - **访问权限（Access）**：选 **App Manager**（够用；Admin 权限过大，
     能增删团队成员）
8. 点 **「生成」**

#### 生成后拿到的三样东西

页面会显示：

| 项 | 说明 | 用途 |
|---|---|---|
| **Issuer ID** | 页面顶部，一个 UUID | → `ASC_API_ISSUER` |
| **Key ID** | 密钥列表里那一列 | → `ASC_API_KEY` |
| **AuthKey_XXXXXXXXXX.p8** | **点「下载 API 密钥」下载** | → `ASC_PRIVATE_KEY_PATH` |

> ⚠️ **私钥只能下载一次**，Apple 不保留副本。下载后立刻妥善保存，
> 丢了只能撤销重建。**不要提交到 git、不要发到网盘或聊天工具**。

#### 存放位置建议

放到仓库外的安全位置，例如：

```bash
mkdir -p ~/.config/tanji
mv ~/Downloads/AuthKey_*.p8 ~/.config/tanji/
chmod 600 ~/.config/tanji/AuthKey_*.p8
```

`.p8` 不在仓库目录内，天然不会被 `git` 扫到。

#### 上传

```bash
export ASC_API_KEY=<Key ID>
export ASC_API_ISSUER=<Issuer ID>
export ASC_PRIVATE_KEY_PATH=~/.config/tanji/AuthKey_XXXXXXXXXX.p8

cd /Users/ola/drax-toolbox/tanji-native-ios
npm run upload:testflight -- build/testflight/TanjiNative-1.0.0-<build>/ipa/TanjiNative.ipa
```

脚本先 `altool --validate-app` 再 `--upload-app`。

> 备选：用 App 专用密码而非 API Key —
> `export ASC_APPLE_ID=fengyong@ustc.edu`、
> `export ASC_APP_SPECIFIC_PASSWORD=<app-specific-password>`。
> App 专用密码在 <https://appleid.apple.com> → 登录 → 安全 → 生成密码。
> 不推荐用登录密码。

> 工具现状（2026-11-28 实测）：本机 Xcode 27.2 的 `xcrun altool`（27.10.4）**仍可用**，
> Apple 官方「上传构建版本」文档当前仍列出 altool。
> 网上有「altool 已废弃」的说法，与官方文档不一致 —— 若日后 altool 失效，
> 替代路径是 **Transporter CLI** 或 **App Store Connect 的 Build Uploads API**，
> 届时只需替换 `scripts/upload-testflight.sh` 里的上传调用。

> ⏱️ **别拖太久**：TestFlight 构建**上传后 90 天过期**，不是「归档后 90 天」。
> 归档产物放磁盘不会自动续期，得重新归档上传。

### 步骤 6 · 测试组

> ✅ **内部测试组已建好**（2026-11-28，通过 API 操作完成）：
>
> | 项 | 值 |
> |---|---|
> | 组名 | 探记 内部验收（内部组，无需 Beta 审核） |
> | groupId | `27b2129a-8528-459d-9657-f9545f9a6958` |
> | 测试者 | `fengyong@ustc.edu`（betaTesterId `26315ba5-b729-4b88-b97e-5e9cabdedebf`） |
> | 已分配构建 | `20261128.212041`（`processingState = VALID`） |
> | 构建有效期 | 至 2027-02-26（上传后 90 天） |
>
> #### ⚠️ 内部测试**仍然要接受邀请**（2026-11-28 实测修正）
>
> 最初以为「ASC 团队成员自动可见、无需邀请」，**实测不成立**：
> 用 API 创建的 betaTester 状态是 `INVITED`，TestFlight App 里看不到「探记」。
> 状态流转必须是：
>
> ```
> NOT_INVITED → INVITED → ACCEPTED → INSTALLED
>                            ↑
>                    测试者点邮件里的链接接受
> ```
>
> `state` 字段**只在从 betaGroup 端点查时才有值**
> （`GET /v1/betaGroups/{id}/betaTesters`），
> 直接查 `GET /v1/betaTesters/{id}` 恒为 `null`。
> `state` 与 `inviteType` 都是**只读**的，API 无法改，只能由测试者接受邀请。
>
> #### 你要做的
>
> 1. 去 **`fengyong@ustc.edu` 邮箱**收 Apple 的 TestFlight 邀请邮件
>    （发件人是 Apple「App Store Connect」，标题类似
>    「TestFlight: 探记」/「You have been invited to test」）
> 2. 点邮件里的 **「View in TestFlight」** 按钮 → 打开 TestFlight App
> 3. 在 TestFlight 里点 **「接受」/「Accept」**
>    （如果 TestFlight 已登录且 App 列表为空，先退出登录重进）
> 4. 回到 TestFlight → 「要测试的 App」里就有「探记」了 → 点「安装」
>
> 邀请已通过 API 发出（`betaTesterInvitations` id
> `7e2398cb-1ea7-42d3-af2a-32f24780dab5`）。若收不到邮件，
> 可在 ASC 网页端手动重发：
> ASC → App → TestFlight → 内部测试 → 「探记 内部验收」→
> 测试人员 → 选中 `fengyong@ustc.edu` → **重新发送邀请**。
>
> #### 服务端已就绪的判据（2026-11-28 实测全绿）
>
> | 项 | 值 | 含义 |
> |---|---|---|
> | `internalBuildState` | `IN_BETA_TESTING` | 构建已进入内部测试分发 |
> | `externalBuildState` | `READY_FOR_BETA_SUBMISSION` | 外部测试也已就绪（只需过 Beta 审核） |
> | `processingState` | `VALID` | 构建处理完成 |
> | 构建归属 | `探记 内部验收`（内部组） | 已分配 |
> | 测试者可见构建 | `20261128.212041` | 关联正确 |
> | 测试者 `state` | **`INVITED`** | ⚠️ **等待测试者点邮件接受** |
>
> 上表全部正确但 TestFlight 里仍看不到 App 时，**只剩一个原因**：
> 邀请没被接受。此时 ASC 网页端的「邀请」列显示 **「-」**，
> 接受后会变成具体日期。
>
> #### 验证是否已接受
>
> ```bash
> source ~/.config/tanji/asc.env
> # state 变成 ACCEPTED / INSTALLED 就说明成功了
> curl -s -H "Authorization: Bearer <JWT>" \
>   "https://api.appstoreconnect.apple.com/v1/betaGroups/27b2129a-8528-459d-9657-f9545f9a6958/betaTesters" \
>   | python3 -m json.tool | grep -E '"email"|"state"'
> ```
>
> #### 若 TestFlight 里仍看不到「探记」
>
> 按序排查：
> 1. 测试者 `state` 是不是 `ACCEPTED`（用上面的命令查）
> 2. 组里有没有这个测试者 → ASC → App → TestFlight → 内部测试 →
>    「探记 内部验收」→ 测试人员
> 3. 构建有没有分配到组 → 同页「构建版本」列表里应能看到 `20261128.212041`
> 4. 该账号的 ASC 职能是否有权访问你的 App（没有就改职能）
> 5. TestFlight 登录用的 Apple ID 是否就是 `fengyong@ustc.edu`——
>    用别的 Apple ID 登录就看不到（**很常见**）
>
> #### 内部组**不能**启用公开链接
>
> 实测（2026-11-28）：`PATCH /v1/betaGroups/{id}` 传
> `publicLinkEnabled: true` 会被拒：
>
> ```
> Public link cannot be enabled for internal group
> ```
>
> 公开链接（`testflight.apple.com/join/XXXX`）**只对外部组有效**。

#### ⚠️ 关键坑：出口合规声明（不声明则构建无法分配）

2026-11-28 实测踩到的坑：构建上传成功、`processingState = VALID`，
但**分配到测试组时一直报 422**：

```
Build is not assignable.
Build is not in an externally assignable state.     ← 外部组
Build is not in an internally testable state.       ← 内部组
```

根因是**没做出口合规声明**。查 `buildBetaDetail` 可见：

```
internalBuildState = MISSING_EXPORT_COMPLIANCE
externalBuildState = MISSING_EXPORT_COMPLIANCE
```

解决办法（API）：

```
PATCH /v1/builds/{buildId}
{
  "data": {
    "type": "builds",
    "id": "<buildId>",
    "attributes": { "usesNonExemptEncryption": false }
  }
}
```

本 App 不发起任何网络请求、不用非豁免加密，所以填 `false`。
声明后状态立即变为 `internalBuildState = READY_FOR_BETA_TESTING`，
构建就能分配了。

> 💡 网页端对应位置：ASC → App → TestFlight → 构建版本列表 →
> 选中构建 → 「出口合规」/「Export Compliance」→ 回答问题。
> **每次上传新构建都要重新声明。**

#### 分配构建的 API（内部组）

```
POST /v1/betaGroups/{groupId}/relationships/builds
{ "data": [ { "type": "builds", "id": "<buildId>" } ] }
```

#### 建内部组与加测试者的 API

```
# 建组（内部组必须显式 isInternalGroup: true，否则建出来的是外部组）
POST /v1/betaGroups
{
  "data": {
    "type": "betaGroups",
    "attributes": {
      "name": "探记 内部验收",
      "publicLinkEnabled": false,
      "isInternalGroup": true
    },
    "relationships": { "app": { "data": { "type": "apps", "id": "<appResourceId>" } } }
  }
}

# 加测试者（inviteType 不能在 CREATE 时指定，会报 409）
POST /v1/betaTesters
{
  "data": {
    "type": "betaTesters",
    "attributes": { "email": "fengyong@ustc.edu", "firstName": "yong", "lastName": "feng" },
    "relationships": { "betaGroups": { "data": [ { "type": "betaGroups", "id": "<groupId>" } ] } }
  }
}
```

> 💡 `appResourceId` 不是 bundle ID，要先查：
> `GET /v1/apps` → 找到 `attributes.bundleId == com.ord.tanji.app` 那条的 `id`
> （本项目是 `6840332432`）。
> 同理 `GET /v1/builds?filter[app]=<appResourceId>` 才是查构建的正确写法，
> 用 bundle ID 过滤会返回空。
>
> ⚠️ **光创建 betaTester 不够**，还要显式发邀请，否则测试者状态停在
> `INVITED`，TestFlight 里看不到 App：
>
> ```
> POST /v1/betaTesterInvitations
> {
>   "data": {
>     "type": "betaTesterInvitations",
>     "relationships": {
>       "app":        { "data": { "type": "apps", "id": "<appResourceId>" } },
>       "betaTester": { "data": { "type": "betaTesters", "id": "<betaTesterId>" } }
>     }
>   }
> }
> ```
>
> 该端点的 `app` 关系**必填**（缺了报
> `You must provide a value for the relationship 'app'`），
> 且**没有 `email` 属性**（传了报 `'email' is not an attribute`）。
> 路径是 `/v1/`，不是 `/v2/`（V2 资源仍走 `/v1/` 前缀）。
>
> 另外，若测试者看不到构建，还要把它单独挂到构建上：
>
> ```
> POST /v1/builds/{buildId}/relationships/individualTesters
> { "data": [ { "type": "betaTesters", "id": "<betaTesterId>" } ] }
> ```
>
> 📌 **查 state 必须走组端点**：
> `GET /v1/betaGroups/{id}/betaTesters` → `attributes.state` 才有值；
> `GET /v1/betaTesters/{id}` 的 `state` 恒为 `null`。

#### 加入第二位内部测试员（对方还不是 ASC 团队成员）

> ⚡ **已封装成一键脚本**（2026-11-28 新增，无需手写 curl）：
>
> ```bash
> # 查状态 / 加人（对方接受团队邀请后再跑一次即可）
> npm run asc:add-tester -- 1763637894@qq.com
>
> # 对方还不是团队成员时，发团队邀请
> npm run asc:add-tester -- 1763637894@qq.com Test Tester --invite-team
>
> # 任意 ASC API 调用
> npm run asc:api -- GET /betaGroups/27b2129a-8528-459d-9657-f9545f9a6958/betaTesters
> ```
>
> 脚本会自己判断对方是否已是团队成员，并依次完成
> 「建 betaTester → 加内部组 → 分配构建 → 发 TestFlight 邀请 → 打印 state」。
> 底层是 `scripts/asc-api.mjs`（Node 内置 crypto 做 ES256 JWT，
> **必须是 `dsaEncoding: 'ieee-p1363'`**，DER 格式会被 Apple 拒）。

**内部测试员必须是 App Store Connect 团队成员。**
Apple 官方帮助原文：「如果所选的测试员不是 App Store Connect 用户，
则无法添加到内部群组。」API 层面的表现是：

```
POST /v1/betaTesters（带内部组关系）
→ HTTP 409 ENTITY_ERROR / STATE_ERROR
   detail: "Tester(s) cannot be assigned"
```

所以顺序必须是：**先邀请进团队 → 等对方接受 → 才能加内部组**。

**第 1 步：邀请进 ASC 团队**（已发出）

```
POST /v1/userInvitations
{
  "data": {
    "type": "userInvitations",
    "attributes": {
      "email": "1763637894@qq.com",
      "firstName": "Test",
      "lastName": "Tester",
      "roles": ["DEVELOPER"],
      "allAppsVisible": true,
      "provisioningAllowed": false
    }
  }
}
```

- `roles` 至少要有 `DEVELOPER` / `MARKETING` / `APP_MANAGER` / `ADMIN`
  之一，否则即使接受了团队邀请也进不了内部测试组。
- **邀请 3 天后过期**（本次的到期时间 `2026-12-01`），过期后要重发。
- 对方接受后，**邀请记录会被自动删除**，`GET /v1/users` 里会多出新成员，
  `GET /v1/userInvitations` 变空——这是"已接受"的标志。

> 📌 **对方怎么接受**（两条路都要走）：
> 1. 邮件：Apple 发到 `1763637894@qq.com` 的激活邮件 → 点里面的链接 →
>    关联/确认自己的 Apple 账户 → 加入团队。
> 2. 网页：登录 [developer.apple.com/account](https://developer.apple.com/account)
>    → App Store Connect → 接受邀请。
> 接受时需要一个 **Apple 账户**（不是 App Store Connect 账户），
> 如果他还没有 Apple ID，先在 iPhone 上用这个邮箱注册一个即可。
> 接受完这一步，TestFlight 的装机邀请邮件是**另外一封**，
> 要等他点了那封邮件里的「View in TestFlight」才会在 TestFlight App 里出现「探记」。

**第 2 步：确认他已成为团队成员**

```
GET /v1/users
→ data 里出现 username == 1763637894@qq.com 的那条，记下它的 id
```

**第 3 步：建 betaTester 并加进内部组**（此时才不会报 409）

```
POST /v1/betaTesters
{
  "data": {
    "type": "betaTesters",
    "attributes": { "email": "1763637894@qq.com", "firstName": "Test", "lastName": "Tester" },
    "relationships": {
      "betaGroups": { "data": [ { "type": "betaGroups", "id": "27b2129a-8528-459d-9657-f9545f9a6958" } ] }
    }
  }
}
```

> ⚠️ `POST /v1/betaTesters` **必须**带 `betaGroups` 或 `builds` 关系，
> 两个都不带会报
> `Either betaGroups or builds relationship is required when creating betaTesters`；
> `inviteType` 依然**不能**在 CREATE 时传。

**第 4 步：分配构建 + 发 TestFlight 邀请**

```
POST /v1/builds/{buildId}/relationships/individualTesters
{ "data": [ { "type": "betaTesters", "id": "<betaTesterId>" } ] }

POST /v1/betaTesterInvitations
{
  "data": {
    "type": "betaTesterInvitations",
    "relationships": {
      "app":        { "data": { "type": "apps", "id": "6840332432" } },
      "betaTester": { "data": { "type": "betaTesters", "id": "<betaTesterId>" } }
    }
  }
}
```

**第 5 步：验收状态**

```
GET /v1/betaGroups/27b2129a-8528-459d-9657-f9545f9a6958/betaTesters
→ attributes.state：
   INVITED   = 邀请已发，对方还没点
   ACCEPTED  = 对方已点邮件里的「View in TestFlight」
   INSTALLED = 已在设备上装了 TestFlight App（第一个测试员已是此状态）
```

> 💡 补充：Apple 帮助里写明「App Store Connect 用户」群组的用户会自动获得
> 所有合格构建版本的访问权限，因此第 4 步的 `individualTesters` 挂载在
> 实践中往往是冗余的，但显式挂一次更保险。

#### 后续：外部测试（给团队外的人测）

外部测试者**必须走 Beta App Review**（首个外部构建会送去 Apple 审核），
且有三个前置资源目前**都还没建**（2026-11-28 实测 API 查询均为空）：

| 前置资源 | 作用 | API 端点 | 现状 |
|---|---|---|---|
| `betaAppLocalizations` | Beta 描述 + 反馈邮箱（每语言一条） | `POST /v1/betaAppLocalizations` | ❌ 0 条 |
| `betaBuildLocalizations` | What to Test（每个构建每语言一条） | `POST /v1/betaBuildLocalizations` | ❌ 0 条 |
| `betaReviewDetails` | Beta 审核联系人信息 | `POST /v1/betaReviewDetails` | ❌ 无 |

步骤：

1. **建外部组**（`isInternalGroup: false`），可同时启用公开链接
   ```bash
   POST /v1/betaGroups
   { "data": { "type": "betaGroups",
       "attributes": { "name": "探记 外部测试", "publicLinkEnabled": true,
                       "publicLinkLimit": 10, "publicLinkLimitEnabled": true },
       "relationships": { "app": { "data": { "type": "apps", "id": "6840332432" } } } } }
   ```
   外部组**可以**启用公开链接（内部组不行），拿到 `testflight.apple.com/join/XXXX`。
2. **填 Beta 描述与反馈邮箱**（`betaAppLocalizations`，locale 用 `zh-Hans`）
   —— 文案见 `testflight/beta-description.txt`
3. **填 What to Test**（`betaBuildLocalizations`）—— 见 `testflight/what-to-test.txt`
4. **填 Beta 审核联系人**（`betaReviewDetails`）—— 见 `testflight/review-notes.txt`
5. **分配构建**到外部组（同一 `POST /v1/betaGroups/{id}/relationships/builds`）
6. **提交 Beta App Review**：`POST /v1/builds/{buildId}/betaAppReviewSubmission`
7. 审核通过后，测试者通过**公开链接**或**邮件邀请**加入

> 文案已备好：`testflight/` 下的 `beta-description.txt`、`what-to-test.txt`、
> `review-notes.txt`、`tester-invitation.txt`。
>
> ⚠️ 内部组已装好构建后，**同一个构建是否也能进外部组**，取决于该构建
> 上传时的分发方式：只有标了「TestFlight Internal Only」的构建**不能**
> 进外部组。本项目的构建走的是 App Store 分发（`buildAudienceType =
> APP_STORE_ELIGIBLE`），所以内部外部都能用。

---

## 三点五、旁路直装：绕过 TestFlight 直接装到指定设备（2026-11-28）

TestFlight 走不通（团队外的人不是 ASC 团队成员，内部组不接受）时，
可以把开发签名的包直接装到已注册设备上。

### 3.5.1 本机已具备的条件（2026-11-28 实测）

| 条件 | 状态 | 证据 |
|---|---|---|
| 开发签名身份 | ✅ `Apple Development: fengyong@ustc.edu (DFVF2R4K8Y)` | `security find-identity -v -p codesigning` |
| 证书有效期 | ✅ 2026-11-22 → **2027-11-22** | openssl 读 subject/dates |
| 通配符开发 profile | ✅ `iOS Team Provisioning Profile: *`，`YC9UFHH73D.*`，到期 **2027-11-26** | `e454e5ef-5327-49aa-9dbc-84d36f628787.mobileprovision` |
| 该 profile 覆盖的设备 | 3 台：`00008130-…3803A`(Ordi 的 iPhone15)、`00008142-…401C`(iPad pro 2025)、**`00008150-…401C`(扬眉吐气的杨小姐)** | `ProvisionedDevices` |
| ASC 已注册设备 | 3 台，与上面一致，`00008150-001E654A3C39401C` 状态 ENABLED | `GET /v1/devices` |

> 📌 **为什么不用「探记 App Store」那个 profile**：
> 它的 `ProvisionedDevices` 为空（App Store 类型 profile 不带设备列表），
> 装不到任何具体设备上，只能用于上传。
> 直装必须用 **development / ad hoc** 类型的 profile。

### 3.5.2 一条命令装机

```bash
cd /Users/ola/drax-toolbox/tanji-native-ios
DEVICE_UDID=00008150-001E654A3C39401C \
PROFILE_UUID=e454e5ef-5327-49aa-9dbc-84d36f628787 \
CONFIGURATION=Release \
bash scripts/install-device-ios.sh
```

- `DEVICE_UDID` 缺省会自动挑第一台已连接的真机；指定它可以避免装错机器。
- `PROFILE_UUID` 缺省也会自动挑「覆盖目标设备 + 通配符 + 未过期」的 profile。
- `CONFIGURATION=Release` 出的是给外部人员用的包（Debug 版带调试 dylib，仅本机自测用）。

### 3.5.3 前置条件（最容易卡住的一步）

**手机必须处于可被 Mac 访问的状态**，`xcrun devicectl list devices` 里
tunnelState 要是 `connected`：

```bash
xcrun devicectl list devices --json-output /tmp/devs.json
node -e 'const j=require("/tmp/devs.json");
for(const d of j.result.devices||[]) if(d.hardwareProperties.reality==="physical")
  console.log(d.hardwareProperties.udid, d.connectionProperties.tunnelState, d.connectionProperties.pairingState);'
```

- `unavailable` / `disconnected` → **装机必然失败**，报
  `The device is not able to fulfill the requested usage assertion requirements (error 4016)`。
- 让对方用数据线连上 Mac 并解锁，或让手机与 Mac 连同一个 Wi-Fi 并打开无线调试。
- `paired` 只表示配过对，`tunnelState` 才是真连上了。

### 3.5.4 「开发者模式」到底要不要一直开着

**不用一直开。** 开发者模式（设置 → 隐私与安全性 → 开发者模式）是个
**一次性开关**：装开发签名的 App 时系统会要求打开它，打开后**永久保持**，
之后每次安装都不用再管。真正的持续成本是**签名有效期**：

| 项 | 本项目实际情况 |
|---|---|
| 开发证书 | 到 2027-11-22，够用近一年 |
| 开发 profile | 到 2027-11-26，够用近一年 |
| 后果 | 一年后证书/profile 过期，需要重新签发并重装 |

对比 TestFlight：TestFlight 的构建 **90 天**过期（当前构建到 2027-02-26），
而且**不需要开发者模式**。所以长期看 TestFlight 更省事，
直装适合「现在就装上、马上要测」的场景。

### 3.5.5 已产出的安装包（2026-11-28 22:19）

```
build/device-install/TanjiNative.app            # 已签名，可直接 devicectl 安装
build/device-install/TanjiNative-dev-20261128.zip  # 1,539,860 bytes
sha256: 7f696a8039841fbc0fcc1b34562c3d53ba6bdaff21692bceb13dce2500ce20f4
```

签名校验（实跑结果）：

```
codesign --verify --deep --strict → valid
Authority = Apple Development: fengyong@ustc.edu (DFVF2R4K8Y)
          → Apple Worldwide Developer Relations Certification Authority
          → Apple Root CA
TeamIdentifier = YC9UFHH73D
CFBundleIdentifier = com.ord.tanji.app
CFBundleShortVersionString = 1.0.0 / CFBundleDisplayName = 探记
内嵌 profile = iOS Team Provisioning Profile: *（到期 2027-11-26）
二进制架构 = arm64
```

> ✅ **代码版本确认**：所有 Swift 源码最后修改时间为 2026-11-28 20:58，
> 早于 TestFlight 归档（21:20）。所以**直装包与已上传构建 `20261128.212041`
> 是同一份代码**，无需重新归档。

### 3.5.6 装机命令（设备连上后直接跑）

```bash
cd /Users/ola/drax-toolbox/tanji-native-ios

# 方式 A：装已构建好的包（最快，约 10 秒）
xcrun devicectl device install app \
  --device 00008150-001E654A3C39401C \
  build/device-install/TanjiNative.app
xcrun devicectl device process launch \
  --device 00008150-001E654A3C39401C --terminate-existing com.ord.tanji.app

# 方式 B：重新构建 + 装机（代码有改动时）
DEVICE_UDID=00008150-001E654A3C39401C \
PROFILE_UUID=e454e5ef-5327-49aa-9dbc-84d36f628787 \
CONFIGURATION=Release \
bash scripts/install-device-ios.sh
```

### 3.5.6.1 ✅ 杨小姐的 iPhone 17 Pro 已装成功（2026-11-28 23:00）

实跑结果：

```
xcrun devicectl device install app --device 00008150-001E654A3C39401C build/device-install/TanjiNative.app
→ App installed:
  • bundleID: com.ord.tanji.app
  • installationURL: file:///private/var/containers/Bundle/Application/8CF91FD2-…/TanjiNative.app/
  • databaseSequenceNumber: 1704

xcrun devicectl device process launch --device 00008150-001E654A3C39401C --terminate-existing com.ord.tanji.app
→ Launched application with com.ord.tanji.app bundle identifier.
```

设备上 `devicectl list apps` 显示「探记 `com.ord.tanji.app` 1.0.0」，
`tunnelState = connected`。

> 📌 **生效的关键动作是「USB 重新接入」**：
> 设备从 `unavailable` → `connecting` → `disconnected` → `connected`
> 的过程中，装机立刻成功。
> 也就是说**线缆要真正重新插拔一次**，光在软件层面重试没用。
>
> 📌 **重要判定经验**：`unavailable` 与 `disconnected` 都不是「装不上」，
> 但含义不同：
>
> | tunnelState | 含义 | 该做什么 |
> |---|---|---|
> | `unavailable` | 设备还没被 CoreDevice 认到，或隧道从没建起来 | 检查 USB 枚举、信任、开发者模式 |
> | `connecting` | 正在握手 | 等，别打断 |
> | `disconnected` | **已认到设备**，隧道刚断/正在重建 | **马上重试装机，往往就成功** |
> | `connected` | 隧道通了 | 正常装机 |
>
> 2026-11-28 实测正是靠这一条翻盘的：
> 22:58:11 状态从 `unavailable` 跳到 `connecting`，
> 随后 `disconnected`，
> 此时 `devicectl device install app` 立即返回 `App installed`。
> 等待脚本 `scripts/wait-and-install.sh` 也捕获到了这个瞬间并自动完成装机 + 启动。
>
> 📌 **设备上有三个名字相近的图标**，验收时注意区分：
>
> | 显示名 | Bundle ID | 说明 |
> |---|---|---|
> | **探记** | `com.ord.tanji.app` | ✅ **本次装的新版**（1.0.0） |
> | 探记 | `com.olatanji.app` | 旧版，不在本开发者账号下（别的账号装的） |
> | 探记 HG | `com.tanji.hg` | 混合版旧版，也不在本账号下 |
>
> 旧版两个**不影响**新版运行，导数据时要认准新版是 `com.ord.tanji.app`。

> 📌 **2026-11-28 22:19-22:58 实测记录（这台机器上杨小姐的 iPhone 17 Pro
> 一直无法建立 CoreDevice 隧道）**，逐层排除如下：
>
> | 检查项 | 命令 | 实测结果 | 结论 |
> |---|---|---|---|
> | 设备是否已注册 | `GET /v1/devices` | `00008150-001E654A3C39401C` 存在，ENABLED | ✅ |
> | 是否为 ASC 团队成员 | `GET /v1/users` | 只有 `fengyong@ustc.edu` | ❌ 不是内部测试员 |
> | 开发者模式 | `devicectl list devices --json-output` → `deviceProperties.developerModeStatus` | `enabled` | ✅ 已开，且**永久保持**，不是问题 |
> | USB 物理枚举 | `ioreg -p IOUSB -l -w 0` | 见过 `iPhone@00100000`，`kUSBSerialNumberString = 00008150001E654A3C39401C` | ✅ 线是通的 |
> | 信任配对 | `devicectl` → `connectionProperties.pairingState` | `paired`；用户也确认点了「信任此电脑」 | ✅ |
> | **隧道** | `devicectl` → `connectionProperties.tunnelState` | **`unavailable`** | ❌ **卡在这** |
> | 设备在线状态 | `devicectl device info details` | `Boot State: booted` / `Developer Mode: Enabled` | ✅ |
> | 缺哪条能力 | 安装报错 | 缺 `remoteServiceDiscoveryTrustedConnectivityAvailable`、`coreDeviceServicesLoaded` | ❌ **RSD 通道未建立** |
> | Xcode 设备列表 | `xcodebuild -showdestinations` | 只有 iPad 与 Ordi's iPhone15，**没有这台** | ❌ |
> | Xcode 报错原文 | `xcrun xcdevice list` | `Browsing on the local area network for 扬眉吐气的杨小姐` | ❌ Xcode 在**局域网里搜不到它** |
> | mDNS 是否工作 | `dns-sd -B _airplay._tcp` | 能看到「客厅的小米电视S75 (192.168.31.171)」 | ✅ mDNS 本身正常 |
> | 无线调试服务 | `dns-sd -B _apple-mobdev2._tcp` / `_rdlink._tcp` | **无任何广播** | ❌ **手机没开「无线调试」** |
> | 主机侧端口 | `nc -z 192.168.31.232` | 62078、49152 开放（iOS 无线调试标准端口） | ✅ 手机在网 |
> | DDI 缓存 | `ls ~/Library/Developer/Xcode/iOS\ DeviceSupport/` | `iPhone18,1 26.6.2 (23G90)`（设备已是 27.2.1） | ⚠️ 陈旧 |
> | DDI 更新 | `xcrun devicectl manage ddis update` | 已是最新，无变化 | ⚠️ |
>
> **结论**：不是老版本探记的问题（Ordi's iPhone15 上同样装了老版「探记 HG
> `ord.tanji` 1.0」，它的隧道状态却是 `connected`），
> 也不是信任、开发者模式、线缆、签名的问题。
> **卡点是 iOS 26+ 的 RSD（远程服务发现）通道没能建立**，
> 而 Apple 开发者论坛已有多起同症状报告（iOS 26.3 + Xcode 26.x，
> `devicectl` 恒为 `unavailable`，DTS 工程师回复需提交 Feedback Assistant
> 附 Core Device 日志，属系统级问题）。
>
> 📌 **可试的绕过手段**（按成功率排序）：
> 1. **手机开「无线调试」**（设置 → 开发者 → 无线调试），
>    再用 `xcrun devicectl device install app --device 192.168.31.232`
>    ——但注意 `devicectl` 只认 UDID / CoreDevice UUID，
>    纯 IP 会报 `The specified device was not found`，
>    所以还得靠 mDNS 主机名被登记进来
> 2. **手机重启**（Apple 论坛多名用户重启后恢复）
> 3. **重启 iPhone 上的 `remoted`**：设置 → 通用 → VPN 与设备管理 → 重置网络设置
> 4. **重置信任**：手机上「抹掉所有内容与设置」后重新信任（代价大，最后手段）
> 5. **改走 TestFlight**（§3.6）：让对方接受 ASC 团队邀请后进内部组，
>    完全不依赖 Mac 与手机的直连 —— **这是最稳的路**
>
> ⚠️ **不要用 `killall CoreDeviceService` 反复重启**：
> 它会把**已经连上的其他设备**（如 Ordi's iPhone15）一起踢成 `disconnected`，
> 且不一定让目标设备恢复。实测踩过。

### 3.5.7 覆盖安装 vs 卸载

- **覆盖安装**（直接装新的）→ 保留沙盒数据，记账记录不丢。
- **卸载** → 沙盒数据被删，本地记账全丢。升级时**不要卸载**。

---

## 三点六、如果直接申请正式上架：还差什么（2026-11-28 API 实测）

App Store 版本 `1.0` **已经建好了**（id `7e8012d1-2117-4cac-9c97-fda593536ff2`，
状态 `PREPARE_FOR_SUBMISSION`），所以不是「从零开始」，
而是**把这一版补齐内容 + 挂构建 + 提交**。

### 3.6.1 已就绪的部分

| 项 | 状态 | 证据 |
|---|---|---|
| App 记录 | ✅ 探记 / `com.ord.tanji.app` / SKU `tanji-ios-001` | `GET /v1/apps/6840332432` |
| App Store 版本 | ✅ `1.0.0`，状态 `PREPARE_FOR_SUBMISSION` | `GET /v1/appStoreVersions/7e8012d1-…` |
| 上传构建 | ✅ `20261128.212041`，`processingState=VALID` | `GET /v1/builds/395355aa-…` |
| 出口合规 | ✅ 已声明 `usesNonExemptEncryption=false` | `PATCH /v1/builds/{id}` 后的状态 |
| 版本号对齐 | ✅ ASC 版本号已由 `1.0` 改为 **`1.0.0`**，匹配构建的 `CFBundleShortVersionString` | `PATCH /v1/appStoreVersions/{id}` |
| 构建挂载 | ✅ `20261128.212041` 已挂到版本 | `GET /v1/appStoreVersions/7e8012d1-…/build` 返回该构建 |
| 版权信息 | ✅ `copyright = "2026 探记"` | `PATCH /v1/appStoreVersions/{id}` |
| 隐私政策 / 支持页 | ✅ 两个 URL 均 HTTP 200 | `npm run testflight:ready` |
| 隐私清单 | ✅ `PrivacyInfo.xcprivacy` 存在且声明完整 | 同上 |
| 无账号 / 无内购 / 无服务器 | ✅ 买断制，审核时不需要演示账号 | 项目设定 |

### 3.6.2 阻塞项（实测为空/为 null，必须补）

| # | 缺什么 | 实测证据 | 谁来解 |
|---|---|---|---|
| 1 | **版本文案** | `appStoreVersionLocalizations`（zh-Hans, id `c7c24edd-…`）的 `description`/`keywords`/`promotionalText`/`supportUrl`/`marketingUrl` **全为 null** | 写文案 + 填 URL |
| 2 | **副标题与隐私政策链接** | `appInfoLocalizations`（zh-Hans, id `50fc3d51-…`）的 `subtitle`/`privacyPolicyUrl`/`privacyPolicyText` **全为 null**（`name=探记` 已填） | 写文案 |
| 3 | **App 截图** | `appStoreVersionLocalizations/c7c24edd-…/appScreenshotSets` → **0 条**（`appPreviewSets` 也是 0 条） | 真机截图 |
| 4 | **版本未挂构建** | ~~`GET /v1/appStoreVersions/7e8012d1-…/build` → `data: null`~~ | ✅ **2026-11-28 已挂上**，复查返回构建 `20261128.212041` |
| 5 | **审核联系信息** | `GET …/appStoreReviewDetail` → `data: null` | 填联系人 |
| 6 | **定价** | `appPriceSchedules/6840332432` 存在但 `manualPrices` 与 `automaticPrices` 均 **404**（无定价，等同 0 元）；`baseTerritory` 货币 = USD | 定价格 |
| 7 | **上架可用性** | `GET …/appAvailabilityV2` → **404**（未创建 appAvailability） | 选可售地区 |
| 8 | **版权信息** | ~~`appStoreVersions` 的 `copyright` = null~~ | ✅ **已填 `2026 探记`** |
| 9 | **年龄分级问卷** | `appInfos/c7681246-…/ageRatingDeclaration` → 32 个字段里 **29 个为 null**（未作答） | 网页端 |
| 10 | **真机业务验收** | 见 §4 清单，Face ID / 通知 / 导入导出未验 | 用户 + 测试员 |
| 11 | **提交审核** | `GET /v1/reviewSubmissions?filter[app]=6840332432` → **0 条**（从未提交过） | 最后一步 |

### 3.6.3 两条路线对比

| | 直装到指定设备（§3.5） | 直接正式上架（§3.6） |
|---|---|---|
| 耗时 | 分钟级（设备连上即可） | 补完 9 项 + 审核，通常 1-3 天起 |
| 需要对方配合 | 手机连 Mac、开开发者模式 | 无（但要装 TestFlight App） |
| 签名有效期 | 到 2027-11-26（开发证书） | 上架后永久可下载 |
| 审核风险 | 无 | 有（权限声明、描述与实现不符会被拒） |
| 适合 | 现在就要测 | 正式发布 |

> 💡 **两者不冲突**：直装可以让测试员**今天就测**，同时并行补上架缺项。
> 建议先直装验收（把 §4 清单走完），验收过的代码再提审，能显著降低被拒概率。

### 3.6.4 补缺项的 API 速查

```bash
# 挂构建到版本（✅ 2026-11-28 实测返回 200，构建已挂上）
npm run asc:api -- PATCH /v1/appStoreVersions/7e8012d1-2117-4cac-9c97-fda593536ff2 \
  '{"data":{"type":"appStoreVersions","id":"7e8012d1-2117-4cac-9c97-fda593536ff2",
    "relationships":{"build":{"data":{"type":"builds","id":"395355aa-f637-4371-bd6f-cb89a77cd641"}}}}}'

# 写版本文案（描述/关键词/宣传文本/支持页/营销页）
npm run asc:api -- PATCH /v1/appStoreVersionLocalizations/c7c24edd-d40d-4300-b545-0e0149e24c3f \
  '{"data":{"type":"appStoreVersionLocalizations","id":"c7c24edd-d40d-4300-b545-0e0149e24c3f",
    "attributes":{"description":"...","keywords":"...","promotionalText":"...",
                  "supportUrl":"https://tanji-app-guvc.zai.site/support.html",
                  "marketingUrl":"https://tanji-app-guvc.zai.site"}}}'

# 写 App 元信息（副标题/隐私政策链接）
npm run asc:api -- PATCH /v1/appInfoLocalizations/50fc3d51-850f-4554-98d2-385dba4111ae \
  '{"data":{"type":"appInfoLocalizations","id":"50fc3d51-850f-4554-98d2-385dba4111ae",
    "attributes":{"subtitle":"...","privacyPolicyUrl":"https://tanji-app-guvc.zai.site/privacy.html"}}}'

# 建审核联系信息
npm run asc:api -- POST /v1/appStoreReviewDetails \
  '{"data":{"type":"appStoreReviewDetails","attributes":{
    "firstName":"yong","lastName":"feng","phoneNumber":"...","email":"fengyong@ustc.edu",
    "contactFirstName":"yong","contactLastName":"feng","contactPhoneNumber":"...","contactEmail":"fengyong@ustc.edu"},
    "relationships":{"appStoreVersion":{"data":{"type":"appStoreVersions","id":"7e8012d1-2117-4cac-9c97-fda593536ff2"}}}}}'
```

> 📌 **`npm run asc:api` 的路径参数带不带 `/v1` 都行**：
> 脚本内部会去掉重复的 `/v1` 前缀。带 `/v1` 写 `/v1/appStoreVersions/...`，
> 不带就写 `/appStoreVersions/...`。
>
> ⚠️ 2026-11-28 踩过的坑：`BASE` 常量本身已含 `/v1`，
> 早期版本直接 `BASE + endpoint`，于是路径变成 `/v1/v1/appStoreVersions/...`，
> Apple 返回 **404「The path provided does not match a defined resource type」**。
> 这个 404 看起来像「资源不存在」，其实是**路径拼错**，别误判成权限或资源缺失。
> 排查手法：在 fetch 前打印最终 URL。
>
> ⚠️ **版本号必须与构建里的 `CFBundleShortVersionString` 一致**：
> 本轮已把 ASC 版本号由 `1.0` 改为 **`1.0.0`**，与构建一致
> （`GET /v1/appStoreVersions/7e8012d1-…` 实测 `versionString = 1.0.0`）。
> 若以后再改 MARKETING_VERSION 而忘了同步 ASC 版本号，Apple 会拒绝提审。
>
> 📌 **文案字段的资源归属**（2026-11-28 实测 + Apple 文档核对）：
> `description`/`keywords`/`promotionalText`/`supportUrl`/`marketingUrl`/`whatsNew`
> 在 **`appStoreVersionLocalizations`**；
> `name`/`subtitle`/`privacyPolicyUrl`/`privacyPolicyText`/`privacyChoicesUrl`
> 在 **`appInfoLocalizations`**。
> `appInfos` 与 `apps` 上**都没有** `supportUrl`/`marketingUrl`——
> 用 `fields[appInfos]=supportUrl` 会被 Apple 拒为 `'supportUrl' is not a valid field name`。
>
> ⚠️ **截图必须通过 ASC 网页端或 Transporter 上传**，
> `POST /v1/appScreenshots` 需要先建 `appScreenshotSets`，
> 且要按机型分尺寸（6.9"/6.7"/6.5"/5.5" iPhone、iPad 等），
> 每种至少 1 张。纯 API 上传比较繁琐，**建议网页端拖拽**。

---

## 三点七、混合版「探记 HG」数据能否导入纯原生版「探记」

**结论：可以，实测通过。** 但 2026-11-28 实测中发现并修掉了一个真实的兼容性 bug。

### 3.7.1 两边的备份格式

混合版（Capacitor，bundle `ord.tanji`）的 `backupDocument()`
（`src/app/storage.js`）产出：

```json
{"app":"探记 TanJi","version":"0.6","exportedAt":"...","threshold":15,
 "notifyEnabled":true,"accounts":[...],"providers":[...],
 "orders":[...],"payments":[...]}
```

原生版 `BackupValidator.swift` 的注释写明「逐条对应 Web 版 `validateState`」，
版本白名单 `0.2~0.6` 一致 → 混合版导出的 `version:"0.6"` 备份**在白名单内**。

字段名也是同一套 camelCase（`store`/`cat`/`price`/`deposit`/`appt`/`settleVia`/
`deliverMain`/`deliverSub`/`reviewResult`/`accountId`/`remindLog`/`expectPayAt`/
`gpsPlace`…），流水 `oid`/`kind`/`amount`/`at`/`method` 也一致。

### 3.7.2 ⚠️ 实测发现并修掉的 bug：空头像导致整份拒收

混合版 `storage.js:102` 对账号头像的校验是：

```js
if (typeof account.avatar !== 'string'
    || (account.avatar !== '' && !TanJiImage.isValidStored(account.avatar)))
  throw new Error(`${label}的头像数据无效`);
```

注意 `account.avatar !== ''` —— **混合版显式放行空串头像**。
这是因为混合版存账号时用的是 `a.avatar||null`，
而账号默认没头像 → 导出 JSON 里 `avatar` 就是 `""`。

原生版原本写成：

```swift
guard let avatarText = raw as? String,
      ImageStore.isValidStored(avatarText),      // ← 空串不是合法 dataURL，直接 false
      avatarText.count <= ImageStore.avatarLimit
else { throw BackupError.invalid("\(label)的头像数据无效") }
```

→ **只要账号没设过头像，混合版备份就会被原生版整份拒收**，
报「第 1 个账号的头像数据无效」，用户看到的是「不能导入」。

**已修复**（`BackupValidator.swift`）：空串按混合版口径放行，落库为 `nil`；
非空串仍走 `isValidStored` + 体积上限。

### 3.7.3 到店定位（`gpsPlace`）的格式坑

混合版 `www/geo.js` 有两种格式：

| 用途 | 格式 | 例 |
|---|---|---|
| **存储**（`format()`，落库与导出都用它） | `lat,lng`，英文逗号，**无空格**，6 位小数 | `22.543096,114.057865` |
| 展示（`label()`，只用于显示） | `lat, lng`，逗号后**有空格** | `22.543096, 114.057865` |

原生版 `GeoStore.parse` 与混合版 `parse` **口径一致**（都要无空格），
所以带空格的串两边都会被丢弃、不报错。
> 📌 导出的是**存储格式**，所以正常导出的备份不会带空格，
> 手动改过文件才可能踩到。

### 3.7.4 回归测试（已加进仓库）

`ios/TanjiNative/Tests/BackupValidationTests.swift` 新增两个用例：

- `testImportsHybridAppBackup`：用混合版 `backupDocument()` 的**完整真实结构**
  （填满 accounts/providers/orders/payments，含 `remindLog`、`gpsPlace`、
  `expectPayAt`、`reviewResult`、`accountId` 等所有字段）走原生版解析，
  逐字段断言解析结果。
- `testImportsHybridBackupWithBOM`：混合版 `download()` 给文本导出加了
  `\ufeff`（UTF-8 BOM），原生版必须能剥掉再解析。

2026-11-28 实跑：`Executed 27 tests, with 0 failures` → `** TEST SUCCEEDED **`。

### 3.7.5 实际迁移操作步骤

1. 在**旧版「探记 HG」**里：设置 → 数据与备份 → **导出 JSON 备份**
   （文件形如 `探记-工作备份-2026-11-28T….json`，注意是 **JSON**，不是 CSV/`.db`）
2. 把这个 JSON 传到新设备（AirDrop / 微信文件传输助手 / iCloud Drive 都行）
3. 在**新版「探记」**里：设置 → 数据与备份 → **导入** → 选那个 JSON 文件
4. 导入前会自动留**恢复点**，导入后会提示订单数 / 流水数

> ⚠️ **不要导 `.db`**：混合版 `.db` 是 SQLite 原始库，
> 内部表结构（`orders` 表带 `mode` 列、`settings` 主键是 `(scope,key)`）
> 与纯原生版不同，跨版本对拷会出问题。**必须走 JSON 备份**。
>
> ⚠️ **CSV 只能看不能导回**：CSV 是给人看的报表，没有订单 ID 关联，
> 导入功能不接受。
>
> 📌 导入是**整体替换**语义：新版的现有数据会被备份内容覆盖
> （覆盖前的数据留在恢复点里，可以退回）。
> 新版是空数据时导入最安全。

---

## 四、真机验收清单（提审前必须走完）

原生版目前**未做真机业务验收**，以下每项都要在真机上确认：

- [ ] 首次启动无崩溃，底部导航 5 个 Tab 可切换
- [ ] 新建订单 → 登记定金/尾款 → 本月成交额、待收款、逾期金额口径正确
- [ ] 行程页月历、未来 7 天、单日订单显示正确
- [ ] 通知授权 → 每日催收提醒按排程弹出
- [ ] Face ID 解锁隐藏金额；取消授权时有降级路径
- [ ] 导出 JSON / CSV / .db 到「文件」App 的「探记」文件夹
- [ ] 导入 JSON：导入前有恢复点提示，导入后订单数/流水数一致
- [ ] 切后台 15 分钟再返回、强制关闭重开后数据仍在
- [ ] 相册选头像（`设置 → 我的账号`）、Face ID 解锁隐藏金额

> 📌 **原清单里的「相机拍门口照、定位记录与地图跳转」已删除** ——
> 2026-11-28 实测：纯原生版**没有**相机与定位实现（见 §4.2）。
> 原生版只保留「相册选头像」与「Face ID 隐藏金额」。

### 4.2 Info.plist 声明了未使用的权限 —— ✅ 已处理（2026-11-28）

2026-11-28 逐权限核对 `ios/TanjiNative/Resources/Info.plist` 与实际代码：

| 权限声明 | 代码是否使用 | 处理 |
|---|---|---|
| `NSFaceIDUsageDescription` | ✅ `AmountPrivacy.swift` 用 `LAContext.evaluatePolicy` | 保留 |
| `NSPhotoLibraryUsageDescription` | ✅ `AccountFormView.swift` 用 `PhotosPicker` | 保留 |
| `NSCameraUsageDescription` | ❌ `AVCaptureSession` / `UIImagePickerController` **零命中** | **已删除** |
| `NSLocationWhenInUseUsageDescription` | ❌ `CLLocationManager` / `MapKit` **零命中** | **已删除** |

**为什么必须处理**：Apple 审核会核对「声明了权限但从不用」的 App。
多余的 `NSCameraUsageDescription`（文案还在讲"拍一张店铺门口照片"）会让审核员
以为 App 有拍照功能却找不到入口，可能被拒或被追问。

**已执行的改动**（只改 `ios/TanjiNative/project.yml` 正本，
xcodegen 重新生成后 `Info.plist` 与产物同步生效）：

- 删除 `NSCameraUsageDescription`
- 删除 `NSLocationWhenInUseUsageDescription`
- 在 `project.yml` 里留注释说明原因与将来的加回条件
- **代码零改动**——已核实全仓库无任何相机/定位 API 调用

验证：Release 归档 `ARCHIVE SUCCEEDED`，产物 `Info.plist` 只剩
`NSFaceIDUsageDescription` 与 `NSPhotoLibraryUsageDescription` 两条；191 项回归全绿。

> 若将来补齐「打卡记录当前地址」功能（见 §4.3），需同步加回定位权限声明。

### 4.3 功能缺口：纯原生版**没有**「打卡记录当前地址」

2026-11-28 对比核实（用户提问触发）：

**结论：原生版没有这个功能，是移植时的遗漏，不是设计决策。**

| 版本 | 打卡时记录 GPS | 证据 |
|---|---|---|
| 混合版 `tanji-native-hg` | ✅ **有** | `src/app/order-actions.js:150` `capturePlace(oid)` → `TanJiGeo.locate()` → 写 `order.gpsPlace`；调用点 `actions.js:93`、`:299`、`order-forms.js:235` |
| 原生版 `tanji-native-ios` | ❌ **没有** | 打卡逻辑 `HomeView.swift:475` `punch()` → 只调 `model.advance(order, field: .shot)` 写 `shotAt` 时间戳，**无任何坐标采集** |

**原生版里 `gpsPlace` 的实际状态**（字段在，但写不进去）：

- ✅ 有完整的数据链路：SQLite `gps_place` 列（`DataStore.swift:140`）、
  模型字段（`Models.swift:46`）、读写（`DataStore.swift:332`/`:371`）、
  备份导入（`BackupValidator.swift:419`）、导出（`BackupService.swift:84`）、
  详情页展示（`OrderDetailView.swift:724`「到店定位」行）
- ❌ **没有任何运行时写入点**：全仓库 `gpsPlace =` 的赋值只有 3 处，
  全是「从数据库读出」或「从导入的备份恢复」，**没有一个是采集坐标**
- ❌ 详情页的「到店定位」永远显示 `—`（除非手工导入过带坐标的旧备份）

**处理决策（2026-11-28 用户定）**：用户确认 H5/混合版确有此功能，
但明确「如果带来额外麻烦，隐藏入口暂不提供也可以」。

→ **采用「隐藏入口暂不提供」方案**：

1. ✅ 已删除定位与相机权限声明（见 §4.2）——与实际实现完全一致，消除审核风险；
2. ✅ **保留** `gps_place` 字段与详情页「到店定位」展示行不动——
   它们不是采集入口，而是**旧备份的数据回显**：
   用户导入混合版导出的带坐标备份后，仍能看到当时的位置；
3. ✅ **不新增**任何定位采集入口，`CLLocationManager` 依赖为零；
4. 📌 将来若要补齐该功能，再加回权限声明 + 实现采集（见下方 A 方案）。

> **未选「保留声明但不实现」**——那正是此前的状态，是审核风险点，已消除。
>
> **将来补齐时的做法**（约 1 个 service + 3 处调用点）：
> 新增 `GeoService` 用 `CLLocationManager` 做一次性定位
> （`requestWhenInUseAuthorization` + `requestLocation`），
> 在打卡动作（`HomeView.punch` 与 `OrderDetailView` 的「到店了，标记已拍摄」）后调用，
> **失败静默**（与混合版一致：位置是附加信息，不能影响「这单拍过了」），
> 并在详情页补「手动重新定位」入口（混合版有）。

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

## 六、架构议题：要不要加 iCloud 同步？（2026-11-28 讨论结论：v1 不做）

用户提出：「本地版是否使用 iCloud 更好？用户信息保存在 iCloud 中更安全。」

### 6.1 关键事实：数据**已经在** iCloud 里了

实测本工程代码（`ios/TanjiNative/Sources/Store/DataStore.swift`）：

| 数据 | 位置 | iCloud 现状 |
|---|---|---|
| 实时 SQLite（`tanji.sqlite`） | `Application Support/探记HG/` | ✅ **已被 iCloud 设备备份覆盖**（未设置 `NSURLIsExcludedFromBackupKey`，Application Support 默认参与备份） |
| 导出 JSON / CSV / .db | `Documents/探记HG/` | ✅ **已被 iCloud Drive 覆盖**（`UIFileSharingEnabled = true`，同一文件夹在「文件」App 里） |

> ⚠️ 这是「iCloud **备份**」，不是「iCloud **同步**」：
> 换设备时 iCloud 备份能恢复，但**不会**让 iPhone 和 iPad 同时在线编辑同一份数据。
> 对「手机丢了 / 误删 App」这个真实风险，现状**已经有保护**。

### 6.2 为什么 v1 不引入 CloudKit

| 理由 | 说明 |
|---|---|
| **会打破「数据不出设备」的口径** | 现有提审备注与隐私政策都写明「数据不上传任何服务器」。引入 CloudKit 后必须改口径、修改隐私政策、重新填 App Privacy，**当前所有文案都要返工** |
| **审核风险上升** | 启用 iCloud 需要在工程加 entitlement、开发者后台建容器、ASC 里配 iCloud 容器。配置不全会直接被拒 |
| **改动量远大于收益** | CloudKit 同步要处理冲突合并、离线队列、账号切换、schema 迁移——这是一条完整的产品线，不是加个开关 |
| **零服务端是当前卖点** | 「买断 + 纯本地 + 无账号」是差异化优势，引入云同步会稀释它 |

### 6.3 如果要做，建议的顺序

1. **v1（现在）**：靠 iCloud 设备备份 + iCloud Drive 导出目录兜底，**零代码改动**。
   唯一要做的是在 App 内把这条讲清楚：
   「数据保存在本机，并随 iCloud 备份保护；换设备请用「导出 / 导入」迁移。」
2. **v2（用户反馈确实需要时）**：引入 **CloudKit 私有数据库**（不是自建服务器），
   理由是开发者**无法访问**用户私有库，符合「我们拿不到你的数据」的承诺。
3. **不建议**：自建服务器同步。那会让「数据不上传服务器」彻底失效，
   还要过国内备案，与当前「零服务端」定位冲突。

### 6.4 v1 可以立刻补的低成本改进

- [ ] 在「设置 → 关于与支持」里加一句 iCloud 备份说明，消除用户「数据会不会丢」的疑虑
- [ ] 引导用户开启「设置 → Apple 账户 → iCloud → iCloud Drive」的「探记」文件夹
- [ ] 首次启动时检测 iCloud Drive 是否开启，未开启则提示（可选）

---

## 七、参考来源

- 上传构建版本（altool / Transporter / ASC API）：<https://developer.apple.com/cn/help/app-store-connect/reference/upload-tools>
- TestFlight 总览：<https://developer.apple.com/testflight>
- 隐私清单文件：<https://developer.apple.com/documentation/bundleresources/privacy_manifest_files>
- Required Reason API 与原因码：<https://developer.apple.com/documentation/bundleresources/privacy_manifest_files/describing_use_of_required_reason_api>
- App Review Guidelines：<https://developer.apple.com/app-store/review/guidelines/>
