#!/usr/bin/env node
/**
 * 探记 TanJi —— main → native 的 Web 资产同步
 *
 * main 是唯一真源。共享文件分两类，同步方式不同：
 *
 *   纯资产（sw.js / manifest.webmanifest / icons/ / vendor/）
 *     与平台无关，main → www/ 直接字节级拷贝，本脚本自动完成。
 *
 *   合并文件（index.html / storage.js）
 *     里面已织入原生适配层（SQLite 持久化、通知、分享导出），
 *     盲拷会毁掉适配代码 —— 本脚本只检测 main 侧是否有新改动，
 *     有则列出差异摘要并中止，由人工合并后再 `--update` 重新登记。
 *
 * 执行完拷贝后自动调用 check-web-sync.cjs --update 刷新锁文件基线。
 *
 * 用法
 * ----
 *   npm run sync:web                    # 从 origin/main 同步
 *   npm run sync:web -- --ref main      # 指定其它 main 侧引用
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const LOCK_PATH = path.join(ROOT, 'scripts', 'web-sync.lock.json');

/** 可自动拷贝的纯资产：main 路径 → www 路径 */
const PURE_ASSETS = [
  { main: 'sw.js', native: 'www/sw.js' },
  { main: 'manifest.webmanifest', native: 'www/manifest.webmanifest' },
  { main: 'privacy.html', native: 'www/privacy.html' },
  { main: 'support.html', native: 'www/support.html' },
  { main: 'icons', native: 'www/icons' },
  { main: 'vendor', native: 'www/vendor' },
];

/** 含原生适配的合并文件：只检测漂移，禁止自动拷贝 */
const MERGED_FILES = [
  { main: 'index.html', native: 'www/index.html' },
  { main: 'storage.js', native: 'www/storage.js' },
];

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: opts.binary ? 'buffer' : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
}

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

/** 从 git 对象库读 main 侧 blob 内容 */
function readBlob(ref, rel) {
  try {
    return git(['cat-file', 'blob', `${ref}:${rel}`], { binary: true, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return null; // main 上不存在（可能是目录）
  }
}

/** main 侧目录：读整个 tree 的文件清单 */
function listTree(ref, rel) {
  return git(['ls-tree', '-r', `${ref}:${rel}`])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [meta, p] = line.split('\t');
      const sha = meta.split(/\s+/)[2];
      return { path: p, sha };
    });
}

function writeBlob(abs, buf) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
}

function copyPureAssets(ref) {
  for (const item of PURE_ASSETS) {
    const abs = path.join(ROOT, item.native);
    // 文件
    const blob = readBlob(ref, item.main);
    if (blob !== null) {
      writeBlob(abs, blob);
      console.log(`  ✓ ${item.main} → ${item.native}（${blob.length} 字节）`);
      continue;
    }
    // 目录
    try {
      const files = listTree(ref, item.main);
      // 清掉本地旧内容再落新树，避免 main 已删除的文件残留
      fs.rmSync(abs, { recursive: true, force: true });
      for (const f of files) {
        writeBlob(path.join(ROOT, item.native, f.path), readBlobBySha(f.sha));
      }
      console.log(`  ✓ ${item.main}/ → ${item.native}/（${files.length} 个文件）`);
    } catch {
      console.error(`  ✗ ${item.main} 在 ${ref} 上不存在且不是目录，跳过`);
    }
  }
}

// ls-tree 给的是 blob sha，按 sha 直接读内容
function readBlobBySha(sha) {
  return git(['cat-file', 'blob', sha], { binary: true });
}

/** 合并文件在 main 侧自上次登记以来是否有新改动 */
function mergedDrift(lock, ref, mainCommit) {
  const drifts = [];
  if (!lock || !lock.mainCommit) return drifts;
  for (const item of MERGED_FILES) {
    const out = git([
      'diff',
      '--stat',
      `${lock.mainCommit}`,
      mainCommit,
      '--',
      item.main,
    ]).trim();
    if (out) drifts.push({ item, stat: out });
  }
  return drifts;
}

function main() {
  const argv = process.argv.slice(2);
  let explicitRef = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ref') explicitRef = argv[++i];
    else if (argv[i].startsWith('--ref=')) explicitRef = argv[i].split('=')[1];
  }

  const ref = resolveMainRef(explicitRef);
  if (!ref) {
    console.error('✗ 找不到 main 分支引用。请用 --ref <ref> 指定，或先 fetch origin/main。');
    process.exit(1);
  }
  const mainCommit = git(['rev-parse', `${ref}^{commit}`]).trim();
  const lock = fs.existsSync(LOCK_PATH) ? JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8')) : null;

  console.log(`同步基准：${ref} @ ${mainCommit.slice(0, 12)}`);

  // ---------- 1. 合并文件漂移检测（先检测后拷贝，中止时不留下半同步状态） ----------
  console.log('\n[1/3] 合并文件检测（index.html / storage.js 含原生适配，不做自动拷贝）：');
  const drifts = mergedDrift(lock, ref, mainCommit);
  if (drifts.length) {
    console.error('✗ main 侧合并文件有未合并进 native 的改动，已中止（未拷贝任何资产、锁文件未刷新）：\n');
    for (const d of drifts) {
      console.error(`  • ${d.item.main}`);
      for (const line of d.stat.split('\n')) console.error(`      ${line}`);
      console.error(
        `      处理：对照 ${lock.mainCommit.slice(0, 12)}..${mainCommit.slice(0, 12)} 的人工差异，` +
          `把改动合入 ${d.item.native}（保留原生适配层），完成后重新执行 npm run sync:web。`
      );
    }
    process.exit(1);
  }
  console.log('  ✓ index.html / storage.js：main 侧自上次登记以来无新改动');

  // ---------- 2. 拷贝纯资产 ----------
  console.log('\n[2/3] 拷贝纯资产：');
  copyPureAssets(ref);

  // ---------- 3. 刷新锁文件基线 ----------
  console.log('\n[3/3] 刷新锁文件基线：');
  execFileSync(
    process.execPath,
    [path.join(__dirname, 'check-web-sync.cjs'), '--update', '--main-ref', ref],
    { cwd: ROOT, stdio: 'inherit' },
  );
}

main();
