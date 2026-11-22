/**
 * 探记 TanJi —— 导出表结构一致性回归
 *
 * 背景
 * ----
 * 2026-11-22 的 v0.5 工作流改动给 orders 表加了 5 列
 * (location / deliver_main / deliver_sub / review_result / published_at),
 * 但只改了 CREATE TABLE,忘了同步改 INSERT 的占位符数量 ——
 * 结果是 25 列的表配了 26 个 `?`,SQLite 直接报
 * "table orders has 25 columns but 26 values were supplied"。
 *
 * 后果不是报错退出,而是 buildSqliteBytes() 静默 catch 掉异常返回 null:
 *   - Web 版的 SQLite 双副本写入失效
 *   - 两端的「导出 SQLite 数据库(.db)」按钮点出来是空的
 * 一个用户可见的功能整个坏掉,却因为 catch 吞了异常而没有任何报错日志。
 *
 * 所以这里做静态校验:凡是"列"与"值个数"对不上的,直接判失败。
 * 这类错不需要跑起来才能发现,读源码就够了。
 *
 * 另外 index.html 里有**两份** orders 表定义:
 *   1. buildSqliteBytes() 里真正建表用的那份
 *   2. 「数据结构 · SQLite」说明页里带注释的那份(给用户看的)
 * 两份必须同步 —— 文档说 20 列而实际建 25 列,用户照文档查库会查错。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// native 分支的 Web 资源在 www/ 下,main 分支在仓库根目录 —— 同一份测试两边都能跑
const WEB_DIR = fs.existsSync(path.join(ROOT, 'www', 'index.html')) ? path.join(ROOT, 'www') : ROOT;
const INDEX = path.join(WEB_DIR, 'index.html');
const STORAGE = path.join(WEB_DIR, 'storage.js');

const indexSrc = fs.readFileSync(INDEX, 'utf8');
const storageSrc = fs.readFileSync(STORAGE, 'utf8');

/** 按括号深度切分 SQL 片段 */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * 取一列的定义名。
 * 说明页那份表定义里每列前面带 HTML 注释(单独一行),
 * 所以真正的列定义是该片段的最后一行。
 */
function columnName(part) {
  const lines = part.split('\n').filter(line => line.trim());
  const last = lines[lines.length - 1] || '';
  return last.trim().split(/\s+/)[0];
}

/** 抽出所有 CREATE TABLE name(...) 的表体 */
function createTableDefinitions(src) {
  const tables = new Map();
  const re = /CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
    }
    const body = src.slice(m.index + m[0].length, i - 1);
    const parts = splitTopLevel(body).filter(Boolean);
    if (!tables.has(name)) tables.set(name, []);
    tables.get(name).push({ columns: parts, names: parts.map(columnName) });
    re.lastIndex = i;
  }
  return tables;
}

/** 抽出 INSERT INTO name[(cols)] VALUES (...) */
function insertStatements(src) {
  const list = [];
  const re = /INSERT(?:\s+OR\s+\w+)?\s+INTO\s+(\w+)\s*(\(([^)]*)\))?\s*VALUES\s*\(([^)]*)\)/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    list.push({
      table: m[1],
      columns: m[3] ? splitTopLevel(m[3]).map(c => c.trim()) : null,
      placeholders: (m[4].match(/\?/g) || []).length,
      raw: m[0].replace(/\s+/g, ' '),
    });
  }
  return list;
}

const tables = createTableDefinitions(indexSrc);

test('三张表都能被解析出来', () => {
  for (const name of ['orders', 'payments', 'settings']) {
    assert.ok(tables.has(name), `没找到 ${name} 表`);
    assert.ok(tables.get(name).length > 0, `${name} 表没有可用定义`);
  }
});

test('同一个表的每一份定义列数与列名都必须一致(建表语句与结构说明页不能各说各话)', () => {
  for (const [name, defs] of tables) {
    const reference = defs[0];
    for (const def of defs.slice(1)) {
      assert.equal(
        def.columns.length,
        reference.columns.length,
        `${name} 的两份定义列数不一致:${reference.columns.length} vs ${def.columns.length}`,
      );
      assert.deepEqual(
        def.names,
        reference.names,
        `${name} 的两份定义列名不一致:\n  ${reference.names.join(',')}\n  ${def.names.join(',')}`,
      );
    }
  }
});

test('每个 INSERT 的值个数必须与目标表的列数一致', () => {
  const statements = insertStatements(indexSrc);
  assert.ok(statements.length >= 3, `只解析到 ${statements.length} 条 INSERT,预期至少 3 条`);

  for (const st of statements) {
    const defs = tables.get(st.table);
    assert.ok(defs, `INSERT 指向未定义的表 ${st.table}`);
    const cols = defs[0].columns.length;

    // 显式列出列名时按列名数量,否则按表的总列数
    const expected = st.columns ? st.columns.length : cols;
    assert.equal(
      st.placeholders,
      expected,
      `${st.table} 的 INSERT 有 ${st.placeholders} 个占位符,` +
        `但目标只有 ${expected} 列 —— 会报 "table ${st.table} has ${expected} columns ` +
        `but ${st.placeholders} values were supplied",` +
        `表现为 buildSqliteBytes() 静默返回 null(.db 导出是空的)\n  ${st.raw}`,
    );
  }
});

test('orders 表的列数与 v0.5/v0.6 新增字段符合预期', () => {
  const names = tables.get('orders')[0].names;
  // native 分支已上 v0.5 工作流(多 5 列);main 分支仍是 v0.4,按各自基准校验
  const isWorkflowV05 = names.includes('location');
  if (!isWorkflowV05) {
    assert.equal(names.length, 20, `main 分支 orders 表当前是 ${names.length} 列,预期 20`);
    return;
  }
  const hasAccounts = names.includes('account_id');
  const hasGps = names.includes('gps_place');
  // v0.5 工作流(25) → v0.6 账号(26) → v0.6 到店定位(27);按已上线的列逐级放宽
  const expected = hasAccounts ? (hasGps ? 27 : 26) : 25;
  assert.equal(names.length, expected, `orders 表当前是 ${names.length} 列,预期 ${expected}`);
  for (const added of ['location', 'deliver_main', 'deliver_sub', 'review_result', 'published_at']) {
    assert.ok(names.includes(added), `orders 表缺少 v0.5 新增列 ${added}`);
  }
  if (hasGps) {
    // 定位列必须紧跟 location:两份建表语句与 ORD_COLS 的列序都靠这个约定对齐
    assert.equal(names.indexOf('gps_place'), names.indexOf('location') + 1, 'gps_place 应紧跟 location');
  }
  if (hasAccounts) {
    assert.ok(tables.has('accounts'), 'v0.6 账号体系必须有 accounts 表(导出 .db 也要带)');
  }
});

test('storage.js 的 ORD_COLS 与 orders 表列一一对应(原生插件写入路径)', t => {
  const m = storageSrc.match(/ORD_COLS\s*=\s*\[([^\]]*)\]/);
  if (!m) {
    // main 分支是纯 Web 版,没有原生插件的 ORD_COLS,跳过
    t.skip('本分支没有 ORD_COLS(纯 Web 版)');
    return;
  }
  const ordCols = splitTopLevel(m[1]).map(c => c.trim().replace(/^['"]|['"]$/g, ''));
  const names = tables.get('orders')[0].names;

  assert.equal(
    ordCols.length,
    names.length,
    `ORD_COLS 有 ${ordCols.length} 列,orders 表有 ${names.length} 列`,
  );
  assert.deepEqual(ordCols, names, 'ORD_COLS 与 orders 表列名/列序不一致');
});
