# 探记 HG 真机安装指南

> 目标：在 macOS 上把 `tanji-native-hg` 分支的当前代码签名、安装并启动到 iPhone。
> 本文命令在仓库根目录执行；所有 Team ID、UDID 和账号信息均使用占位符，不写入仓库。

## 0. 前提与签名说明

| 前提 | 说明 |
|---|---|
| Node ≥ 22 | Capacitor 8 CLI 要求 |
| Xcode 26+ | 建议使用当前 Xcode，以保留 iOS 26+ 系统 Liquid Glass 外观 |
| Apple Development 签名 | 付费开发者团队或免费 Personal Team 均可做本机调试 |
| 本地通知 | 使用 `LocalNotifications`，不依赖 APNs |
| 无 App Groups / Push entitlements | 当前工程不需要这些能力 |

签名有效期取决于 Team 与 provisioning profile：

- **付费开发者团队**：按 Apple 当前政策、账号状态和描述文件有效期执行，不统一按 7 天计算。
- **免费 Personal Team**：描述文件通常只有 7 天有效期，失效后重新构建安装即可。

升级时覆盖安装会保留沙盒数据；**卸载会删除沙盒数据，不要用卸载重装来升级**。

## 1. 一次性准备

### 1.1 Xcode 登录 Apple ID

`Xcode → Settings → Accounts → + → Apple ID`，登录拥有目标 Team 的账号。

### 1.2 iPhone 开启开发者模式

`设置 → 隐私与安全性 → 开发者模式 → 打开 → 重启 → 确认`。

### 1.3 配对设备

解锁手机并保持亮屏，用数据线连接 Mac，在手机上点「信任此电脑」并输入锁屏密码。

```bash
xcrun devicectl list devices
# 期望 Pairing State = paired，Device State = connected
```

### 1.4 获取 Team ID 与 UDID

```bash
# 设备 UDID：从 Identifier 列复制
xcrun devicectl list devices

# Team ID：Xcode → Settings → Accounts → 选中账号 → Team 列表
# 也可从已生成的 Apple Development 证书读取，subject 的 OU 字段即 Team ID
security find-certificate -c "Apple Development" -p | openssl x509 -noout -subject
```

不要把真实值写进 `docs/`、脚本或工程文件。

## 2. 一条命令安装

```bash
cd /path/to/tanji-native-hg
DEVELOPMENT_TEAM=<TEAM_ID> DEVICE_UDID=<DEVICE_UDID> \
CONFIGURATION=Release npm run install:ios:device
```

`scripts/build-device.sh` 依次执行：

1. `npm run sync`：重建 JS 产物并把 `www/` 同步进 iOS 工程。
2. `xcodebuild -allowProvisioningUpdates`：签名并生成 `.app`。
3. `xcrun devicectl device install app`：安装到设备。
4. `xcrun devicectl device process launch`：启动 `com.tanji.hg`。

可选环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `BUNDLE_ID` | `com.tanji.hg` | HG 正式 Bundle ID；一般不要覆盖 |
| `CONFIGURATION` | `Debug` | 真机验收建议 `Release` |
| `SKIP_SYNC` | 未设 | 设为 `1` 可跳过同步，仅用于确认 `www/` 已同步的场景 |

构建日志：`/tmp/tanji-device-build.log`。

## 3. 安装后检查

首次启动若提示「不受信任的开发者」：

`iPhone → 设置 → 通用 → VPN与设备管理 → 开发者 App → 选择对应证书 → 信任`。

```bash
# 手动启动（先解锁手机）
xcrun devicectl device process launch --device <DEVICE_UDID> com.tanji.hg

# 抓真机截图
xcrun devicectl device capture screenshot \
  --device <DEVICE_UDID> --destination /tmp/tanji-hg-device.png
```

真机必须人工验收：

- 相机、相册、定位、通知权限及拒绝后的反馈。
- 新建/编辑订单、打卡、发片、发布、定金/尾款与撤销。
- SQLite 写入后重启 App，数据仍存在。
- JSON 导入导出、SQLite/CSV 导出与系统分享面板。
- 离线可用、安全区、Liquid Glass、键盘与弹层实际手感。

## 4. 故障对照表

| 报错 / 现象 | 原因 | 解法 |
|---|---|---|
| `Locked: device was not, or could not be, unlocked` | 手机锁屏 | 解锁后重跑启动命令，或手动点图标 |
| `invalid code signature ... profile has not been explicitly trusted` | 证书未信任 | 按 §3 在「VPN与设备管理」信任 |
| `Signing for "App" requires a development team` | 未传 Team 或工程未选 Team | 传 `DEVELOPMENT_TEAM=<TEAM_ID>`；不要在提交中写入本机 Team |
| `Pairing State: unpaired` | 手机未信任此电脑 | 重新插拔并按 §1.3 信任 |
| `developer mode disabled` | 开发者模式未开启 | 按 §1.2 开启并重启 |
| `com.tanji.hg` 注册失败 / Bundle ID 标红 | App ID 被占用或账号无权限 | 先确认该 ID 归属；不要静默改成原 TanJi App 的 ID |
| 签名/描述文件失效，App 无法启动 | Team、证书或 profile 到期/撤销 | 重新执行 §2 覆盖安装；不要卸载 |
| `xcrun: error: unable to find utility "devicectl"` | Xcode 版本太旧 | 升级 Xcode 并选择正确的开发者目录 |
| 构建成功但页面还是旧版 | `www/` 未同步 | 去掉 `SKIP_SYNC=1`，重新执行安装命令 |

## 5. 先看模拟器效果

```bash
npm run build:ios
xcrun simctl boot "iPhone 17"
APP=$(ls -d ~/Library/Developer/Xcode/DerivedData/App-*/Build/Products/Debug-iphonesimulator/App.app | head -1)
xcrun simctl install booted "$APP"
xcrun simctl launch booted com.tanji.hg
xcrun simctl io booted screenshot /tmp/tanji-hg-sim.png
```

模拟器不能替代真机权限、GPS、分享面板、安全区和键盘手感验收。

## 6. 给 agent 的硬约束

1. Team ID、UDID、私钥、真实账目数据不得写入仓库。
2. 不要在 `project.pbxproj` 中提交本机 `DEVELOPMENT_TEAM`。
3. 改了 `www/` 必须先 `npm run sync` 再装机。
4. 不要修改原 TanJi App 的 `main` / `native-app` 分支。
5. 不要 force push、merge、上架或删除旧 App 数据，除非用户单独明确授权。
