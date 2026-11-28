import XCTest
@testable import TanjiNative

/// 业务规则规格测试。
///
/// 对应 Web 版 `tests/logic.test.cjs`：那里是产品口径的可执行说明书，
/// 这里的 Swift 实现对不上就是实现错了。
final class LogicTests: XCTestCase {

    // MARK: - 工作线

    func testDeliveredAll() {
        XCTAssertFalse(Logic.deliveredAll(SampleOrder.make(longAt: "x")), "只发正片、要副片 → 未出齐")
        XCTAssertTrue(Logic.deliveredAll(SampleOrder.make(shortAt: "y", longAt: "x")), "两片都发 → 出齐")
        XCTAssertTrue(Logic.deliveredAll(SampleOrder.make(longAt: "x", deliverSub: false)), "只要正片 → 发正片即出齐")
        XCTAssertTrue(Logic.deliveredAll(SampleOrder.make(shortAt: "y", deliverMain: false)), "只要副片 → 发副片即出齐")
        XCTAssertTrue(Logic.deliveredAll(SampleOrder.make(deliverMain: false, deliverSub: false)), "两片都不要求 → 视为出齐")
    }

    func testWorkStates() {
        XCTAssertEqual(Logic.workOf(SampleOrder.make(shotAt: nil)), "待拍摄")
        XCTAssertEqual(Logic.workOf(SampleOrder.make(submittedAt: nil)), "后期中")
        XCTAssertEqual(Logic.workOf(SampleOrder.make(shortAt: "y")), "发片中")
        XCTAssertEqual(Logic.workOf(SampleOrder.make(shortAt: "y", longAt: "x")), "已交付")
        XCTAssertEqual(Logic.workOf(SampleOrder.make(shortAt: "y", deliverMain: false)), "已交付", "只要求副片时发完即已交付")
    }

    func testDeliverLate() {
        let shot = Format.parseLocal("2026-11-01T11:00")!
        XCTAssertFalse(Logic.deliverLate(SampleOrder.make(), now: shot.addingTimeInterval(23 * 3600)))
        XCTAssertTrue(Logic.deliverLate(SampleOrder.make(), now: shot.addingTimeInterval(24 * 3600)))
        XCTAssertFalse(Logic.deliverLate(SampleOrder.make(shortAt: "y", longAt: "x"),
                                         now: shot.addingTimeInterval(48 * 3600)), "已出齐不再提醒")
    }

    // MARK: - 资金线

    func testPayStates() {
        XCTAssertEqual(Logic.payOf(SampleOrder.make(depositPaidAt: nil), payments: []), "待定金")
        XCTAssertEqual(Logic.payOf(SampleOrder.make(depositPaidAt: "2026-11-01T10:00"), payments: []), "待尾款")
        XCTAssertEqual(Logic.payOf(SampleOrder.make(depositPaidAt: "2026-11-01T10:00",
                                                    finalPaidAt: "2026-11-02T10:00"), payments: []), "已结清")
        XCTAssertEqual(Logic.payOf(SampleOrder.make(depositPaidAt: "2026-11-01T10:00",
                                                    settleVia: "douyin"), payments: []), "平台结算")
        XCTAssertEqual(Logic.payOf(SampleOrder.make(), payments: [Payment(oid: 1, kind: "定金", amount: 200,
                                                                         at: "2026-11-01T10:00", method: "微信", note: nil)]),
                       "待尾款", "有定金流水 → 待尾款")
        XCTAssertEqual(Logic.owedOf(SampleOrder.make(), payments: []), 1000, "未收任何款 → 欠全款")
        XCTAssertEqual(Logic.owedOf(SampleOrder.make(depositPaidAt: "2026-11-01T10:00"), payments: []), 800,
                       "收定金后仍欠尾款 800")
    }

    func testOverdue() {
        let today = Format.parseLocal("2026-11-10T09:00")!
        XCTAssertEqual(Logic.overdueDays(SampleOrder.make(), payments: [], today: today), 9)
        XCTAssertEqual(Logic.overdueDays(SampleOrder.make(settleVia: "douyin"), payments: [], today: today), 0,
                       "平台结算不逾期")
        XCTAssertEqual(Logic.overdueDays(SampleOrder.make(depositPaidAt: "a", finalPaidAt: "b"), payments: [], today: today), 0,
                       "已结清不逾期")
        XCTAssertEqual(Logic.overdueDays(SampleOrder.make(shotAt: nil), payments: [], today: today), 0, "未拍摄不计逾期")
        XCTAssertFalse(Logic.isOver(SampleOrder.make(), payments: [], threshold: 15, today: today))
        XCTAssertTrue(Logic.isOver(SampleOrder.make(), payments: [], threshold: 9, today: today))
    }

    // MARK: - 排期重叠

    func testApptOverlap() {
        let orders = [SampleOrder.make(id: 2, appt: "2026-11-01T12:00"),
                      SampleOrder.make(id: 3, appt: "2026-11-01T13:00")]
        let at120 = Logic.apptOverlap(orders: orders, date: "2026-11-01", time: "10:00", excludeId: 1)
        XCTAssertEqual(at120.same.count, 2, "同日排期都算 same")
        XCTAssertEqual(at120.overlap.count, 1, "差 120 分钟算重叠，差 180 分钟不算")
        XCTAssertEqual(Logic.apptOverlap(orders: orders, date: "2026-11-01", time: "10:00", excludeId: 2).overlap.count, 0,
                       "排除自己后不与 12:00 重叠")
        XCTAssertEqual(Logic.apptOverlap(orders: orders, date: "", time: "10:00", excludeId: 1).same.count, 0, "无日期返回空")
    }

    // MARK: - 统计

    func testStatsWindow() {
        let now = Format.parseLocal("2026-11-22T12:00")!
        let orders = [SampleOrder.make(id: 1, price: 1000, appt: "2026-11-20T10:00",
                                       shortAt: "2026-11-20T18:00", longAt: "2026-11-20T18:00"),
                      SampleOrder.make(id: 2, price: 500, appt: "2026-10-25T10:00"),
                      SampleOrder.make(id: 3, price: 300, appt: "2026-09-01T10:00")]
        let payments = [Payment(oid: 1, kind: "定金", amount: 200, at: "2026-11-21T10:00", method: "微信", note: nil)]
        let month = Logic.statsFor(orders: orders, payments: payments, period: "M", list: nil, now: now)
        XCTAssertEqual(month.deals.count, 1, "本月只含 11 月的单")
        XCTAssertEqual(month.dealSum, 1000, "成交额按报价求和")
        XCTAssertEqual(month.paidSum, 200, "实收按流水求和")
        XCTAssertEqual(month.done.count, 1, "已交付计入")
        let d30 = Logic.statsFor(orders: orders, payments: payments, period: "30", list: nil, now: now)
        XCTAssertEqual(d30.deals.count, 2, "近 30 天含 10-25 的单")
        XCTAssertEqual(d30.dealSum, 1500, "窗口变大后成交额同步")
        XCTAssertEqual(Logic.statsFor(orders: orders, payments: payments, period: "7", list: nil, now: now).deals.count,
                       1, "近 7 天只含 11-20")
    }

    func testStatsOnlySubFilmCounts() {
        let now = Format.parseLocal("2026-11-22T12:00")!
        let subOnly = SampleOrder.make(id: 1, price: 1000, deposit: 0, appt: "2026-11-20T10:00",
                                       shotAt: "2026-11-20T11:00", submittedAt: "2026-11-20T12:00",
                                       shortAt: "2026-11-20T18:00", longAt: nil,
                                       deliverMain: false, deliverSub: true)
        XCTAssertEqual(Logic.workOf(subOnly), "已交付")
        let month = Logic.statsFor(orders: [subOnly], payments: [], period: "M", list: nil, now: now)
        XCTAssertEqual(month.done.count, 1, "统计页「已交付完结」不能漏计单副片订单")
        XCTAssertEqual(Logic.lastDeliveredAt(subOnly), "2026-11-20T18:00")
        let both = SampleOrder.make(shortAt: "2026-11-18T18:00", longAt: "2026-11-20T18:00")
        XCTAssertEqual(Logic.lastDeliveredAt(both), "2026-11-20T18:00")
    }

    // MARK: - 催收跟进

    func testRemindLog() {
        XCTAssertEqual(Logic.remindCount(SampleOrder.make()), 0, "没记过就是 0 次")
        XCTAssertNil(Logic.lastRemind(SampleOrder.make()))
        let log = [RemindEntry(at: "2026-11-10T10:00", note: "说这周给"),
                   RemindEntry(at: "2026-11-18T18:30", note: "财务走流程")]
        let tracked = SampleOrder.make(remindLog: log)
        XCTAssertEqual(Logic.remindCount(tracked), 2)
        XCTAssertEqual(Logic.lastRemind(tracked), log[1], "最近一次取数组末尾")
        XCTAssertEqual(Logic.remindCount(SampleOrder.make(remindLog: nil)), 0, "非数组按没记过处理")
    }

    // MARK: - 平台单预计到账

    func testExpectOverdue() {
        let today = Format.parseLocal("2026-11-22T09:00")!
        let douyin = SampleOrder.make(depositPaidAt: "2026-11-01T10:00", settleVia: "douyin",
                                      expectPayAt: "2026-11-15T10:00")
        XCTAssertEqual(Logic.expectOverdue(douyin, payments: [], today: today), 7)
        XCTAssertEqual(Logic.expectOverdue(SampleOrder.make(depositPaidAt: "2026-11-01T10:00", settleVia: "douyin",
                                                            expectPayAt: "2026-11-30T10:00"), payments: [], today: today),
                       0, "还没到日子不算超期")
        XCTAssertEqual(Logic.expectOverdue(SampleOrder.make(depositPaidAt: "2026-11-01T10:00", finalPaidAt: "2026-11-20T10:00",
                                                            settleVia: "douyin",
                                                            expectPayAt: "2026-11-15T10:00"), payments: [], today: today),
                       0, "已收款就不再提醒")
        XCTAssertEqual(Logic.expectOverdue(SampleOrder.make(depositPaidAt: "2026-11-01T10:00", settleVia: "douyin",
                                                            expectPayAt: nil), payments: [], today: today),
                       0, "没填到账日不提示")
        XCTAssertEqual(Logic.expectOverdue(SampleOrder.make(depositPaidAt: "2026-11-01T10:00", settleVia: "private",
                                                            expectPayAt: "2026-11-15T10:00"), payments: [], today: today),
                       0, "私收单带预计到账日不应算超期")
    }

    // MARK: - 未来 N 天

    func testUpcomingByDay() {
        let orders = [SampleOrder.make(id: 1, price: 1000, appt: "2026-11-22T10:00"),
                      SampleOrder.make(id: 2, price: 800, appt: "2026-11-22T15:00"),
                      SampleOrder.make(id: 3, price: 600, appt: "2026-11-25T09:00"),
                      SampleOrder.make(id: 4, price: 900, appt: "2026-12-01T09:00")]
        let week = Logic.upcomingByDay(orders: orders, fromISO: "2026-11-22", days: 7)
        XCTAssertEqual(week.count, 7, "含起点当天共 7 格")
        XCTAssertEqual(week[0].day, "2026-11-22")
        XCTAssertEqual(week[0].count, 2)
        XCTAssertEqual(week[0].sum, 1800, "当天两单合计")
        XCTAssertEqual(week[3].count, 1, "11-25 在窗口内")
        XCTAssertEqual(week[6].count, 0, "12-01 不在 7 天窗口内")
        XCTAssertEqual(Logic.upcomingByDay(orders: orders, fromISO: "不是日期", days: 7).count, 0, "起点非法返回空")
    }

    // MARK: - 金额

    func testMoney() {
        XCTAssertEqual(Logic.moneyCents(1000), 100_000)
        XCTAssertEqual(Logic.moneyCents(12.34), 1234)
        XCTAssertEqual(Logic.moneyCents(12.3), 1230)
        XCTAssertNil(Logic.moneyCents(-1), "负数拒绝")
        XCTAssertNil(Logic.moneyCents(nil))
        XCTAssertNil(Logic.orderMoney(SampleOrder.make(price: 1000, deposit: 2000)), "定金大于报价不合法")
        let money = Logic.orderMoney(SampleOrder.make(price: 1000, deposit: 200))
        XCTAssertEqual(money?.price, 100_000)
        XCTAssertEqual(money?.deposit, 20_000)
        XCTAssertEqual(money?.final, 80_000)
    }

    // MARK: - 时间串校验

    func testValidDateTime() {
        XCTAssertTrue(Logic.validDateTime("2026-11-01T10:00"))
        XCTAssertFalse(Logic.validDateTime("2026-02-30T10:00"), "非法日期要挡掉")
        XCTAssertFalse(Logic.validDateTime("2026-11-01"))
        XCTAssertFalse(Logic.validDateTime(""))
        XCTAssertFalse(Logic.validDateTime(nil))
    }
}
