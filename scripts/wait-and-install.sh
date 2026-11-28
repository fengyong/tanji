#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 探记 · 纯原生 iOS 版 —— 等待设备上线并自动装机
#
# 用法:
#   ./scripts/wait-and-install.sh                      # 等第一台连上的真机
#   DEVICE_UDID=00008150-... ./scripts/wait-and-install.sh   # 等指定设备
#   TIMEOUT=600 ./scripts/wait-and-install.sh          # 最长等 10 分钟（默认）
#
# 为什么需要这个脚本:
#   手机「用户侧说已插上线」和「Mac 真能访问到」是两件事。
#   devicectl 只有在 tunnelState == connected 时才装得上，
#   否则报 error 4016。本脚本轮询到 connected 就立刻装。
#
# 判定命令:
#   xcrun devicectl list devices --json-output <file>
#   看 hardwareProperties.reality == "physical" 且
#      connectionProperties.tunnelState == "connected"
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

DEVICE="${DEVICE_UDID:-}"
TIMEOUT="${TIMEOUT:-600}"
INTERVAL="${INTERVAL:-5}"
APP_PATH="${APP_PATH:-build/device-install/TanjiNative.app}"
BUNDLE="${BUNDLE_ID:-com.ord.tanji.app}"

if [[ ! -d "$APP_PATH" ]]; then
  printf '找不到安装包：%s\n先跑一次：\n  DEVICE_UDID=<udid> PROFILE_UUID=e454e5ef-5327-49aa-9dbc-84d36f628787 CONFIGURATION=Release bash scripts/install-device-ios.sh\n' "$APP_PATH" >&2
  exit 1
fi

deadline=$(( $(date +%s) + TIMEOUT ))
printf '等待设备上线（最长 %d 秒）…\n' "$TIMEOUT"

while (( $(date +%s) < deadline )); do
  xcrun devicectl list devices --json-output /tmp/tanji_wait_devices.json >/dev/null 2>&1 || true
  target=$(WANT_UDID="$DEVICE" node -e '
    const fs = require("fs");
    let j;
    try { j = JSON.parse(fs.readFileSync("/tmp/tanji_wait_devices.json", "utf8")); } catch { process.exit(0); }
    const want = process.env.WANT_UDID;
    const phys = (j.result.devices || []).filter(d => d.hardwareProperties.reality === "physical");
    const hit = phys.find(d =>
      d.connectionProperties.tunnelState === "connected" &&
      (!want || d.hardwareProperties.udid === want));
    if (hit) console.log(hit.hardwareProperties.udid);
  ' 2>/dev/null || true)

  if [[ -n "$target" ]]; then
    printf '设备已上线：%s\n==> 装机\n' "$target"
    xcrun devicectl device install app --device "$target" "$APP_PATH"
    printf '==> 启动\n'
    xcrun devicectl device process launch --device "$target" --terminate-existing "$BUNDLE" || \
      printf '自动启动失败，手动点桌面的「探记」图标即可。\n'
    printf '\n完成。\n'
    exit 0
  fi

  # 打印当前状态，方便判断「插上了但没连上」
  if [[ -n "$DEVICE" ]]; then
    state=$(WANT_UDID="$DEVICE" node -e '
      const fs=require("fs");
      try{
        const j=JSON.parse(fs.readFileSync("/tmp/tanji_wait_devices.json","utf8"));
        const d=(j.result.devices||[]).find(x=>x.hardwareProperties.udid===process.env.WANT_UDID);
        if(d) console.log(d.connectionProperties.tunnelState);
      }catch{}
    ' 2>/dev/null || true)
    # 顺带报告 USB 层是否枚举到了这台设备 —— 这是区分
    # 「线没插好/手机锁屏」和「只是隧道没建起来」的关键信号。
    usb=$(ioreg -p IOUSB -l -w 0 2>/dev/null | grep -c "${DEVICE//-/}" || true)
    usb_state="USB未见"
    [[ "$usb" != "0" ]] && usb_state="USB已枚举"
    printf '[%s] 目标设备状态：%s（%s）\n' "$(date +%H:%M:%S)" "${state:-未知}" "$usb_state"
    if [[ "$state" == "unavailable" && "$usb_state" == "USB已枚举" ]]; then
      printf '        ↳ 设备在 USB 上但服务隧道不通：让手机保持解锁，若弹了「信任此电脑」请点信任。\n'
    elif [[ "$state" == "unavailable" && "$usb_state" == "USB未见" ]]; then
      printf '        ↳ USB 层看不到设备：数据线没插紧/插的是充电头/插在了不带供电的 hub 上。\n'
    fi
  fi
  sleep "$INTERVAL"
done

printf '超时：%d 秒内没有设备上线。\n' "$TIMEOUT" >&2
printf '排查：手机插的是不是数据线（不是充电头）？锁屏了吗？弹的「信任此电脑」点了吗？\n' >&2
exit 1
