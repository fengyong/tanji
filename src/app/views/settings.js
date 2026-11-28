import {$,esc} from '../util.js';
import {LEGAL_BASE,APP_STORE_URL,isNative} from '../env.js';
import {db,DEFAULT_MEDAL_RULES} from '../storage.js';
import {ui} from '../ui.js';
import {ACCS,accAvatarHTML,accLevel} from '../accounts.js';

const chevron=`<svg class="ic" style="color:var(--line-strong)"><path d="M9.5 6l6 6-6 6"/></svg>`;

function accountSectionHtml(){
  const accs=ACCS();
  if(!accs.length)return `<div class="menu-row" data-act="open-account" role="button" tabindex="0"><span class="menu-ic" style="background:var(--brand-soft);color:var(--brand-ink)"><svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M5.5 19.5c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5"/></svg></span><div class="menu-t"><div class="menu-name">添加账号</div><div class="menu-sub">订单挂账号，报名资料一键拷贝</div></div>${chevron}</div>`;
  let html='';
  for(const a of accs){
    const n=db.orders.filter(o=>o.accountId===a.id).length;
    html+=`<div class="row" style="align-items:center;gap:12px">${accAvatarHTML(a)}<div style="flex:1;min-width:0"><div class="rname" style="font-size:14px">${esc(a.name)}</div><div class="rsub">${esc(accLevel(a))} · 抖音 ${esc(a.douyin||'—')} · 手机 ${esc(a.phone||'—')} · ${n} 单</div></div><div style="display:flex;gap:6px;flex-shrink:0"><button class="mini-btn" data-act="copy-account" data-id="${a.id}">拷贝</button><button class="mini-btn" style="background:rgba(23,53,47,.06);color:var(--ink-2);border-color:transparent" data-act="open-account" data-id="${a.id}">编辑</button></div></div>`;
  }
  const unassigned=db.orders.filter(o=>o.accountId==null).length;
  if(unassigned)html+=`<div class="row" style="align-items:center;gap:10px"><div class="rmain"><div class="rsub" style="color:var(--orange)">${unassigned} 笔订单未指定账号</div></div><button class="mini-btn" data-act="assign-open">批量改挂</button></div>`;
  return html;
}

function medalSettingsHtml(){
  const r=db.medalRules||DEFAULT_MEDAL_RULES;
  return `<div class="app-header">
      <button class="icon-btn" data-act="settings-back" aria-label="返回设置"><svg class="ic" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <div style="flex:1;min-width:0"><div class="eyebrow">Achievements / 每日勋章</div><h1 class="big">勋章门槛</h1></div>
    </div>
    <div class="medal-note">所有账号共用这一套标准。金额按当天订单总价计算，不是实收；修改后历史日期会立即按新门槛重新判定。</div>
    <div class="sec-title">四项门槛</div>
    <div class="card rows medal-card">
      <div class="frow"><label for="medal-busy">⭐ 忙碌日</label><div class="medal-value"><input id="medal-busy" type="number" inputmode="numeric" min="1" max="9999" step="1" value="${esc(r.busyOrders)}"><span>单</span></div></div>
      <div class="frow"><label for="medal-sales">💰 千元日</label><div class="medal-value"><span>¥</span><input id="medal-sales" type="number" inputmode="decimal" min="0.01" max="999999999.99" step="0.01" value="${esc(r.salesAmount)}"></div></div>
      <div class="frow"><label for="medal-hot">🔥 爆单</label><div class="medal-value"><input id="medal-hot" type="number" inputmode="numeric" min="1" max="9999" step="1" value="${esc(r.hotOrders)}"><span>单</span></div></div>
      <div class="frow"><label for="medal-ace">💎 王牌日</label><div class="medal-value"><span>¥</span><input id="medal-ace" type="number" inputmode="decimal" min="0.01" max="999999999.99" step="0.01" value="${esc(r.aceAmount)}"></div></div>
    </div>
    <div class="ferr" id="medal-err"></div>
    <div style="padding:16px 2px 4px"><button class="btn primary" style="width:100%" data-act="save-medals">保存门槛</button></div>
    <div class="rsub" style="margin:10px 2px 0;line-height:1.6">爆单单数需大于忙碌日；王牌日金额不能低于千元日。同一天满足多项时，只显示 💎 > 🔥 > 💰 > ⭐ 中最高的一枚。</div>`;
}

export function renderSettings(){
  if(ui.settingsPage==='medals'){$('#v-settings').innerHTML=medalSettingsHtml();return}
  const privacyHelp=isNative?'仅 Face ID 可隐藏或显示，重启后保留':'隐藏所有金额，适合截图与对账';
  const importTitle=isNative?'从文件导入备份':'从旧版探记导入';
  const importHelp=isNative?'默认打开「文件 › 探记 HG」；预览后替换，自动留恢复点':'选择 JSON 备份；预览后替换，自动留恢复点';
  const exportTitle=isNative?'保存 JSON 备份':'导出 JSON 备份';
  const exportHelp=isNative?'直接存入「文件 › 探记 HG」；换机迁移选这个':'订单、流水、账号与设置；换机迁移选这个';
  $('#v-settings').innerHTML=`
    <div class="app-header">
      <button class="icon-btn" data-act="close-settings" aria-label="返回统计"><svg class="ic" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <div style="flex:1;min-width:0"><div class="eyebrow">Settings / 本机与偏好</div><h1 class="big">设置</h1></div>
    </div>

    <div class="sec-title">我的账号 <span class="more" role="button" tabindex="0" data-act="open-account">+ 添加 ›</span></div>
    <div class="card rows">${accountSectionHtml()}</div>

    <div class="sec-title">数据与备份 <span class="rsub">本机 SQLite · 完全离线</span></div>
    <div class="card rows">
      <div class="menu-row" data-act="import-json" role="button" tabindex="0"><span class="menu-ic" style="background:var(--brand-soft);color:var(--brand-ink)"><svg class="ic" viewBox="0 0 24 24"><path d="M12 4v11M7.5 10l4.5 4.5L16.5 10"/><path d="M4.5 19.5h15"/></svg></span><div class="menu-t"><div class="menu-name">${importTitle}</div><div class="menu-sub">${importHelp}</div></div>${chevron}</div>
      <div class="menu-row" data-act="export-json" role="button" tabindex="0"><span class="menu-ic" style="background:var(--green-soft);color:var(--green)"><svg class="ic" viewBox="0 0 24 24"><path d="M8 4.5H6A2.5 2.5 0 0 0 3.5 7v3A2.5 2.5 0 0 1 1 12.5 2.5 2.5 0 0 1 3.5 15v3A2.5 2.5 0 0 0 6 20.5h2M16 4.5h2A2.5 2.5 0 0 1 20.5 7v3a2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0-2.5 2.5v3A2.5 2.5 0 0 1 16 20.5h-2"/></svg></span><div class="menu-t"><div class="menu-name">${exportTitle}</div><div class="menu-sub">${exportHelp}</div></div>${chevron}</div>
      <div class="menu-row" data-act="export-db" role="button" tabindex="0"><span class="menu-ic" style="background:var(--blue-soft);color:var(--blue)"><svg class="ic" viewBox="0 0 24 24"><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/></svg></span><div class="menu-t"><div class="menu-name">导出 SQLite（.db）</div><div class="menu-sub">完整数据库存档，可用 SQLite 工具打开</div></div>${chevron}</div>
      <div class="menu-row" data-act="export-csv" role="button" tabindex="0"><span class="menu-ic" style="background:var(--green-soft);color:var(--green)"><svg class="ic" viewBox="0 0 24 24"><path d="M12 4v11M7.5 11l4.5 4.5L16.5 11"/><path d="M4.5 19.5h15"/></svg></span><div class="menu-t"><div class="menu-name">导出 CSV</div><div class="menu-sub">订单表 + 收款流水，Excel / Numbers 可直接打开</div></div>${chevron}</div>
      <div class="menu-row" data-act="open-schema" role="button" tabindex="0"><span class="menu-ic" style="background:var(--blue-soft);color:var(--blue)"><svg class="ic" viewBox="0 0 24 24"><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/></svg></span><div class="menu-t"><div class="menu-name">数据结构 · SQLite</div><div class="menu-sub">orders / payments / accounts / settings</div></div>${chevron}</div>
      <div class="menu-row" data-act="restore-backup" role="button" tabindex="0"><span class="menu-ic" style="background:var(--orange-soft);color:var(--orange)"><svg class="ic" viewBox="0 0 24 24"><path d="M4 10a8 8 0 1 1 1.5 7.5M4 4v6h6"/></svg></span><div class="menu-t"><div class="menu-name">恢复替换前的数据</div><div class="menu-sub">撤回最近一次导入或清空，仅保留最近一份</div></div>${chevron}</div>
    </div>

    <div class="sec-title">提醒与隐私</div>
    <div class="card rows">
      <div class="menu-row" data-act="privacy" role="button" tabindex="0"><span class="menu-ic" style="background:var(--brand-soft);color:var(--brand-ink)"><svg class="ic" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg></span><div class="menu-t"><div class="menu-name">隐私模式</div><div class="menu-sub">${privacyHelp}</div></div><span class="tag-badge">${ui.privacy?'已开启':'已关闭'}</span></div>
      <div class="menu-row"><span class="menu-ic" style="background:var(--orange-soft);color:var(--orange)"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5a6 6 0 0 0-6 6v3.2l-1.6 3a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5l-1.6-3V9.5a6 6 0 0 0-6-6z"/></svg></span><div class="menu-t"><div class="menu-name">尾款催收阈值</div><div class="menu-sub">超过该天数未收尾款即标记逾期</div></div><div class="stepper"><button data-act="th" data-v="-1" aria-label="减少催收阈值">−</button><span>${db.threshold} 天</span><button data-act="th" data-v="1" aria-label="增加催收阈值">+</button></div></div>
      ${isNative?`<div class="menu-row" data-act="notify-toggle" role="button" tabindex="0"><span class="menu-ic" style="background:var(--blue-soft);color:var(--blue)"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5a6 6 0 0 0-6 6v3.2l-1.6 3a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5l-1.6-3V9.5a6 6 0 0 0-6-6z"/><path d="M10 19.5a2 2 0 0 0 4 0"/></svg></span><div class="menu-t"><div class="menu-name">逾期催收每日提醒</div><div class="menu-sub">每天 09:00 · 只报条数与最长天数，不含金额</div></div><span class="tag-badge">${db.notifyEnabled===false?'已关闭':'已开启'}</span></div>`:''}
    </div>

    <div class="sec-title">勋章与激励</div>
    <div class="card rows"><div class="menu-row" data-act="open-medals" role="button" tabindex="0"><span class="menu-ic" style="background:var(--orange-soft);color:var(--orange)"><svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="8" r="5"/><path d="M8.5 12.5 7 21l5-3 5 3-1.5-8.5"/></svg></span><div class="menu-t"><div class="menu-name">勋章门槛</div><div class="menu-sub">全账号统一 · 忙碌 ${db.medalRules?.busyOrders??DEFAULT_MEDAL_RULES.busyOrders} 单 · 千元 ¥${db.medalRules?.salesAmount??DEFAULT_MEDAL_RULES.salesAmount} · 爆单 ${db.medalRules?.hotOrders??DEFAULT_MEDAL_RULES.hotOrders} 单 · 王牌 ¥${db.medalRules?.aceAmount??DEFAULT_MEDAL_RULES.aceAmount}</div></div>${chevron}</div></div>

    <div class="sec-title">数据空间</div>
    <div class="card rows"><div class="menu-row" data-act="switch-mode" role="button" tabindex="0"><span class="menu-ic" style="background:var(--ink);color:var(--card)"><svg class="ic" viewBox="0 0 24 24"><path d="M5 7h12l-3-3M19 17H7l3 3M19 7l-3 3M5 17l3-3"/></svg></span><div class="menu-t"><div class="menu-name">切换数据空间</div><div class="menu-sub">两套数据独立保存，切换不会覆盖另一套</div></div>${chevron}</div></div>

    <div class="sec-title">危险操作</div>
    <div class="card rows"><div class="menu-row" data-act="clear-data" role="button" tabindex="0"><span class="menu-ic" style="background:var(--red);color:#fff"><svg class="ic" viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></span><div class="menu-t"><div class="menu-name" style="color:var(--red)">清空当前数据</div><div class="menu-sub">清空订单与流水，账号与设置保留；替换前自动备份</div></div>${chevron}</div></div>

    <div class="sec-title">关于与支持</div>
    <div class="card rows">
      <a class="menu-row" href="${LEGAL_BASE}privacy.html" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><span class="menu-ic" style="background:var(--blue-soft);color:var(--blue)"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3l7.5 3v6c0 4.4-3.1 8.2-7.5 9.5C7.6 20.2 4.5 16.4 4.5 12V6L12 3z"/></svg></span><div class="menu-t"><div class="menu-name">隐私政策</div><div class="menu-sub">纯本地运行 · 不收集、不上传任何数据</div></div>${chevron}</a>
      <a class="menu-row" href="${LEGAL_BASE}support.html" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><span class="menu-ic" style="background:var(--green-soft);color:var(--green)"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5a6 6 0 0 0-6 6v3.2l-1.6 3a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5l-1.6-3V9.5a6 6 0 0 0-6-6z"/><path d="M10 19.5a2 2 0 0 0 4 0"/></svg></span><div class="menu-t"><div class="menu-name">支持与常见问题</div><div class="menu-sub">备份、迁移、通知与导出问题</div></div>${chevron}</a>
      ${APP_STORE_URL?`<a class="menu-row" href="${APP_STORE_URL}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><span class="menu-ic" style="background:var(--brand-soft);color:var(--brand-ink)"><svg class="ic" viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg></span><div class="menu-t"><div class="menu-name">iOS 原生版 · 买断</div><div class="menu-sub">离线更稳 · 本地通知提醒</div></div>${chevron}</a>`:`<div class="menu-row" data-act="app-store-soon" role="button" tabindex="0"><span class="menu-ic" style="background:var(--brand-soft);color:var(--brand-ink)"><svg class="ic" viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg></span><div class="menu-t"><div class="menu-name">iOS 原生版 · 买断</div><div class="menu-sub">离线更稳 · 本地通知提醒</div></div><span class="tag-badge">即将上架</span></div>`}
      <div class="rsub" style="text-align:center;padding:12px 0 3px;color:var(--sub);white-space:normal">探记 HG · 数据仅存本机，请定期导出 JSON 备份</div>
    </div>`;
}
