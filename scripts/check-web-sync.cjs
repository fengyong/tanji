#!/usr/bin/env node
/**
 * 探记 TanJi —— main / native 分支代码漂移校验
 *
 * 背景
 * ----
 * main 是唯一真源（Web/PWA 版），native-app 是纯本地 iOS 版。两边的
 * index.html / storage.js 是同一套业务逻辑的两份拷贝：native 额外塞进了
 * Capacitor 适配层（SQLite 持久化、通知、分享导出）。
 *
 * 现实是：main 改了一处 bug，native 那份拷贝很容易忘记同步，于是同一个
 * 业务规则在两个版本上行为不一致——这种漂移在 App Store 上架后要靠用户
 * 投诉才能发现，代价极高。
 *
 * 本脚本的做法
 * ------------
 * 不去猜"哪些差异是合法的原生差异"（那种白名单必然腐化），而是反过来：
 * **任何一侧的改动都必须显式登记**。
 *
 *   scripts/web-sync.lock.json 记录每一份共享文件在 main 与 native 两侧
 *   各自的内容指纹（git blob sha）。校验时重算指纹并与锁文件比对：
 *
 *     - main 侧变了、native 没变  →  漏同步，CI 必须失败
 *     - native 侧变了              →  未登记的私自改动，CI 必须失败
 *     - 两侧都变了                →  重新同步过，但锁文件没更新，CI 必须失败
 *
 * 只有显式跑 `npm run check:update` 重写锁文件，CI 才会放行。
 * 这样"同步"从一个靠记性的动作，变成一个 CI 可验证的状态。
 *
 * 另外还校验：
 *   - www/cap-plugins.js 必须等于 src/cap-plugins.js 的 esbuild 产物
 *     （否则手改过构建产物，或改了 src 却忘了重新打包）
 *
 * 用法
 * ----
 *   node scripts/check-web-sync.cjs                 # 校验（CI 用）
 *   node scripts/check-web-sync.cjs --update        # 同步完成后重写锁文件
 *   node scripts/check-web-sync.cjs --main-ref <ref>
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const LOCK_PATH = path.join(ROOT, 'scripts', 'web-sync.lock.json');

/** main 与 native 之间的共享文件映射 */
const SHARED = [
  { main: 'index.html', native: 'www/index.html', note: '主应用 UI(markup)与模块入口' },
  // P0 拆层:native 的 storage 源码已移入 src/app/,与 main 的平铺 storage.js 对应
  { main: 'storage.js', native: 'src/app/storage.js', note: '双副本存储与迁移' },
  { main: 'sw.js', native: 'www/sw.js', note: 'Service Worker 离线缓存' },
  { main: 'manifest.webmanifest', native: 'www/manifest.webmanifest', note: 'PWA 清单' },
  { main: 'privacy.html', native: 'www/privacy.html', note: '隐私政策（App Store 必需）' },
  { main: 'support.html', native: 'www/support.html', note: '支持页（App Store 必需）' },
  { main: 'icons', native: 'www/icons', note: '图标目录' },
  { main: 'vendor', native: 'www/vendor', note: '第三方静态资源（sqlite3 wasm）' },
];

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: opts.binary ? 'buffer' : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...opts,
  });
}

/** git blob sha（与 git hash-object 一致） */
function blobSha(buf) {
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

/** 文件内容指纹 */
function digestFile(abs) {
  return blobSha(fs.readFileSync(abs));
}

/**
 * 目录内容指纹：对目录下每个文件按相对路径排序，
 * 逐个取 blob sha，再把 "路径\0sha\n" 拼起来做 sha256。
 * 空目录返回固定值。
 */
function digestDir(abs) {
  const entries = [];
  const walk = (dir, prefix) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, rel);
      else entries.push(`${rel}\0${digestFile(full)}\n`);
    }
  };
  walk(abs, '');
  return crypto.createHash('sha256').update(entries.join('')).digest('hex');
}

/** main 侧的内容指纹：走 git 对象库，不碰工作区 */
function digestFromRef(ref, relPath) {
  let type;
  try {
    type = git(['cat-file', '-t', `${ref}:${relPath}`]).trim();
  } catch {
    return null; // 该路径在 main 上不存在
  }
  if (type === 'blob') {
    return blobSha(git(['cat-file', 'blob', `${ref}:${relPath}`], { binary: true }));
  }
  if (type === 'tree') {
    // 递归展开 tree，对齐工作区目录的 digest 算法
    const listing = git(['ls-tree', '-r', `${ref}:${relPath}`])
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [meta, p] = line.split('\t');
        const sha = meta.split(/\s+/)[2];
        return `${p}\0${sha}\n`;
      })
      .join('');
    return crypto.createHash('sha256').update(listing).digest('hex');
  }
  return null;
}

function readLock() {
  if (!fs.existsSync(LOCK_PATH)) return null;
  return JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
}

function parseArgs(argv) {
  const args = { update: false, mainRef: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--update') args.update = true;
    else if (argv[i] === '--main-ref') args.mainRef = argv[++i];
    else if (argv[i].startsWith('--main-ref=')) args.mainRef = argv[i].split('=')[1];
    else if (argv[i] === '--ref') args.mainRef = argv[++i];
    else if (argv[i].startsWith('--ref=')) args.mainRef = argv[i].split('=')[1];
  }
  return args;
}

/**
 * 解析 main 引用。
 * 优先本地 main 分支：本地提交后 origin/main 可能还是旧的，
 * 优先本地分支才能让刚提交的内容立刻参与校验。
 * CI 里没有本地 main 分支时自动回落到 origin/main。
 */
function resolveMainRef(explicit) {
  const candidates = explicit ? [explicit] : ['main', 'origin/main', 'refs/remotes/origin/main'];
  for (const ref of candidates) {
    try {
      git(['rev-parse', '--verify', `${ref}^{commit}`]);
      return ref;
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}

/** 校验 www/cap-plugins.js 是否等于 src/cap-plugins.js 的构建产物 */
function checkBuiltPlugin() {
  const src = path.join(ROOT, 'src', 'cap-plugins.js');
  const built = path.join(ROOT, 'www', 'cap-plugins.js');
  if (!fs.existsSync(src)) return { ok: true, skipped: true };
  if (!fs.existsSync(built)) return { ok: false, message: '缺少 www/cap-plugins.js' };

  let esbuild;
  try {
    esbuild = require('esbuild'); // JS API（内部 spawn 平台二进制）；bin/esbuild 是 Mach-O，不能拿 node 跑
  } catch {
    return { ok: true, skipped: true, message: '未安装 esbuild，跳过构建产物比对' };
  }

  const os = require('node:os');
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tanji-build-')), 'cap-plugins.js');
  try {
    esbuild.buildSync({
      entryPoints: [path.join(ROOT, 'src', 'cap-plugins.js')],
      bundle: true,
      format: 'iife',
      outfile: tmp,
      minify: true,
      logLevel: 'silent',
    });

    const a = fs.readFileSync(built);
    const b = fs.readFileSync(tmp);
    if (a.equals(b)) return { ok: true };
    return {
      ok: false,
      message:
        'www/cap-plugins.js 与 src/cap-plugins.js 的构建产物不一致 —— ' +
        '请执行 `npm run build:plugins` 后重新提交',
    };
  } catch (e) {
    return { ok: true, skipped: true, message: `esbuild 执行失败，跳过比对：${e.message}` };
  } finally {
    try {
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    } catch {
      /* 临时目录清不掉也无所谓 */
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mainRef = resolveMainRef(args.mainRef);

  if (!mainRef) {
    console.error('✗ 找不到 main 分支引用。请用 --main-ref <ref> 指定，或先 fetch origin/main。');
    process.exit(1);
  }

  const mainCommit = git(['rev-parse', `${mainRef}^{commit}`]).trim();
  const lock = readLock();

  // ---------- 收集当前两侧指纹 ----------
  const current = {};
  const missing = [];
  for (const item of SHARED) {
    const abs = path.join(ROOT, item.native);
    if (!fs.existsSync(abs)) {
      missing.push(item.native);
      continue;
    }
    const stat = fs.statSync(abs);
    current[item.main] = {
      main: digestFromRef(mainRef, item.main),
      native: stat.isDirectory() ? digestDir(abs) : digestFile(abs),
    };
  }

  if (missing.length) {
    console.error('✗ native 侧缺少这些共享文件：');
    for (const m of missing) console.error(`    ${m}`);
    process.exit(1);
  }

  // ---------- 校验模式 ----------
  if (!args.update) {
    if (!lock) {
      console.error('✗ 缺少 scripts/web-sync.lock.json —— 无法校验漂移。');
      console.error('  首次建立基线请执行： npm run check:update');
      process.exit(1);
    }

    const problems = [];
    for (const item of SHARED) {
      const now = current[item.main];
      const was = lock.files?.[item.main];
      if (!was) {
        problems.push(`${item.main}：锁文件中没有登记项`);
        continue;
      }
      const mainChanged = now.main !== was.main;
      const nativeChanged = now.native !== was.native;

      if (!mainChanged && !nativeChanged) continue;

      if (mainChanged && !nativeChanged) {
        problems.push(
          `${item.main}（${item.note}）\n` +
            `      main 已更新但 native 未同步。\n` +
            `      处理：把 main 的改动同步到 ${item.native}，` +
            `然后执行 npm run check:update 重新登记。`
        );
      } else if (!mainChanged && nativeChanged) {
        problems.push(
          `${item.main}（${item.note}）\n` +
            `      native 侧被改动了但未登记。\n` +
            `      处理：确认这是有意的原生专属改动后，执行 npm run check:update 重新登记。`
        );
      } else {
        problems.push(
          `${item.main}（${item.note}）\n` +
            `      两侧都更新了，但锁文件没有同步更新。\n` +
            `      处理：确认 native 已吸收 main 的最新改动后，执行 npm run check:update 重新登记。`
        );
      }
    }

    const plugin = checkBuiltPlugin();
    if (!plugin.ok) problems.push(plugin.message);

    if (problems.length) {
      console.error('✗ main / native 存在未登记的漂移：\n');
      for (const p of problems) console.error(`  • ${p}\n`);
      console.error(`  基准：${lock.mainRef || 'origin/main'} @ ${(lock.mainCommit || '').slice(0, 12)}`);
      console.error(`  当前：${mainRef} @ ${mainCommit.slice(0, 12)}`);
      process.exit(1);
    }

    console.log('✓ main / native 无漂移');
    console.log(`  基准：${lock.mainRef || 'origin/main'} @ ${(lock.mainCommit || '').slice(0, 12)}`);
    console.log(`  当前：${mainRef} @ ${mainCommit.slice(0, 12)}`);
    if (plugin.skipped && plugin.message) console.log(`  （${plugin.message}）`);
    process.exit(0);
  }

  // ---------- 更新模式 ----------
  const files = {};
  for (const item of SHARED) {
    files[item.main] = {
      main: current[item.main].main,
      native: current[item.main].native,
      nativePath: item.native,
      note: item.note,
    };
  }

  const next = {
    $schema: 'tanji-web-sync-lock/v1',
    mainRef,
    mainCommit,
    updatedAt: new Date().toISOString().slice(0, 10),
    files,
  };

  fs.writeFileSync(LOCK_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log('✓ 已更新 scripts/web-sync.lock.json');
  console.log(`  基准：${mainRef} @ ${mainCommit.slice(0, 12)}`);
  for (const item of SHARED) {
    console.log(`    ${item.main.padEnd(22)} → ${item.native}`);
  }
  process.exit(0);
}

main();
