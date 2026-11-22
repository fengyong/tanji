#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 探记 TanJi · 真机安装(免费 Apple ID / 个人团队)
#
# 免费签名的两个事实:
#   1. 证书 7 天有效,到期后 App 打不开 —— 重跑本脚本覆盖安装即可,沙盒数据保留;
#      千万别卸载再装(卸载 = 删沙盒 = 丢账)。
#   2. 不需要任何付费能力:本项目没有 entitlements / APNs / App Groups,
#      本地通知(LocalNotifications)、SQLite、相机、定位在免费签名下都可用。
#
# 用法:
#   DEVELOPMENT_TEAM=XXXXXXXXXX DEVICE_UDID=<手机UDID> ./scripts/build-device.sh
#
# 可选环境变量:
#   BUNDLE_ID=com.olatanji.app   覆盖 bundle id(不动工程文件,只在构建时替换)
#   CONFIGURATION=Release        默认 Debug
#   SKIP_SYNC=1                  跳过 npm run sync(www 已同步时)
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

TEAM="${DEVELOPMENT_TEAM:-}"
BUNDLE="${BUNDLE_ID:-com.olatanji.app}"
CONFIG="${CONFIGURATION:-Debug}"
DEVICE="${DEVICE_UDID:-}"

if [[ -z "$TEAM" ]]; then
  cat >&2 <<'EOF'
缺少 DEVELOPMENT_TEAM。

取法:Xcode → Settings → Accounts → 选中你的 Apple ID → 右侧 Team 列表里的 ID
     (形如 A1B2C3D4E5 的 10 位串,个人团队的名字通常显示为 "Personal Team")

然后:DEVELOPMENT_TEAM=你的TeamID DEVICE_UDID=手机UDID ./scripts/build-device.sh
EOF
  exit 1
fi

if [[ -z "$DEVICE" ]]; then
  cat >&2 <<'EOF'
缺少 DEVICE_UDID。手机用 USB 连上 Mac、解锁并点「信任」后,从下面的列表里取 Identifier:
EOF
  xcrun devicectl list devices >&2 || true
  echo "" >&2
  echo "再执行:DEVELOPMENT_TEAM=$TEAM DEVICE_UDID=<上面那串> ./scripts/build-device.sh" >&2
  exit 1
fi

echo "==> 同步 Web 资源到 iOS 工程"
if [[ "${SKIP_SYNC:-0}" != "1" ]]; then
  npm run sync >/dev/null
fi

echo "==> 构建($CONFIG · bundle id = $BUNDLE)"
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration "$CONFIG" -sdk iphoneos -destination 'generic/platform=iOS' \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM" PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE" \
  build >/tmp/tanji-device-build.log 2>&1 \
  || { echo "构建失败,日志末尾:" >&2; tail -30 /tmp/tanji-device-build.log >&2; exit 1; }

APP=$(xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration "$CONFIG" \
  -sdk iphoneos -showBuildSettings 2>/dev/null \
  | awk -F' = ' '/^ *BUILT_PRODUCTS_DIR =/{d=$2} /^ *FULL_PRODUCT_NAME =/{n=$2} END{if(d&&n)print d"/"n}')

if [[ -z "$APP" || ! -d "$APP" ]]; then
  echo "找不到构建产物(.app),请看 /tmp/tanji-device-build.log" >&2
  exit 1
fi
echo "==> 产物:$APP"

echo "==> 安装到设备 $DEVICE"
xcrun devicectl device install app --device "$DEVICE" "$APP"

echo "==> 启动"
xcrun devicectl device process launch --device "$DEVICE" "$BUNDLE" || \
  echo "自动启动失败,手动点桌面的「探记」图标即可"

cat <<EOF

完成。两件事记住:
  1. 首次启动若提示「不受信任的开发者」:iPhone → 设置 → 通用 → VPN与设备管理 → 信任你的证书
  2. **7 天后** App 会打不开:重跑本脚本覆盖安装即可,数据保留;不要卸载
EOF
