/* ================= 事件委托(P0 §3;P0-3 起改为 action 注册表) ================= */
import {$,esc,pad,now,TODAY,dOff,fmtD,copyText} from './util.js';
import {ui,showTab,renderAll,refreshClock} from './ui.js';
import {db,Store,save,Notify,switchMode,replaceData,loadState,confirmImport,restoreCheckpoint,exportCheckpoint,accountCopyText} from './storage.js';
import {byId,isOver,snoozed,REVIEW_LABEL} from './derived.js';
import {ACCS,accById,accColor,accAvatarHTML,renderAccPick,renderProvPick,renderPal,renderAvatarPreview,openAccount,saveAccount,deleteAccount} from './accounts.js';
import {openNew,saveOrder,openEdit,saveEdit,toggleReceipt,updateConflict} from './order-forms.js';
import {mark,pay,openPay,capturePlace,openRemind,saveRemind,openExpect,saveExpect,clearExpect,MILE_ORDER} from './order-actions.js';
import {openDetail,rerenderDetail,MILE_LABEL} from './detail.js';
import {closeSheets,showSheet,toast,dismissToast} from './sheets.js';
import {exportCsv,exportJson,exportDb,download} from './export.js';
import {shareToday} from './share-image.js';
import {renderOrders} from './views/orders.js';
import {renderPay} from './views/pay.js';
import {renderStats} from './views/stats.js';
import {renderTrip} from './views/trip.js';

/* ================= 事件委托 ================= */
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-act]');if(!t)return;
  const act=t.dataset.act,oid=+t.dataset.oid||0;
  if(!Store.ready||Store.busy){toast('正在读写数据，请稍候');return}
  if(Store.blocked&&!['retry-storage','export-json','export-csv','export-db','export-checkpoint','tab','open','close-sheet','privacy','app-store-soon','goto-collect','chip','bucket','period','day','mnav','mtoday','share','share-confirm','open-schema','open-account','acc-filter','acc-pick','prov-pick','pal-pick','copy-account','assign-open','pick-avatar','shot-pick','nav-place','remind-open','expect-open'].includes(act)){toast('为保护原数据，写入已暂停，请先重试读取');return}
  refreshClock();
  switch(act){
    case 'tab':showTab(t.dataset.tab);break;
    case 'open':openDetail(oid);break;
    case 'close-sheet':closeSheets();break;
    case 'new-order':openNew();break;
    case 'save-order':saveOrder();break;
    case 'goto-collect':ui.bucket=db.orders.some(o=>isOver(o)&&!snoozed(o))?'over':'snoozed';showTab('pay');renderAll();break;
    case 'chip':ui.chip=t.dataset.chip;renderOrders();break;
    case 'bucket':ui.bucket=t.dataset.bucket;renderPay();break;
    case 'period':ui.period=t.dataset.period;renderStats();break;
    case 'day':{
      const day=t.dataset.day||ui.selDay;
      ui.selDay=day;
      const dy=+day.slice(0,4),dm=+day.slice(5,7);
      if(dy!==ui.vMon.y||dm!==ui.vMon.m)ui.vMon={y:dy,m:dm};   // 从「未来 7 天」点到下个月的日子时同步翻月
      renderTrip();break;}
    case 'mnav':{
      let m=ui.vMon.m+ +t.dataset.d, y=ui.vMon.y;
      if(m<1){m=12;y--} if(m>12){m=1;y++}
      ui.vMon={y,m};ui.selDay=`${y}-${pad(m)}-${pad(Math.min(+ui.selDay.slice(8,10),new Date(y,m,0).getDate()))}`;renderTrip();break;}
    case 'mtoday':ui.vMon={y:now.getFullYear(),m:now.getMonth()+1};ui.selDay=TODAY;renderTrip();break;
    case 'mark-shot':if(mark(oid,'shotAt','已记录实际拍摄时间 ✓'))capturePlace(oid);break;
    case 'nav-place':{
      const o=byId(oid);if(!o)break;
      const url=(t.dataset.gps||!o.location)
        ?TanJiGeo.mapUrl({place:o.gpsPlace,name:o.store})
        :TanJiGeo.mapUrl({query:o.location});
      if(!url){toast('这单还没有地点,先填地点或记录当前位置');break}
      if(!TanJiGeo.open(url))toast('打不开地图,请手动搜索该地址');
      break;
    }
    case 'locate-now':{
      const o=byId(oid);if(!o)break;
      toast('正在获取当前位置…');
      TanJiGeo.locate().then(place=>{
        const cur=byId(oid);if(!cur)return;
        cur.gpsPlace=place;save();renderAll();rerenderDetail();
        toast('已记录到店定位 ✓');
      }).catch(()=>toast('定位失败,请确认已允许「使用 App 期间」定位'));
      break;
    }
    case 'mark-submit':mark(oid,'submittedAt','已标记提审 ✓');break;
    case 'mark-short':mark(oid,'shortAt','已标记发副片 ✓');break;
    case 'mark-long':mark(oid,'longAt','已标记发正片 ✓');break;
    case 'acc-filter':ui.accFilter=t.dataset.id===''?null:+t.dataset.id;renderAll();break;
    case 'acc-pick':ui.draftAccId=+t.dataset.id;renderAccPick('f-acc-block',ui.draftAccId);renderAccPick('e-acc-block',ui.draftAccId);break;
    case 'prov-pick':ui.draftProv=t.dataset.v;{const ctx=t.closest('[id$="-block"]');if(ctx)renderProvPick(ctx.id,ui.draftProv);}break;
    case 'pal-pick':ui.draftColor=+t.dataset.i;renderPal();renderAvatarPreview();break;
    case 'open-account':openAccount(t.dataset.id!=null?+t.dataset.id:null);break;
    case 'save-account':saveAccount();break;
    case 'delete-account':deleteAccount();break;
    case 'pick-avatar':$('#avatar-file').click();break;
    case 'shot-pick':$('#shot-file').click();break;
    case 'shot-clear':{
      const target=byId(oid);
      if(!target||!target.photoThumb)break;
      if(!confirm('删除这张随手拍照?'))return;
      target.photoThumb=null;save();renderAll();rerenderDetail();toast('照片已删除');
      break;
    }
    case 'remove-avatar':ui.draftAvatar=null;renderAvatarPreview();break;
    case 'copy-account':{
      const a=accById(t.dataset.id);
      if(!a){toast('该订单未指定账号,无资料可拷');break}
      copyText(accountCopyText(a)).then(ok=>toast(ok?`已拷贝「${a.name}」资料 ✓`:'拷贝失败,请手动长按复制'));
      break;
    }
    case 'assign-open':{
      ui.assignAcc=ACCS()[0]?ACCS()[0].id:null;
      $('#assign-list').innerHTML=ACCS().map(a=>{const c=accColor(a);
        return `<button type="button" class="acc-opt ${ui.assignAcc===a.id?'sel':''}" data-act="assign-pick" data-id="${a.id}" style="${ui.assignAcc===a.id?`border-color:${c.ink};background:${c.bg}`:''}">
          <span class="acc-dot"></span>${accAvatarHTML(a,'width:30px;height:30px;font-size:14px;border-radius:10px')}
          <span class="acc-name">${esc(a.name)}</span><span class="acc-cnt">${db.orders.filter(o=>o.accountId===a.id).length} 单</span></button>`}).join('');
      showSheet('sheet-assign');break;
    }
    case 'assign-pick':ui.assignAcc=+t.dataset.id;{const list=$('#assign-list');list.querySelectorAll('.acc-opt').forEach(el=>{const sel=+el.dataset.id===ui.assignAcc;el.classList.toggle('sel',sel);el.style.borderColor=sel?accColor(accById(ui.assignAcc)).ink:'';el.style.background=sel?accColor(accById(ui.assignAcc)).bg:'';});}break;
    case 'assign-run':{
      const n=db.orders.filter(o=>o.accountId==null).length;
      if(!n){toast('没有未指定的订单');break}
      if(ui.assignAcc==null){toast('先选一个账号');break}
      db.orders.forEach(o=>{if(o.accountId==null)o.accountId=ui.assignAcc});
      save();closeSheets();renderAll();toast(`已把 ${n} 笔订单改挂到「${accById(ui.assignAcc).name}」`);
      break;
    }
    case 'set-review':{
      const o=byId(oid),v=t.dataset.v;
      if(!o||!['pass','fail'].includes(v))break;
      o.reviewResult=o.reviewResult===v?'':v;
      save();renderAll();rerenderDetail();
      toast(o.reviewResult?`已标记${REVIEW_LABEL[o.reviewResult]}`:'已清除送审结果');
      break;
    }
    case 'open-pay':openPay(oid,t.dataset.kind);break;
    case 'pay-method':if(ui.payCtx){ui.payCtx.method=t.dataset.m;openPay(ui.payCtx.oid,ui.payCtx.kind,ui.payCtx.method)}break;
    case 'confirm-pay':{
      const ctx=ui.payCtx;ui.payCtx=null;
      if(!ctx){toast('收款操作已结束，请重新打开收款');break}
      const returnDetail=ui.detail===ctx.oid?ctx.oid:null;
      closeSheets();pay(ctx.oid,ctx.kind,ctx.method);
      if(returnDetail!==null&&byId(returnDetail))openDetail(returnDetail);
      break}
    case 'snooze':{const o=byId(oid);if(o){const d=+t.dataset.d;o.remindAt=dOff(d,'09:00');save();renderAll();rerenderDetail();Notify.scheduleSnooze(o,d);Notify.syncDaily();toast(`已备忘:${d} 天后(${fmtD(o.remindAt)})提醒催收 ✓`)}break}
    case 'notify-toggle':Notify.toggle();break;
    case 'clear-remind':{const o=byId(oid);if(o){o.remindAt=null;save();renderAll();rerenderDetail();Notify.cancelSnooze(oid);Notify.syncDaily();toast('已清除催收提醒')}break}
    case 'remind-open':openRemind(oid);break;
    case 'remind-quick':{const el=$('#remind-note');if(el){el.value=t.dataset.v||'';if(el.focus)el.focus()}break}
    case 'remind-save':saveRemind();break;
    case 'expect-open':openExpect(oid);break;
    case 'expect-save':saveExpect();break;
    case 'expect-clear':clearExpect(oid);break;
    case 'toast-undo':{
      const action=dismissToast();
      if(action&&typeof action.run==='function')action.run();
      break}
    case 'mile':{const o=byId(oid),key=t.dataset.key;
      if(!o||!Object.prototype.hasOwnProperty.call(MILE_LABEL,key))break;
      if(o[key]){
        const after=MILE_ORDER.slice(MILE_ORDER.indexOf(key)+1).filter(k=>o[k]);
        const msg=after.length?`清除「${MILE_LABEL[key]}」？其后的「${after.map(k=>MILE_LABEL[k]).join('」「')}」也将一并清除。`:`清除「${MILE_LABEL[key]}」记录?`;
        if(confirm(msg)){[key,...after].forEach(k=>o[k]=null);save();renderAll();rerenderDetail();Notify.syncDeliver();Notify.syncDaily();toast('已清除,可重新标记')}
      }
      else if(mark(oid,key,'已标记「'+MILE_LABEL[key]+'」')&&key==='shotAt')capturePlace(oid);
      break}
    case 'edit-order':openEdit(oid);break;
    case 'save-edit':saveEdit();break;
    case 'toggle-dep':toggleReceipt(oid,'deposit');break;
    case 'toggle-fin':toggleReceipt(oid,'final');break;
    case 'privacy':ui.privacy=!ui.privacy;renderAll();rerenderDetail();toast(ui.privacy?'已隐藏金额 · 截图模式':'已恢复显示金额');break;
    case 'app-store-soon':toast('iOS 原生版即将上架,上线后可直接在 App Store 买断');break;
    case 'share':shareToday();break;
    case 'share-confirm':{
      if(ui.shareBlob){
        const name='拍摄行程-'+ui.shareDay+'.png';
        const file=new File([ui.shareBlob],name,{type:'image/png'});
        if(navigator.canShare&&navigator.canShare({files:[file]})){navigator.share({files:[file],title:ui.shareDay+' 拍摄行程'}).catch(error=>{if(error.name!=='AbortError')toast('分享失败，请重试')})}
        else{download(name,ui.shareBlob,'image/png');toast('图片已保存')}
      }
      break;}
    case 'del-order':
      if(confirm('删除该订单及其流水?')){db.orders=db.orders.filter(o=>o.id!==oid);db.payments=db.payments.filter(p=>p.oid!==oid);save();closeSheets();renderAll();Notify.cancelOrder(oid);Notify.syncDaily();toast('订单已删除')}
      break;
    case 'export-csv':exportCsv();break;
    case 'export-json':exportJson();break;
    case 'export-db':exportDb();break;
    case 'open-schema':showSheet('sheet-schema');break;
    case 'th':{
      const opts=[7,15,30,45];let i=opts.indexOf(db.threshold);
      i=Math.min(opts.length-1,Math.max(0,i+ +t.dataset.v));
      db.threshold=opts[i];save();renderAll();rerenderDetail();Notify.syncDaily();
      toast(`催收阈值已设为 ${db.threshold} 天`);break;}
    case 'import-json':$('#import-file').value='';$('#import-file').click();break;
    case 'confirm-import':confirmImport();break;
    case 'restore-backup':restoreCheckpoint();break;
    case 'switch-mode':switchMode(Store.mode==='demo'?'work':'demo');break;
    case 'clear-data':
      // 账号资料与服务商预设跟 notifyEnabled 一样随清空保留:用户"重新开始记账"
      // 不该把精心录好的账号资料一并抹掉(订单与流水才是"数据"的本体)
      if(confirm('清空当前'+(Store.mode==='work'?'工作':'演示')+'数据？订单与流水会清空，账号与设置保留，替换前会自动备份。'))replaceData({orders:[],payments:[],threshold:db.threshold,notifyEnabled:db.notifyEnabled,accounts:db.accounts||[],providers:db.providers||[]}).then(ok=>{if(ok)toast('已清空，替换前数据可在统计页恢复')});
      break;
    case 'export-checkpoint':exportCheckpoint();break;
    case 'retry-storage':
      if(Store.lockedOut){location.reload()}else if(Store.blocked){loadState().then(()=>{closeSheets();renderAll();showTab('home')})}else save();
      break;
  }
});
['f-date','f-time'].forEach(id=>$('#'+id).addEventListener('change',updateConflict));
['f-date','f-time'].forEach(id=>$('#'+id).addEventListener('input',updateConflict));
