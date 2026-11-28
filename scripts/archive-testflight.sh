#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 探记 HG · 纯原生 iOS 版 —— TestFlight 归档
#
# 与混合版 scripts/archive-testflight.sh 的区别:
#   混合版用 Capacitor 生成的 ios/App/App.xcodeproj(需先 npm run sync);
#   本工程用 xcodegen 生成的 ios/TanjiNative/TanjiNative.xcodeproj,
#   且 project.yml 是正本(.xcodeproj 不入库),故脚本先跑 xcodegen generate。
#
# 用法:
#   DEVELOPMENT_TEAM=<10位TeamID> npm run archive:testflight
#   MARKETING_VERSION=1.0.0 BUILD_NUMBER=20261128.201000 npm run archive:testflight
#
# 可选环境变量:
#   DEVELOPMENT_TEAM   10 位 Team ID(必填)。不写进仓库,从 Xcode → Settings → Accounts 查。
#   MARKETING_VERSION  三段式版本号,默认 1.0.0
#   BUILD_NUMBER       一至三段整数,默认取 Asia/Shanghai 的 YYYYMMDD.HHMMSS
#   OUTPUT_DIR         归档输出目录,默认 build/testflight/TanjiNative-<version>-<build>
#   SKIP_TESTS=1       跳过 npm test / 单元与 UI 测试(正式对外构建不要跳过)
#   SKIP_GENERATE=1    跳过 xcodegen generate(改了 project.yml 就别跳)
#
# 注意:本脚本不做任何签名证书创建与账号配置,那些必须在 Xcode / App Store Connect 后台完成。
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

TEAM="${DEVELOPMENT_TEAM:-}"
VERSION="${MARKETING_VERSION:-1.0.0}"
BUILD="${BUILD_NUMBER:-$(TZ=Asia/Shanghai date +%Y%m%d.%H%M%S)}"
BUNDLE="${BUNDLE_ID:-com.ord.tanji}"
OUT="${OUTPUT_DIR:-build/testflight/TanjiNative-$VERSION-$BUILD}"
ARCHIVE="$OUT/TanjiNative.xcarchive"
EXPORT_DIR="$OUT/ipa"
PLIST="$OUT/ExportOptions.plist"
PROJECT="ios/TanjiNative/TanjiNative.xcodeproj"

if [[ -z "$TEAM" ]]; then
  printf '缺少 DEVELOPMENT_TEAM。请在 Xcode Settings → Accounts 查看付费开发者团队的 10 位 Team ID，然后通过环境变量传入；不要把 Team ID 写进仓库。\n' >&2
  exit 1
fi
if [[ ! "$TEAM" =~ ^[A-Z0-9]{10}$ ]]; then
  printf 'DEVELOPMENT_TEAM 应为 10 位大写字母/数字。\n' >&2
  exit 1
fi
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf 'MARKETING_VERSION 必须为三段式版本号，例如 1.0.0。\n' >&2
  exit 1
fi
if [[ ! "$BUILD" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]]; then
  printf 'BUILD_NUMBER 必须为一至三段整数，建议使用 YYYYMMDD.HHMMSS。\n' >&2
  exit 1
fi
if [[ -e "$ARCHIVE" ]]; then
  printf '归档已存在：%s\n请换一个新的 BUILD_NUMBER，避免覆盖。\n' "$ARCHIVE" >&2
  exit 1
fi
command -v xcodegen >/dev/null 2>&1 || {
  printf '未找到 xcodegen。安装：brew install xcodegen\n' >&2
  exit 1
}

mkdir -p "$OUT"
printf '探记 HG TestFlight 归档\n  Bundle ID: %s\n  Version: %s\n  Build: %s\n  Output: %s\n' "$BUNDLE" "$VERSION" "$BUILD" "$OUT"

if [[ "${SKIP_TESTS:-0}" != "1" ]]; then
  npm test
  npm run ios:test
fi

printf '\n==> 生成 Xcode 工程（project.yml 是正本，.xcodeproj 不入库）\n'
if [[ "${SKIP_GENERATE:-0}" != "1" ]]; then
  xcodegen generate --spec ios/TanjiNative/project.yml
fi

printf '\n==> Xcode Archive（Apple Distribution）\n'
# 本机 macOS 27 的 sandbox-exec 不可用，SwiftUI 宏展开需要关掉沙箱。
# 与 scripts/install-device-ios.sh 保持一致，否则归档会在宏展开阶段失败。
if ! xcodebuild \
  -project "$PROJECT" \
  -scheme TanjiNative \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM" \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE" \
  MARKETING_VERSION="$VERSION" \
  CURRENT_PROJECT_VERSION="$BUILD" \
  CODE_SIGN_STYLE=Automatic \
  # 不覆盖 CODE_SIGN_IDENTITY：自动签名模式下手动指定 identity 会与
  # Xcode 的自动签名冲突（报 "conflicting provisioning settings"）。
  # Release 归档时 Xcode 自动选用 Apple Distribution 证书。
  ENABLE_DEBUG_DYLIB=NO \
  OTHER_SWIFT_FLAGS='$(inherited) -Xfrontend -disable-sandbox' \
  archive >"$OUT/archive.log" 2>&1; then
  printf 'Archive 失败，日志末尾：\n' >&2
  tail -80 "$OUT/archive.log" >&2
  exit 1
fi

APP_PATH="$ARCHIVE/Products/Applications/TanjiNative.app"
[[ -d "$APP_PATH" ]] || { printf '归档中缺少 TanjiNative.app。\n' >&2; exit 1; }
PLISTBUDDY=/usr/libexec/PlistBuddy
read_plist() { "$PLISTBUDDY" -c "Print :$1" "$2"; }

actual_bundle="$(read_plist CFBundleIdentifier "$APP_PATH/Info.plist")"
actual_version="$(read_plist CFBundleShortVersionString "$APP_PATH/Info.plist")"
actual_build="$(read_plist CFBundleVersion "$APP_PATH/Info.plist")"
[[ "$actual_bundle" == "$BUNDLE" ]] || { printf '归档 Bundle ID 不符：%s\n' "$actual_bundle" >&2; exit 1; }
[[ "$actual_version" == "$VERSION" ]] || { printf '归档版本号不符：%s\n' "$actual_version" >&2; exit 1; }
[[ "$actual_build" == "$BUILD" ]] || { printf '归档构建号不符：%s\n' "$actual_build" >&2; exit 1; }

# 隐私清单缺失会被 App Store Connect 直接拒收（ITMS-91053），必须在导出前拦。
[[ -f "$APP_PATH/PrivacyInfo.xcprivacy" ]] || { printf '归档缺少 PrivacyInfo.xcprivacy。\n' >&2; exit 1; }
plutil -extract NSPrivacyAccessedAPICategoryUserDefaults raw "$APP_PATH/PrivacyInfo.xcprivacy" >/dev/null 2>&1 || {
  printf '隐私清单未声明 NSPrivacyAccessedAPICategoryUserDefaults。\n' >&2
  exit 1
}
# 二进制若引用了 NSUserDefaults 而清单里没有 UserDefaults 类别，上传必被拒。
if nm -u "$APP_PATH/TanjiNative" 2>/dev/null | grep -q 'NSUserDefaults'; then
  printf '已校验：二进制引用 NSUserDefaults，隐私清单已声明该类别。\n'
fi

codesign --verify --deep --strict "$APP_PATH"
security cms -D -i "$APP_PATH/embedded.mobileprovision" >"$OUT/provisioning.plist"
profile_team="$("$PLISTBUDDY" -c 'Print :TeamIdentifier:0' "$OUT/provisioning.plist")"
profile_name="$("$PLISTBUDDY" -c 'Print :Name' "$OUT/provisioning.plist")"
get_task_allow="$("$PLISTBUDDY" -c 'Print :Entitlements:get-task-allow' "$OUT/provisioning.plist")"
[[ "$profile_team" == "$TEAM" ]] || { printf '描述文件团队不符：%s\n' "$profile_team" >&2; exit 1; }
[[ "$get_task_allow" == "false" ]] || { printf '归档使用了开发描述文件，不能用于 TestFlight。\n' >&2; exit 1; }
printf '签名校验通过：%s（Team %s）\n' "$profile_name" "$profile_team"

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>$TEAM</string>
  <key>uploadSymbols</key><true/>
  <key>stripSwiftSymbols</key><true/>
</dict>
</plist>
EOF
plutil -lint "$PLIST"

printf '\n==> 导出 App Store / TestFlight IPA\n'
if ! xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$PLIST" \
  >"$OUT/export.log" 2>&1; then
  printf 'IPA 导出失败，日志末尾：\n' >&2
  tail -80 "$OUT/export.log" >&2
  exit 1
fi

IPA="$(find "$EXPORT_DIR" -maxdepth 1 -type f -name '*.ipa' -print -quit)"
[[ -n "$IPA" ]] || { printf '导出目录中没有 IPA。\n' >&2; exit 1; }
unzip -p "$IPA" Payload/TanjiNative.app/Info.plist >"$OUT/ipa-Info.plist"
[[ "$(read_plist CFBundleIdentifier "$OUT/ipa-Info.plist")" == "$BUNDLE" ]]
[[ "$(read_plist CFBundleShortVersionString "$OUT/ipa-Info.plist")" == "$VERSION" ]]
[[ "$(read_plist CFBundleVersion "$OUT/ipa-Info.plist")" == "$BUILD" ]]
unzip -l "$IPA" | grep -q 'Payload/TanjiNative.app/PrivacyInfo.xcprivacy' || {
  printf 'IPA 内缺少 PrivacyInfo.xcprivacy。\n' >&2
  exit 1
}
shasum -a 256 "$IPA" >"$OUT/SHA256SUMS.txt"

printf '\n完成：%s\n归档：%s\nSHA-256：%s\n' "$IPA" "$ARCHIVE" "$(cut -d' ' -f1 "$OUT/SHA256SUMS.txt")"
printf '下一步先运行 npm run testflight:ready，再用 npm run upload:testflight -- %q 上传。\n' "$IPA"
