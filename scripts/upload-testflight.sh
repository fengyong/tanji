#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 探记 HG · 纯原生 iOS 版 —— 上传构建到 TestFlight
#
# 用法:
#   npm run upload:testflight -- <IPA 路径>
#
# 认证二选一（均通过环境变量，不入库）：
#   App Store Connect API Key：ASC_API_KEY、ASC_API_ISSUER、ASC_PRIVATE_KEY_PATH
#   Apple ID：ASC_APPLE_ID、ASC_APP_SPECIFIC_PASSWORD（App 专用密码，不是登录密码）
#
# 说明：Apple 官方当前仍列出 altool 作为上传方式（xcrun altool --upload-app）。
# 若 altool 未来被移除，替代路径是 Transporter CLI 或 App Store Connect 的
# Build Uploads API，本脚本只需替换上传那一段调用。
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

BUNDLE="${BUNDLE_ID:-com.ord.tanji.app}"

if [[ $# -ne 1 ]]; then
  printf '用法：npm run upload:testflight -- <IPA 路径>\n\n认证二选一（均通过环境变量，不入库）：\n  App Store Connect API Key：ASC_API_KEY、ASC_API_ISSUER、ASC_PRIVATE_KEY_PATH\n  Apple ID：ASC_APPLE_ID、ASC_APP_SPECIFIC_PASSWORD\n' >&2
  exit 2
fi
IPA="$1"
[[ -f "$IPA" ]] || { printf '找不到 IPA：%s\n' "$IPA" >&2; exit 1; }

if [[ "${SKIP_READY_CHECK:-0}" != "1" ]]; then
  npm run testflight:ready
fi

AUTH=()
if [[ -n "${ASC_API_KEY:-}" || -n "${ASC_API_ISSUER:-}" || -n "${ASC_PRIVATE_KEY_PATH:-}" ]]; then
  [[ -n "${ASC_API_KEY}" && -n "${ASC_API_ISSUER}" && -n "${ASC_PRIVATE_KEY_PATH}" ]] || {
    printf 'API Key 认证需要同时提供 ASC_API_KEY、ASC_API_ISSUER、ASC_PRIVATE_KEY_PATH。\n' >&2
    exit 1
  }
  [[ -f "$ASC_PRIVATE_KEY_PATH" ]] || { printf '找不到 .p8 私钥：%s\n' "$ASC_PRIVATE_KEY_PATH" >&2; exit 1; }
  AUTH=(--api-key "$ASC_API_KEY" --api-issuer "$ASC_API_ISSUER" --p8-file-path "$ASC_PRIVATE_KEY_PATH")
elif [[ -n "${ASC_APPLE_ID:-}" || -n "${ASC_APP_SPECIFIC_PASSWORD:-}" ]]; then
  [[ -n "${ASC_APPLE_ID}" && -n "${ASC_APP_SPECIFIC_PASSWORD}" ]] || {
    printf 'Apple ID 认证需要同时提供 ASC_APPLE_ID、ASC_APP_SPECIFIC_PASSWORD。\n' >&2
    exit 1
  }
  AUTH=(--username "$ASC_APPLE_ID" --password @env:ASC_APP_SPECIFIC_PASSWORD)
else
  printf '缺少上传认证。推荐使用 App Store Connect API Key；不要使用 Apple ID 登录密码。\n' >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
unzip -p "$IPA" Payload/TanjiNative.app/Info.plist >"$TMP/Info.plist"
IPA_BUNDLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$TMP/Info.plist")"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$TMP/Info.plist")"
BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$TMP/Info.plist")"
[[ "$IPA_BUNDLE" == "$BUNDLE" ]] || { printf 'IPA Bundle ID 不符：%s\n' "$IPA_BUNDLE" >&2; exit 1; }
printf '上传构建：%s · %s (%s)\n' "$IPA_BUNDLE" "$VERSION" "$BUILD"

printf '\n==> 验证构建\n'
xcrun altool --validate-app -f "$IPA" "${AUTH[@]}" --output-format normal
printf '\n==> 上传构建\n'
xcrun altool --upload-app -f "$IPA" "${AUTH[@]}" --output-format normal

printf '\n上传请求已提交。请在 App Store Connect → App Store Connect Users and Access / 活动 中等待「处理完成」。\n'
printf '处理完成后仍需：指定测试构建 → 添加唯一外部测试者 → 如首次外部测试则提交 Beta Review → 发送邮件邀请。\n'
