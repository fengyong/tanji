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

当前 `native-app/www/` 是 `main` 根目录 web 资源的**手工拷贝**。两边目前逐字节一致,
但那是手工同步的结果,不是机制保证。

同步方向是 **main → native**(main 是唯一真源)。需要:

- [ ] 加 `npm run sync:web`:从上游 main 拷贝 `index.html / storage.js / sw.js /
      manifest.webmanifest / icons/ / vendor/` 到 `www/`
- [ ] 加 CI 校验:`git diff --exit-code -- www/` 不一致则失败
- [ ] `sw.js` 的 `VERSION` 在发布前必须 bump(否则老用户拿不到新版本)

不做这件事,native 的 `www/` 会慢慢和 Web 版分叉,最终 App Store 版本出现"只有原生版有的 bug"。

### 2. App Store 合规(2026 年比想象的严)

| 项 | 要求 | 备注 |
|---|---|---|
| **隐私清单** `PrivacyInfo.xcprivacy` | **强制**,2024-05-01 起每次提交都查 | 见下方 Required Reason |
| **Required Reason API 声明** | 必须声明用到哪些受限 API 及原因码 | 本项目大概率命中 `UserDefaults` / 文件时间戳 / 磁盘空间 |
| **隐私政策 URL** | 必填,必须可访问 | 可挂在 `tanji-app-guvc.zai.site` 下 |
| **支持页 URL** | 必填 | 同上 |
| **App Privacy 营养标签** | 必填,且**必须与 `PrivacyInfo.xcprivacy` 一致** | 不一致会被自动化扫描直接拒 |
| **账号删除** | 仅当 App 支持账号创建时需要 | 纯本地版**无账号 → 不需要** ✅ |
| **Paid Apps Agreement** | 付费 App 必须签 | App Store Connect → Agreements |
| **银行与税务信息** | 付费 App 必须填完整 | 不填会阻塞销售 |
| **图标** | 1024×1024 PNG,**不允许 alpha 通道**,不预切圆角 | |
| **截图** | 必须提供 6.9 英寸 iPhone | 6.5 英寸可选 |
| **Bundle ID** | 必须与 App Store Connect 注册的完全一致 | 当前是 `com.tanji.app` |
| **签名** | `CODE_SIGN_STYLE = Automatic`,需在 Xcode 选 Team | 上架需付费账号证书 |

自查工具:构建后 `Product → Privacy Report`,会列出每个 SDK 是否带隐私清单。

> ⚠️ 本项目的 4 个 Capacitor 插件里,`@capacitor-community/sqlite` 依赖 **SQLCipher.swift**,
> `@capacitor/filesystem` 会用到 UserDefaults 与文件时间戳 —— 这些都会触发
> Required Reason API 声明要求。

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

## 五、执行顺序建议

1. **原生版编译闭环**(当前进行中)→ 真机跑通 → 模拟器验收第七节清单
2. **同步脚本 + CI 校验**(防 `www/` 腐化)—— 必须在第一次真源变更前做
3. **隐私清单 + 隐私政策页 + 支持页** —— 上架硬门槛
4. **买断付费上架**,PWA 保持免费
5. AI 功能 → v2(需要时再加服务端 + AI 授权弹窗)

## 六、参考来源

- Apple Developer Program 注册:<https://developer.apple.com/cn/programs/enroll/>
- App Review Guidelines:<https://developer.apple.com/app-store/review/guidelines/>
- 隐私清单文件:<https://developer.apple.com/documentation/bundleresources/privacy_manifest_files>
- 账号删除要求(5.1.1(v)):<https://developer.apple.com/support/offering-account-deletion-in-your-app/>
- Capacitor IAP 插件(仅 B 方案需要):<https://github.com/capawesome-team/capacitor-plugins>
