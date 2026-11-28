# 探记 · 纯原生 iOS · 开发契约

> 面向所有参与这个工程的实现者（人和 AI）。
> 目标是：**用 SwiftUI 重写混合版（Capacitor + WebView）的全部界面与逻辑**，界面与文案保持一致，并重做导出/导入。

## 0. 基本约束

- 只用系统框架：SwiftUI / UIKit / SQLite3 / Charts / LocalAuthentication / UserNotifications / PhotosUI / CoreLocation。**不引入任何第三方依赖**。
- **最低支持设备：iPhone 15 Pro**（首发系统 iOS 17.0）→ deployment target 锁定 **iOS 17.0**。
  - **不为更低版本做兼容**：不要写 `@available` / `#available` 分支去兼容 iOS 17 以下，
    也不需要为 iPhone 14 及更早机型做适配。iOS 17+ 的 API（`onChange(of:initial:)` 双参版、
    `scrollClipDisabled`、Swift Charts 的 `plotFrame`）可以直接用。
  - 若将来要下调 target，**先量编译错误再动手**：`SWIFT_COMPILATION_MODE=wholemodule` 才会报全
    全部可用性错误（默认分批编译首批失败即中断，会漏报，实测 iOS 16 从「1 处」变成「7 处」，
    iOS 15 从「34 处」变成「108 处」）。
- Swift 5 语言模式；主线程约束用 `@MainActor`。
- 全程简体中文文案，与 Web 版逐句对齐（Web 版原文在 `src/app/` 与 `www/`）。
- 共享文件（`Sources/Model`、`Sources/Logic`、`Sources/Store`、`Sources/Design`、`Sources/Services`、`Sources/App`）除非任务明确要求，**不要改动**；需要新能力时先在回复里说明。
- 视觉走 `Theme` 里的暖纸色系；组件优先复用 `Sources/Design/Components.swift`。
- 构建命令（macOS 27 上 Swift 宏插件的 `sandbox-exec` 不可用，必须带这个开关）：

```bash
cd /Users/ola/drax-toolbox/tanji-native-ios/ios/TanjiNative
xcodegen generate --spec project.yml
xcodebuild -project TanjiNative.xcodeproj -scheme TanjiNative \
  -sdk iphonesimulator -configuration Debug \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO \
  OTHER_SWIFT_FLAGS='$(inherited) -Xfrontend -disable-sandbox' build
```

## 1. 数据模型（`Sources/Model/Models.swift`）

```swift
enum DataSpace { case work, demo }          // 两套数据空间

struct RemindEntry: Codable, Identifiable { var at: String; var note: String }

struct Order: Codable, Identifiable {
    var id: Int
    var store: String          // 品名 / 商家
    var cat: String            // 店铺类型
    var contact: String
    var price: Double
    var deposit: Double
    var appt: String           // 'YYYY-MM-DDTHH:mm' 预约时间
    var shotAt: String?        // 实际拍摄
    var submittedAt: String?   // 提审
    var shortAt: String?       // 副片发出
    var longAt: String?        // 正片发出
    var depositPaidAt: String?
    var finalPaidAt: String?
    var settleVia: String      // "private" 私收 / "douyin" 抖音商单
    var remindAt: String?      // 催收备忘：下次提醒时间
    var channel: String        // 服务商
    var partner: String        // 组队 / 出镜搭档
    var location: String       // 地点
    var gpsPlace: String?      // 到店定位 "lat,lng"
    var deliverMain: Bool      // 需要正片
    var deliverSub: Bool       // 需要副片
    var reviewResult: String   // "" 待审 / "pass" 合格 / "fail" 不合格
    var publishedAt: String?
    var accountId: Int?
    var note: String
    var remindLog: [RemindEntry]?
    var photoThumb: String?    // 随手拍缩略 dataURL
    var expectPayAt: String?   // 平台单预计到账
}

struct Payment: Codable, Identifiable {
    var oid: Int; var kind: String   // "定金" / "尾款"
    var amount: Double; var at: String
    var method: String                // 微信/支付宝/银行卡/抖音商单/其他
    var note: String?
}

struct Account: Codable, Identifiable {
    var id: Int; var name: String; var phone: String; var douyin: String
    var color: Int          // 标识色 0-7
    var avatar: String?     // 头像 dataURL
    var createdAt: String?
}

struct AppData {
    var orders: [Order]; var payments: [Payment]
    var threshold: Int = 15          // 催收阈值
    var notifyEnabled: Bool = true
    var accounts: [Account]
    var providers: [String]
}
```

`Order` / `Payment` / `Account` 的字段名与混合版 JSON 备份**完全一致**，旧备份可原样导入。

## 2. 业务规则（`Sources/Logic/Logic.swift`）

纯函数，逐条对应 Web 版 `www/logic.js`：

```swift
Logic.workOf(order) -> "待拍摄"/"后期中"/"发片中"/"已交付"
Logic.deliveredAll(order) -> Bool
Logic.deliverLate(order, now) -> Bool
Logic.payOf(order, payments:) -> "待定金"/"待尾款"/"平台结算"/"已结清"
Logic.unDep(order, payments:) / Logic.unFin(...) / Logic.owedOf(...)
Logic.overdueDays(order, payments:, today:) -> Int
Logic.isOver(order, payments:, threshold:, today:) -> Bool
Logic.snoozed(order, nowString:) -> Bool
Logic.expectOverdue(order, payments:, today:) -> Int
Logic.remindCount(order) / Logic.lastRemind(order)
Logic.apptOverlap(orders, date, time, excludeId) -> Overlap{same, overlap}
Logic.statsFor(orders:payments:period:list:now:) -> Stats{start,deals,paid,done,dealSum,paidSum}
Logic.upcomingByDay(orders, fromISO:, days:) -> [DaySummary{day,count,sum}]
Logic.dayBadge(count:sum:) -> Badge?   // ⭐忙碌日 🔥爆单 💰千元日 💎王牌日
Logic.moneyCents / Logic.orderMoney / Logic.paymentSpec
```

## 3. 格式化（`Sources/Logic/Format.swift`）

```swift
Format.today() -> "YYYY-MM-DD"
Format.nowString() / Logic.nowString() -> "YYYY-MM-DDTHH:mm"
Format.dayString(date) / Format.localString(date)
Format.parseLocal(_:) -> Date?      // 严格校验，回读确认
Format.parseDay(_:) -> Date?
Format.fmtD / fmtHM / fmtDT         // "M-DD" / "HH:mm" / "M-DD HH:mm"
Format.fmtMoney(value, masked:)     // "¥1,234.5" 或 "¥✱✱✱"
Format.moneyText(value)             // 不带符号
Format.compactMoney(value)          // "1.28万"
Format.dowOf(dayString) -> "一"…"日"
Format.relativeDayLabel(day, baseDay:) -> "2026-11-28 周五 · 今天"
Format.dayOffset(days) / Format.localOffset(days, hourMinute:)
Format.round2(value)
```

## 4. 状态中枢（`Sources/App/AppModel.swift`）

`@EnvironmentObject var model: AppModel`

```swift
model.data            // 当前数据空间的 AppData（只读）
model.mode            // DataSpace
model.ready / model.busy
model.status          // 存储异常横幅文案（nil = 正常）
model.privacyHidden   // 金额隐私（只能经 Face ID 切换）
model.accountFilter: Int?   // 全局账号筛选（nil = 全部）
model.orderQuery / model.orderChip / model.payBucket / model.statsPeriod
model.selectedDay / model.tripMonth
model.selectedTab          // 当前标签页（AppTab：home/trip/orders/pay/stats）
model.settingsPresented       // 设置页 sheet

model.filteredOrders / model.filteredPayments   // 已按账号筛选
model.isMultiAccount / model.accounts / model.orders / model.payments / model.threshold
model.overdueBadgeCount
model.account(_:) / model.order(_:) / model.payments(of:)
model.providerList

await model.load()
await model.save()
await model.replaceData(AppData, keepNotifyEnabled:) -> Bool
await model.restoreFromCheckpoint() -> Bool
model.checkpointPayload() -> AppData?
await model.switchMode(DataSpace)
await model.upsertAccount(Account) / deleteAccount(Int) / assignUnassigned(to: Int)
await model.saveOrder(Order) / deleteOrder(Int) / nextOrderId()
await model.advance(order, field: .shot/.submitted/.short/.long)
await model.toggleReceipt(orderId:, kind: "定金"/"尾款")
await model.addPayment(Payment) / deletePayment(Payment)
await model.setRemind(orderId:, days: 1/3/7) / clearRemind(orderId:)
await model.addRemindEntry(orderId:, note:)
await model.setExpectPayAt(orderId:, value:) / setReviewResult(orderId:, value:) / setPublishedAt(orderId:, value:)
await model.setOrderAccount(orderId:, accountId:)
await model.changeThreshold(±1) / setNotifyEnabled(Bool) / rememberProvider(String)
await model.toggleAmountPrivacy()      // Face ID 校验后切换
model.showToast("文案")

// 提示条宿主仲裁（ToastHost.swift 用）
model.registerToastHost(UUID) / model.unregisterToastHost(UUID)
model.activeToastHostID: UUID?        // 当前该显示提示条的宿主（栈顶）
```

**跨标签跳转**：直接改 `model.selectedTab`（`.home` / `.trip` / `.orders` / `.pay` / `.stats`），
不要弹「请在底部切到…」这种提示——选中态在状态中枢里，任何页面都能切。
跳转前先预置目标页的筛选状态（如 `model.statsPeriod = "M"`、`model.payBucket = "over"`）。

## 4.1 测试约定

- UI 测试启动参数带 `-tanji-reset`：把数据重置成 Demo 种子。
  UI 测试会推进订单状态、打卡，不重置的话后一个用例的起点会被前一个改掉。
- 定位元素**优先用 `accessibilityIdentifier`**：`order.row.<id>`、`export.json` 等。
- `.plain` 按钮的可访问性标签是「标题 + 副标题」的拼接串，
  只能用 `label CONTAINS` 匹配，**不能等值匹配**。
- 首页首屏卡片有三种形态（下一站 / 今天的店都拍完了 / 今天没有安排），
  取决于当天数据状态，断言要接受任一分支。
- `UITests/TanjiLayoutProbe.swift` 是**人工版面核对工具**：只截图、不断言，
  一轮 5 个 Tab 约 4–5 分钟，因此 `npm run ios:test` 默认用
  `-skip-testing:TanjiNativeUITests/TanjiLayoutProbe` 跳过它。
  需要核对版面时单独跑：

  ```bash
  xcodebuild test -project ios/TanjiNative/TanjiNative.xcodeproj -scheme TanjiNative \
    -destination 'platform=iOS Simulator,name=iPhone 17' \
    -only-testing:TanjiNativeUITests/TanjiLayoutProbe \
    -resultBundlePath /tmp/probe.xcresult \
    OTHER_SWIFT_FLAGS='$(inherited) -Xfrontend -disable-sandbox'
  xcrun xcresulttool export attachments --path /tmp/probe.xcresult --output-path /tmp/probe
  ```

  两条坑：滚动必须用**长距离坐标拖动**（dy 0.5 → 0.05），短 `swipeUp`
  在 iOS 26 浮动标签栏下滚不动，会误判成「内容被标签栏压住」；
  截图按 `suggestedHumanReadableName` 认页面，别按文件名猜。

## 5. 界面组件（`Sources/Design/Components.swift`）

```swift
ScreenBackground                       // 页面底色
AppHeader(eyebrow:, title:, subtitle:, trailing:)   // 顶栏
SectionTitle("标题") { trailing }       // 分区标题
CardBox { content }                     // 卡片
Chip(text:ink:background:)  / Chip.work(_:) / Chip.pay(_:) / Chip.method(_:)
AccountFilterBar                        // 账号筛选条
MoneyText(value:masked:font:color:)    // 金额（隐私打码）
MiniStat(value:label:valueColor:)
PrimaryButton(title:systemImage:tint:action:) / GhostButton(...)
IconButton(systemName:active:accessibility:action:)
SegmentedTabs(items:selection:)
RowItem(title:subtitle:titleColor:leading:trailing:)
AccountBadge(account:compact:)
EmptyState(title:subtitle:)
SearchField(text:$placeholder:)
ToastOverlay(message:)                  // 提示条本体（在 ToastHost.swift）
OrderRow(order:account:work:pay:price:masked:footnote:onTap:)
CompactOrderRow(order:account:work:pay:price:masked:leading:footnote:showAccount:onTap:)
```

配色：`Theme.paper / card / ink / sub / line / brand / brandInk / green / orange / red / blue / purple`，
`Theme.display(_:)` 是衬线标题字体，`Theme.body(_:weight:)` 是正文。

## 5.1 提示条宿主（`Sources/Design/ToastHost.swift`）

提示条会被 `.sheet` 盖住，**不能只挂在 `RootView`**。规则：

```swift
// 任何会弹提示的页面层级，在 body 末尾加：
someView.toastHost()

// 页面顶栏加（上报高度，提示条自动下沉避让，不要写死像素值）：
someHeader.toastTopAnchor()
```

- `toastHost()` 的宿主在 `AppModel.toastHostStack` 里登记；同一时刻只有栈顶（最上层）宿主渲染提示条。
- 顶层是 `RootView`，各 sheet 内容各自是独立宿主；sheet 打开时它压过根层宿主，关闭后根层恢复。
- `toastTopAnchor()` 用 `PreferenceKey` 上报顶栏高度，宿主读它决定下沉量；顶栏文案或字号变了也不会压住标题。

## 5.2 排版约定（固定宽度必须先量字宽）

- **文字塞进固定宽度容器前，先实测字宽再定宽**。`Theme.display`（衬线）
  的数字明显比 `Theme.body` 宽：`display(21)` 下「09:00」实测 60pt，
  给 52pt 会被截成「09:…」，给 50pt 还会折成两行「09:3 / 0」。
- 固定宽度里的 `Text` 要加 `.lineLimit(1)` + `.fixedSize(horizontal: true, vertical: false)`，
  让它保持单行，由容器 padding 吸收压缩，而不是把字挤到换行。
- **金额用 `MoneyText` 并加 `.layoutPriority(1)`**：同行还有其它元素时，
  金额不能被压成极小字号或省略号。
- 标签行用 `WrapLayout` 而不是 `HStack`：对齐 Web 版
  `.chiprow{display:flex;gap:6px;flex-wrap:wrap}`，窄容器里折行而不是溢出。
- 顶栏右侧的胶囊按钮（首页/行程/订单的「+ 预约」）文字必须单行：
  按钮宽度会被标题挤掉，文字若可换行就会排成「+ 预 / 约」两行。

```swift
WrapLayout(spacing: 6, lineSpacing: 6) { ... }   // 标签行折行（Sources/Design/WrapLayout.swift）
```

## 6. 服务（`Sources/Services/`）

```swift
// 导出：写进沙盒 Documents（「文件」App 里的「探记 HG」文件夹）
BackupService.exportJSON(AppData) throws -> URL        // 探记-备份-YYYY-MM-DD.json
BackupService.exportCSV(AppData) throws -> URL         // 探记-导出-YYYY-MM-DD.csv
BackupService.exportSQLite() throws -> URL              // 探记-YYYY-MM-DD.db
BackupService.exportCheckpoint(AppData) throws -> URL   // 探记-替换前备份-YYYY-MM-DD.json
BackupService.loadImport(from: URL) throws -> AppData  // 读取 + 校验（不落库）
BackupService.exportFolder() -> URL                    // Documents 目录

// 通知
Notifications.ensurePermission() async -> Bool
Notifications.syncDaily(orders:payments:threshold:notifyEnabled:mode:) async
Notifications.syncDeliver(orders:mode:) async
Notifications.scheduleSnooze(order:days:mode:) async
Notifications.cancelSnooze(orderId:mode:) / cancelOrder(...) / cancelMode(...)

// 金额隐私
AmountPrivacy.isHidden / setHidden(_:) / authenticate(reason:) async throws

// 图片
ImageTools.image(fromDataURL:) -> UIImage?
ImageTools.avatarDataURL(from: UIImage) -> String?    // 正方裁剪 128px，≤200KB
ImageTools.doorThumbDataURL(from: UIImage) -> String? // ≤12KB

// 定位串
GeoStore.parse(_:) / isValid(_:) / label(_:)
```

## 7. 弹层 API（各页面共用，签名固定，不要改动）

```swift
// 新建 / 编辑订单（传 nil = 新建）
struct OrderFormView: View {
    let order: Order?
    var presetAppt: String?
    var onSaved: (() -> Void)?
}

// 订单详情
struct OrderDetailView: View {
    let order: Order
    var onChanged: (() -> Void)?    // 数据变化后回调（详情内部自行刷新）
}

// 确认收款（金额可改）
struct PaymentFormView: View {
    let order: Order
    var kind: String                // "定金" / "尾款"
    var onSaved: (() -> Void)?
}

// 记一次催收跟进
struct RemindLogView: View {
    let order: Order
    var onSaved: (() -> Void)?
}

// 平台单预计到账日
struct ExpectPayView: View {
    let order: Order
    var onSaved: (() -> Void)?
}

// 新建 / 编辑账号（传 nil = 新建）
struct AccountFormView: View {
    let account: Account?
    var onSaved: (() -> Void)?
}

// 批量把未指定账号的订单改挂到某个账号
struct AssignAccountView: View {
    var onSaved: (() -> Void)?
}

// 系统原生文件选择器（导入用），默认定位到「探记 HG」文件夹
struct DocumentPicker: UIViewControllerRepresentable {
    var onPick: (URL) -> Void
}
```

弹层统一用 `.sheet(item:)` / `.sheet(isPresented:)` 呈现，内部 `@Environment(\.dismiss) private var dismiss` 关闭。

## 8. Web 版对应源码（写界面前必读）

| 页面 | Web 源码 | 原生文件 |
|---|---|---|
| 首页 | `src/app/views/home.js` | `Sources/Features/Home/HomeView.swift` |
| 行程 | `src/app/views/trip.js` | `Sources/Features/Trip/TripView.swift` |
| 订单 | `src/app/views/orders.js` + `src/app/detail.js` + `src/app/order-forms.js` | `Sources/Features/Orders/` |
| 收款 | `src/app/views/pay.js` + `src/app/order-actions.js` | `Sources/Features/Pay/` |
| 统计 | `src/app/views/stats.js` + `src/app/stats.js` | `Sources/Features/Stats/` |
| 设置 | `src/app/views/settings.js` + `src/app/accounts.js` + `src/app/export.js` | `Sources/Features/Settings/` |
| 视觉 | `www/index.html` 的 `<style>` 段 | `Sources/Design/` |
| 规则 | `www/logic.js` | `Sources/Logic/Logic.swift` |

页面骨架与弹层在 `www/index.html` 的 `<body>` 段（`<section class="view" id="v-xxx">`、`.sheet` 弹层）。
