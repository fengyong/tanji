# 探记 TanJi · iOS 本地 App(native-app 分支)

探店达人的行程 + 记账工具。本分支用 **Capacitor 壳复用 Web UI** 的路线做 iOS 本地 App:同一套页面/状态机,持久化按平台切换——Web 走 IndexedDB + localStorage,iOS 原生走 App 沙盒内 SQLite(@capacitor-community/sqlite)。

技术决策与完整研发记录见 [docs/native-app-notes.md](docs/native-app-notes.md)。

## 目录结构

```
www/                Web 资源(与 main 分支 Web 版 v0.2 同步)
  index.html        UI + 双轨状态机 + 平台自适应持久化 + 原生桥接
  cap-plugins.js    esbuild 打包的 Capacitor 插件桥(window.TanjiCap)
  vendor/           sql.js WASM(导出真 .db 字节)
src/cap-plugins.js  插件桥源文件
ios/App/            cap add ios 生成的 Xcode 工程(SPM,Capacitor 8)
docs/               v0.1 原型归档 + 研发笔记
```

## 环境要求

- **Node ≥ 22**(Capacitor 8 CLI 硬性要求;本机 homebrew node 26 已满足)
- **Xcode 16+**(构建 iOS;2026-11-22 起 Xcode 27.2 已装并实测通过,模拟器 GUI 在 `Xcode.app/Contents/Applications/DeviceHub.app`)
- 无需 CocoaPods:Capacitor 8 默认 Swift Package Manager

## 常用命令

```bash
npm run build:plugins   # esbuild 打包 src/cap-plugins.js → www/cap-plugins.js
npm run sync            # 打包插件桥 + cap sync ios(www → ios/App/App/public)
npm run sync:web        # 从 main 同步 Web 资产(纯资产自动拷;index.html/storage.js 只检测漂移,人工合并)
npm run check           # main/native 漂移校验(指纹锁 scripts/web-sync.lock.json + esbuild 产物比对)
npm test                # 回归测试(node --test:原生路径 18 项 + Web 39 项)
npm run serve           # 本地起 Web 版预览(python3 http.server,http://localhost:8765)
npm run open:ios        # 用 Xcode 打开 iOS 工程
```

## 功能(native v0.5,工作流增强版)

- 品名/商家、**地点**、时间、**组队**、费用、**服务商**(蜂向/小爱/金城/食物/直客)、联系方式、备注
- 预约 → 拍摄 → 提审 → 出片(**按单配置正片/副片要求,两个多选**)→ **送审(合格/不合格)** → **发布** → 收款;时间线顺序不变,新增送审/发布两个可标记可清除的状态
- **24 小时未出片提醒**:拍摄完成 +24h 仍未出齐(按该单正/副片配置)→ 本地通知 + 列表红色「超24h」角标
- 定金/尾款双轨收款,渠道仅作记录标签(微信/支付宝/银行卡/抖音商单/其他);抖音商单=平台结算,豁免催收
- 逾期催收:阈值可配(7/15/30/45 天,默认 15),逾期列表 + 1/3/7 天后提醒备忘
- **原生增强**:每日 09:00 催收汇总本地通知(不含金额,可关);snooze 备忘升级为真·本地通知
- 隐私模式(隐藏金额)、预约时段冲突提醒(不禁止)、今日行程分享图
- 导出:CSV / JSON / **SQLite .db**——原生端全部经系统分享面板。导出件是归档用途:表结构沿用 Web 版(单数据集),而 App 内库按 `mode` 分工作/演示两套,两者不通用;**跨设备搬运请用 JSON 备份**(统计页可导入)
- 数据仅存本机(iOS 沙盒 / 浏览器 IndexedDB),无服务器

## 数据表(orders / payments / settings)

见 `docs/native-app-notes.md` 第四节,或 App 内「统计 → 数据结构」页。含 `settle_via`(private/douyin)、`remind_at`(催收备忘),以及 v0.5 工作流字段:`location` / `deliver_main` / `deliver_sub` / `review_result` / `published_at`(旧库启动时自动 ALTER 迁移)。

## 已知状态

- 2026-11-22:模拟器构建闭环打通——`xcodebuild` BUILD SUCCEEDED,安装/启动/渲染正常;SQLite 落盘与读取回环(抹镜像+直改库→UI 显示改后值)实测通过;通知权限弹窗正常。实测记录见研发笔记六·五节。
- 剩余人工点验项(snooze 通知到达、每日汇总、四种导出分享面板、真机签名)见研发笔记第七节。
- `xcodebuild` 命令:`xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath build/DerivedData build`(`build/` 已入 gitignore)。
