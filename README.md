# 探记 TanJi

探店达人的行程与收款本机记账工具。纯前端 PWA，无后端依赖；订单与流水保存在本机，并生成可导出的 SQLite 数据库。

## 在线地址

| 站点 | 链接 | 内容 |
|---|---|---|
| **正式版（给达人用）** | https://tanji-app-guvc.zai.site | v0.4：双数据集（工作/演示）、JSON 导入恢复、月历勋章、全环节可改 |
| **点子实验室（验收用）** | https://tanji-lab-1v7g.zai.site | 8 个产品点子可交互 demo + 自测试机制（26 条断言 + 12 步 UAT） |
| **代码仓库** | https://github.com/fengyong/tanji | main / native-app / fix/native-persistence-review / lab / feat 分支 |

实验室与正式版相互独立、分开部署；实验室数据全部虚构，正式版默认演示数据。

### 免费 PWA 与付费 iOS App

| | PWA（main，本分支） | iOS 原生版（native-app 分支） |
|---|---|---|
| 价格 | **免费体验** | **买断付费**（App Store 下载） |
| 定位 | 宣传 + 试用入口 | 变现 + 功能迭代载体 |
| 更新 | 手动 bump `sw.js` VERSION | **推送更新，点一下即可** |

两端「统计 → 关于」里都有同一个转化入口：`index.html` 顶部的 `APP_STORE_URL` 常量。
留空显示「iOS 原生版 · 买断 / 即将上架」，填上 App ID 自动变成可点的 App Store 链接。

付费版后续按使用者意见迭代 —— 反馈入口就是 App 内「支持与常见问题」里的邮箱。

## 快速开始(手机)

1. 用 iPhone 的 Safari 打开应用链接(部署后的 https 地址)
2. 点底部「分享」按钮 → 「添加到主屏幕」→ 确认
3. 从主屏幕打开,即以独立 App 形态运行(全屏、有图标)
4. 首次打开显示独立演示数据；进入「统计」→「切换到工作数据」，开始记录自己的订单

> **重要**：浏览器数据仍可能被系统清理；添加到主屏幕不能替代备份。请定期导出 JSON 到文件 App 或 iCloud。应用需要 HTTPS 或 localhost，使用支持 Web Locks 的现代浏览器；同一地址只允许一个标签页写入，其他标签页为只读。

## 功能

- **行程**：月历 + 整月逐日档期；预约时同时段冲突只提醒不禁止（可找人代拍）
- **订单**:工作线(待拍摄 → 后期中 → 发片中 → 已交付)与资金线(待定金 → 待尾款/平台结算 → 已结清)双轨状态,里程碑标记(拍摄/提审/短片/长片)自动记时间
- **收款**:定金/尾款,收款方式(微信/支付宝/银行卡/抖音商单/其他)仅作入账记录;抖音商单=平台结算,自动豁免催收
- **催收**:尾款自实际拍摄日起算,超过阈值(默认 15 天,可调 7/15/30/45)标记逾期;详情页可设「1/3/7 天后再次提醒」备忘,打开 App 即可查看
- **统计**:近 7 天/近 30 天/本月,成交额、实收金额、完结单、客单价、每日实收柱状图、收款渠道构成
- **隐私**：隐藏页面金额；首页分享今日行程，行程页分享选中日期，图片默认不含金额。公开页面不再内嵌真实档期
- **数据**：localStorage 与 IndexedDB 双副本，按修订号恢复较新数据；支持导出 SQLite / CSV / JSON、JSON 预览导入和替换前恢复
- **账务保护**：金额精确到分、定金不超过总价、零元单直接结清；重复收款不重复入账，已有收款时锁定总价和定金，需明确撤销相应流水才能改价

## 数据与备份

- 数据仅存本机,不上传任何服务器
- 建议每周在「统计 → 数据管理」导出一次 .db 或 JSON 备份(存到文件 App / iCloud)
- 更换设备：旧设备导出 JSON → 新设备切换「工作数据」→「导入 JSON 备份」，核对预览后确认替换
- 导入会检查订单 ID、金额、时间、流水与已收状态；有不一致时拒绝导入，不会静默修账
- 导入或清空前保留一份当前数据，可通过「恢复替换前数据」撤回；再次替换会轮换这份备份，不是多版本历史
- 演示与工作数据分别保存；清空、导入和恢复仅影响当前模式。旧版本本机数据自动迁移为工作数据，原存储键保留
- 保存失败会显示持续提示；请勿关闭页面，先导出 JSON，再重试。读取异常时暂停写入，仍可尝试导出替换前备份
- 数据按浏览器与站点地址隔离；更换端口、域名、浏览器不会自动迁移。JSON/CSV/SQLite 导出包含完整明文信息，隐藏金额不等于加密备份

## 技术结构

```
index.html            主应用(UI + 业务状态 + SQLite 生成)
storage.js            双副本存储、迁移、导入恢复与写入锁
sw.js                 Service Worker(离线缓存,发版需升级 VERSION)
manifest.webmanifest  PWA 清单
vendor/sqlite3.mjs    SQLite 官方 WASM 构建(@sqlite.org/sqlite-wasm)
vendor/sqlite3.wasm   同上
icons/                App 图标(512/192/apple-touch 180)
AGENTS.md             项目必读文档(动手前先读)
docs/git-push-guide.md 提交与推送规范(两条硬规则 + 故障排查)
docs/prototype-v0.1.html  v0.1 原型存档
```

## 本机预览与回归

在本工作区启动静态服务器，然后打开 `http://127.0.0.1:48762`；不要直接双击 HTML。请保持端口一致，且不要把私人备份复制进公开目录。

```sh
python3 -m http.server 48762 --bind 127.0.0.1
```

使用 Node.js 24 运行测试，无需安装依赖：

```sh
node --test tests/reliability.test.cjs
node tests/browser-smoke.cjs
```

浏览器测试会启动本机 Chrome、临时 HTTP 服务和独立临时资料目录，不读取日常浏览器数据；默认使用 macOS Chrome 路径，也可通过 `CHROME_BIN` 指定。覆盖新建/收款/导入/清空恢复、SQLite 生成、写入锁与离线刷新，并输出手机及桌面尺寸截图路径。iOS 安装、系统分享和系统数据清理仍需真机验收。

## 分支

- `main` — Web/PWA 版（线上部署即此分支），包含可靠性修复与备份恢复
- `lab` — 点子实验室（8 个点子 demo + 自测试机制），独立部署于实验室链接，待验收合入
- `native-app` — 本地 App 版（Capacitor 壳 + 原生 SQLite/本地通知），独立 worktree（`tanji-native/`）开发；已同步 v0.4，并叠加 native 专属的 v0.5 工作流与 v0.6 多账号；Xcode 27.2 模拟器构建与 SQLite/通知实测已通过（当前开发分支 `fix/native-persistence-review` → PR 目标 `native-app`）
- `feat/reliability-recovery` — 可靠性修复开发分支，保留独立 worktree
- `feat/cloud-local-first` — 云端/本地优先策略实验分支（未合入）

## 提交与推送（必读）

**两条硬规则**，任何一次提交和推送都必须满足，完整版见 [`AGENTS.md`](AGENTS.md)：

1. **提交标题必须以 agent 名称 / 模型名称开头**

   ```bash
   git commit -m "mimocode/M31.1-flash feat(web): 一句话说清做了什么"
   ```

   格式：`<agent名称>/<模型名称> <类型>(<作用域>): <一句话摘要>`。前缀取值 `mimocode/M31.1-flash`
   （MiniMax Code / MiniMax-M3.1-Flash，本项目当前在用）；换 agent 或换模型就写当次实际用的那个。
   前缀必须在标题行**开头**，不能写成 `feat(web): mimocode/M31.1-flash ...`。

2. **推送一律用 `fengyong` 账号**

   ```bash
   git push git@github-fengyong:fengyong/tanji.git HEAD:refs/heads/<分支>
   ```

   `origin` 在本机是 `drax-ola` 身份、对 `fengyong/tanji` 无写权限；HTTPS 到 github.com 不通；
   本机 `~/.gitconfig` 的 `insteadOf` 全局改写让「改 remote / 换 HTTPS / 加 `-u」全部无效。
   `~/.ssh/config` 里已配好 `Host github-fengyong` 别名，用 `ssh -T git@github-fengyong` 校验
   应回 `Hi fengyong!`。

首次配置、提交前自检、PR 目标分支、CI 触发条件与四类 push 报错的排查见
[docs/git-push-guide.md](docs/git-push-guide.md)。
