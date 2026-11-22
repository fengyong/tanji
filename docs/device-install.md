# 真机安装指南(给 agent / 新同学)

> 目标:在一台**从没装过**的 Mac 上,把 `native-app` 的当前代码装进 iPhone,10 分钟内跑起来。
> 全程免费 Apple ID,**不需要付费开发者账号**。
> 本文所有命令都在 `/Users/ola/drax-toolbox/tanji-native` 下执行,且均已实测。

---

## 0. 这条链路为什么能成(先确认前提)

| 前提 | 为什么需要 | 怎么验 |
|---|---|---|
| 工程无 entitlements | 免费签名不给 Push / App Groups / Associated Domains | `ls ios/App/App/*.entitlements` → No such file |
| 通知走本地通知 | 免费签名不能用 APNs | `grep LocalNotifications package.json` |
| 有一台登录了 Apple ID 的 Xcode | 生成 `Apple Development` 证书与描述文件 | 见 §2 |

现状(2026-11-22):工程满足上述三条,已实测装进 iPhone 15 Pro。

---

## 1. 一次性准备(只做一次)

### 1.1 Xcode 登录 Apple ID

`Xcode` → `Settings…`(`⌘,`)→ `Accounts` → 左下 `+` → `Apple ID` → 登录(普通账号,不付费)。

登录成功的判据(命令):

```bash
plutil -p ~/Library/Developer/Xcode/UserData/XcodeSettings/*/AppleAccounts/AppleAccounts.plist
# 能看到 username => "xxx@xxx" 即可
```

### 1.2 iPhone 开开发者模式

`设置` → `隐私与安全性` → `开发者模式` → 打开 → 重启 → 确认。

### 1.3 配对(必须 `paired`,不是插上线就行)

解锁手机并保持亮屏 → 用数据线连 Mac → 手机弹「要信任此电脑吗」→ 信任 → 输锁屏密码。

```bash
xcrun devicectl list devices
# 期望:Pairing State = paired,Device State = connected
```

若一直显示 `unpaired`:手机 `设置` → `通用` → `传输或还原 iPhone` → `还原` → `还原位置与隐私`,再插一次。

### 1.4 记下两个值

```bash
# 设备 UDID
xcrun devicectl list devices | grep -i iphone

# Team ID:Xcode → Settings → Accounts → 选中账号 → 右侧 Team 列表(10 位)
# 或者构建时让 xcodebuild 报错提示,或从已生成的证书读:
security find-certificate -c "Apple Development" -p | openssl x509 -noout -subject
# subject 里的 OU 字段就是 Team ID
```

本项目已知值(2026-11-22,仅个人机器有效,**不要写进仓库文件**):

| 项 | 值 |
|---|---|
| 设备 | `Ordi's iPhone15` / iPhone 15 Pro / iOS 27.2.1 |
| UDID | `00008130-0002358002F3803A` |
| Team ID | `YC9UFHH73D`(`fengyong@ustc.edu`,Personal Team) |
| 装机 bundle id | `com.olatanji.app`(构建时覆盖,**不写进 `project.pbxproj`**) |

---

## 2. 一条命令安装

```bash
cd /Users/ola/drax-toolbox/tanji-native
DEVELOPMENT_TEAM=<TeamID> DEVICE_UDID=<UDID> npm run install:ios:device
```

脚本 `scripts/build-device.sh` 依次做四件事:

1. `npm run sync`(esbuild 打包插件桥 + `cap sync ios`,把 `www/` 拷进 `ios/App/App/public`)
2. `xcodebuild -allowProvisioningUpdates`(首次会自动注册设备 UDID 与 App ID、生成描述文件)
3. `xcrun devicectl device install`
4. `xcrun devicectl device process launch`

可选环境变量:

| 变量 | 默认 | 说明 |
|---|---|---|
| `BUNDLE_ID` | `com.olatanji.app` | 覆盖 bundle id,不碰工程文件 |
| `CONFIGURATION` | `Debug` | 想装 Release 就设 `Release` |
| `SKIP_SYNC` | 未设 | 设 `1` 跳过 `npm run sync`(www 已同步时更快) |

构建日志:`/tmp/tanji-device-build.log`(只在失败时有价值)。

---

## 3. 装好之后

首次启动若提示「不受信任的开发者」:

手机 `设置` → `通用` → `VPN与设备管理` → `开发者 App` → 点 `Apple Development: xxx` → `信任`。

```bash
# 手动启动(手机锁屏时会失败,先解锁)
xcrun devicectl device process launch --device <UDID> com.olatanji.app

# 抓真机截图(验收 UI 用,比描述可靠)
xcrun devicectl device capture screenshot --device <UDID> --destination /tmp/tanji-device.png
```

---

## 4. 故障对照表(踩过的都在这)

| 报错 / 现象 | 原因 | 解法 |
|---|---|---|
| `Locked: device was not, or could not be, unlocked` | 手机锁屏 | 解锁后重跑启动命令,或手动点图标(装是成功的) |
| `invalid code signature ... profile has not been explicitly trusted` | 证书未在手机上信任 | 走 §3 的「VPN与设备管理 → 信任」 |
| `Signing for "App" requires a development team` | 工程里没配 team,也没传 `DEVELOPMENT_TEAM` | 传 `DEVELOPMENT_TEAM=<TeamID>`;或在 Xcode Signing & Capabilities 选一次团队(**选完记得别提交 `project.pbxproj`**) |
| `Pairing State: unpaired` | 没点「信任此电脑」 | 见 §1.3 |
| `developer mode disabled` | 开发者模式没开 | 见 §1.2 |
| `com.tanji.app` 注册失败 / Bundle ID 标红 | 该 App ID 被占用或属于正式上架用 | 别改工程,**用默认的 `BUNDLE_ID=com.olatanji.app`** 构建 |
| 装完 7 天后打不开 | 免费证书过期(约 **2026-11-29**) | 重跑 §2 同一条命令覆盖安装;**数据保留,千万别卸载** |
| `xcrun: error: unable to find utility "devicectl"` | Xcode 版本太旧(< 15) | 升级 Xcode |
| 模拟器打不开图形界面 | Xcode 27 里 Simulator 改名 DeviceHub | `open -a "/Applications/Xcode.app/Contents/Applications/DeviceHub.app"` |

---

## 5. 想先看效果、不折腾真机

```bash
npm run build:ios     # xcodebuild 模拟器构建(不签名)
xcrun simctl boot "iPhone 17"
APP=$(ls -d ~/Library/Developer/Xcode/DerivedData/App-*/Build/Products/Debug-iphonesimulator/App.app | head -1)
xcrun simctl install booted "$APP"
xcrun simctl launch booted com.tanji.app
xcrun simctl io booted screenshot /tmp/tanji-sim.png
```

模拟器验不了的(**必须真机**):相机权限、GPS 定位精度、地图跳转、底部安全区、通知授权弹窗。

---

## 6. 给 agent 的硬约束

1. **不要把 Team ID / UDID 写进仓库文件**(`docs/` 里只保留占位符或明确标注"个人机器值")。
2. **不要提交 `ios/App/App.xcodeproj/project.pbxproj` 里 Xcode 写入的 `DEVELOPMENT_TEAM`**(那是本机账号信息)。
3. 改完 `www/` 一定要 `npm run sync` 再 `install:ios:device`,否则装进去的还是旧前端。
4. 装机后至少验证:`curl` 不需要;打开 App 不白屏、`npm run test:smoke` 仍全绿。
5. 卸载重装会**删沙盒数据**;只想升级就覆盖安装。
