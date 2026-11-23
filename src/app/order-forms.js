/* ================= 新建预约 + 编辑订单 + 随手拍输入(P0 §3) ================= */
import {$,esc,fmtHM,TODAY,validDateTime,nowStr} from './util.js';
import {db,Store,save} from './storage.js';
import {Notify} from './notify.js';
import {ui,showTab,renderAll} from './ui.js';
import {moneyCents,byId,gpsText,hasAnyReceipt,paymentSpec,hasReceipt,unDep,unFin,needMain,needSub} from './derived.js';
import {showSheet,closeSheets,toast} from './sheets.js';
import {ACCS,accMulti,renderAccPick,renderProvPick,chanFromDraft} from './accounts.js';
import {pay,capturePlace,clearSnooze} from './order-actions.js';
import {openDetail,rerenderDetail} from './detail.js';

/* ================= 新建预约(含时段冲突提醒,不禁止) ================= */
function toMin(appt){return +appt.slice(11,13)*60 + +appt.slice(14,16)}
/* 冲突提示要能支撑"要不要接/要不要跨区"的判断:只报门店名不够,
 * 必须带上已是几点、在哪(手填地点优先,没填就退到到店定位的坐标)。 */
function conflictLine(o){
  const place=(o.location||'').trim()||gpsText(o);
  return `${esc(fmtHM(o.appt))} 「${esc(o.store)}」${place?` · ${esc(place)}`:''}`;
}
export function conflictFor(date,time,excludeId){
  const {same,overlap}=TanJiLogic.apptOverlap(db.orders,date,time,excludeId);
  if(!same.length)return '';
  const rows=list=>list.map(o=>`<div>· ${conflictLine(o)}</div>`).join('');
  if(overlap.length)return `<b>该时段已有排期(前后 2 小时内):</b>${rows(overlap)}不影响保存——可找人代拍或错峰。`;
  return `<b>当天已有 ${same.length} 个排期:</b>${rows(same)}`;
}
export function updateConflict(){
  const el=$('#f-conflict');
  const date=$('#f-date').value,time=$('#f-time').value||'10:00';
  const msg=conflictFor(date,time,0);
  if(msg){el.innerHTML=msg;el.style.display='block'}else el.style.display='none';
}
export function openNew(){
  $('#f-store').value='';$('#f-price').value='';$('#f-deposit').value='';
  $('#f-contact').value='';$('#f-note').value='';$('#f-settle').value='private';
  $('#f-partner').value='';$('#f-location').value='';
  $('#f-need-main').checked=true;$('#f-need-sub').checked=false;
  $('#f-date').value=TODAY;$('#f-time').value='10:00';$('#f-err').style.display='none';
  ui.draftProv='';ui.draftAccId=ACCS().length?ACCS()[0].id:null;
  renderAccPick('f-acc-block',ui.draftAccId);renderProvPick('f-prov-block','');
  updateConflict();
  showSheet('sheet-new');
}
export function saveOrder(){
  const fail=message=>{const el=$('#f-err');el.textContent=message;el.style.display='block'};
  const store=$('#f-store').value.trim();
  const priceCents=moneyCents($('#f-price').value),depositCents=moneyCents($('#f-deposit').value,true);
  if(!store){fail('请填写商家名称');return}
  if(priceCents===null||depositCents===null||depositCents>priceCents){fail('总价和定金须为有效非负金额，最多两位小数，定金不能超过总价');return}
  const needMain=$('#f-need-main').checked,needSub=$('#f-need-sub').checked;
  if(!needMain&&!needSub){fail('出片要求至少要勾选正片或副片');return}
  if(accMulti()&&ui.draftAccId==null){fail('请选择账号');return}
  const date=$('#f-date').value||TODAY,time=$('#f-time').value||'10:00',appt=`${date}T${time}`;
  const settleVia=$('#f-settle').value;
  if(!validDateTime(appt)){fail('请填写有效的预约日期和时间');return}
  if(!['private','douyin'].includes(settleVia)){fail('请选择有效的结算方式');return}
  const maxId=db.orders.reduce((max,x)=>Number.isSafeInteger(x.id)&&x.id>0?Math.max(max,x.id):NaN,0);
  const id=maxId+1;
  if(!Number.isSafeInteger(id)||id<1){fail('订单编号超出安全范围或已有异常编号，无法新建');return}
  // 通知 id 分段要求 orderId<100000(见 storage.js NOTIFY_OFFSET),个人记账远达不到,到顶直接拦下
  if(id>=100000){fail('订单编号已达上限(99999),请先导出备份并联系支持');return}
  const o={id,store,cat:$('#f-cat').value,
    contact:$('#f-contact').value.trim(),price:priceCents/100,deposit:depositCents/100,settleVia,
    channel:chanFromDraft(),partner:$('#f-partner').value.trim(),
    accountId:ACCS().length?(accMulti()?ui.draftAccId:ACCS()[0].id):null,
    location:$('#f-location').value.trim(),deliverMain:needMain,deliverSub:needSub,reviewResult:'',publishedAt:null,
    appt,shotAt:null,submittedAt:null,shortAt:null,longAt:null,
    depositPaidAt:null,finalPaidAt:null,remindAt:null,note:$('#f-note').value.trim()};
  db.orders.push(o);save();Notify.syncDeliver();
  closeSheets();ui.selDay=date;ui.vMon={y:+date.slice(0,4),m:+date.slice(5,7)};showTab('trip');renderAll();
  toast(`已添加预约:${store}`);
}

/* ================= 编辑订单(全环节可改) ================= */
const EDIT_FIELDS=['e-store','e-cat','e-settle','e-partner','e-location','e-date','e-time','e-price','e-deposit','e-contact','e-note'];
const EDIT_CHECKS=['e-need-main','e-need-sub'];
/* 隐私模式:编辑弹层的金额输入框留空 + 占位符,取值时回落到原值。
   (直接把值遮成 ✱✱✱ 会让 type=number 变成非法值,保存时反而报「金额不合法」) */
const moneyFieldValue=(id,fallback)=>{
  const el=$('#'+id);
  if(!el)return fallback;
  if(el.dataset.masked==='1')return fallback;
  return el.value;
};
function editDraft(){return JSON.stringify([EDIT_FIELDS.map(id=>{const el=$('#'+id);return el?el.value:''}),EDIT_CHECKS.map(id=>{const el=$('#'+id);return el?el.checked:false}),ui.draftProv,ui.draftAccId])}
function renderEditReceipts(o){
  const locked=hasAnyReceipt(o),masked=ui.privacy;
  $('#e-price').readOnly=locked||masked;$('#e-deposit').readOnly=locked||masked;
  $('#e-money-help').textContent=masked
    ?'隐私模式已隐藏金额：总价与定金暂不可查看、不可修改，关掉隐私模式（右上角眼睛）后再编辑。'
    :locked?'已有收款记录或已收标记，不能修改总价和定金；请先撤销错误收款再改。':'金额最多两位小数，定金不能超过总价；支持 0 元无定金。';
  $('#e-payments').innerHTML=['deposit','final'].map(kind=>{
    const spec=paymentSpec(kind),received=hasReceipt(o,kind),due=kind==='deposit'?unDep(o):unFin(o);
    if(!received&&due<=0)return '';
    return `<button class="btn ${received?'ghost':kind==='deposit'?'tint-blue':'tint-green'}" data-act="${kind==='deposit'?'toggle-dep':'toggle-fin'}" data-oid="${esc(o.id)}">${received?'撤销'+spec.label+'记录':'补记'+spec.label+'已收'}</button>`;
  }).join('')||'<div class="rsub">没有待收款项或可撤销的收款记录</div>';
}
export function toggleReceipt(oid,kind){
  const o=byId(oid),spec=paymentSpec(kind);
  if(!o||!spec||ui.editId!==oid)return;
  if(hasReceipt(o,kind)){
    if(!confirm('撤销'+spec.label+'记录并删除对应流水？仅用于纠正错误收款，不表示退款。'))return;
    o[spec.field]=null;
    db.payments=db.payments.filter(p=>!(p.oid===oid&&(p.kind===spec.label||p.kind===kind)));
    save();renderAll();Notify.syncDaily();toast('已撤销'+spec.label+'记录(含流水)');
  }else{
    if(editDraft()!==ui.editSnapshot){toast('有未保存的修改，请先保存，再补记收款');return}
    if(!pay(oid,kind,o.settleVia==='douyin'?'抖音商单':'微信'))return;
  }
  renderEditReceipts(o);
}
export function openEdit(oid){
  const o=byId(oid);if(!o)return;
  ui.editId=oid;ui.payCtx=null;
  const cats=['咖啡','餐饮','烧烤','火锅','茶饮','甜品','烘焙','美发','健身','民宿','零售','体验馆','露营','服饰','快餐','其他'];
  const catOpts=[...new Set([o.cat||'其他',...cats])];
  $('#edit-body').innerHTML=`
    <div class="frow"><label>品名/商家</label><input id="e-store" value="${esc(o.store||'')}"></div>
    <div class="frow"><label>类型</label><select id="e-cat">${catOpts.map(c=>`<option ${c===o.cat?'selected':''}>${esc(c)}</option>`).join('')}</select></div>
    <div class="frow"><label>结算方式</label><select id="e-settle"><option value="private" ${o.settleVia!=='douyin'?'selected':''}>私收(微信/支付宝/银行卡)</option><option value="douyin" ${o.settleVia==='douyin'?'selected':''}>抖音商单(平台结算)</option></select></div>
    <div id="e-acc-block"></div>
    <div id="e-prov-block"></div>
    <div class="frow"><label>组队</label><input id="e-partner" value="${esc(o.partner||'')}" placeholder="组队/出镜搭档,单人拍摄可空"></div>
    <div class="frow"><label>地点</label><input id="e-location" value="${esc(o.location||'')}" placeholder="如:万象城 3 层"></div>
    <div class="frow"><label>预约日期</label><input id="e-date" type="date" value="${esc((o.appt||'').slice(0,10))}"></div>
    <div class="frow"><label>预约时间</label><input id="e-time" type="time" value="${esc((o.appt||'').slice(11,16))}"></div>
    <div class="frow"><label>出片要求</label><div style="display:flex;gap:22px;align-items:center;padding:6px 2px">
      <label style="display:flex;gap:7px;align-items:center;font-size:14px"><input type="checkbox" id="e-need-main" ${needMain(o)?'checked':''} style="width:17px;height:17px;accent-color:var(--brand)"> 正片</label>
      <label style="display:flex;gap:7px;align-items:center;font-size:14px"><input type="checkbox" id="e-need-sub" ${needSub(o)?'checked':''} style="width:17px;height:17px;accent-color:var(--brand)"> 副片</label>
    </div></div>
    <div class="frow"><label>送审结果</label><select id="e-review">
      <option value="" ${!o.reviewResult?'selected':''}>未送审/待审</option>
      <option value="pass" ${o.reviewResult==='pass'?'selected':''}>合格</option>
      <option value="fail" ${o.reviewResult==='fail'?'selected':''}>不合格</option>
    </select></div>
    <div class="frow"><label>总价(¥)</label><input id="e-price" type="number" inputmode="decimal" min="0" step="0.01" value="${ui.privacy?'':esc(o.price)}"${ui.privacy?' placeholder="¥✱✱✱" data-masked="1" readonly':''}></div>
    <div class="frow"><label>定金(¥)</label><input id="e-deposit" type="number" inputmode="decimal" min="0" step="0.01" value="${ui.privacy?'':esc(o.deposit)}"${ui.privacy?' placeholder="¥✱✱✱" data-masked="1" readonly':''}></div>
    <div class="rsub" id="e-money-help" style="margin:6px 0;line-height:1.5"></div>
    <div class="frow"><label>联系方式</label><input id="e-contact" value="${esc(o.contact||'')}"></div>
    <div class="frow"><label>备注</label><textarea id="e-note" rows="2">${esc(o.note||'')}</textarea></div>
    <div class="banner-amber" id="e-conflict"></div>
    <div class="sec-title">收款记录(可撤销 / 补记)</div>
    <div class="btn2" id="e-payments"></div>
    <div class="rsub" style="margin-top:6px;line-height:1.5">补记前请先保存修改；按已保存金额记一笔，平台单使用抖音商单，私收默认微信。撤销仅用于纠正错误收款，会同时移除对应流水。</div>`;
  ui.draftProv=o.channel||'直客';ui.draftAccId=o.accountId??(ACCS().length?ACCS()[0].id:null);
  renderAccPick('e-acc-block',ui.draftAccId);renderProvPick('e-prov-block',ui.draftProv);
  renderEditReceipts(o);ui.editSnapshot=editDraft();
  updateEditConflict();
  ['e-date','e-time'].forEach(id=>{
    $('#'+id).addEventListener('change',updateEditConflict);
    $('#'+id).addEventListener('input',updateEditConflict);
  });
  showSheet('sheet-edit');
}
function updateEditConflict(){
  const el=$('#e-conflict');
  const date=$('#e-date').value,time=$('#e-time').value||'10:00';
  const msg=conflictFor(date,time,ui.editId);
  if(msg){el.innerHTML=msg;el.style.display='block'}else el.style.display='none';
}
export function saveEdit(){
  const o=byId(ui.editId);if(!o)return;
  const store=$('#e-store').value.trim();
  const priceCents=moneyCents(moneyFieldValue('e-price',o.price)),depositCents=moneyCents(moneyFieldValue('e-deposit',o.deposit),true);
  if(!store){toast('请填写商家名称');return}
  if(priceCents===null||depositCents===null||depositCents>priceCents){toast('总价和定金须为有效非负金额，最多两位小数，定金不能超过总价');return}
  if(hasAnyReceipt(o)&&(priceCents!==moneyCents(o.price)||depositCents!==moneyCents(o.deposit))){toast('已有收款记录，请先撤销错误收款，再修改总价或定金');return}
  const date=$('#e-date').value||TODAY,time=$('#e-time').value||'10:00',appt=`${date}T${time}`;
  const settleVia=$('#e-settle').value;
  if(!validDateTime(appt)){toast('请填写有效的预约日期和时间');return}
  if(!['private','douyin'].includes(settleVia)){toast('请选择有效的结算方式');return}
  const needMain=$('#e-need-main').checked,needSub=$('#e-need-sub').checked;
  if(!needMain&&!needSub){toast('出片要求至少要勾选正片或副片');return}
  if(accMulti()&&ui.draftAccId==null){toast('请选择账号');return}
  o.store=store;o.cat=$('#e-cat').value;o.settleVia=settleVia;
  o.channel=chanFromDraft();o.partner=$('#e-partner').value.trim();
  o.location=$('#e-location').value.trim();
  o.accountId=ACCS().length?(accMulti()?ui.draftAccId:ACCS()[0].id):null;
  o.deliverMain=needMain;o.deliverSub=needSub;o.reviewResult=$('#e-review').value;
  o.appt=appt;o.price=priceCents/100;o.deposit=depositCents/100;
  o.contact=$('#e-contact').value.trim();o.note=$('#e-note').value.trim();
  // 私收单改成平台单(平台单不催收),或改完后尾款已无待收:原先设的催收备忘失效
  if(o.settleVia==='douyin'||unFin(o)<=0)clearSnooze(o);
  const returnDetail=ui.detail===o.id?o.id:null;
  save();closeSheets();renderAll();Notify.syncDeliver();Notify.syncDaily();
  if(returnDetail!==null)openDetail(returnDetail);
  toast('已保存修改');
}

export function initShotInput(){
  const input=$('#shot-file');
  input.addEventListener('change',async()=>{
    const file=input.files&&input.files[0];input.value='';
    if(!file)return;
    // 只读保护:shot-pick 在 blocked 白名单里、能打开相册,但这个 change 处理器
    // 不经过 data-act 守卫——不拦的话用户会看到"已随手拍"的成功提示,实际 save 被
    // Store.blocked 拦下,什么都没存上
    if(Store.blocked){toast('本机数据读取异常,写入已暂停;请先点「重试保存 / 读取」');return}
    const target=byId(ui.detail);
    if(!target){toast('先打开一笔订单再拍');return}
    try{
      // 原图只在内存里过一次,入库的永远是烘焙过淡化的小图(约 3KB),备份和全量重写都不会被撑爆
      target.photoThumb=await TanJiImage.doorThumb(file);
      if(!target.shotAt)target.shotAt=nowStr();   // 到店拍照 = 开始拍摄,不用再点一次"标记已拍摄"
      await save();renderAll();rerenderDetail();
      // 随手拍会写 shotAt,和「标记已拍摄」是同一条路径 —— 必须同样重排出片提醒,
      // 否则打卡拍的这一单永远收不到 24h 提醒(App 内红角标却照常显示)。
      Notify.syncDeliver();
      toast('已随手拍 · 拍摄时间已记录');
      capturePlace(target.id);                    // 拍照当下顺手记一次位置,不阻塞上面的保存
    }catch(e){toast('这张图处理不了,换一张试试')}
  });
}
