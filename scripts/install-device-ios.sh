#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 探记 HG · 纯原生 iOS 版真机安装
#
# 与混合版的 scripts/build-device.sh 的区别:
#   混合版走 Xcode 自动签名(-allowProvisioningUpdates),需要 Xcode 登录账号;
#   本工程在「Xcode 未登录开发者账号」时也能装 —— 复用本机已有的
#   provisioning profile + 开发证书,手工 codesign 后用 devicectl 安装。
#
# 用法:
#   ./scripts/install-device-ios.sh                      # 自动挑第一台已连接的真机
#   DEVICE_UDID=00008130-... ./scripts/install-device-ios.sh
#   PROFILE_UUID=e454e5ef-... ./scripts/install-device-ios.sh
#
# 可选环境变量:
#   DEVICE_UDID        目标设备 UDID;缺省自动挑选第一台 available 的真机
#   PROFILE_UUID       使用的 provisioning profile UUID;缺省自动挑一个
#                      覆盖目标设备、且已过期的通配符 profile
#   SIGNING_IDENTITY   代码签名身份;缺省自动挑本机第一个 Apple Development 身份
#   TEAM_ID            团队 ID;缺省从 profile 的 TeamIdentifier 取
#   BUNDLE_ID          bundle id;缺省用工程里的 com.ord.tanji.app
#   CONFIGURATION      Debug(默认) / Release
#
# 注意:
#   覆盖安装保留沙盒数据;卸载会删除沙盒数据(会丢本地记账),升级时不要卸载。
#   Debug 构建必须带 ENABLE_DEBUG_DYLIB=NO —— 否则真机会因内层
#   TanjiNative.debug.dylib 未签名而 dyld 启动失败。
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

CONFIG="${CONFIGURATION:-Debug}"
BUNDLE="${BUNDLE_ID:-com.ord.tanji.app}"

# ---------------------------------------------------------------- 设备选择
DEVICE="${DEVICE_UDID:-}"
if [[ -z "$DEVICE" ]]; then
  DEVICE=$(xcrun devicectl list devices --json-output /tmp/tanji_devices.json >/dev/null 2>&1 \
    && node -e '
      const j = require("/tmp/tanji_devices.json");
      const devs = (j.result.devices || []);
      // 只要真机:reality === "physical";模拟器 reality === "simulated"
      // 注意要取 hardwareProperties.udid(硬件 UDID,形如 00008130-xxxx),
      // 而不是顶层的 identifier(CoreDevice UUID)——后者在 provisioning
      // profile 的 ProvisionedDevices 里对不上。
      const phys = devs.filter(d => d.hardwareProperties.reality === "physical");
      const pick = phys.find(d => d.connectionProperties.tunnelState === "connected")
                || phys.find(d => d.connectionProperties.pairingState === "paired");
      if (pick) console.log(pick.hardwareProperties.udid);
    ' || true)
  if [[ -z "$DEVICE" ]]; then
    cat >&2 <<'EOF'
找不到已连接的真机。请用数据线连上 Mac、解锁并在手机上点「信任」,然后重试。
手动指定:DEVICE_UDID=<UDID> ./scripts/install-device-ios.sh
UDID 可从 xcrun devicectl list devices 里查。
EOF
    exit 1
  fi
fi
echo "==> 目标设备:$DEVICE"

# ---------------------------------------------------------------- 签名身份
IDENTITY="${SIGNING_IDENTITY:-}"
if [[ -z "$IDENTITY" ]]; then
  IDENTITY=$(security find-identity -v -p codesigning \
    | grep 'Apple Development' | head -1 | sed -E 's/^ *[0-9]+\) [0-9A-F]+ "//; s/"$//')
  if [[ -z "$IDENTITY" ]]; then
    echo "找不到可用的 Apple Development 签名身份。" >&2
    echo "在 Xcode → Settings → Accounts 登录账号,或先跑一次真机构建让 Xcode 签发证书。" >&2
    exit 1
  fi
fi
echo "==> 签名身份:$IDENTITY"

# ---------------------------------------------------------------- profile
PROFILE_DIR="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
PROFILE="${PROFILE_UUID:-}"
if [[ -z "$PROFILE" ]]; then
  PROFILE=$(for f in "$PROFILE_DIR"/*.mobileprovision; do
      [[ -e "$f" ]] || continue
      uuid=$(security cms -D -i "$f" 2>/dev/null | plutil -extract UUID raw -o - - 2>/dev/null) || continue
      devs=$(security cms -D -i "$f" 2>/dev/null | plutil -extract ProvisionedDevices json -o - - 2>/dev/null) || continue
      # 过期时间用 epoch 比较,不用字符串比年份
      # 注意 plutil -extract raw 输出的是 ISO8601(2027-11-26T13:18:47Z),
      # 不是 plutil -p 里的显示格式,两种格式要分开处理。
      exp=$(security cms -D -i "$f" 2>/dev/null | plutil -extract ExpirationDate raw -o - - 2>/dev/null) || continue
      exp_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$exp" +%s 2>/dev/null) || continue
      now_epoch=$(date +%s)
      app_id=$(security cms -D -i "$f" 2>/dev/null | plutil -extract Entitlements.application-identifier raw -o - - 2>/dev/null) || continue
      # 要求:覆盖本机 + 覆盖目标设备 + 未过期 + 是通配符(能签任意 bundle id)
      if [[ "$devs" == *"$DEVICE"* ]] && (( exp_epoch > now_epoch )) && [[ "$app_id" == *'*' ]]; then
        echo "$uuid"
        break
      fi
    done)
  if [[ -z "$PROFILE" ]]; then
    echo "找不到覆盖设备 $DEVICE 的可用 provisioning profile。" >&2
    echo "请在 Xcode → Settings → Accounts 登录账号,让 Xcode 为这台设备签发 profile。" >&2
    exit 1
  fi
fi
PROFILE_FILE="$PROFILE_DIR/$PROFILE.mobileprovision"
if [[ ! -f "$PROFILE_FILE" ]]; then
  PROFILE_FILE="$HOME/Library/MobileDevice/Provisioning Profiles/$PROFILE.mobileprovision"
fi
if [[ ! -f "$PROFILE_FILE" ]]; then
  echo "找不到 profile 文件:$PROFILE" >&2
  exit 1
fi
echo "==> provisioning profile:$PROFILE"

PROFILE_PLIST=/tmp/tanji_profile.plist
security cms -D -i "$PROFILE_FILE" > "$PROFILE_PLIST" 2>/dev/null
TEAM_ID="${TEAM_ID:-$(plutil -extract TeamIdentifier.0 raw -o - "$PROFILE_PLIST")}"

# ---------------------------------------------------------------- 构建
echo "==> 构建($CONFIG · bundle id = $BUNDLE)"
# ENABLE_DEBUG_DYLIB=NO 必须:Debug 默认把代码拆进 TanjiNative.debug.dylib,
# 手工签名签不到内层 dylib,真机会 dyld 报错启动失败。
xcodebuild -project ios/TanjiNative/TanjiNative.xcodeproj -scheme TanjiNative \
  -configuration "$CONFIG" -sdk iphoneos -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY='' \
  ENABLE_DEBUG_DYLIB=NO \
  OTHER_SWIFT_FLAGS='$(inherited) -Xfrontend -disable-sandbox' \
  build >/tmp/tanji-ios-device-build.log 2>&1 \
  || { echo "构建失败,日志末尾:" >&2; tail -30 /tmp/tanji-ios-device-build.log >&2; exit 1; }

APP=$(xcodebuild -project ios/TanjiNative/TanjiNative.xcodeproj -scheme TanjiNative \
  -configuration "$CONFIG" -sdk iphoneos -showBuildSettings 2>/dev/null \
  | awk -F' = ' '/^ *BUILT_PRODUCTS_DIR =/{d=$2} /^ *FULL_PRODUCT_NAME =/{n=$2} END{if(d&&n)print d"/"n}')
if [[ -z "$APP" || ! -d "$APP" ]]; then
  echo "找不到构建产物(.app),请看 /tmp/tanji-ios-device-build.log" >&2
  exit 1
fi
echo "==> 产物:$APP"

# ---------------------------------------------------------------- 手工签名
ENTITLEMENTS=/tmp/tanji_entitlements.plist
cat > "$ENTITLEMENTS" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>application-identifier</key>
	<string>${TEAM_ID}.${BUNDLE}</string>
	<key>com.apple.developer.team-identifier</key>
	<string>${TEAM_ID}</string>
	<key>get-task-allow</key>
	<true/>
	<key>keychain-access-groups</key>
	<array>
		<string>${TEAM_ID}.${BUNDLE}</string>
		<string>com.apple.token</string>
	</array>
</dict>
</plist>
EOF

echo "==> 手工签名(Xcode 未登录账号时走这条路)"
rm -rf "$APP/_CodeSignature"
cp "$PROFILE_FILE" "$APP/embedded.mobileprovision"
codesign --force --sign "$IDENTITY" --entitlements "$ENTITLEMENTS" "$APP"
codesign --verify --deep --strict "$APP"

# ---------------------------------------------------------------- 安装启动
echo "==> 安装到设备 $DEVICE"
xcrun devicectl device install app --device "$DEVICE" "$APP"

echo "==> 启动"
xcrun devicectl device process launch --device "$DEVICE" --terminate-existing "$BUNDLE" || \
  echo "自动启动失败,手动点桌面的「探记 HG」图标即可"

cat <<EOF

完成。桌面图标为「探记 HG」。
- 覆盖安装会保留沙盒数据;卸载会删除沙盒数据(会丢本地记账),升级时不要卸载。
- 签名有效期取决于 profile:$(plutil -extract ExpirationDate raw -o - "$PROFILE_PLIST")
EOF
