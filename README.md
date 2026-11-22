# 探记 TanJi · iOS 本地 App(native-app 分支)

探店达人的行程 + 记账工具。本分支用 **Capacitor 壳复用 Web UI** 的路线做 iOS 本地 App:同一套页面/状态机,持久化按平台切换——Web 走 IndexedDB + localStorage,iOS 原生走 App 沙盒内 SQLite(@capacitor-community/sqlite)。

技术决策与完整研发记录见 [docs/native-app-notes.md](docs/native-app-notes.md)。
达人工作流还原、交互评估与功能缺口优先级见 [docs/creator-workflow-review.md](docs/creator-workflow-review.md);
视觉探索产物(六套配色 / 首页卡片 / 金额格 / 详情 v2)归档在 `docs/design-preview/`,排在功能之后落地。

> 当前开发分支:`fix/native-persistence-review`(PR 目标 `native-app`)。代码、App 内页脚、导出 `.db`、
> 备份文档与本文档的版本号统一为 **v0.6**。

## 目录结构

```
www/                Web 资源(与 main 分支 Web 版同源;纯资产同步,index.html/storage.js 含原生适配层与 v0.5/v0.6 专属改动)
  index.html        UI + 页面状态 + 平台自适应持久化 + 原生桥接
  logic.js          业务规则纯函数层(工作线/资金线/逾期/出片/统计/排期),不碰 DOM,可单测
  imaging.js        图像处理模块(裁切/压缩/烘焙淡化 + 体积上限),头像与随手拍共用
  geo.js            到店定位与地图跳转(GPS 记录 / 手填地点导航),原生与 Web 同一套入口
  cap-plugins.js    esbuild 打包的 Capacitor 插件桥(window.TanjiCap)
  vendor/           sql.js WASM(导出真 .db 字节)
src/cap-plugins.js  插件桥源文件
ios/App/            cap add ios 生成的 Xcode 工程(SPM,Capacitor 8)
docs/               v0.1 原型归档 + 研发笔记 + 交互评估 + 上架清单 + 多账号原型(docs/proto) + 视觉探索(design-preview)
```

## 环境要求

- **Node ≥ 22**(Capacitor 8 CLI 硬性要求;本机 homebrew node 26 已满足)
- **Xcode 16+**(构建 iOS;2026-11-22 起 Xcode 27.2 已装并实测通过,模拟器 GUI 在 `Xcode.app/Contents/Applications/DeviceHub.app`)
- 无需 CocoaPods:Capacitor 8 默认 Swift Package Manager

## 提交与推送

推送必须走自己的 SSH 别名地址（`origin` 在本机是 `drax-ola` 身份、无写权限；HTTPS 到 github.com 不通）：

```bash
git push git@github-<你的GitHub用户名>:fengyong/tanji.git HEAD:refs/heads/<你的分支>
```

首次配置、提交前自检、PR 目标分支、CI 触发条件与四类 push 报错的排查见
[docs/git-push-guide.md](docs/git-push-guide.md)。

## 常用命令

```bash
npm run build:plugins   # esbuild 打包 src/cap-plugins.js → www/cap-plugins.js
npm run sync            # 打包插件桥 + cap sync ios(www → ios/App/App/public)
npm run sync:web        # 从 main 同步 Web 资产(纯资产自动拷;index.html/storage.js 只检测漂移,人工合并)
npm run check           # main/native 漂移校验(指纹锁 scripts/web-sync.lock.json + esbuild 产物比对)
npm run check:update    # 人工合并/有意改动后重新登记锁基线(只做这一件事,不碰文件)
npm test                # 回归测试(node --test:原生 32 + Web 39 + 导出表结构 5 + 规则 8 + 定位 5 + 接线 3,共 92)
npm run test:smoke      # 浏览器端到端冒烟(需本机 Chrome,可用 CHROME_BIN 指定)
npm run serve           # 本地起 Web 版预览(python3 http.server,http://localhost:8765)
npm run build:ios       # xcodebuild 模拟器构建(不签名)
npm run build:ios:device# xcodebuild 真机 Release 构建(不签名)
npm run open:ios        # 用 Xcode 打开 iOS 工程
```

## 功能(native v0.6,多账号版)

- **多账号体系**:录入多个达人账号(昵称/手机号/抖音账号/**头像**/标识色),订单挂账号;首页/订单/**收款**/统计四页可「全部合并看 / 按账号拆开」;订单/流水行带账号浅底色+迷你头像小标;账号资料**一键拷贝**(昵称+抖音+手机,去报名/给服务商);≥2 账号时建单出**单选卡**选号(不是下拉),单账号全程零打扰自动归属
- 服务商:预设芯片点选(蜂向/小爱/金城/食物/直客)+ 直接输入,自定义过的自动记入预设
- 品名/商家、**地点**、时间、**组队**、费用、联系方式、备注
- **地点一键导航**:详情页地点行直接跳地图 App(按手填的中文地址查,最准);**到店定位**:打卡/随手拍时自动记一次当时 GPS(`gps_place` 新列,与手填地点并存),详情页可回看位置或手动补记
- **保存按钮常驻**:新建/编辑弹层的保存条固定在底部,不用滚到最下面才看得见
- **行内推进**:首页「今日拍摄」可直接打卡、首页/订单页「待发片」行内直接提审/发片/发布;订单搜索覆盖商家/地点/联系人/备注
- 预约 → 拍摄 → 提审 → 出片(**按单配置正片/副片要求,两个多选**)→ **送审(合格/不合格)** → **发布** → 收款;时间线顺序不变,新增送审/发布两个可标记可清除的状态
- **24 小时未出片提醒**:拍摄完成 +24h 仍未出齐(按该单正/副片配置)→ 本地通知 + 列表红色「超24h」角标
- 定金/尾款双轨收款,渠道仅作记录标签(微信/支付宝/银行卡/抖音商单/其他);抖音商单=平台结算,豁免催收
- 逾期催收:阈值可配(7/15/30/45 天,默认 15),逾期列表 + 1/3/7 天后提醒备忘
- **原生增强**:每日 09:00 催收汇总本地通知(不含金额,可关);snooze 备忘升级为真·本地通知
- 隐私模式(隐藏金额)、预约时段冲突提醒(不禁止)、今日行程分享图
- 导出:CSV / JSON / **SQLite .db**——原生端全部经系统分享面板。导出件是归档用途:表结构沿用 Web 版(单数据集),而 App 内库按 `mode` 分工作/演示两套,两者不通用;**跨设备搬运请用 JSON 备份**(统计页可导入)
- 数据仅存本机(iOS 沙盒 / 浏览器 IndexedDB),无服务器

## 数据表(orders / payments / settings)

见 `docs/native-app-notes.md` 第四节,或 App 内「统计 → 数据结构」页。v0.5 工作流字段:`location` / `deliver_main` / `deliver_sub` / `review_result` / `published_at`;v0.6 新增 `accounts` 表与 orders.`account_id`、orders.`gps_place`(旧库启动时自动迁移)。

## 已知状态

- 2026-11-22:模拟器构建闭环打通——`xcodebuild` BUILD SUCCEEDED,安装/启动/渲染正常;SQLite 落盘与读取回环(抹镜像+直改库→UI 显示改后值)实测通过;通知权限弹窗正常。实测记录见研发笔记六·五节。
- 剩余人工点验项(snooze 通知到达、每日汇总、四种导出分享面板、真机签名)见研发笔记第七节。
- `xcodebuild` 命令:`xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath build/DerivedData build`(`build/` 已入 gitignore)。
