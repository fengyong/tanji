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
# NSPrivacyAccessedAPICategoryUserDefaults 是数组元素内部的键，plutil -extract 取不到，
# 转 json 后精确匹配（避免子串误命中）。
if plutil -convert json -o - "$PRIVACY" 2>/dev/null \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("yes" if any(t.get("NSPrivacyAccessedAPIType")=="NSPrivacyAccessedAPICategoryUserDefaults" for t in d.get("NSPrivacyAccessedAPITypes",[])) else "no")' 2>/dev/null \
  | grep -q 'yes'; then
  pass '隐私清单已声明 UserDefaults / CA92.1'
else
  fail '隐私清单未声明 NSPrivacyAccessedAPICategoryUserDefaults'
fi
# 数据收集必须为空数组。用 json 转换后精确判断，避免 raw 输出格式差异导致漏判。
privacy_json="$(plutil -convert json -o - "$PRIVACY" 2>/dev/null || echo '{}')"
collected="$(printf '%s' "$privacy_json" | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("NSPrivacyCollectedDataTypes", [])))' 2>/dev/null || echo -1)"
if [[ "$collected" == "0" ]]; then
  pass '隐私清单未声明任何数据收集'
else
  fail "隐私清单声明了 ${collected} 项数据收集，与「不收集数据」口径冲突"
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

# ---------------------------------------------------------------- 分发描述文件
# 只有 get-task-allow=false 的 App Store profile 才能用于 TestFlight。
# 本机可能存在多个开发 profile（com.tanji.app / site.zai.aifishing / *），
# 必须精确匹配 com.ord.tanji.app，否则会误判成已就绪。
PROFILE_DIR="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
BUNDLE="${BUNDLE_ID:-com.ord.tanji.app}"
dist_profile=''
dist_profile_name=''
if [[ -d "$PROFILE_DIR" ]]; then
  for f in "$PROFILE_DIR"/*.mobileprovision; do
    [[ -f "$f" ]] || continue
    tmp_plist="$(mktemp -d)"
    if security cms -D -i "$f" >"$tmp_plist/p.plist" 2>/dev/null; then
      app_id="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$tmp_plist/p.plist" 2>/dev/null || true)"
      gta="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:get-task-allow' "$tmp_plist/p.plist" 2>/dev/null || true)"
      if [[ "$app_id" == *".$BUNDLE" && "$gta" == "false" ]]; then
        dist_profile="$f"
        dist_profile_name="$(/usr/libexec/PlistBuddy -c 'Print :Name' "$tmp_plist/p.plist" 2>/dev/null || true)"
        break
      fi
    fi
    rm -rf "$tmp_plist"
  done
fi
if [[ -n "$dist_profile" ]]; then
  pass "存在 $BUNDLE 的 App Store 分发描述文件"
else
  fail "缺少 $BUNDLE 的 App Store 分发描述文件（get-task-allow=false）；需在 Xcode 登录账号让自动签名拉取，或在开发者后台手动创建，步骤见 docs/testflight-release-runbook.md §2.8"
fi

# ---------------------------------------------------------------- Xcode 登录态
# 账号只显示在 Accounts 面板 ≠ 登录生效。真正生效的判据是
# DVTDeveloperAccountManagerAppleIDLists 里的账号数组非空。
# 结构：{ "IDE.Identifiers.Prod" => [ ...账号... ] }，空数组即未登录。
#
# 注意：这个 plist 用 plutil -convert json 会报
# "Invalid object in plist for JSON format"，必须用 plistlib 读。
xcode_accounts="$(python3 -c "
import plistlib
with open('$HOME/Library/Preferences/com.apple.dt.Xcode.plist','rb') as f:
    d = plistlib.load(f)
print(len(d.get('DVTDeveloperAccountManagerAppleIDLists',{}).get('IDE.Identifiers.Prod',[])))
" 2>/dev/null || echo 0)"
if [[ "$xcode_accounts" =~ ^[0-9]+$ ]] && [[ "$xcode_accounts" -gt 0 ]]; then
  pass 'Xcode 已完成开发者身份登录'
elif [[ -n "$dist_profile" ]]; then
  # 已装好 App Store 分发描述文件时，走手动签名路线（脚本传
  # PROVISIONING_PROFILE_SPECIFIER），不需要 Xcode 登录。
  printf '! Xcode 未完成开发者身份登录，但已装好分发描述文件，可走手动签名路线：\n'
  printf '  PROVISIONING_PROFILE_SPECIFIER="%s" DEVELOPMENT_TEAM=%s npm run archive:testflight\n' \
    "$dist_profile_name" "${DEVELOPMENT_TEAM:-YC9UFHH73D}"
else
  fail 'Xcode 未完成开发者身份登录（Accounts 面板显示账号不算，实际账号数组为空）；自动签名因此无法拉取分发描述文件，步骤见 docs/testflight-release-runbook.md §2.8'
fi

# ---------------------------------------------------------------- 上传凭据
# 凭据不入库：Key ID / Issuer ID 记录在 testflight/app-store-connect.json，
# 私钥放在仓库外的 ~/.config/tanji/。这里只校验「是否就绪」，不读取密钥内容。
ASC_ENV="${ASC_ENV:-$HOME/.config/tanji/asc.env}"
if [[ -n "${ASC_API_KEY:-}" && -n "${ASC_API_ISSUER:-}" && -n "${ASC_PRIVATE_KEY_PATH:-}" ]]; then
  if [[ -f "$ASC_PRIVATE_KEY_PATH" ]]; then
    pass '上传凭据已通过环境变量注入'
  else
    fail "找不到私钥文件：$ASC_PRIVATE_KEY_PATH"
  fi
elif [[ -f "$ASC_ENV" ]]; then
  # 只验证文件里三个变量都有值，不 source（避免执行任意内容）
  if grep -q '^export ASC_API_KEY=' "$ASC_ENV" \
     && grep -q '^export ASC_API_ISSUER=' "$ASC_ENV" \
     && grep -q '^export ASC_PRIVATE_KEY_PATH=' "$ASC_ENV"; then
    pass "上传凭据已就绪（${ASC_ENV}）"
    printf '  上传时先执行：source %s\n' "$ASC_ENV"
  else
    fail "${ASC_ENV} 缺少必要的变量定义"
  fi
else
  fail "缺少上传凭据；创建 App Store Connect API Key 并放到 ${ASC_ENV}，步骤见 docs/testflight-release-runbook.md 步骤 5"
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
