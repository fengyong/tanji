/* ================= 本地通知排程(T2-C 自 storage.js 拆出) =================
 * 业务逻辑,不是存储原语:依赖 derived 的规则口径与 storage 的数据,
 * storage 经 registerStorageHooks({notify}) 反向回调,依赖保持单向。 */
import {CAP,isNative} from './env.js';
import {db,Store,save} from './storage.js';
import {isOver,snoozed,overdueDays,needMain,needSub,deliveredAll} from './derived.js';
import {toast} from './sheets.js';
import {renderAll} from './ui.js';

const NOTIFY_OFFSET={work:0,demo:500000};
const notifyBase=()=>NOTIFY_OFFSET[Store.mode]||0;


export const Notify={
  native(){return isNative&&CAP&&CAP.LocalNotifications},
  async ensurePermission(){
    const L=CAP.LocalNotifications;
    let p=await L.checkPermissions();
    if(p.display!=='granted')p=await L.requestPermissions();
    return p.display==='granted';
  },
  async syncDaily(){
    if(!this.native())return;
    // 演示数据不排真通知(见文件头注释);work 的通知不受切模式影响,由各排程入口自行维护
    if(Store.mode==='demo')return;
    try{
      const L=CAP.LocalNotifications;
      const base=notifyBase();
      const pend=await L.getPending();
      const oldDaily=(pend.notifications||[]).filter(n=>+n.id===base+1);
      if(oldDaily.length)await L.cancel({notifications:oldDaily});
      const over=db.orders.filter(o=>isOver(o)&&!snoozed(o));
      if(!over.length||db.notifyEnabled===false)return;
      if(!await this.ensurePermission())return;
      const maxD=Math.max(...over.map(overdueDays));
      await L.schedule({notifications:[{
        id:base+1,title:'探记 · 尾款催收',
        body:`${over.length} 笔尾款已逾期，最长 ${maxD} 天 —— 今日安排一次跟进`,
        schedule:{on:{hour:9,minute:0},repeats:true,allowWhileIdle:true},
      }]});
    }catch(e){console.warn('[TanJi] 催收提醒排程失败',e)}
  },
  // 出片提醒:拍摄完成 +24h 仍未出齐(按该单的正/副片配置) → 一次性本地通知。
  // 已超期的不再排(应用内列表有红色角标),出齐/删单/清除拍摄时间后重排即撤销。
  async syncDeliver(){
    if(!this.native())return;
    if(Store.mode==='demo')return;   // 演示数据不排真通知,与 syncDaily 同口径
    try{
      const L=CAP.LocalNotifications;
      const base=notifyBase();
      const pend=await L.getPending();
      const mine=(pend.notifications||[]).filter(n=>+n.id>=base+300000&&+n.id<base+400000);
      if(mine.length)await L.cancel({notifications:mine});
      const now=Date.now();
      const list=db.orders
        .filter(o=>o.shotAt&&!deliveredAll(o))
        .map(o=>({o,at:new Date(new Date(o.shotAt).getTime()+864e5)}))
        .filter(x=>!isNaN(x.at.getTime())&&x.at.getTime()>now);
      // 没有可排的提醒就别碰权限:保存一笔普通订单也要弹通知授权,时机莫名其妙
      if(!list.length)return;
      if(!await this.ensurePermission())return;
      await L.schedule({notifications:list.map(({o,at})=>({
        id:base+300000+o.id,title:'探记 · 出片提醒',
        body:`「${o.store}」拍摄已超 24 小时,还有片子没出齐,记得跟进`,
        schedule:{at,allowWhileIdle:true},
      }))});
    }catch(e){console.warn('[TanJi] 出片提醒排程失败',e)}
  },
  async scheduleSnooze(o,d){
    if(!this.native())return;
    if(Store.mode==='demo')return;   // 演示数据不排真通知,与 syncDaily 同口径
    try{
      const at=new Date(o.remindAt);
      if(isNaN(at))return;
      if(!await this.ensurePermission())return;
      const L=CAP.LocalNotifications;
      const base=notifyBase();
      const pend=await L.getPending();
      // 备忘一单同时只有一条(下面排新前先撤旧),id 用 base+100000+订单号独占一段即可。
      // 不再用 100000+id*100+d:那会在订单号≥2000 时落进 300000+id 的出片提醒段,
      // 高单号的备忘会把低单号的出片提醒顶掉(id 相同后者覆盖前者)。
      const mine=(pend.notifications||[]).filter(n=>+n.id===base+100000+o.id);
      if(mine.length)await L.cancel({notifications:mine});
      // d = 设提醒到响铃之间隔了几天(正常路径:刚设的 1/3/7 天备忘)。
      // d 缺省时是「导入/恢复后按 remindAt 重排」——那时不知道当初设于几天前,
      // 硬套一个天数会写错,改用日期本身说明白。
      const when=d!=null?`（${d} 天前设置的提醒）`:`（${String(o.remindAt||'').slice(5,10)} 设的提醒）`;
      await L.schedule({notifications:[{
        id:base+100000+o.id,title:'探记 · 催收跟进',
        body:`「${o.store}」尾款该跟进了${when}`,
        schedule:{at,allowWhileIdle:true},
      }]});
    }catch(e){console.warn('[TanJi] 单次提醒排程失败',e)}
  },
  // (cancelAll/isOurNotifyId 已删:replaceData 改用 cancelMode 后无调用方,
  //  而"撤双模式全部通知"的语义一旦被误接回单模式动作,会重演通知误杀)
  // 只撤当前模式的全部通知(导入/恢复/清空只替换当前模式数据,另一模式的通知指向的数据还在,不能动)
  async cancelMode(mode=Store.mode){
    if(!this.native())return;
    try{
      const base=NOTIFY_OFFSET[mode]||0;
      const L=CAP.LocalNotifications,pend=await L.getPending();
      const ours=(pend.notifications||[]).filter(n=>{const id=+n.id;return id===base+1||(id>=base+100000&&id<base+400000)});
      if(ours.length)await L.cancel({notifications:ours});
    }catch(e){}
  },
  // 只撤单笔备忘:清除催收提醒不能连带撤掉同单的 24h 出片提醒(两条通知语义独立)
  async cancelSnooze(id){
    if(!this.native())return;
    try{
      const base=notifyBase();
      const L=CAP.LocalNotifications,pend=await L.getPending();
      const mine=(pend.notifications||[]).filter(n=>+n.id===base+100000+(+id));
      if(mine.length)await L.cancel({notifications:mine});
    }catch(e){}
  },
  async cancelOrder(id){
    if(!this.native())return;
    try{
      const base=notifyBase();
      const L=CAP.LocalNotifications,pend=await L.getPending();
      const mine=(pend.notifications||[]).filter(n=>+n.id===base+100000+(+id)||+n.id===base+300000+(+id));
      if(mine.length)await L.cancel({notifications:mine});
    }catch(e){}
  },
  async toggle(){
    db.notifyEnabled=(db.notifyEnabled===false);
    save();renderAll();
    if(db.notifyEnabled!==false)await this.syncDaily();
    else{
      // 开关语义是「逾期催收每日提醒」(统计页文案),只撤当前模式的每日汇总(base+1)。
      // 用户自设的 1/3/7 天备忘与 24h 出片提醒不受它管——连带取消会让
      // 用户明确设置的提醒静默消失,且重新开启时也不会被恢复。
      try{
        const L=CAP.LocalNotifications,pend=await L.getPending();
        const daily=(pend.notifications||[]).filter(n=>+n.id===notifyBase()+1);
        if(daily.length)await L.cancel({notifications:daily});
      }catch(e){}
    }
    toast(db.notifyEnabled!==false?'已开启每日催收提醒（每天 09:00）':'已关闭每日催收提醒');
  }
};
