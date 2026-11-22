/* 业务规则规格测试(www/logic.js)
 * 这一组不碰 DOM、不依赖设备,是「产品口径」的可执行说明书:
 * 将来换 SwiftUI 时,Swift 版实现对不上这里就是实现错了。 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');

require(path.join(__dirname,'..','www','logic.js'));
const L=globalThis.TanJiLogic;

const order=o=>({id:1,store:'店',price:1000,deposit:200,settleVia:'private',
  appt:'2026-11-01T10:00',shotAt:'2026-11-01T11:00',submittedAt:'2026-11-01T12:00',
  shortAt:null,longAt:null,depositPaidAt:null,finalPaidAt:null,remindAt:null,
  deliverMain:true,deliverSub:true,...o});

test('工作线:正/副片四种配置的出齐判定',()=>{
  assert.equal(L.deliveredAll(order({longAt:'x'})),false,'只发正片、要副片 → 未出齐');
  assert.equal(L.deliveredAll(order({longAt:'x',shortAt:'y'})),true,'两片都发 → 出齐');
  assert.equal(L.deliveredAll(order({deliverSub:false,longAt:'x'})),true,'只要正片 → 发正片即出齐');
  assert.equal(L.deliveredAll(order({deliverMain:false,shortAt:'y'})),true,'只要副片 → 发副片即出齐');
  assert.equal(L.deliveredAll(order({deliverMain:false,deliverSub:false})),true,'两片都不要求 → 视为出齐');
});

test('工作线:四态推进顺序',()=>{
  assert.equal(L.workOf(order({shotAt:null})),'待拍摄');
  assert.equal(L.workOf(order({submittedAt:null})),'后期中');
  assert.equal(L.workOf(order({shortAt:'y'})),'发片中');
  assert.equal(L.workOf(order({shortAt:'y',longAt:'x'})),'已交付');
  assert.equal(L.workOf(order({deliverMain:false,shortAt:'y'})),'已交付','只要求副片时发完即已交付');
});

test('资金线:定金/尾款/平台结算',()=>{
  assert.equal(L.payOf(order({depositPaidAt:null})),'待定金');
  assert.equal(L.payOf(order({depositPaidAt:'2026-11-01T10:00'})),'待尾款');
  assert.equal(L.payOf(order({depositPaidAt:'2026-11-01T10:00',finalPaidAt:'2026-11-02T10:00'})),'已结清');
  assert.equal(L.payOf(order({depositPaidAt:'2026-11-01T10:00',settleVia:'douyin'})),'平台结算');
  // 流水(payments)也算作已收,和标记字段等价
  assert.equal(L.payOf(order({}),[{oid:1,kind:'定金',amount:200}]),'待尾款','有定金流水 → 待尾款');
  assert.equal(L.owedOf(order({})),1000,'未收任何款 → 欠全款(定金200+尾款800)');
  assert.equal(L.owedOf(order({depositPaidAt:'2026-11-01T10:00'})),800,'收定金后仍欠尾款 800');
});

test('逾期:从拍摄日起算,平台结算与已结清不计',()=>{
  const today=new Date('2026-11-10T09:00');
  assert.equal(L.overdueDays(order({}),[],today),9,'拍摄日 11-01 → 11-10 共 9 天');
  assert.equal(L.overdueDays(order({settleVia:'douyin'}),[],today),0,'平台结算不逾期');
  assert.equal(L.overdueDays(order({depositPaidAt:'a',finalPaidAt:'b'}),[],today),0,'已结清不逾期');
  assert.equal(L.overdueDays(order({shotAt:null}),[],today),0,'未拍摄不计逾期');
  assert.equal(L.isOver(order({}),[],15,today),false,'9 天未到 15 天阈值');
  assert.equal(L.isOver(order({}),[],9,today),true,'阈值 9 天时命中');
});

test('出片超时:满 24 小时才置角标',()=>{
  const shot=new Date('2026-11-01T11:00').getTime();
  assert.equal(L.deliverLate(order({}),shot+23*3600e3),false);
  assert.equal(L.deliverLate(order({}),shot+24*3600e3),true);
  assert.equal(L.deliverLate(order({longAt:'x',shortAt:'y'}),shot+48*3600e3),false,'已出齐不再提醒');
});

test('排期重叠:±120 分钟,含边界',()=>{
  const orders=[order({id:2,appt:'2026-11-01T12:00'}),order({id:3,appt:'2026-11-01T13:00'})];
  const at120=L.apptOverlap(orders,'2026-11-01','10:00',1);
  assert.equal(at120.same.length,2,'同日排期都算 same');
  assert.equal(at120.overlap.length,1,'差 120 分钟算重叠,差 180 分钟不算');
  assert.equal(L.apptOverlap(orders,'2026-11-01','10:00',2).overlap.length,0,'排除自己后不与 12:00 重叠');
  assert.equal(L.apptOverlap(orders,'',  '10:00',1).same.length,0,'无日期返回空');
});

test('统计:窗口口径(M=本月1日至今,N=近N天)与金额',()=>{
  const now=new Date('2026-11-22T12:00');
  const orders=[
    order({id:1,price:1000,appt:'2026-11-20T10:00',shortAt:'2026-11-20T18:00',longAt:'2026-11-20T18:00'}),
    order({id:2,price:500,appt:'2026-10-25T10:00'}),             // 本月外,近30天内
    order({id:3,price:300,appt:'2026-09-01T10:00'}),             // 近30天外
  ];
  const payments=[{oid:1,kind:'定金',amount:200,at:'2026-11-21T10:00'}];
  const m=L.statsFor({orders,payments,period:'M',now});
  assert.equal(m.deals.length,1,'本月只含 11 月的单');
  assert.equal(m.dealSum,1000,'成交额按报价求和');
  assert.equal(m.paidSum,200,'实收按流水求和');
  assert.equal(m.done.length,1,'已交付计入');
  const d30=L.statsFor({orders,payments,period:'30',now});
  assert.equal(d30.deals.length,2,'近30天含 10-25 的单');
  assert.equal(d30.dealSum,1500,'窗口变大后成交额同步');
  assert.equal(L.statsFor({orders,payments,period:'7',now}).deals.length,1,'近7天只含 11-20');
});

test('催收跟进:次数与最近一次可读,脏数据不影响其它规则',()=>{
  const empty=order({});
  assert.equal(L.remindCount(empty),0,'没记过就是 0 次');
  assert.equal(L.lastRemind(empty),null);
  const log=[{at:'2026-11-10T10:00',note:'说这周给'},{at:'2026-11-18T18:30',note:'财务走流程'}];
  const tracked=order({remindLog:log});
  assert.equal(L.remindCount(tracked),2);
  assert.deepEqual(L.lastRemind(tracked),log[1],'最近一次取数组末尾');
  assert.equal(L.remindCount(order({remindLog:'不是数组'})),0,'非数组按没记过处理');
});

test('平台单预计到账:过了约定日仍未收款才算超期',()=>{
  const today=new Date('2026-11-22T09:00');
  const douyin=order({settleVia:'douyin',depositPaidAt:'2026-11-01T10:00',expectPayAt:'2026-11-15T10:00'});
  assert.equal(L.expectOverdue(douyin,[],today),7,'11-15 → 11-22 共 7 天');
  assert.equal(L.expectOverdue({...douyin,expectPayAt:'2026-11-30T10:00'},[],today),0,'还没到日子不算超期');
  assert.equal(L.expectOverdue({...douyin,finalPaidAt:'2026-11-20T10:00'},[],today),0,'已收款就不再提醒');
  assert.equal(L.expectOverdue({...douyin,expectPayAt:null},[],today),0,'没填到账日不提示');
});

test('未来 N 天:含当天,按日汇总单量与成交额',()=>{
  const orders=[
    order({id:1,price:1000,appt:'2026-11-22T10:00'}),
    order({id:2,price:800,appt:'2026-11-22T15:00'}),
    order({id:3,price:600,appt:'2026-11-25T09:00'}),
    order({id:4,price:900,appt:'2026-12-01T09:00'}),   // 第 10 天,窗口外
  ];
  const week=L.upcomingByDay(orders,'2026-11-22',7);
  assert.equal(week.length,7,'含起点当天共 7 格');
  assert.equal(week[0].day,'2026-11-22');
  assert.equal(week[0].count,2);
  assert.equal(week[0].sum,1800,'当天两单合计');
  assert.equal(week[3].count,1,'11-25 在窗口内');
  assert.equal(week[6].count,0,'12-01 不在 7 天窗口内');
  assert.equal(L.upcomingByDay(orders,'不是日期',7).length,0,'起点非法返回空');
});

test('金额:分制解析拒绝非法输入',()=>{
  assert.equal(L.moneyCents('12.34'),1234);
  assert.equal(L.moneyCents('12.3'),1230);
  assert.equal(L.moneyCents('12.345'),null,'超过两位小数拒绝');
  assert.equal(L.moneyCents('-1'),null);
  assert.equal(L.moneyCents(''),null);
  assert.equal(L.moneyCents('',true),0,'blankZero 允许空串作 0');
  assert.equal(L.orderMoney({price:'1000',deposit:'2000'}),null,'定金大于报价不合法');
  assert.deepEqual(L.orderMoney({price:'1000',deposit:'200'}),{price:100000,deposit:20000,final:80000});
});
