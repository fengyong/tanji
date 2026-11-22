/* ================= 独立演示数据 ================= */
import {dOff} from './util.js';

/* ================= 独立演示数据 ================= */
export function demoSeed(){
  const O=[
    {id:1, store:'麓野日料·万象城店', cat:'餐饮', contact:'王店长 138****2043', price:1600, deposit:500, settleVia:'private',
     appt:dOff(0,'14:00'), shotAt:null, submittedAt:null, shortAt:null, longAt:null,
     depositPaidAt:dOff(-3,'11:20'), finalPaidAt:null, remindAt:null, note:'重点拍寿司拼盘与环境氛围,竖屏 3 条'},
    {id:2, store:'澄川咖啡·滨江店', cat:'咖啡', contact:'陈姐 139****8871', price:800, deposit:300, settleVia:'private',
     appt:dOff(0,'09:30'), shotAt:dOff(0,'10:12'), submittedAt:null, shortAt:null, longAt:null,
     depositPaidAt:dOff(-2,'15:00'), finalPaidAt:null, remindAt:null, note:'上午已拍完,下午出片提审'},
    {id:3, store:'南栖烘焙·大学城店', cat:'烘焙', contact:'林生 137****6602', price:900, deposit:300, settleVia:'private',
     appt:dOff(1,'10:30'), shotAt:null, submittedAt:null, shortAt:null, longAt:null,
     depositPaidAt:dOff(-1,'18:40'), finalPaidAt:null, remindAt:null, note:'欧包特写为主'},
    {id:4, store:'拾光汉服体验馆', cat:'体验馆', contact:'苏苏 189****3355', price:1500, deposit:0, settleVia:'private',
     appt:dOff(2,'15:00'), shotAt:null, submittedAt:null, shortAt:null, longAt:null,
     depositPaidAt:null, finalPaidAt:null, remindAt:null, note:'待收定金;拍摄含妆造两个场景'},
    {id:5, store:'山野咖啡·露台店', cat:'咖啡', contact:'阿哲 136****9027', price:1200, deposit:400, settleVia:'private',
     appt:dOff(4,'13:00'), shotAt:null, submittedAt:null, shortAt:null, longAt:null,
     depositPaidAt:dOff(-1,'12:10'), finalPaidAt:null, remindAt:null, note:'露台自然光,下午三点后最佳'},
    {id:6, store:'半糖甜品研究所', cat:'甜品', contact:'Vivi 135****4419', price:1000, deposit:300, settleVia:'private',
     appt:dOff(6,'14:30'), shotAt:null, submittedAt:null, shortAt:null, longAt:null,
     depositPaidAt:dOff(-4,'10:05'), finalPaidAt:null, remindAt:null, note:''},
    {id:7, store:'云端西餐厅·33楼', cat:'餐饮', contact:'周经理 138****7710', price:2200, deposit:600, settleVia:'private',
     appt:dOff(9,'18:30'), shotAt:null, submittedAt:null, shortAt:null, longAt:null,
     depositPaidAt:null, finalPaidAt:null, remindAt:null, note:'夜景机位,需带补光;定金已催两次'},
    {id:8, store:'山茶花奶茶·观前街店', cat:'茶饮', contact:'叶子 150****2288', price:1000, deposit:300, settleVia:'private',
     appt:dOff(-1,'10:00'), shotAt:dOff(-1,'11:05'), submittedAt:dOff(-1,'16:40'), shortAt:null, longAt:null,
     depositPaidAt:dOff(-3,'09:30'), finalPaidAt:null, remindAt:null, note:''},
    {id:9, store:'铁兽健身·私教工作室', cat:'健身', contact:'K哥 186****5566', price:1300, deposit:400, settleVia:'private',
     appt:dOff(-3,'19:00'), shotAt:dOff(-3,'19:40'), submittedAt:dOff(-2,'10:00'), shortAt:dOff(-1,'12:00'), longAt:null,
     depositPaidAt:dOff(-5,'14:00'), finalPaidAt:null, remindAt:null, note:'长片等客户确认口播版本'},
    {id:10, store:'循环洗衣·Central店', cat:'零售', contact:'何店长 131****0093', price:1400, deposit:400, settleVia:'private',
     appt:dOff(-9,'15:00'), shotAt:dOff(-9,'15:35'), submittedAt:dOff(-8,'09:00'), shortAt:dOff(-6,'14:10'), longAt:null,
     depositPaidAt:dOff(-10,'11:00'), finalPaidAt:null, remindAt:null, note:''},
    {id:11, store:'TONI 造型沙龙·湖畔店', cat:'美发', contact:'Tony 137****8123', price:1200, deposit:300, settleVia:'private',
     appt:dOff(-18,'14:00'), shotAt:dOff(-18,'14:40'), submittedAt:dOff(-17,'10:30'), shortAt:dOff(-15,'16:00'), longAt:dOff(-14,'11:20'),
     depositPaidAt:dOff(-19,'09:00'), finalPaidAt:null, remindAt:null, note:'微信催过一次,回复"月底统一结"',
     remindLog:[{at:dOff(-9,'18:30'),note:'微信问了一次,回复"月底统一结"'}]},
    {id:12, store:'栖里民宿·太湖店', cat:'民宿', contact:'洁姐 139****5160', price:1800, deposit:500, settleVia:'douyin',
     appt:dOff(-34,'11:00'), shotAt:dOff(-34,'11:40'), submittedAt:dOff(-33,'15:00'), shortAt:dOff(-31,'10:00'), longAt:dOff(-30,'17:30'),
     depositPaidAt:dOff(-35,'10:00'), finalPaidAt:null, remindAt:null, note:'抖音商单;平台审核通过后结算,预计 T+7 到账',
     expectPayAt:dOff(-20,'10:00')},
    {id:13, store:'城市露营地·郊野公园', cat:'露营', contact:'大鹏 188****6678', price:1500, deposit:0, settleVia:'private',
     appt:dOff(-41,'16:00'), shotAt:dOff(-41,'16:30'), submittedAt:dOff(-40,'12:00'), shortAt:dOff(-38,'15:00'), longAt:dOff(-36,'10:40'),
     depositPaidAt:null, finalPaidAt:null, remindAt:null, note:'全款尾款待结;多次微信未回,约了周五电话',
     remindLog:[{at:dOff(-12,'10:10'),note:'微信未回'},{at:dOff(-5,'20:40'),note:'电话约了周五再谈'}]},
    {id:14, store:'老门东火锅·旗舰店', cat:'餐饮', contact:'刘总 133****2280', price:1600, deposit:500, settleVia:'private', finalMethod:'银行卡',
     appt:dOff(-6,'17:30'), shotAt:dOff(-6,'18:10'), submittedAt:dOff(-5,'11:00'), shortAt:dOff(-4,'14:00'), longAt:dOff(-3,'16:20'),
     depositPaidAt:dOff(-7,'10:30'), finalPaidAt:dOff(-2,'15:20'), remindAt:null, note:'尾款对公转账'},
    {id:15, store:'喜邻超市·社区店', cat:'零售', contact:'范店 158****3366', price:900, deposit:300, settleVia:'douyin', finalMethod:'抖音商单',
     appt:dOff(-12,'10:00'), shotAt:dOff(-12,'10:35'), submittedAt:dOff(-11,'14:00'), shortAt:dOff(-10,'15:00'), longAt:dOff(-9,'11:00'),
     depositPaidAt:dOff(-13,'16:00'), finalPaidAt:dOff(-8,'10:00'), remindAt:null, note:''},
    {id:16, store:'麦仓面包·奥体店', cat:'烘焙', contact:'Kiki 182****7745', price:800, deposit:200, settleVia:'private', finalMethod:'支付宝',
     appt:dOff(-25,'09:30'), shotAt:dOff(-25,'10:10'), submittedAt:dOff(-24,'10:00'), shortAt:dOff(-22,'14:30'), longAt:dOff(-21,'10:00'),
     depositPaidAt:dOff(-26,'15:00'), finalPaidAt:dOff(-18,'11:30'), remindAt:null, note:''},
    {id:17, store:'橘朵花艺工作室', cat:'零售', contact:'小橘 177****9012', price:1100, deposit:300, settleVia:'private',
     appt:dOff(-4,'16:00'), shotAt:dOff(-4,'16:40'), submittedAt:dOff(-3,'12:00'), shortAt:dOff(-2,'13:00'), longAt:dOff(-1,'15:00'),
     depositPaidAt:dOff(-6,'11:00'), finalPaidAt:dOff(0,'08:40'), remindAt:null, note:'今早已收尾款'},
  ];
  const P=[];
  O.forEach(o=>{
    if(o.depositPaidAt&&o.deposit>0) P.push({oid:o.id,kind:'定金',amount:o.deposit,at:o.depositPaidAt,method:o.depMethod||'微信'});
    if(o.finalPaidAt) P.push({oid:o.id,kind:'尾款',amount:o.price-o.deposit,at:o.finalPaidAt,method:o.finalMethod||(o.settleVia==='douyin'?'抖音商单':'微信')});
  });
  return {orders:O, payments:P, threshold:15};
}
