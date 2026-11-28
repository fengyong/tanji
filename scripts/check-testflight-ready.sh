#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 探记 HG · 纯原生 iOS 版 —— TestFlight 上传前就绪检查
#
# 覆盖本地可自动核查的阻断项 + 公网法律页可达性。
# 账号侧的事项（Distribution 证书、ASC App 记录、Paid Apps Agreement、
# 银行与税务信息）无法自动核查，见 docs/appstore-release-checklist.md。
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

FAILED=0
fail() { printf '✗ %s\n' "$1" >&2; FAILED=1; }
pass() { printf '✓ %s\n' "$1"; }

# ---------------------------------------------------------------- 隐私清单
PRIVACY=ios/TanjiNative/Resources/PrivacyInfo.xcprivacy
if [[ -f "$PRIVACY" ]] && plutil -lint "$PRIVACY" >/dev/null; then
  pass '隐私清单可解析'
else
  fail '隐私清单缺失或不可解析（上传会被 ITMS-91053 拒收）'
fi
if [[ "$(plutil -extract NSPrivacyTracking raw "$PRIVACY" 2>/dev/null || true)" == "false" ]]; then
  pass '隐私清单声明不追踪'
else
  fail '隐私清单未声明 NSPrivacyTracking=false'
fi
# UserDefaults 是本工程实际命中的受限 API，缺失即拒收。
# plutil -extract 取不到 NSPrivacyAccessedAPITypes 数组里的子键，改用 json 转换后读。
if plutil -convert json -o - "$PRIVACY" 2>/dev/null | grep -q 'NSPrivacyAccessedAPICategoryUserDefaults'; then
  pass '隐私清单已声明 UserDefaults / CA92.1'
else
  fail '隐私清单未声明 NSPrivacyAccessedAPICategoryUserDefaults'
fi
if plutil -extract NSPrivacyCollectedDataTypes raw "$PRIVACY" 2>/dev/null | grep -q 'dict'; then
  fail '隐私清单声明了数据收集，与「不收集数据」口径冲突'
else
  pass '隐私清单未声明任何数据收集'
fi

# ---------------------------------------------------------------- 图标
ICON=ios/TanjiNative/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
if [[ -f "$ICON" ]]; then
  icon_info="$(sips -g pixelWidth -g pixelHeight -g hasAlpha "$ICON" 2>/dev/null || true)"
  if [[ "$icon_info" == *'pixelWidth: 1024'* && "$icon_info" == *'pixelHeight: 1024'* && "$icon_info" == *'hasAlpha: no'* ]]; then
    pass 'App 图标为 1024×1024 且无 alpha'
  else
    fail 'App 图标不是 1024×1024 无 alpha PNG（App Store 会拒收）'
  fi
else
  fail '缺少 App Store 图标'
fi

# ---------------------------------------------------------------- 签名证书
if security find-identity -v -p codesigning 2>/dev/null | grep -q 'Apple Distribution'; then
  pass '本机存在 Apple Distribution 证书'
else
  fail '本机缺少 Apple Distribution 证书；请在 Xcode Settings → Accounts → Manage Certificates 创建'
fi

# ---------------------------------------------------------------- 公网法律页
LEGAL_BASE="${LEGAL_BASE:-https://tanji-app-guvc.zai.site}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
check_page() {
  local name="$1" marker="$2" status
  status="$(curl --silent --show-error --location --max-time 20 --output "$TMP/$name.html" --write-out '%{http_code}' "$LEGAL_BASE/$name.html" || true)"
  if [[ "$status" != "200" ]]; then
    fail "$name.html 公网不可访问（HTTP ${status}）：$LEGAL_BASE/$name.html"
  elif ! grep -q "$marker" "$TMP/$name.html"; then
    fail "$name.html 返回内容不是探记页面"
  else
    pass "$name.html 公网可访问"
  fi
}
check_page privacy '隐私政策'
check_page support '支持'

if [[ "$FAILED" != "0" ]]; then
  printf '\nTestFlight 就绪检查未通过；解决以上阻断项后再上传。\n' >&2
  exit 1
fi
printf '\nTestFlight 本地与公网就绪检查通过。\n'
