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

- **Node ≥ 22**(Capacitor 8 CLI 硬性要求;本机装在 `~/tools/node22`,命令前 `PATH=$HOME/tools/node22/bin:$PATH`)
- **Xcode 16+**(构建 iOS;当前机器未装,模拟器构建待装机后执行)
- 无需 CocoaPods:Capacitor 8 默认 Swift Package Manager

## 常用命令

```bash
npm run build:plugins   # esbuild 打包 src/cap-plugins.js → www/cap-plugins.js
npm run sync            # 打包插件桥 + cap sync ios(www → ios/App/App/public)
npm run serve           # 本地起 Web 版预览(python3 http.server,http://localhost:8765)
npm run open:ios        # 用 Xcode 打开 iOS 工程
```

## 功能(与 Web v0.2 对齐)

- 商家预约 → 拍摄 → 提审 → 发短片 → 发长片;工作线派生状态(待拍摄/后期中/发片中/已交付)
- 定金/尾款双轨收款,渠道仅作记录标签(微信/支付宝/银行卡/抖音商单/其他);抖音商单=平台结算,豁免催收
- 逾期催收:阈值可配(7/15/30/45 天,默认 15),逾期列表 + 1/3/7 天后提醒备忘
- **原生增强**:每日 09:00 催收汇总本地通知(不含金额,可关);snooze 备忘升级为真·本地通知
- 隐私模式(隐藏金额)、预约时段冲突提醒(不禁止)、今日行程分享图
- 导出:CSV / JSON / **SQLite .db**——原生端全部经系统分享面板。导出件是归档用途:表结构沿用 Web 版(单数据集),而 App 内库按 `mode` 分工作/演示两套,两者不通用;**跨设备搬运请用 JSON 备份**(统计页可导入)
- 数据仅存本机(iOS 沙盒 / 浏览器 IndexedDB),无服务器

## 数据表(orders / payments / settings)

见 `docs/native-app-notes.md` 第四节,或 App 内「统计 → 数据结构」页。含 `settle_via`(private/douyin)与 `remind_at`(催收备忘)字段。

## 已知状态

- `cap sync ios` 通过;`xcodebuild` 模拟器构建因本机无 Xcode 暂未执行(环境问题,非代码问题),装机步骤与实测清单见研发笔记第六、七节。
