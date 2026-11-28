'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appDir = path.join(root, 'ios', 'App', 'App');
const read = name => fs.readFileSync(path.join(appDir, name), 'utf8');

test('原生容器只持有一个 Capacitor Bridge', () => {
  const container = read('NativeTabContainerViewController.swift');
  const bridge = read('AppBridgeViewController.swift');
  const scene = read('SceneDelegate.swift');
  assert.match(container, /private let bridgeController = AppBridgeViewController\(\)/);
  assert.equal((container.match(/AppBridgeViewController\(\)/g) || []).length, 1);
  assert.match(bridge, /final class AppBridgeViewController: CAPBridgeViewController/);
  assert.match(bridge, /bridge\?\.registerPluginInstance\(plugin\)/);
  assert.match(scene, /rootViewController = NativeTabContainerViewController\(\)/);
});

test('原生导航、金额隐私与备份文件都进入 App Sources 构建阶段', () => {
  const project = fs.readFileSync(path.join(root, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj'), 'utf8');
  for (const name of ['AppBridgeViewController.swift', 'NativeTabsPlugin.swift', 'NativeTabContainerViewController.swift', 'AmountPrivacyPlugin.swift', 'BackupFilesPlugin.swift']) {
    const sourceEntry = new RegExp(`${name.replace('.', '\\.')} in Sources \\*/ = \\{isa = PBXBuildFile;`);
    assert.match(project, sourceEntry, `${name} 缺少 PBXBuildFile`);
    assert.ok(project.includes(`/* ${name} in Sources */`), `${name} 未加入 Sources phase`);
  }
  assert.match(project, /AppUITests\.xctest/);
});

test('金额隐私仅接受 Face ID，并在成功后持久化切换', () => {
  const swift = read('AmountPrivacyPlugin.swift');
  const plist = read('Info.plist');
  const bridge = read('AppBridgeViewController.swift');
  assert.match(swift, /jsName = "AmountPrivacy"/);
  assert.match(swift, /CAPPluginMethod\(name: "getState"/);
  assert.match(swift, /CAPPluginMethod\(name: "toggle"/);
  assert.match(swift, /canEvaluatePolicy\(\.deviceOwnerAuthenticationWithBiometrics/);
  assert.match(swift, /evaluatePolicy\(\.deviceOwnerAuthenticationWithBiometrics/);
  assert.match(swift, /context\.biometryType == \.faceID/);
  assert.match(swift, /context\.localizedFallbackTitle = ""/);
  assert.doesNotMatch(swift, /evaluatePolicy\(\.deviceOwnerAuthentication\s*,/);
  assert.match(swift, /UserDefaults\.standard/);
  assert.match(swift, /defaults\.set\(enabled, forKey: Self\.hiddenKey\)/);
  assert.match(bridge, /registerPluginInstance\(privacyPlugin\)/);
  assert.match(plist, /<key>NSFaceIDUsageDescription<\/key>/);
});

test('原生备份目录对文件 App 可见，导入使用系统 JSON 选择器', () => {
  const swift = read('BackupFilesPlugin.swift');
  const plist = read('Info.plist');
  const bridge = read('AppBridgeViewController.swift');
  assert.match(swift, /jsName = "BackupFiles"/);
  assert.match(swift, /CAPPluginMethod\(name: "saveBackup"/);
  assert.match(swift, /CAPPluginMethod\(name: "pickBackup"/);
  assert.match(swift, /documentDirectory/);
  assert.match(swift, /directoryName = "探记 HG"/);
  assert.match(swift, /UIDocumentPickerViewController\(forOpeningContentTypes: \[\.json\], asCopy: true\)/);
  assert.match(swift, /picker\.directoryURL = directory/);
  assert.match(swift, /startAccessingSecurityScopedResource/);
  assert.match(swift, /name == \(name as NSString\)\.lastPathComponent/);
  assert.match(swift, /maxFileSize = 10 \* 1024 \* 1024/);
  assert.match(bridge, /registerPluginInstance\(backupFilesPlugin\)/);
  assert.match(plist, /<key>UIFileSharingEnabled<\/key>\s*<true\/>/);
  assert.match(plist, /<key>LSSupportsOpeningDocumentsInPlace<\/key>\s*<true\/>/);
});

test('Web 与 Swift 的原生底栏协议字段一致', () => {
  const js = fs.readFileSync(path.join(root, 'src', 'app', 'native-tabs.js'), 'utf8');
  const swift = read('NativeTabsPlugin.swift');
  assert.match(js, /registerPlugin\('NativeTabs'\)/);
  assert.match(swift, /jsName = "NativeTabs"/);
  assert.match(swift, /CAPPluginMethod\(name: "setState"/);
  for (const field of ['ready', 'tab', 'badge', 'overlay', 'appliedCommandId']) {
    assert.ok(js.includes(field), `Web 状态缺少 ${field}`);
    assert.ok(swift.includes(`"${field}"`), `Swift 未读取 ${field}`);
  }
  assert.match(js, /tanjiNativeTab/);
  assert.match(js, /tanjiNativeLayout/);
  assert.match(swift, /eventName: "tanjiNativeTab"/);
  assert.match(swift, /eventName: "tanjiNativeLayout"/);
  assert.match(js, /cropOpen\?'crop':sheetOpen\?'sheet':'none'/);
  assert.doesNotMatch(js, /heading\.focus|h1.*focus/, '原生 Tab 切换不能把焦点移进 Web 标题，避免 iOS 显示间歇性蓝色外框');
  assert.match(read('NativeTabContainerViewController.swift'), /case none, sheet, crop/);
});

test('原生底栏使用系统默认图标与标题间距', () => {
  const container = read('NativeTabContainerViewController.swift');
  assert.doesNotMatch(container, /titlePositionAdjustment|imageInsets|withBaselineOffset/, 'iOS 26 已修正 Liquid Glass 默认布局，不应再叠加间距补偿');
});

test('iOS 26 保留系统玻璃外观，旧系统与无障碍有明确降级', () => {
  const container = read('NativeTabContainerViewController.swift');
  assert.match(container, /if #available\(iOS 26\.0, \*\) \{\s*return\s*\}/);
  assert.doesNotMatch(container, /standardAppearance = UITabBarAppearance\(\)/);
  assert.match(container, /UIBlurEffect\(style: \.systemThinMaterial\)/);
  assert.match(container, /accessibilityTraits = \.tabBar/);
  assert.doesNotMatch(container, /accessibilityElementsHidden = overlay != \.none/, '弹层也在 WebView 内，不能整棵 WebView 对无障碍隐藏');
});

test('键盘只在实际遮挡底栏时隐藏，退出后恢复', () => {
  const container = read('NativeTabContainerViewController.swift');
  assert.match(container, /UIResponder\.keyboardDidChangeFrameNotification/);
  assert.match(container, /UIResponder\.keyboardDidHideNotification/);
  assert.match(container, /localFrame\.minY < tabBar\.frame\.maxY/);
  assert.match(container, /overlay != \.none \|\| keyboardVisible/);
  assert.match(container, /guard keyboardVisible != visible else \{ return \}/);
});

test('弹层关闭延迟由桥接层单一管理', () => {
  const tabs = fs.readFileSync(path.join(root, 'src', 'app', 'native-tabs.js'), 'utf8');
  const plugin = read('NativeTabsPlugin.swift');
  const sheetSource = fs.readFileSync(path.join(root, 'src', 'app', 'sheets.js'), 'utf8');
  assert.match(tabs, /clearTimeout\(sheetTimer\)/);
  assert.match(tabs, /setTimeout\(\(\)=>\{sheetTimer=null;syncOverlay\(\)\},360\)/);
  assert.match(sheetSource, /setNativeSheetOpen\(false\)/);
  assert.doesNotMatch(sheetSource, /setTimeout\(refreshNativeOverlay/, 'sheets.js 不能再发一个无法撤回的提前恢复');
  assert.ok(plugin.includes('tanjiNativeTab'));
});
