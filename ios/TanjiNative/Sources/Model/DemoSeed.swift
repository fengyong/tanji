import Foundation

/// 演示数据种子（对应 Web 版 `src/app/demo.js`）。
///
/// 演示数据只作「另一套数据空间」用：不排系统通知，切换时不影响工作数据。
enum DemoSeed {

    private static func offset(_ days: Int, _ hourMinute: String) -> String {
        Format.localOffset(days, hourMinute: hourMinute)
    }

    private static func order(_ id: Int,
                              _ store: String,
                              _ cat: String,
                              _ contact: String,
                              _ price: Double,
                              _ deposit: Double,
                              _ appt: String,
                              settleVia: String = "private",
                              shotAt: String? = nil,
                              submittedAt: String? = nil,
                              shortAt: String? = nil,
                              longAt: String? = nil,
                              depositPaidAt: String? = nil,
                              finalPaidAt: String? = nil,
                              note: String = "",
                              remindLog: [RemindEntry] = [],
                              expectPayAt: String? = nil) -> Order {
        Order(id: id,
              store: store,
              cat: cat,
              contact: contact,
              price: price,
              deposit: deposit,
              appt: appt,
              shotAt: shotAt,
              submittedAt: submittedAt,
              shortAt: shortAt,
              longAt: longAt,
              depositPaidAt: depositPaidAt,
              finalPaidAt: finalPaidAt,
              settleVia: settleVia,
              channel: "直客",
              note: note,
              remindLog: remindLog.isEmpty ? nil : remindLog,
              expectPayAt: expectPayAt)
    }

    static func seed() -> AppData {
        let orders: [Order] = [
            order(1, "麓野日料·万象城店", "餐饮", "王店长 138****2043", 1600, 500, offset(0, "14:00"),
                  depositPaidAt: offset(-3, "11:20"), note: "重点拍寿司拼盘与环境氛围,竖屏 3 条"),
            order(2, "澄川咖啡·滨江店", "咖啡", "陈姐 139****8871", 800, 300, offset(0, "09:30"),
                  shotAt: offset(0, "10:12"), depositPaidAt: offset(-2, "15:00"), note: "上午已拍完,下午出片提审"),
            order(3, "南栖烘焙·大学城店", "烘焙", "林生 137****6602", 900, 300, offset(1, "10:30"),
                  depositPaidAt: offset(-1, "18:40"), note: "欧包特写为主"),
            order(4, "拾光汉服体验馆", "体验馆", "苏苏 189****3355", 1500, 0, offset(2, "15:00"),
                  note: "待收定金;拍摄含妆造两个场景"),
            order(5, "山野咖啡·露台店", "咖啡", "阿哲 136****9027", 1200, 400, offset(4, "13:00"),
                  depositPaidAt: offset(-1, "12:10"), note: "露台自然光,下午三点后最佳"),
            order(6, "半糖甜品研究所", "甜品", "Vivi 135****4419", 1000, 300, offset(6, "14:30"),
                  depositPaidAt: offset(-4, "10:05")),
            order(7, "云端西餐厅·33楼", "餐饮", "周经理 138****7710", 2200, 600, offset(9, "18:30"),
                  note: "夜景机位,需带补光;定金已催两次"),
            order(8, "山茶花奶茶·观前街店", "茶饮", "叶子 150****2288", 1000, 300, offset(-1, "10:00"),
                  shotAt: offset(-1, "11:05"), submittedAt: offset(-1, "16:40"),
                  depositPaidAt: offset(-3, "09:30")),
            order(9, "铁兽健身·私教工作室", "健身", "K哥 186****5566", 1300, 400, offset(-3, "19:00"),
                  shotAt: offset(-3, "19:40"), submittedAt: offset(-2, "10:00"), shortAt: offset(-1, "12:00"),
                  depositPaidAt: offset(-5, "14:00"), note: "长片等客户确认口播版本"),
            order(10, "循环洗衣·Central店", "零售", "何店长 131****0093", 1400, 400, offset(-9, "15:00"),
                  shotAt: offset(-9, "15:35"), submittedAt: offset(-8, "09:00"), shortAt: offset(-6, "14:10"),
                  depositPaidAt: offset(-10, "11:00")),
            order(11, "TONI 造型沙龙·湖畔店", "美发", "Tony 137****8123", 1200, 300, offset(-18, "14:00"),
                  shotAt: offset(-18, "14:40"), submittedAt: offset(-17, "10:30"), shortAt: offset(-15, "16:00"),
                  longAt: offset(-14, "11:20"), depositPaidAt: offset(-19, "09:00"),
                  note: "微信催过一次,回复\"月底统一结\"",
                  remindLog: [RemindEntry(at: offset(-9, "18:30"), note: "微信问了一次,回复\"月底统一结\"")]),
            order(12, "栖里民宿·太湖店", "民宿", "洁姐 139****5160", 1800, 500, offset(-34, "11:00"),
                  settleVia: "douyin", shotAt: offset(-34, "11:40"), submittedAt: offset(-33, "15:00"),
                  shortAt: offset(-31, "10:00"), longAt: offset(-30, "17:30"), depositPaidAt: offset(-35, "10:00"),
                  note: "抖音商单;平台审核通过后结算,预计 T+7 到账", expectPayAt: offset(-20, "10:00")),
            order(13, "城市露营地·郊野公园", "露营", "大鹏 188****6678", 1500, 0, offset(-41, "16:00"),
                  shotAt: offset(-41, "16:30"), submittedAt: offset(-40, "12:00"), shortAt: offset(-38, "15:00"),
                  longAt: offset(-36, "10:40"), note: "全款尾款待结;多次微信未回,约了周五电话",
                  remindLog: [RemindEntry(at: offset(-12, "10:10"), note: "微信未回"),
                              RemindEntry(at: offset(-5, "20:40"), note: "电话约了周五再谈")]),
            order(14, "老门东火锅·旗舰店", "餐饮", "刘总 133****2280", 1600, 500, offset(-6, "17:30"),
                  shotAt: offset(-6, "18:10"), submittedAt: offset(-5, "11:00"), shortAt: offset(-4, "14:00"),
                  longAt: offset(-3, "16:20"), depositPaidAt: offset(-7, "10:30"), finalPaidAt: offset(-2, "15:20"),
                  note: "尾款对公转账"),
            order(15, "喜邻超市·社区店", "零售", "范店 158****3366", 900, 300, offset(-12, "10:00"),
                  settleVia: "douyin", shotAt: offset(-12, "10:35"), submittedAt: offset(-11, "14:00"),
                  shortAt: offset(-10, "15:00"), longAt: offset(-9, "11:00"),
                  depositPaidAt: offset(-13, "16:00"), finalPaidAt: offset(-8, "10:00")),
            order(16, "麦仓面包·奥体店", "烘焙", "Kiki 182****7745", 800, 200, offset(-25, "09:30"),
                  shotAt: offset(-25, "10:10"), submittedAt: offset(-24, "10:00"), shortAt: offset(-22, "14:30"),
                  longAt: offset(-21, "10:00"), depositPaidAt: offset(-26, "15:00"), finalPaidAt: offset(-18, "11:30")),
            order(17, "橘朵花艺工作室", "零售", "小橘 177****9012", 1100, 300, offset(-4, "16:00"),
                  shotAt: offset(-4, "16:40"), submittedAt: offset(-3, "12:00"), shortAt: offset(-2, "13:00"),
                  longAt: offset(-1, "15:00"), depositPaidAt: offset(-6, "11:00"), finalPaidAt: offset(0, "08:40"),
                  note: "今早已收尾款")
        ]

        var payments: [Payment] = []
        let finalMethods: [Int: String] = [14: "银行卡", 15: "抖音商单", 16: "支付宝"]
        for order in orders {
            if let paidAt = order.depositPaidAt, order.deposit > 0 {
                payments.append(Payment(oid: order.id, kind: "定金", amount: order.deposit, at: paidAt, method: "微信", note: nil))
            }
            if let paidAt = order.finalPaidAt {
                let method = finalMethods[order.id] ?? (order.settleVia == "douyin" ? "抖音商单" : "微信")
                payments.append(Payment(oid: order.id, kind: "尾款", amount: Format.round2(order.price - order.deposit),
                                       at: paidAt, method: method, note: nil))
            }
        }
        return AppData(orders: orders, payments: payments, threshold: 15, notifyEnabled: true, accounts: [], providers: [])
    }
}
