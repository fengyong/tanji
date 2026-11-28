# 探记 HG · 纯原生 iOS 版

> 本目录是**纯原生 SwiftUI** 实现，与仓库根目录的 Capacitor 混合版（`www/` + `ios/App/`）并存。
> 两条路线各自独立发展，互不覆盖；本目录不使用任何 WebView、Capacitor 或第三方依赖。

## 这个版本是什么

在 `tanji-native-hg` 混合版基线上，用 SwiftUI 重写整套 App：

- **纯原生**：只用系统框架（SwiftUI / Swift Charts / SQLite3 / UserNotifications / LocalAuthentication / PhotosUI / UniformTypeIdentifiers），无三方依赖、无 WebView。
- **逻辑与界面保持一致**：业务口径移植自 Web 版 `www/logic.js` 与 `www/app.js`，文案逐句对齐；`Sources/Logic/Logic.swift` 是移植后的业务核心。
- **数据兼容**：沿用同样的四张表（`orders` / `payments` / `accounts` / `settings`）与同样的 JSON 备份格式，旧版导出的 JSON 可直接导入。
- **导出落到「文件」App**：备份写成带日期的 JSON，直接进沙盒 Documents —— 即「文件」App 里的「探记 HG」文件夹；导入用系统文件选择器，默认定位到同一个文件夹。
- **导入前自动留恢复点**：导入、清空前都会自动存一份快照，可在设置页「恢复替换前的数据」撤回。

## 目录结构

```text
ios/TanjiNative/
  project.yml                xcodegen 工程定义（改工程先改这里，再 xcodegen generate）
  CONTRACT.md                各模块之间的接口约定（改结构前先读）
  Sources/
    App/                     App 入口、RootView、全局状态 AppModel
    Model/                   数据模型、备份校验、Demo 种子
    Logic/                   业务口径移植（Logic、Format）
    Store/                   SQLite 存储与 DataStore
    Services/                备份服务、通知、Face ID 隐私、图片工具
    Design/                  主题、通用组件、提示条宿主
    Features/                各页面（Home/Trip/Orders/Pay/Stats/Settings）
  Tests/                     单元测试（Logic / 备份校验 / 存储）
  UITests/                   UI 回归测试
```

## 支持的设备范围

**最低支持：iPhone 15 Pro**（首发系统 iOS 17.0），deployment target 锁定 iOS 17.0。

- 只面向 iPhone（`TARGETED_DEVICE_FAMILY = "1"`），iPad 不在支持范围。
- **不为更低版本做兼容**：工程里不写 `@available` / `#available` 分支，iOS 17+ 的 API
  （`onChange(of:initial:)` 双参版、`scrollClipDisabled`、Swift Charts 的 `plotFrame`）直接用。
- 若将来要下调 target，先用 `SWIFT_COMPILATION_MODE=wholemodule` 量真实编译错误再动手
  ——默认分批编译会在首批失败时中断并漏报（实测 iOS 16 从 1 处变成 7 处，iOS 15 从 34 处变成 108 处）。

## 构建与测试

工程用 [xcodegen](https://github.com/yonaskolb/XcodeGen) 生成，`.xcodeproj` 不入库：

```bash
brew install xcodegen          # 首次
xcodegen generate --spec ios/TanjiNative/project.yml
```

跑测试：

```bash
xcodebuild test \
  -project ios/TanjiNative/TanjiNative.xcodeproj \
  -scheme TanjiNative \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  OTHER_SWIFT_FLAGS='$(inherited) -Xfrontend -disable-sandbox'
```

> `-Xfrontend -disable-sandbox` 是**本机环境需要**，不是代码问题：
> macOS 27 的 `sandbox-exec` 在本机报 `sandbox_apply: Operation not permitted`，
> SwiftUI 的宏展开因此失败。加上这个 flag 即可正常编译。

在仓库根目录也有快捷脚本：

```bash
npm run ios:generate     # 重新生成 Xcode 工程
npm run ios:test         # 跑单元 + UI 测试
npm run ios:build        # 模拟器构建
npm run ios:install      # 构建 + 签名 + 安装到已连接的真机
```

## 装到真机

```bash
npm run ios:install                          # 自动挑第一台已连接的真机
DEVICE_UDID=00008130-... npm run ios:install # 指定设备
```

脚本 `scripts/install-device-ios.sh` 会自动选设备、选签名身份、挑一个覆盖该设备的
provisioning profile，然后构建 → 手工 `codesign` → 嵌入 profile → `devicectl` 安装并启动。

> **为什么手工签名而不是 Xcode 自动签名**：本机 Xcode 未登录开发者账号，
> `-allowProvisioningUpdates` 会报 `No Accounts`。脚本改为复用本机已有的
> 证书（`Apple Development: …`）与通配符 provisioning profile（`application-identifier` 为 `TEAM.*`，
> 能签任意 bundle id），自己拼 entitlements 后用 `codesign` 签。

> **Debug 构建必须带 `ENABLE_DEBUG_DYLIB=NO`**：Xcode 16+ 的 Debug 默认把代码拆进
> `TanjiNative.debug.dylib`，主程序只是个壳。手工签名只签外层 bundle 时，内层 dylib
> 没有签名，真机会直接启动失败：
> `dyld: Library not loaded: @rpath/TanjiNative.debug.dylib … missing code signature`。
> 加上 `ENABLE_DEBUG_DYLIB=NO` 后 dylib 不再生成，问题消失。

> **覆盖安装保留沙盒数据；卸载会删除沙盒数据**（会丢本地记账），升级时不要卸载。

## 关键实现说明

### 提示条（Toast）的层级

设置页、订单详情、收款表单都是 `.sheet` 呈现的，**sheet 会盖住根页面**。
所以提示条不挂在 `RootView` 一处，而是每个能弹提示的页面层级都挂一个宿主，
由 `AppModel.toastHostStack` 仲裁：同一时刻只有最上层的宿主渲染提示条。

提示条还要避开页面顶部的大标题。做法是顶栏用 `toastTopAnchor()` 上报自身高度
（`PreferenceKey`），提示条宿主读这个高度自动下沉 —— 不写死像素值，
顶栏高度随文案或动态字号变化时也不会压住标题。

### 导出与导入

- 导出（JSON / CSV / SQLite）写进沙盒 Documents，文件名带日期且不覆盖旧文件。
  `Info.plist` 里 `UIFileSharingEnabled = true`，所以「文件」App 里会出现「探记 HG」文件夹。
- 导入用 `UIDocumentPickerViewController`（`DocumentPicker.swift`），默认定位到「探记 HG」文件夹。
- 导入前自动留恢复点；导入后先预览再确认替换。

### 金额隐私

开启后金额用 `••••` 显示，只能经 Face ID 切换（`AmountPrivacy.swift`），状态持久化。

## 已知未验证项

以下只在模拟器验过，**真机尚未确认**：

- Face ID 真实流程与系统弹窗。
- 通知授权与每日催收提醒的实际排程。
- 相册选择头像、拍照打卡的真实流程。
- `UIDocumentPickerViewController` 的默认目录与「文件」App 中的「探记 HG」文件夹在真机上的表现。

> 已验证：真机安装与启动（iPhone 15 Pro / iOS 27.2.1，bundle `com.ord.tanji`，显示名「探记 HG」）。
> 上面这些是 App 内部功能点，需要在真机上逐个点一遍确认。

## 与混合版的关系

- 本目录**不修改** `www/`、`src/`、`ios/App/`；混合版的产物与校验（`npm run check`）不受影响。
- 业务口径以混合版的 Web 版为准；改动两边逻辑时两边都要同步。
- 备份格式相同，可以互相导入。
