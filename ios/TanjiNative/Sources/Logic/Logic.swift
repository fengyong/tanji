import Foundation

/// 勋章门槛不合法时的原因（文案与混合版 `validateMedalRules` 一致）。
enum MedalRulesError: LocalizedError {
    case invalid(String)

    var errorDescription: String? {
        switch self {
        case .invalid(let message): return message
        }
    }
}

/// 业务规则层（纯函数，不碰 UI、不读全局状态）。
///
/// 这是产品口径的唯一真源，Swift 版逐条对应 Web 版的 `www/logic.js`。
/// 对应关系：
///   logic.js 的 `TanJiLogic.*` → 本文件同名函数
///   `statsFor` / `apptOverlap` / `upcomingByDay` 的口径与 Web 版逐行等价。
enum Logic {

    // MARK: - 时间基础

    static func pad(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }

    /// 'YYYY-MM-DD'
    static func iso(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return "\(parts.year ?? 0)-\(pad(parts.month ?? 1))-\(pad(parts.day ?? 1))"
    }

    /// 'YYYY-MM-DDTHH:mm'（本地时间）
    static func nowString(_ date: Date = Date()) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        return "\(iso(date))T\(pad(parts.hour ?? 0)):\(pad(parts.minute ?? 0))"
    }

    /// 严格校验本地时间串，并回读一次确认不是 2026-02-30 这类非法日期。
    static func validDateTime(_ value: String?) -> Bool {
        guard let value else { return false }
        return Format.parseLocal(value) != nil
    }

    /// 'YYYY-MM-DDTHH:mm' → 当天第几分钟（用于排期重叠判定）
    static func toMinutes(_ appt: String) -> Int {
        let parts = appt.split(separator: ":")
        guard appt.count >= 16, parts.count >= 2,
              let hour = Int(appt[appt.index(appt.startIndex, offsetBy: 11)..<appt.index(appt.startIndex, offsetBy: 13)]),
              let minute = Int(appt[appt.index(appt.startIndex, offsetBy: 14)..<appt.index(appt.startIndex, offsetBy: 16)])
        else { return 0 }
        _ = parts
        return hour * 60 + minute
    }

    /// 自然日差（跨时区安全：用 UTC 归一），未来日期返回 0
    static func daysBetween(from: String, today: Date = Date()) -> Int {
        guard let fromDate = Format.parseLocal(from) ?? Format.parseDay(from) else { return 0 }
        let fromDay = Calendar.current.startOfDay(for: fromDate)
        let todayDay = Calendar.current.startOfDay(for: today)
        return max(0, Calendar.current.dateComponents([.day], from: fromDay, to: todayDay).day ?? 0)
    }

    // MARK: - 金额（以分为单位，避免浮点误差）

    /// 金额合法则返回分；非法返回 nil
    static func moneyCents(_ value: Double?) -> Int? {
        guard let value, value.isFinite, value >= 0 else { return nil }
        let text = String(format: "%.2f", value)
        let cents = (Double(text) ?? 0) * 100
        guard cents.isFinite, cents >= 0, cents <= Double(Int64.max) else { return nil }
        return Int(cents.rounded())
    }

    /// 报价与定金都合法且定金≤报价时，返回 {price, deposit, final}（分）
    static func orderMoney(_ order: Order) -> (price: Int, deposit: Int, final: Int)? {
        guard let price = moneyCents(order.price),
              let deposit = moneyCents(order.deposit),
              deposit <= price else { return nil }
        return (price, deposit, price - deposit)
    }

    /// 只有定金/尾款两期；流水里的 kind 存中文标签
    static func paymentSpec(_ kind: String) -> (field: String, label: String)? {
        switch kind {
        case "定金": return ("depositPaidAt", "定金")
        case "尾款": return ("finalPaidAt", "尾款")
        default: return nil
        }
    }

    // MARK: - 工作线（正/副片可单独配置）

    static func needMain(_ order: Order) -> Bool { order.deliverMain }
    static func needSub(_ order: Order) -> Bool { order.deliverSub }

    /// 按该单的出片要求判断是否已出齐；两片都不要求时视为已出齐
    static func deliveredAll(_ order: Order) -> Bool {
        let hasLong = !(order.longAt?.isEmpty ?? true)
        let hasShort = !(order.shortAt?.isEmpty ?? true)
        return (!needMain(order) || hasLong) && (!needSub(order) || hasShort)
    }

    /// 工作线四态：待拍摄 → 后期中 → 发片中 → 已交付
    static func workOf(_ order: Order) -> String {
        if order.shotAt?.isEmpty != false { return "待拍摄" }
        if order.submittedAt?.isEmpty != false { return "后期中" }
        if deliveredAll(order) { return "已交付" }
        return "发片中"
    }

    /// 拍摄完成满 24h 仍未出齐 → 红色角标
    static func deliverLate(_ order: Order, now: Date = Date()) -> Bool {
        guard let shotAt = order.shotAt, !shotAt.isEmpty, !deliveredAll(order),
              let shotDate = Format.parseLocal(shotAt) else { return false }
        return now.timeIntervalSince(shotDate) >= 86400
    }

    // MARK: - 资金线

    static func hasReceipt(_ order: Order, kind: String, payments: [Payment]) -> Bool {
        guard let spec = paymentSpec(kind) else { return false }
        let flag: Bool
        switch spec.field {
        case "depositPaidAt": flag = !(order.depositPaidAt?.isEmpty ?? true)
        case "finalPaidAt": flag = !(order.finalPaidAt?.isEmpty ?? true)
        default: flag = false
        }
        if flag { return true }
        return payments.contains { $0.oid == order.id && ($0.kind == spec.label || $0.kind == kind) }
    }

    static func hasAnyReceipt(_ order: Order, payments: [Payment]) -> Bool {
        if !(order.depositPaidAt?.isEmpty ?? true) { return true }
        if !(order.finalPaidAt?.isEmpty ?? true) { return true }
        return payments.contains { $0.oid == order.id }
    }

    static func unDep(_ order: Order, payments: [Payment]) -> Double {
        guard let money = orderMoney(order) else { return 0 }
        return hasReceipt(order, kind: "定金", payments: payments) ? 0 : Double(money.deposit) / 100
    }

    static func unFin(_ order: Order, payments: [Payment]) -> Double {
        guard let money = orderMoney(order) else { return 0 }
        return hasReceipt(order, kind: "尾款", payments: payments) ? 0 : Double(money.final) / 100
    }

    static func owedOf(_ order: Order, payments: [Payment]) -> Double {
        let value = (unDep(order, payments: payments) + unFin(order, payments: payments)) * 100
        return (value).rounded() / 100
    }

    /// 资金线四态；平台结算（douyin）的尾款不催收、不逾期
    static func payOf(_ order: Order, payments: [Payment]) -> String {
        if unDep(order, payments: payments) > 0 { return "待定金" }
        if unFin(order, payments: payments) <= 0 { return "已结清" }
        if order.settleVia == "douyin" { return "平台结算" }
        return "待尾款"
    }

    /// 逾期天数从拍摄日起算；未拍摄/已结清/平台结算返回 0
    static func overdueDays(_ order: Order, payments: [Payment], today: Date = Date()) -> Int {
        if order.settleVia == "douyin" { return 0 }
        if unFin(order, payments: payments) <= 0 { return 0 }
        guard let shotAt = order.shotAt, validDateTime(shotAt) else { return 0 }
        return daysBetween(from: shotAt, today: today)
    }

    static func isOver(_ order: Order, payments: [Payment], threshold: Int, today: Date = Date()) -> Bool {
        guard order.settleVia != "douyin", unFin(order, payments: payments) > 0,
              validDateTime(order.shotAt) else { return false }
        return overdueDays(order, payments: payments, today: today) >= threshold
    }

    /// 已设 1/3/7 天备忘且未到期 → 首页不再催
    static func snoozed(_ order: Order, nowString: String = Logic.nowString()) -> Bool {
        guard let remindAt = order.remindAt, !remindAt.isEmpty else { return false }
        return remindAt > nowString
    }

    // MARK: - 催收跟进痕迹

    static func remindLogOf(_ order: Order) -> [RemindEntry] { order.remindEntries }
    static func remindCount(_ order: Order) -> Int { order.remindEntries.count }

    /// 最近一次催收 {at, note}；没催过返回 nil
    static func lastRemind(_ order: Order) -> RemindEntry? {
        let list = order.remindEntries
        return list.isEmpty ? nil : list[list.count - 1]
    }

    /// 平台单（抖音商单）过了预计到账日仍没收款 → 返回超期天数，否则 0
    static func expectOverdue(_ order: Order, payments: [Payment], today: Date = Date()) -> Int {
        if order.settleVia != "douyin" { return 0 }
        if unFin(order, payments: payments) <= 0 { return 0 }
        guard let expectPayAt = order.expectPayAt, validDateTime(expectPayAt) else { return 0 }
        return daysBetween(from: expectPayAt, today: today)
    }

    /// 最后一次交付时间：正片/副片都算，取较晚的那个；两片都不要求时退回提审时间。
    static func lastDeliveredAt(_ order: Order) -> String? {
        let times = [order.shortAt, order.longAt].compactMap { $0 }.filter { !$0.isEmpty }.sorted()
        if let last = times.last { return last }
        guard let submitted = order.submittedAt, !submitted.isEmpty else { return nil }
        return submitted
    }

    // MARK: - 统计

    struct Stats {
        var start: Date = Date()
        var deals: [Order] = []
        var paid: [Payment] = []
        var done: [Order] = []
        var dealSum: Double = 0
        var paidSum: Double = 0
    }

    /// 窗口：period = "M" 本月 1 日至今；其余按「近 N 天」
    static func statsFor(orders: [Order], payments: [Payment], period: String, list: [Order]?, now: Date = Date()) -> Stats {
        let listOrders = list ?? orders
        let calendar = Calendar.current
        let start: Date
        if period == "M" {
            start = calendar.date(from: calendar.dateComponents([.year, .month], from: now)) ?? now
        } else {
            let days = max(0, (Int(period) ?? 7) - 1)
            let base = calendar.date(byAdding: .day, value: -days, to: calendar.startOfDay(for: now)) ?? now
            start = base
        }
        func inWindow(_ value: String?) -> Bool {
            guard let value, !value.isEmpty, let date = Format.parseLocal(value) else { return false }
            return date >= start && date <= now
        }
        let deals = listOrders.filter { inWindow($0.appt) }
        // 传了 list（账号筛选后的子集）时，流水也要按「这张单属于哪个账号」筛
        let scopedPayments = list == nil ? payments : payments.filter { payment in
            listOrders.contains { $0.id == payment.oid }
        }
        let paid = scopedPayments.filter { inWindow($0.at) }
        let done = listOrders.filter { workOf($0) == "已交付" && inWindow(lastDeliveredAt($0)) }
        return Stats(
            start: start,
            deals: deals,
            paid: paid,
            done: done,
            dealSum: (deals.reduce(0) { $0 + ($1.price * 100).rounded() }) / 100,
            paidSum: (paid.reduce(0) { $0 + ($1.amount * 100).rounded() }) / 100
        )
    }

    // MARK: - 排期重叠（±120 分钟）

    struct Overlap {
        var same: [Order] = []
        var overlap: [Order] = []
    }

    static func apptOverlap(orders: [Order], date: String, time: String, excludeId: Int?) -> Overlap {
        guard !date.isEmpty else { return Overlap() }
        let same = orders.filter { order in
            guard validDateTime(order.appt), order.appt.hasPrefix(date) else { return false }
            if let excludeId, order.id == excludeId { return false }
            return true
        }
        guard !same.isEmpty else { return Overlap(same: same, overlap: []) }
        let target = toMinutes("\(date)T\(time)")
        return Overlap(same: same, overlap: same.filter { abs(toMinutes($0.appt) - target) <= 120 })
    }

    struct DaySummary {
        var day: String
        var count: Int
        var sum: Double
    }

    /// 未来 N 天（含起点当天）每天的单量与成交额
    static func upcomingByDay(orders: [Order], fromISO: String, days: Int = 7) -> [DaySummary] {
        let calendar = Calendar.current
        guard let base = Format.parseDay(fromISO),
              let start = calendar.date(from: calendar.dateComponents([.year, .month, .day], from: base))
        else { return [] }
        return (0..<max(0, days)).map { index in
            guard let date = calendar.date(byAdding: .day, value: index, to: start) else {
                return DaySummary(day: fromISO, count: 0, sum: 0)
            }
            let day = iso(date)
            let list = orders.filter { validDateTime($0.appt) && $0.appt.hasPrefix(day) }
            return DaySummary(day: day, count: list.count, sum: list.reduce(0) { $0 + $1.price })
        }
    }

    // MARK: - 单日勋章

    struct Badge {
        var emoji: String
        var title: String
    }

    /// ⭐ 忙碌日 ≥3 单 · 🔥 爆单 ≥5 单 · 💰 千元日 ≥¥1,000 · 💎 王牌日 ≥¥2,500
    /// 单日徽标：返回当天拿到的最高一档（💎 > 🔥 > 💰 > ⭐）。
    ///
    /// 门槛是全账号共用的一套标准（`MedalRules`），改门槛后历史日期立即按新门槛重判。
    static func dayBadge(count: Int, sum: Double, rules: MedalRules) -> Badge? {
        if sum >= rules.aceAmount { return Badge(emoji: "💎", title: "王牌日") }
        if count >= rules.hotOrders { return Badge(emoji: "🔥", title: "爆单") }
        if sum >= rules.salesAmount { return Badge(emoji: "💰", title: "千元日") }
        if count >= rules.busyOrders { return Badge(emoji: "⭐", title: "忙碌日") }
        return nil
    }

    /// 校验勋章门槛。
    ///
    /// 规则与混合版 `validateMedalRules` 一致：单数为大于 0 的整数、金额为大于 0 的
    /// 两位小数金额，且爆单必须严于忙碌、王牌不得低于千元。
    static func validateMedalRules(_ rules: MedalRules) throws -> MedalRules {
        guard rules.busyOrders >= 1 else {
            throw MedalRulesError.invalid("忙碌日单数必须是大于 0 的整数")
        }
        guard rules.hotOrders >= 1 else {
            throw MedalRulesError.invalid("爆单单数必须是大于 0 的整数")
        }
        guard rules.hotOrders > rules.busyOrders else {
            throw MedalRulesError.invalid("爆单单数必须大于忙碌日单数")
        }
        guard isMoneyAmount(rules.salesAmount), rules.salesAmount > 0 else {
            throw MedalRulesError.invalid("千元日金额必须是大于 0 的金额")
        }
        guard isMoneyAmount(rules.aceAmount), rules.aceAmount > 0 else {
            throw MedalRulesError.invalid("王牌日金额必须是大于 0 的金额")
        }
        guard rules.aceAmount >= rules.salesAmount else {
            throw MedalRulesError.invalid("王牌日金额不能低于千元日金额")
        }
        return rules
    }

    /// 金额最多两位小数（与混合版 `isMoneyAmount` 同口径）。
    static func isMoneyAmount(_ value: Double) -> Bool {
        guard value.isFinite, value >= 0 else { return false }
        let cents = (value * 100).rounded()
        return abs(value * 100 - cents) < 0.00001 && cents <= Double(Int64.max)
    }
}
