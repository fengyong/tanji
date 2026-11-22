# App Store 上架清单(买断付费 · 纯本地版)

> 对应策略:主分支 `main` 继续做本地 HTML(PWA)版本,`native-app` 分支做 iOS 原生 App,
> 在 App Store 上**买断付费**上架;线下推广由达人本人完成;靠 App Store 做版本更新。
>
> 本清单基于 2026 年 11 月的官方规则与插件源码核对整理,上架前请以 App Store Connect
> 当日要求为准。

## 一、先把模型定死:买断付费 ⇒ App 内零购买代码

"付费使用"有两种实现,成本差一个量级。**本项目走 A。**

| | A. 付费下载(买断)✅ | B. 免费 App + 内购解锁 ❌ |
|---|---|---|
| App 内代码 | **0 行** | StoreKit 2 + IAP 插件 + 购买页 + 恢复购买 |
| 服务端 | **不需要** | **需要**(Apple 要求服务端验签) |
| 插件 | 无 | `@capawesome-team/capacitor-purchases` 或 `capacitor-plugin-cdv-purchase` |
| 权益管理 | 不需要(买了就能用) | 需存 purchase 状态、处理退款/续订/恢复 |
| 审核 | 简单 | 需核验 IAP 商品配置、Product ID、收据 |
| 适合 | 小圈子、线下信任销售、一次性付费 | 订阅、持续服务、数字内容 |

**A 方案下,App Store 的付费墙本身就是付费墙** —— 用户不付钱连装都装不上,
App 内不需要任何购买逻辑。这意味着:**服务器、云开发、备案、账号体系、支付后端,
在这个方案里全部不存在。**

前提是 App 属于"工具类"而非"数字内容服务"。探记处理的是用户自己的订单和流水,
不提供数字内容消费,因此不强制走 IAP。

### 定价参考
- Apple 抽成 30%;年营收 ≤ 100 万美元可申请 **小企业计划,抽成降至 15%**
- 买断定价由开发者自行设定,App Store Connect 里按地区换算
- 建议定价区间:**¥38–68**(探店达人群体,冲动型小额工具)

## 二、真正的三个工作量(不是服务器,不是支付)

### 1. 分支同步机制 ⚠️ 最高优先级

`native-app/www/` 与 `main` 根目录的 web 资源同源,但**已不再逐字节一致**:
纯资产(sw.js / manifest / privacy.html / support.html / icons / vendor)保持同步,
index.html 与 storage.js 上叠了原生适配层,且 native 侧还有 v0.5(v0.6 多账号)的专属功能改动,
两侧内容指纹由锁文件分别登记,**不再要求相同**——这是有意的,不是漏同步。

同步方向是 **main → native**(main 是唯一真源)。需要:

- [x] 加 `npm run sync:web`(2026-11-22,`scripts/sync-web-assets.cjs`):纯资产(sw.js/manifest/privacy.html/support.html/icons/vendor)从 main 自动拷贝;
      index.html/storage.js 因织入原生适配层**不做盲拷**——main 侧有新改动时列出 diff 摘要并中止,人工合并后再跑一次。
      基线锁 `scripts/web-sync.lock.json` 已建立(当前 main @ `93cfa31`,native 侧指纹在 v0.5/v0.6 后已重登记)。
      注意:`sync:web` 成功后脚本会**自动**刷新锁基线,漂移登记仍是 `npm run check:update`。
- [x] 加 CI 校验(2026-11-22,`.github/workflows/ci.yml`):push 到 `native-app` 或 PR 目标为 `native-app` 时,
      跑 `npm run check` 同款漂移校验 + 原生回归 + 隐私清单合规;`main` 分支跑单元回归 + 浏览器端到端冒烟
- [ ] `sw.js` 的 `VERSION` 在发布前必须 bump(否则老用户拿不到新版本)

不做这件事,native 的 `www/` 会慢慢和 Web 版分叉,最终 App Store 版本出现"只有原生版有的 bug"。

### 2. App Store 合规(2026 年比想象的严)

| 项 | 要求 | 备注 |
|---|---|---|
| **隐私清单** `PrivacyInfo.xcprivacy` | **强制**,2024-05-01 起每次提交都查 | ✅ 已建(2026-11-22),见下方 Required Reason |
| **Required Reason API 声明** | 必须声明用到哪些受限 API 及原因码 | ✅ 已逐个核查第三方 SDK,实测只需 1 项:`FileTimestamp` / `C617.1`(详见下方) |
| **隐私政策 URL** | 必填,必须可访问 | ✅ 页面已建(`privacy.html`),⏳ **待部署站点**使线上可访问 |
| **支持页 URL** | 必填 | ✅ 同上(`support.html`),⏳ 待部署 |
| **App Privacy 营养标签** | 必填,且**必须与 `PrivacyInfo.xcprivacy` 一致** | 不一致会被自动化扫描直接拒。纯本地 → 「不收集数据」 |
| **账号删除** | 仅当 App 支持账号创建(注册/登录)时需要 | **无登录体系 → 不需要** ✅。注意 App 内 v0.6 的「我的账号」是达人自己的抖音号资料(纯本地记录、不注册不上传),不是 App 账号;提审备注里要写清这一点,避免被当成账号体系追问 |
| **Paid Apps Agreement** | 付费 App 必须签 | App Store Connect → Agreements |
| **银行与税务信息** | 付费 App 必须填完整 | 不填会阻塞销售 |
| **图标** | 1024×1024 PNG,**不允许 alpha 通道**,不预切圆角 | |
| **截图** | 必须提供 6.9 英寸 iPhone | 6.5 英寸可选 |
| **Bundle ID** | 必须与 App Store Connect 注册的完全一致 | 当前是 `com.tanji.app` |
| **签名** | `CODE_SIGN_STYLE = Automatic`,需在 Xcode 选 Team | 上架需付费账号证书 |

自查工具:构建后 `Product → Privacy Report`,会列出每个 SDK 是否带隐私清单。

> ⚠️ Required Reason API **已实测核查**(2026-11-22,逐个扫第三方二进制与源码):
> `@capacitor/filesystem` 的依赖 `ion-ios-filesystem` 用 `attributesOfItem` / `creationDate` /
> `modificationDate` 读文件属性 → 命中 **FileTimestamp**,所读文件全在 App 自身沙盒内 →
> 原因码 **C617.1**。
> **UserDefaults / DiskSpace / SystemBootTime / ActiveKeyboards 均未命中**:
> `Capacitor.xcframework` 自带的 `PrivacyInfo.xcprivacy` 里 `NSPrivacyAccessedAPITypes` 是空数组,
> 4 个插件的 Swift 源码里也搜不到这些调用。所以清单里**只声明 FileTimestamp 一项**,
> 多声明反而是噪音。

### 3. 发布流程

- [ ] App Store Connect 建 App 记录(仅 iOS,或 iOS + iPadOS)
- [ ] Bundle ID `com.tanji.app` 在开发者后台注册
- [ ] 填隐私政策、支持页、营养标签、定价、年龄分级
- [ ] `xcodebuild archive` → 上传 → 等待审核(通常 1–3 天)
- [ ] 提审备注里写清:纯本地、数据不出设备、无账号、无数字内容消费
      (可显著降低被质疑的概率)

## 三、如果以后加 AI 功能,会打破"零服务端"

唯一会让服务端重新变成必需品的是 AI(智谱 OCR / 自然语言建单),因为:

1. **模型 API Key 不能进 App 包**(必然被逆向提取 → 刷爆你的额度)
2. **2026 年 Apple 更新了 Guideline 5.1.2(i)**:App 把个人数据发给第三方 AI 服务时,
   **必须显示应用内披露说明发了什么数据、发给谁,并取得用户明确同意**。
   **隐私政策链接不满足此要求** —— 需要在 App 内加 AI 授权弹窗。
   (端侧推理不受此限,因为数据不出设备)

好消息:OCR 处理用户自己拍的对账单属于"工具处理用户自有内容",
不算数字内容服务,依然不强制走 IAP。

代价:需要一台轻量服务器(2核2G,3年 ¥396 折合 ¥11/月)或 CloudBase。
但因为 App Store 版是 Web 浏览器直连,**如果要自定义域名,备案躲不掉**。

**建议:AI 作为 v2 再做,v1 先用买断付费把纯本地版跑通。**

## 四、两条渠道并存是合理的

| | PWA(main) | App Store(native-app) |
|---|---|---|
| 价格 | 免费 | 买断 ¥38–68 |
| 分发 | 链接 / 二维码 | App Store 链接 / 短链 |
| 更新 | 手动 bump `sw.js` VERSION | **推送更新,点一下即可** |
| 安装门槛 | 要教"分享→添加到主屏幕" | "装个 App",大众心智 |
| 适用 | 试用、观望用户 | 付费用户 |

> ✅ 免费 PWA + 付费 App 两个渠道并存,完全合规。
> ❌ 但不要在 App Store 免费上架、靠线下卖"解锁码"变现 —— Apple 明确禁止
>    外部支付引导(bait and switch),会直接拒审。买断付费下载恰好完全绕开这个雷区。

### 4.1 两条渠道的衔接已经接上(2026-11-22)

策略定死为:**PWA 免费体验 → 付费 iOS App**;付费版后续按使用者意见迭代功能。
两端的「统计 → 关于」里都有同一个转化入口:

```js
// index.html(两个分支同一份代码)
const APP_STORE_URL='';   // 上架后填 https://apps.apple.com/app/id<数字>
```

- `APP_STORE_URL` 为空 → 显示为「iOS 原生版 · 买断 / 即将上架」,点一下只弹提示,
  **不留死链**(免费端在 App 上架前不能出现点不动的入口);
- 填上 App ID → 自动变成可点的 App Store 链接(`target=_blank`,原生端由
  Capacitor 转交系统浏览器)。

免费 PWA 端承担宣传与试用,付费端承担变现与功能迭代 —— 两端都不需要内购代码。

### 4.2 付费版的反馈闭环

- 入口:App 内「统计 → 关于 → 支持与常见问题」里有联系邮箱(线上 privacy/support 页同一入口);
- 收集:付费用户的功能建议与 bug 反馈走邮箱 → 汇总进研发笔记;
- 迭代:新功能随下一个版本发到 App Store,**用户点一下即可收到推送更新**
  (这正是原生版相对 PWA 的核心优势,PWA 要手动 bump `sw.js` VERSION 才有新版本);
- 合规提醒:App 内不得出现"到官网付费解锁"等外部支付引导 —— 探记是**买断下载**,
  App Store 已是唯一购买渠道,不涉及外部支付,天然不触碰 Guideline 3.1.1 / 3.1.3。

## 五、执行顺序建议

1. ~~**原生版编译闭环**~~ ✅ 2026-11-22 完成:Xcode 27.2 编译 BUILD SUCCEEDED,`App.app` 已装进 iPhone 17 / iOS 27.2 模拟器跑起来,
   SQLite 落盘 / 双副本镜像 / 通知授权弹窗 / 重启持久化逐项验证通过
2. ~~**同步脚本 + CI 校验**~~ ✅ 2026-11-22 完成:`npm run sync:web` / `npm run check` + `.github/workflows/ci.yml`
3. ~~**隐私清单 + 隐私政策页 + 支持页**~~ ✅ 2026-11-22 全部就位
   （⏳ 剩余:替换联系邮箱占位符 + 部署站点让线上 URL 可访问）
4. **开发者账号**($99/年)→ 选主体 → 签 Paid Apps Agreement → 填银行与税务
5. **真机验收**:选 Team 签名 → 跑一遍下单/收款/导出/通知 → 截 App Store 截图
6. **买断付费上架**,PWA 保持免费
7. AI 功能 → v2(需要时再加服务端 + AI 授权弹窗)

## 五·一、开发者账号到底多少钱(2026-11-22 核实)

**不是 199 美元。** Apple 官方只有三个开发者计划:

| 计划 | 价格 | 能做什么 |
|---|---|---|
| **Apple Developer Program** | **$99/年**(中国大陆 ¥688) | 个人(Individual)与公司(Organization)**同价**;可上架 App Store、用 TestFlight 外部测试、推送 |
| Enterprise Program | $299/年 | 仅限 100+ 员工企业**内部分发**,**不能上 App Store** |
| 免费 Apple ID | $0 | 只能本机真机调试(证书 7 天过期、10 个 AppID、3 台设备),**不能上架、不能 TestFlight 外部测试** |

$199 **不是 Apple 的任何官方档位**,大概率是第三方"代申请已认证账号"服务的报价
(这类服务 Personal 约 $350 / Company 约 $850),或把 $299 记成了 $199。
自己注册只要 $99/年,不需要中间商。

付费买断的 App 上架前,这三件事必须做完:
- [ ] 签 **Paid Apps Agreement**(App Store Connect → Agreements → 同意)
- [ ] 填完整的**银行与税务信息**(不填会阻塞销售,个体户需要提供营业执照等主体材料)
- [ ] 主体类型:个人(Individual)可上架,但**显示的是个人法定姓名**,且中国区个人主体需身份证认证;
      个体工商户可考虑 Organization 主体(需营业执照 + 对公验证)

## 六、参考来源

- Apple Developer Program 注册与价格:<https://developer.apple.com/cn/programs/enroll/>
- App Review Guidelines:<https://developer.apple.com/app-store/review/guidelines/>
- 隐私清单文件:<https://developer.apple.com/documentation/bundleresources/privacy_manifest_files>
- Required Reason API 与原因码:<https://developer.apple.com/documentation/bundleresources/privacy_manifest_files/describing_use_of_required_reason_api>
- 账号删除要求(5.1.1(v)):<https://developer.apple.com/support/offering-account-deletion-in-your-app/>
- Capacitor IAP 插件(仅 B 方案需要):<https://github.com/capawesome-team/capacitor-plugins>
