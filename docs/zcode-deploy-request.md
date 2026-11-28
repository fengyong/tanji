# ZCode 部署需求单 · 探记法律页上线

> ## ✅ 已执行（2026-11-28 23:15 复核通过）
>
> 本文档原本是交给 ZCode 的部署需求单。**部署已经完成**，下方验收标准已逐条实测通过，
> 因此保留此文档作为部署记录，**不需要再执行一次**。
>
> 实测结果（`curl -L` 直连生产站点）：
>
> | URL | 状态码 | 大小 |
> |---|---|---|
> | `https://tanji-app-guvc.zai.site/` | 200 | 108,220 B |
> | `https://tanji-app-guvc.zai.site/privacy.html` | 200 | 10,098 B |
> | `https://tanji-app-guvc.zai.site/support.html` | 200 | 9,594 B |
> | `https://tanji-app-guvc.zai.site/icons/apple-touch-icon.png` | 200 | 27,831 B |
>
> 内容抽查：`privacy.html` 命中「隐私政策」4 处、`support.html` 命中「支持」8 处、
> 首页 `index.html` 内含 `privacy.html` 与 `support.html` 两个入口链接各 1 处。
>
> 这也是 App Store Connect 侧「隐私政策 / 支持页 URL 必须公网 200」这一项得以通过的原因
> （见 `testflight/app-store-connect.json` 的 `legalUrls`）。
>
> ⚠️ 实验室站点 `tanji-lab-1v7g.zai.site` 的两个法律页实测仍为 **404**，
> 属独立部署，本次**未处理**，与生产站点无关。

> 交给 ZCode 执行。本文档是自包含的任务说明，ZCode 不需要读本仓库也能做。

## 背景

「探记 TanJi」Web/PWA 版的**隐私政策页**与**支持页**本地已写好，但线上一直 404。
App Store Connect 要求 App 的隐私政策 URL 必须能访问（返回 200），否则提审会被拒。
所以需要把线上站点重新部署到最新版本。

## 站点信息

| 项 | 值 |
|---|---|
| 生产站点 | `https://tanji-app-guvc.zai.site` |
| 实验室站点 | `https://tanji-lab-1v7g.zai.site` ← **不要部署到这里** |
| 代码仓库 | `git@github.com:fengyong/tanji.git` |
| 部署分支 | **`main`**（Web / PWA 版；`lab` 分支对应实验室站点） |
| 托管平台 | ZCode Sites（`zai.site` 托管域名，底层阿里云 FC） |

## 要做的事

### 1. 重新部署 `main` 分支

线上当前跑的是 **v0.4**，而 `main` 分支（`d74ffd4`）已经包含：

- `privacy.html`（隐私政策，9.2 KB）
- `support.html`（支持页，8.8 KB）
- `index.html` 里「关于」菜单**新增**了这两个页面的入口链接

> 这是一次**整站重新部署**，不是单独上传两个 HTML。
> 两个页面互相引用、也引用了 `icons/apple-touch-icon.png` 与 `index.html`，
> 单独传文件会导致图标 404 和返回首页失效。

### 2. 部署后自检

```bash
# 三个 URL 都必须是 200
curl -s -o /dev/null -w '%{http_code}\n' -L https://tanji-app-guvc.zai.site/
curl -s -o /dev/null -w '%{http_code}\n' -L https://tanji-app-guvc.zai.site/privacy.html
curl -s -o /dev/null -w '%{http_code}\n' -L https://tanji-app-guvc.zai.site/support.html

# 内容抽查：不能是错误页
curl -s -L https://tanji-app-guvc.zai.site/privacy.html | grep -o '隐私政策' | head -1
curl -s -L https://tanji-app-guvc.zai.site/support.html | grep -o '支持' | head -1
curl -s -L https://tanji-app-guvc.zai.site/privacy.html | grep -o 'fengyong@ustc.edu' | head -1
```

### 3. 验收标准

- [ ] `privacy.html` 返回 **200**，正文含「隐私政策」与 `fengyong@ustc.edu`
- [ ] `support.html` 返回 **200**，正文含「支持」
- [ ] 首页 `index.html` 返回 200，且页面里能点到隐私政策与支持页入口
- [ ] `icons/apple-touch-icon.png` 返回 200（两页的图标引用）
- [ ] 用无痕窗口打开验证一次，排除浏览器缓存干扰

## 已知问题（不用处理，但要知晓）

- 本机没有 `aliyun` / `s` / `fcli` 等阿里云部署 CLI，只能走 ZCode 的发布界面。
- 实验室站点 `tanji-lab-1v7g.zai.site` 的法律页同样是 404，属独立部署，**本次不处理**。
- 线上站点是 v0.4，重新部署会同时把首页更新到最新版，这是预期行为。

## 补充说明（给上架用，可选）

纯原生 iOS 版（`com.ord.tanji.app`，显示名「探记」）将复用这两个 URL 作为
App Store Connect 的隐私政策与支持页地址。

**原生版与 Web 版的数据处理口径一致**：纯本地、无账号、无服务器、
不收集任何数据、导出走系统分享面板由用户自行保管。
所以同一份隐私政策覆盖两个渠道，技术上是准确的。

唯一差异（不影响审核，可后续再改）：政策第 2 节写的「设备浏览器的本地存储」
是 Web 版的说法，原生版对应的是「App 内置存储（UserDefaults 镜像）」。
若要更严谨，可在下次改版时把这一句改成兼容两种表述的写法。
