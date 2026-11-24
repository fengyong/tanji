/* ================= 多账号体系 v0.6 + 单日勋章(P0 §3) ================= */
import {$,esc,nowStr} from './util.js';
import {db,save} from './storage.js';
import {ui,renderAll} from './ui.js';
import {showSheet,closeSheets,toast} from './sheets.js';

/* ================= 多账号体系 v0.6 ================= */
const ACC_COLORS=[
  {name:'蜜橙',bg:'#FFF3EC',ink:'#E85D1F'},
  {name:'雾蓝',bg:'#EEF4FF',ink:'#3E7BFA'},
  {name:'抹茶',bg:'#EDF7EF',ink:'#339966'},
  {name:'香芋',bg:'#F4EEFB',ink:'#8E5CD9'},
  {name:'杏黄',bg:'#FFF6E3',ink:'#C97C10'},
  {name:'玫瑰',bg:'#FCEFF2',ink:'#CE5478'},
  {name:'黛青',bg:'#EDF5F6',ink:'#3D8CA0'},
  {name:'卵石灰',bg:'#F2F2F6',ink:'#67676F'},
];
export const PRESET_PROVIDERS=['蜂向','小爱','金城','食物','直客'];
export const ACCS=()=>db.accounts||[];
export const accMulti=()=>ACCS().length>=2;
export const accById=id=>ACCS().find(a=>a.id===+id);
export const accColor=a=>ACC_COLORS[(a&&a.color!=null?a.color:0)%8];
export const providerList=()=>[...new Set([...PRESET_PROVIDERS,...(db.providers||[])])];
/*
 * 多账号的区分方式:行首一条 3px 账号色条,不再整行铺底色。
 * 整行底色会被卡片的 padding 和行间 0.5px 分隔线切成"白框套色块",账号一多就显得脏。
 */
export const accTint=o=>o&&accMulti()&&o.accountId!=null?`--acc:${accColor(accById(o.accountId)).ink}`:'';
export const accBar=o=>accTint(o)?' acc-bar':'';
export const accOrderTag=o=>accMulti()?accTagHTML(accById(o.accountId)):'';
export function accAvatarHTML(a,style=''){
  const c=accColor(a);
  if(a&&a.avatar)return `<span class="acc-avatar" style="background:${c.bg};${style}"><img src="${a.avatar}" alt=""></span>`;
  return `<span class="acc-avatar" style="background:${c.bg};color:${c.ink};${style}">${esc(a&&a.name?a.name.slice(0,1):'·')}</span>`;
}
export function accTagHTML(a){
  if(!a)return '<span class="acc-tag">未指定</span>';
  const c=accColor(a);
  const av=a.avatar?`<img class="tav" src="${a.avatar}" alt="">`:`<span class="tav" style="background:rgba(255,255,255,.72)">${esc(a.name.slice(0,1))}</span>`;
  return `<span class="acc-tag" style="color:${c.ink};background:${c.bg}">${av}${esc(a.name)}</span>`;
}
export function accChipbarHTML(){
  if(!accMulti())return '';
  const chip=(label,id)=>{
    const on=ui.accFilter===id;
    const a=id!=null?accById(id):null;
    const c=a?accColor(a):null;
    const style=a?(on?`background:${c.ink};color:#fff;font-weight:700`:`color:${c.ink};background:${c.bg};font-weight:600`):(on?'background:var(--ink);color:#fff':'');
    // 昵称来自输入或备份,导入校验只查「非空文本」:拼进 innerHTML 前在这里统一按文本转义。
    return `<span class="chip acc-chip${on?' on':''}" data-act="acc-filter" data-id="${id==null?'':id}" style="${style}">${esc(label)}</span>`;
  };
  let html=chip('全部',null);
  for(const a of ACCS())html+=chip(a.name,a.id);
  return `<div class="chipbar">${html}</div>`;
}
export function renderAccPick(elId,sel,multiple=false){
  const el=$('#'+elId);if(!el)return;
  if(!accMulti()){el.innerHTML='';return}
  const selected=new Set(multiple?(sel||[]):[sel]);
  // 编辑(单选)模式要给「未指定」:历史单/删过账号的单 accountId=null,
  // 没有这一项,多账号下订单一旦挂上就再也摘不回未指定(只能删账号这种破坏性操作)。
  // 新建(多选)模式不要——新建至少要选一个账号,与 saveOrder 的校验同口径。
  const unassigned=multiple?'':`<button type="button" class="acc-opt ${selected.has(null)?'sel':''}" data-act="acc-pick" data-id="" aria-pressed="${selected.has(null)}" style="${selected.has(null)?'border-color:var(--brand);background:var(--brand-soft)':''}">
      <span class="acc-dot"></span>${accAvatarHTML(null,'width:30px;height:30px;font-size:14px;border-radius:10px')}
      <span class="acc-name">未指定</span><span class="acc-cnt">${db.orders.filter(o=>o.accountId==null).length} 单</span></button>`;
  el.innerHTML=`<div style="padding:10px 2px 0"><div style="font-size:14px;font-weight:600">账号${multiple?'（可多选） <span style="color:var(--red)">*</span>':' <span class="rsub" style="font-weight:400">可改挂,也可设为「未指定」</span>'}</div>
    <div class="acc-sel">${unassigned}${ACCS().map(a=>{const c=accColor(a);const n=db.orders.filter(o=>o.accountId===a.id).length,on=selected.has(a.id);
      return `<button type="button" class="acc-opt ${multiple?'multi ':''}${on?'sel':''}" data-act="${multiple?'acc-toggle':'acc-pick'}" data-id="${a.id}" aria-pressed="${on}" style="${on?`border-color:${c.ink};background:${c.bg}`:''}">
        <span class="acc-dot">${multiple&&on?'✓':''}</span>${accAvatarHTML(a,'width:30px;height:30px;font-size:14px;border-radius:10px')}
        <span class="acc-name">${esc(a.name)}</span><span class="acc-cnt">${n} 单</span></button>`}).join('')}</div>
    <div class="rsub" style="margin:6px 2px 0">${multiple?'每个选中账号各生成一笔独立订单，后续分别维护':'点整行即选中;「未指定」= 不挂账号,可在统计页批量改挂'}</div></div>`;
}
export function renderProvPick(elId,val){
  const el=$('#'+elId);if(!el)return;
  el.innerHTML=`<div style="padding:10px 2px 0"><div style="font-size:14px;font-weight:600">服务商 <span class="rsub" style="font-weight:400;margin-left:4px">预设点选,或直接输入</span></div>
    <div class="chiprow" style="margin:8px 0 0">${providerList().map(p=>`<span class="chip prov-chip ${val===p?'on':'c-gray'}" data-act="prov-pick" data-v="${esc(p)}">${esc(p)}</span>`).join('')}</div>
    <div class="frow" style="border-bottom:none;padding:9px 0 0"><input id="${elId}-input" placeholder="输入自定义服务商…保存后自动记入预设" value="${esc(val&&!providerList().includes(val)?val:'')}" style="text-align:left;font-size:14px"></div></div>`;
  const input=el.querySelector('input');
  input.addEventListener('input',()=>{ui.draftProv=input.value.trim();el.querySelectorAll('.prov-chip').forEach(c=>c.classList.remove('on'))});
}
export function chanFromDraft(){
  const v=(ui.draftProv||'').trim()||'直客';
  if(!providerList().includes(v))db.providers=[...new Set([...(db.providers||[]),v])];
  return v;
}
export function openAccount(id){
  ui.editAccountId=id==null?null:+id;
  const a=id!=null?accById(id):null;
  ui.draftAvatar=a&&a.avatar||null;
  ui.draftColor=a?a.color:ACCS().length%8;
  $('#account-title').textContent=a?'编辑账号':'新建账号';
  $('#a-name').value=a?a.name:'';$('#a-phone').value=a?a.phone||'':'';$('#a-douyin').value=a?a.douyin||'':'';
  $('#a-err').style.display='none';
  $('#a-delete').style.display=a?'':'none';
  renderAvatarPreview();renderPal();
  showSheet('sheet-account');
}
export function renderAvatarPreview(){
  const c=ACC_COLORS[ui.draftColor%8];
  $('#a-avatar-preview').innerHTML=ui.draftAvatar
    ?`<span class="bigav" style="background:${c.bg}"><img src="${ui.draftAvatar}" alt=""></span>`
    :`<span class="bigav" style="background:${c.bg};color:${c.ink}">${esc($('#a-name').value.trim().slice(0,1)||'·')}</span>`;
}
export function renderPal(){
  const idx=ui.draftColor%8,cur=ACC_COLORS[idx];
  // 色点用「该账号的墨色」填充:浅底(bg)在白卡片上几乎看不出差别,墨色才一眼可辨,选中打勾+外圈。
  $('#a-pal').innerHTML=ACC_COLORS.map((c,i)=>
    `<button type="button" class="sw ${i===idx?'sel':''}" data-act="pal-pick" data-i="${i}" aria-label="${c.name}" title="${c.name}" style="background:${c.ink}"></button>`).join('');
  const label=$('#a-pal-name');
  if(label)label.innerHTML=`当前标识色:<b>${cur.name}</b> · 列表底色与行内小标同步跟随`;
}
export function saveAccount(){
  const name=$('#a-name').value.trim();
  const err=$('#a-err');
  if(!name){err.textContent='请填写昵称';err.style.display='block';return}
  err.style.display='none';
  const base={name,phone:$('#a-phone').value.trim(),douyin:$('#a-douyin').value.trim(),color:ui.draftColor%8};
  if(ui.draftAvatar)base.avatar=ui.draftAvatar;
  if(ui.editAccountId!=null){
    const target=accById(ui.editAccountId);
    Object.assign(target,base);
    // 「移除头像」:base 里没有 avatar 键,Object.assign 不会碰旧值 —— 必须显式删掉,
    // 否则预览里头像没了、提示「已保存账号」,库里的头像却原样还在
    if(!ui.draftAvatar)delete target.avatar;
    toast('已保存账号');
  }else{
    const maxId=ACCS().reduce((m,x)=>Math.max(m,x.id),0);
    db.accounts=[...ACCS(),{id:maxId+1,createdAt:nowStr(),...base}];
    toast('已添加账号');
  }
  save();closeSheets();renderAll();
}
export function deleteAccount(){
  const a=accById(ui.editAccountId);if(!a)return;
  const n=db.orders.filter(o=>o.accountId===a.id).length;
  if(!confirm(`删除「${a.name}」?其名下 ${n} 笔订单将变为「未指定」,可再改挂。`))return;
  db.accounts=ACCS().filter(x=>x.id!==a.id);
  db.orders.forEach(o=>{if(o.accountId===a.id)o.accountId=null});
  if(ui.accFilter===a.id)ui.accFilter=null;
  save();closeSheets();renderAll();toast('已删除账号');
}

/* ================= 单日勋章(激励) =================
 * ⭐ 忙碌日 ≥3 单 · 🔥 爆单 ≥5 单(点封顶 6)
 * 💰 千元日 ≥¥1,000 · 💎 王牌日 ≥¥2,500
 * 同日多枚只显示最高档:💎 > 🔥 > 💰 > ⭐
 * 阈值按大王 11 月真实峰值(单日 5 单 / ¥2,630)校准,确保可达 */
export function dayBadge(n,sum){
  if(sum>=2500)return {e:'💎',t:'王牌日'};
  if(n>=5)return {e:'🔥',t:'爆单'};
  if(sum>=1000)return {e:'💰',t:'千元日'};
  if(n>=3)return {e:'⭐',t:'忙碌日'};
  return null;
}
