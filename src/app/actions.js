/* ================= 事件委托(P0 §3;P0-3 起改为 action 注册表) ================= */
import {$,esc,pad,now,TODAY,dOff,fmtD,copyText} from './util.js';
import {isNative} from './env.js';
import {toggleAmountPrivacy,privacyFailureMessage} from './privacy.js';
import {ui,showTab,openSettings,closeSettings,renderAll,refreshClock} from './ui.js';
import {db,Store,save,switchMode,replaceData,loadState,accountCopyText} from './storage.js';
import {Notify} from './notify.js';
import {byId,isOver,snoozed,REVIEW_LABEL} from './derived.js';
import {ACCS,accById,accColor,accAvatarHTML,renderAccPick,renderProvPick,renderPal,renderAvatarPreview,openAccount,saveAccount,deleteAccount} from './accounts.js';
import {openNew,saveOrder,duplicateOrder,openEdit,saveEdit,toggleReceipt,updateConflict} from './order-forms.js';
import {mark,pay,openPay,capturePlace,openRemind,saveRemind,openExpect,saveExpect,clearExpect,MILE_ORDER} from './order-actions.js';
import {openDetail,rerenderDetail,MILE_LABEL} from './detail.js';
import {closeSheets,showSheet,toast,dismissToast} from './sheets.js';
import {exportCsv,exportJson,exportDb,download,openImportPicker,confirmImport,restoreCheckpoint,exportCheckpoint} from './export.js';
import {shareToday} from './share-image.js';
import {closeCrop,useCrop} from './avatar-crop.js';
import {renderOrders} from './views/orders.js';
import {renderPay} from './views/pay.js';
import {renderStats} from './views/stats.js';
import {renderTrip} from './views/trip.js';

/* ================= 动作注册表(P0-3) =================
 * 事件委托只保留守卫与分发;每个动作具名注册,可静态枚举 —
 * wiring 测试据此断言「markup 全部 data-act ⊆ 已注册动作」,
 * 少注册一个就是「看得见点不动」,测试必红。 */
const ACTIONS={};
export function registerAction(name,fn){ACTIONS[name]=fn}
export function actionNames(){return Object.keys(ACTIONS)}

registerAction('tab',(t,oid)=>{
  showTab(t.dataset.tab);
});

registerAction('open-settings',()=>{
  openSettings();
});

registerAction('close-settings',()=>{
  closeSettings();
});

registerAction('open',(t,oid)=>{
  openDetail(oid);
});

registerAction('close-sheet',(t,oid)=>{
  closeSheets();
});

registerAction('new-order',(t,oid)=>{
  openNew();
});

registerAction('save-order',(t,oid)=>{
  saveOrder();
});

registerAction('goto-collect',(t,oid)=>{
  ui.bucket=db.orders.some(o=>isOver(o)&&!snoozed(o))?'over':'snoozed';showTab('pay');renderAll();
});

registerAction('chip',(t,oid)=>{
  ui.chip=t.dataset.chip;renderOrders();
});

registerAction('bucket',(t,oid)=>{
  ui.bucket=t.dataset.bucket;renderPay();
});

registerAction('period',(t,oid)=>{
  ui.period=t.dataset.period;renderStats();
});

registerAction('day',(t,oid)=>{
  const day=t.dataset.day||ui.selDay;
      ui.selDay=day;
      const dy=+day.slice(0,4),dm=+day.slice(5,7);
      if(dy!==ui.vMon.y||dm!==ui.vMon.m)ui.vMon={y:dy,m:dm};   // 从「未来 7 天」点到下个月的日子时同步翻月
      renderTrip();
});

registerAction('mnav',(t,oid)=>{
  let m=ui.vMon.m+ +t.dataset.d, y=ui.vMon.y;
      if(m<1){m=12;y--} if(m>12){m=1;y++}
      ui.vMon={y,m};ui.selDay=`${y}-${pad(m)}-${pad(Math.min(+ui.selDay.slice(8,10),new Date(y,m,0).getDate()))}`;renderTrip();
});

registerAction('mtoday',(t,oid)=>{
  ui.vMon={y:now.getFullYear(),m:now.getMonth()+1};ui.selDay=TODAY;renderTrip();
});

registerAction('mark-shot',(t,oid)=>{
  if(mark(oid,'shotAt','已记录实际拍摄时间 ✓'))capturePlace(oid);
});

registerAction('nav-place',(t,oid)=>{
  const o=byId(oid);if(!o)return;
      const url=(t.dataset.gps||!o.location)
        ?TanJiGeo.mapUrl({place:o.gpsPlace,name:o.store})
        :TanJiGeo.mapUrl({query:o.location});
      if(!url){toast('这单还没有地点,先填地点或记录当前位置');return;}
      if(!TanJiGeo.open(url))toast('打不开地图,请手动搜索该地址');
});

registerAction('locate-now',(t,oid)=>{
  const o=byId(oid);if(!o)return;
      toast('正在获取当前位置…');
      TanJiGeo.locate().then(place=>{
        const cur=byId(oid);if(!cur)return;
        cur.gpsPlace=place;save();renderAll();rerenderDetail();
        toast('已记录到店定位 ✓');
      }).catch(()=>toast('定位失败,请确认已允许「使用 App 期间」定位'));
});

registerAction('mark-submit',(t,oid)=>{
  mark(oid,'submittedAt','已标记提审 ✓');
});

registerAction('mark-short',(t,oid)=>{
  mark(oid,'shortAt','已标记发副片 ✓');
});

registerAction('mark-long',(t,oid)=>{
  mark(oid,'longAt','已标记发正片 ✓');
});

registerAction('acc-filter',(t,oid)=>{
  ui.accFilter=t.dataset.id===''?null:+t.dataset.id;renderAll();
});

registerAction('acc-pick',(t,oid)=>{
  // data-id="" 是「未指定」项:+'' 会得到 0,必须显式转 null
  ui.draftAccId=t.dataset.id===''?null:+t.dataset.id;renderAccPick('e-acc-block',ui.draftAccId);
});

registerAction('acc-toggle',(t,oid)=>{
  const id=+t.dataset.id;if(!accById(id))return;
  const selected=new Set(ui.draftAccIds||[]);
  if(selected.has(id))selected.delete(id);else selected.add(id);
  ui.draftAccIds=[...selected];ui.draftAccId=ui.draftAccIds[0]??null;
  renderAccPick('f-acc-block',ui.draftAccIds,true);
});

registerAction('prov-pick',(t,oid)=>{
  ui.draftProv=t.dataset.v;{const ctx=t.closest('[id$="-block"]');if(ctx)renderProvPick(ctx.id,ui.draftProv);}
});

registerAction('pal-pick',(t,oid)=>{
  ui.draftColor=+t.dataset.i;renderPal();renderAvatarPreview();
});

registerAction('open-account',(t,oid)=>{
  openAccount(t.dataset.id!=null?+t.dataset.id:null);
});

registerAction('save-account',(t,oid)=>{
  saveAccount();
});

registerAction('delete-account',(t,oid)=>{
  deleteAccount();
});

registerAction('pick-avatar',(t,oid)=>{
  $('#avatar-file').click();
});

registerAction('shot-pick',(t,oid)=>{
  $('#shot-file').click();
});

registerAction('shot-clear',(t,oid)=>{
  const target=byId(oid);
      if(!target||!target.photoThumb)return;
      if(!confirm('删除这张随手拍照?'))return;
      target.photoThumb=null;save();renderAll();rerenderDetail();toast('照片已删除');
});

registerAction('remove-avatar',(t,oid)=>{
  ui.draftAvatar=null;renderAvatarPreview();
});

registerAction('crop-cancel',(t,oid)=>{
  closeCrop();
});

registerAction('crop-use',(t,oid)=>{
  useCrop();
});

registerAction('copy-account',(t,oid)=>{
  const a=accById(t.dataset.id);
      if(!a){toast('该订单未指定账号,无资料可拷');return;}
      copyText(accountCopyText(a)).then(ok=>toast(ok?`已拷贝「${a.name}」资料 ✓`:'拷贝失败,请手动长按复制'));
});

registerAction('assign-open',(t,oid)=>{
  ui.assignAcc=ACCS()[0]?ACCS()[0].id:null;
      $('#assign-list').innerHTML=ACCS().map(a=>{const c=accColor(a);
        return `<button type="button" class="acc-opt ${ui.assignAcc===a.id?'sel':''}" data-act="assign-pick" data-id="${a.id}" style="${ui.assignAcc===a.id?`border-color:${c.ink};background:${c.bg}`:''}">
          <span class="acc-dot"></span>${accAvatarHTML(a,'width:30px;height:30px;font-size:14px;border-radius:10px')}
          <span class="acc-name">${esc(a.name)}</span><span class="acc-cnt">${db.orders.filter(o=>o.accountId===a.id).length} 单</span></button>`}).join('');
      showSheet('sheet-assign');
});

registerAction('assign-pick',(t,oid)=>{
  ui.assignAcc=+t.dataset.id;{const list=$('#assign-list');list.querySelectorAll('.acc-opt').forEach(el=>{const sel=+el.dataset.id===ui.assignAcc;el.classList.toggle('sel',sel);el.style.borderColor=sel?accColor(accById(ui.assignAcc)).ink:'';el.style.background=sel?accColor(accById(ui.assignAcc)).bg:'';});}
});

registerAction('assign-run',(t,oid)=>{
  const n=db.orders.filter(o=>o.accountId==null).length;
      if(!n){toast('没有未指定的订单');return;}
      if(ui.assignAcc==null){toast('先选一个账号');return;}
      db.orders.forEach(o=>{if(o.accountId==null)o.accountId=ui.assignAcc});
      save();closeSheets();renderAll();toast(`已把 ${n} 笔订单改挂到「${accById(ui.assignAcc).name}」`);
});

registerAction('set-review',(t,oid)=>{
  const o=byId(oid),v=t.dataset.v;
      if(!o||!['pass','fail'].includes(v))return;
      o.reviewResult=o.reviewResult===v?'':v;
      save();renderAll();rerenderDetail();
      toast(o.reviewResult?`已标记${REVIEW_LABEL[o.reviewResult]}`:'已清除送审结果');
});

registerAction('open-pay',(t,oid)=>{
  openPay(oid,t.dataset.kind);
});

registerAction('pay-method',(t,oid)=>{
  if(ui.payCtx){ui.payCtx.method=t.dataset.m;openPay(ui.payCtx.oid,ui.payCtx.kind,ui.payCtx.method)}
});

registerAction('confirm-pay',(t,oid)=>{
  const ctx=ui.payCtx;ui.payCtx=null;
      if(!ctx){toast('收款操作已结束，请重新打开收款');return;}
      const returnDetail=ui.detail===ctx.oid?ctx.oid:null;
      closeSheets();pay(ctx.oid,ctx.kind,ctx.method);
      if(returnDetail!==null&&byId(returnDetail))openDetail(returnDetail);
});

registerAction('snooze',(t,oid)=>{
  const o=byId(oid);if(o){const d=+t.dataset.d;o.remindAt=dOff(d,'09:00');save();renderAll();rerenderDetail();Notify.scheduleSnooze(o,d);Notify.syncDaily();toast(`已备忘:${d} 天后(${fmtD(o.remindAt)})提醒催收 ✓`)}
});

registerAction('notify-toggle',(t,oid)=>{
  Notify.toggle();
});

registerAction('clear-remind',(t,oid)=>{
  const o=byId(oid);if(o){o.remindAt=null;save();renderAll();rerenderDetail();Notify.cancelSnooze(oid);Notify.syncDaily();toast('已清除催收提醒')}
});

registerAction('remind-open',(t,oid)=>{
  openRemind(oid);
});

registerAction('remind-quick',(t,oid)=>{
  const el=$('#remind-note');if(el){el.value=t.dataset.v||'';if(el.focus)el.focus()}
});

registerAction('remind-save',(t,oid)=>{
  saveRemind();
});

registerAction('expect-open',(t,oid)=>{
  openExpect(oid);
});

registerAction('expect-save',(t,oid)=>{
  saveExpect();
});

registerAction('expect-clear',(t,oid)=>{
  clearExpect(oid);
});

registerAction('toast-undo',(t,oid)=>{
  const action=dismissToast();
      if(action&&typeof action.run==='function')action.run();
});

registerAction('mile',(t,oid)=>{
  const o=byId(oid),key=t.dataset.key;
      if(!o||!Object.prototype.hasOwnProperty.call(MILE_LABEL,key))return;
      if(o[key]){
        const after=MILE_ORDER.slice(MILE_ORDER.indexOf(key)+1).filter(k=>o[k]);
        // 清「拍摄」时门口的随手照也留不住:photoThumb 是「到过店」的视觉凭据,
        // 时间线清了它还在,列表金额格照样铺底图,就成了「未拍摄却到过店」的矛盾态
        const photoNote=key==='shotAt'&&o.photoThumb?'门口的随手照也会一并删除。':'';
        const msg=after.length?`清除「${MILE_LABEL[key]}」？其后的「${after.map(k=>MILE_LABEL[k]).join('」「')}」也将一并清除。`:`清除「${MILE_LABEL[key]}」记录?`;
        if(confirm(msg+photoNote)){[key,...after].forEach(k=>o[k]=null);if(key==='shotAt')delete o.photoThumb;save();renderAll();rerenderDetail();Notify.syncDeliver();Notify.syncDaily();toast('已清除,可重新标记')}
      }
      else if(mark(oid,key,'已标记「'+MILE_LABEL[key]+'」')&&key==='shotAt')capturePlace(oid);
});

registerAction('copy-order',(t,oid)=>{
  duplicateOrder(oid);
});

registerAction('edit-order',(t,oid)=>{
  openEdit(oid);
});

registerAction('save-edit',(t,oid)=>{
  saveEdit();
});

registerAction('toggle-dep',(t,oid)=>{
  toggleReceipt(oid,'deposit');
});

registerAction('toggle-fin',(t,oid)=>{
  toggleReceipt(oid,'final');
});

registerAction('privacy',async()=>{
  if(isNative){
    try{ui.privacy=await toggleAmountPrivacy()}
    catch(error){toast(privacyFailureMessage(error));return}
  }else ui.privacy=!ui.privacy;
  renderAll();rerenderDetail();toast(ui.privacy?(isNative?'已隐藏金额 · 仅 Face ID 可恢复':'已隐藏金额 · 截图模式'):'已恢复显示金额');
});

registerAction('app-store-soon',(t,oid)=>{
  toast('iOS 原生版即将上架,上线后可直接在 App Store 买断');
});

registerAction('share',(t,oid)=>{
  shareToday();
});

registerAction('share-confirm',(t,oid)=>{
  if(ui.shareBlob){
        const name='拍摄行程-'+ui.shareDay+'.png';
        const file=new File([ui.shareBlob],name,{type:'image/png'});
        if(navigator.canShare&&navigator.canShare({files:[file]})){navigator.share({files:[file],title:ui.shareDay+' 拍摄行程'}).catch(error=>{if(error.name!=='AbortError')toast('分享失败，请重试')})}
        else{download(name,ui.shareBlob,'image/png');toast('图片已保存')}
      }
});

registerAction('del-order',(t,oid)=>{
  if(confirm('删除该订单及其流水?')){db.orders=db.orders.filter(o=>o.id!==oid);db.payments=db.payments.filter(p=>p.oid!==oid);save();closeSheets();renderAll();Notify.cancelOrder(oid);Notify.syncDaily();toast('订单已删除')}
});

registerAction('export-csv',(t,oid)=>{
  exportCsv();
});

registerAction('export-json',(t,oid)=>{
  exportJson();
});

registerAction('export-db',(t,oid)=>{
  exportDb();
});

registerAction('open-schema',(t,oid)=>{
  showSheet('sheet-schema');
});

registerAction('th',(t,oid)=>{
  const opts=[7,15,30,45];let i=opts.indexOf(db.threshold);
      i=Math.min(opts.length-1,Math.max(0,i+ +t.dataset.v));
      db.threshold=opts[i];save();renderAll();rerenderDetail();Notify.syncDaily();
      toast(`催收阈值已设为 ${db.threshold} 天`);
});

registerAction('import-json',(t,oid)=>{
  openImportPicker();
});

registerAction('confirm-import',(t,oid)=>{
  confirmImport();
});

registerAction('restore-backup',(t,oid)=>{
  restoreCheckpoint();
});

registerAction('switch-mode',(t,oid)=>{
  switchMode(Store.mode==='demo'?'work':'demo');
});

registerAction('clear-data',(t,oid)=>{
  // 账号资料与服务商预设跟 notifyEnabled 一样随清空保留:用户"重新开始记账"
      // 不该把精心录好的账号资料一并抹掉(订单与流水才是"数据"的本体)
      if(confirm('清空当前数据？订单与流水会清空，账号与设置保留，替换前会自动备份。'))replaceData({orders:[],payments:[],threshold:db.threshold,notifyEnabled:db.notifyEnabled,accounts:db.accounts||[],providers:db.providers||[]}).then(ok=>{if(ok)toast('已清空，替换前数据可在设置页恢复')});
});

registerAction('export-checkpoint',(t,oid)=>{
  exportCheckpoint();
});

registerAction('retry-storage',(t,oid)=>{
  if(Store.lockedOut){location.reload()}else if(Store.blocked){loadState().then(()=>{closeSheets();renderAll();showTab('home')})}else save();
});

/* ================= 事件委托(守卫逐行保留) ================= */
/* toggle/步进类动作的同目标防连点:隐私开关、送审结果、催收阈值、通知开关都是
   「再点一次 = 回到原状」或「数字跳一格」的语义。用户只点了一下,UI 却像没反应
   (开关被抵消)或阈值连跳两格。同一目标 350ms 内的重复点击直接忽略;
   换一个目标(另一行、另一个 chip)不受影响。 */
const TAP_GUARD=new Set(['privacy','set-review','th','notify-toggle']);
let lastTap={act:'',oid:0,at:0};
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-act]');if(!t)return;
  const act=t.dataset.act,oid=+t.dataset.oid||0;
  if(!Store.ready||Store.busy){toast('正在读写数据，请稍候');return}
  if(Store.blocked&&!['retry-storage','export-json','export-csv','export-db','export-checkpoint','tab','open-settings','close-settings','open','close-sheet','privacy','app-store-soon','goto-collect','chip','bucket','period','day','mnav','mtoday','share','share-confirm','open-schema','open-account','acc-filter','acc-pick','prov-pick','pal-pick','copy-account','assign-open','pick-avatar','crop-cancel','crop-use','shot-pick','nav-place','remind-open','expect-open'].includes(act)){toast('为保护原数据，写入已暂停，请先重试读取');return}
  refreshClock();
  const fn=ACTIONS[act];
  if(fn){
    if(TAP_GUARD.has(act)){
      const now=Date.now();
      if(act===lastTap.act&&oid===lastTap.oid&&now-lastTap.at<350)return;
      lastTap={act,oid,at:now};
    }
    fn(t,oid);
  }
});
['f-date','f-time'].forEach(id=>$('#'+id).addEventListener('change',updateConflict));
['f-date','f-time'].forEach(id=>$('#'+id).addEventListener('input',updateConflict));
