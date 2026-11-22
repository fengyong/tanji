/**
 * 探记 TanJi —— 到店定位规格(纯函数部分)
 *
 * 为什么单测这一层
 * ----------------
 * gps_place 是新增的一列,存的是 `lat,lng` 自造格式:
 *   - 写入端(geo.locate)与读取端(geo.parse / validateState)必须用同一套判定,
 *     否则一次"格式放宽"就会让旧数据的定位静默失效;
 *   - 地图跳转决定"点了有没有反应":手填地点优先、坐标兜底、都没有就不给按钮,
 *     这三条是产品口径,不是实现细节。
 * 真机 GPS 权限与插件调用无法在 node 里验,由 native-reliability 的 mock 覆盖。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../www/geo.js');
const geo = globalThis.TanJiGeo;

test('geo: 只接受「两段数字、范围合法」的坐标串', () => {
  assert.deepEqual(geo.parse('22.543096,114.057865'), { lat: 22.543096, lng: 114.057865 });
  assert.deepEqual(geo.parse('-33.868820,151.209290'), { lat: -33.86882, lng: 151.20929 });

  for (const bad of ['', '   ', '22.5', '22.5,', '22.5,114.0,1', 'abc,def', '91,0', '0,181', null, undefined, 114]) {
    assert.equal(geo.parse(bad), null, `${JSON.stringify(bad)} 不应被当成合法坐标`);
  }
  assert.equal(geo.isValid('22.543096,114.057865'), true);
  assert.equal(geo.isValid('万象城 3 层'), false, '文本地址不能被当成定位串');
});

test('geo: 超长串直接判非法(避免把整段文本硬塞进 gps 列)', () => {
  const long = '22.543096,114.057865'.padEnd(60, '0');
  assert.equal(geo.parse(long), null);
});

test('geo: label 展示为「纬度, 经度」并保留 6 位', () => {
  assert.equal(geo.label('22.543096,114.057865'), '22.543096, 114.057865');
  assert.equal(geo.label('bad'), '');
});

test('geo: 地图链接优先用手填地点文本(中文地址最准)', () => {
  const url = geo.mapUrl({ query: '万象城 3 层', place: '22.5,114.0' });
  assert.equal(url, `https://maps.apple.com/?q=${encodeURIComponent('万象城 3 层')}`);
});

test('geo: 没有手填地点时才用坐标兜底,两者都没有返回 null', () => {
  const url = geo.mapUrl({ place: '22.543096,114.057865', name: '澄川咖啡' });
  assert.match(url, /^https:\/\/maps\.apple\.com\/\?ll=22\.543096,114\.057865&q=/);
  assert.match(url, /%E6%BE%84%E5%B7%9D%E5%92%96%E5%95%A1/, '店铺名应带上,便于地图里一眼认出');

  assert.equal(geo.mapUrl({}), null);
  assert.equal(geo.mapUrl({ place: 'bad', query: '  ' }), null);
  assert.equal(geo.mapUrl(), null);
});
