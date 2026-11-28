#!/usr/bin/env node
// ---------------------------------------------------------------------------
// 探记 HG · 纯原生 iOS 版 —— 上架资产检查（跨平台，CI 与本机通用）
//
// 校验项：
//   1. 隐私清单存在、可解析、声明了实际命中的受限 API、不声明数据收集
//   2. App 图标为 1024×1024 且 PNG 不带 alpha 通道（App Store 硬性要求）
//
// CI runner（ubuntu）没有 plutil / sips，故这里用 Node 直接读文件：
// plist 用简单解析，PNG 用 IHDR 头，够用且不引依赖。
//
// 用法：node scripts/check-release-assets.cjs
// ---------------------------------------------------------------------------
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const PRIVACY = path.join(root, 'ios/TanjiNative/Resources/PrivacyInfo.xcprivacy');
const ICON = path.join(
  root,
  'ios/TanjiNative/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
);

let failed = 0;
const pass = (msg) => console.log(`✓ ${msg}`);
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  failed = 1;
};

// ------------------------------------------------------------ 隐私清单
if (!fs.existsSync(PRIVACY)) {
  fail('缺少 PrivacyInfo.xcprivacy（上传会被 ITMS-91053 拒收）');
} else {
  const raw = fs.readFileSync(PRIVACY, 'utf8');
  // 注释里会出现这些 key 名，匹配前必须先剥离 XML 注释，否则会误判。
  const body = raw.replace(/<!--[\s\S]*?-->/g, '');
  pass('隐私清单存在');
  // 结构用正则核对：plist 体量大，完整解析器不值得引依赖。
  if (/NSPrivacyAccessedAPICategoryUserDefaults/.test(body)) {
    pass('隐私清单已声明 UserDefaults（实际命中的受限 API）');
  } else {
    fail('隐私清单未声明 NSPrivacyAccessedAPICategoryUserDefaults');
  }
  if (/CA92\.1/.test(body)) {
    pass('隐私清单已声明 UserDefaults 原因码 CA92.1');
  } else {
    fail('隐私清单未声明 UserDefaults 原因码 CA92.1');
  }
  if (/<key>NSPrivacyTracking<\/key>\s*<false\/>/.test(body)) {
    pass('隐私清单声明不追踪');
  } else {
    fail('隐私清单未声明 NSPrivacyTracking=false');
  }
  // 纯本地应用：NSPrivacyCollectedDataTypes 必须是空数组。
  // plist 里空数组有两种写法：自闭合的 <array/> 和 <array></array>，
  // 所以不按固定形状匹配，改成定位 key 后的数组区间，再看里面有没有 <dict>。
  const keyIdx = body.indexOf('<key>NSPrivacyCollectedDataTypes</key>');
  if (keyIdx === -1) {
    fail('隐私清单未声明 NSPrivacyCollectedDataTypes');
  } else {
    const after = body.slice(keyIdx + '<key>NSPrivacyCollectedDataTypes</key>'.length);
    const openIdx = after.indexOf('<array');
    let inner = null;
    if (openIdx !== -1) {
      const rest = after.slice(openIdx);
      if (rest.startsWith('<array/>') || rest.startsWith('<array />')) {
        inner = ''; // 自闭合空数组
      } else {
        const closeIdx = rest.indexOf('</array>');
        inner = closeIdx === -1 ? '' : rest.slice('<array>'.length, closeIdx);
      }
    }
    if (inner === null) {
      fail('隐私清单未找到 NSPrivacyCollectedDataTypes 数组');
    } else if (inner.includes('<dict>')) {
      fail('隐私清单声明了数据收集，与「不收集数据」口径冲突');
    } else {
      pass('隐私清单未声明任何数据收集');
    }
  }
}

// ------------------------------------------------------------ 图标
if (!fs.existsSync(ICON)) {
  fail('缺少 App 图标');
} else {
  const buf = fs.readFileSync(ICON);
  const isPng = buf.length > 24 && buf.toString('latin1', 1, 4) === 'PNG';
  if (!isPng) {
    fail('App 图标不是 PNG');
  } else {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    const bitDepth = buf[24];
    const colorType = buf[25];
    // PNG colorType：0=灰度 2=RGB 3=索引 4=灰度+alpha 6=RGBA
    const hasAlpha = colorType === 4 || colorType === 6;
    if (width !== 1024 || height !== 1024) {
      fail(`App 图标尺寸不符：${width}x${height}（应为 1024x1024）`);
    } else if (hasAlpha) {
      fail(`App 图标带 alpha 通道（colorType=${colorType}），App Store 会拒收`);
    } else if (colorType !== 2) {
      fail(`App 图标 colorType=${colorType}，建议用 RGB（colorType=2）`);
    } else {
      pass(`App 图标为 ${width}x${height} RGB 无 alpha（bitDepth=${bitDepth}）`);
    }
  }
}

// ------------------------------------------------------------ 上架脚本
for (const script of [
  'scripts/archive-testflight.sh',
  'scripts/upload-testflight.sh',
  'scripts/check-testflight-ready.sh',
]) {
  if (fs.existsSync(path.join(root, script))) {
    pass(`${script} 已就位`);
  } else {
    fail(`缺少 ${script}`);
  }
}

if (failed !== 0) {
  console.error('\n上架资产检查未通过。');
  process.exit(1);
}
console.log('\n上架资产检查通过。');
