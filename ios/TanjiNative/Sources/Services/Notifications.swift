import Foundation
import UserNotifications

/// 本地通知排程（对应 Web 版 `src/app/notify.js`）。
///
/// 通知 id 按「数据空间 × 类型」分段：
///   work(base=0)：每日汇总 = 1；催收备忘 = 100000+订单号；出片提醒 = 300000+订单号
///   demo(base=500000)：演示数据不排真实通知，仅用于清理旧版本遗留。
enum Notifications {
    static let dailyID = 1
    static let snoozeBase = 100_000
    static let deliverBase = 300_000

    private static func base(_ mode: DataSpace) -> Int { mode == .work ? 0 : 500_000 }

    private static var center: UNUserNotificationCenter { UNUserNotificationCenter.current() }

    /// 申请通知权限（已授权直接返回 true）。
    static func ensurePermission() async -> Bool {
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        case .notDetermined:
            return (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        default:
            return false
        }
    }

    private static func pendingIdentifiers() async -> Set<String> {
        let pending = await center.pendingNotificationRequests()
        return Set(pending.map(\.identifier))
    }

    private static func remove(identifiers: [String]) async {
        guard !identifiers.isEmpty else { return }
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
    }

    private static func identifier(_ id: Int) -> String { "tanji.\(id)" }

    // MARK: - 每日催收汇总（09:00）

    static func syncDaily(orders: [Order], payments: [Payment], threshold: Int, notifyEnabled: Bool, mode: DataSpace) async {
        guard mode == .work else { return }
        let daily = identifier(base(mode) + dailyID)
        await remove(identifiers: [daily])
        let overdue = orders.filter { Logic.isOver($0, payments: payments, threshold: threshold) && !Logic.snoozed($0) }
        guard !overdue.isEmpty, notifyEnabled else { return }
        guard await ensurePermission() else { return }
        let maxDays = overdue.map { Logic.overdueDays($0, payments: payments) }.max() ?? 0
        let content = UNMutableNotificationContent()
        content.title = "探记 · 尾款催收"
        content.body = "\(overdue.count) 笔尾款已逾期，最长 \(maxDays) 天 —— 今日安排一次跟进"
        content.sound = .default
        var components = DateComponents()
        components.hour = 9
        components.minute = 0
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
        try? await center.add(UNNotificationRequest(identifier: daily, content: content, trigger: trigger))
    }

    // MARK: - 出片提醒（拍摄满 24h 仍未出齐）

    static func syncDeliver(orders: [Order], mode: DataSpace) async {
        guard mode == .work else { return }
        let ids = await pendingIdentifiers()
        let mine = ids.filter { id in
            guard let value = Int(id.split(separator: ".").last ?? "") else { return false }
            return value >= base(mode) + deliverBase && value < base(mode) + 400_000
        }.sorted()
        await remove(identifiers: mine)
        let now = Date()
        let list = orders.compactMap { order -> (Order, Date)? in
            guard let shotAt = order.shotAt, !shotAt.isEmpty,
                  !Logic.deliveredAll(order),
                  let shot = Format.parseLocal(shotAt) else { return nil }
            let at = shot.addingTimeInterval(86400)
            return at > now ? (order, at) : nil
        }
        guard !list.isEmpty else { return }
        guard await ensurePermission() else { return }
        for (order, at) in list {
            let content = UNMutableNotificationContent()
            content.title = "探记 · 出片提醒"
            content.body = "「\(order.store)」拍摄已超 24 小时，还有片子没出齐，记得跟进"
            content.sound = .default
            let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: at)
            let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
            try? await center.add(UNNotificationRequest(identifier: identifier(base(mode) + deliverBase + order.id),
                                                        content: content,
                                                        trigger: trigger))
        }
    }

    // MARK: - 单次催收备忘

    static func scheduleSnooze(order: Order, days: Int?, mode: DataSpace) async {
        guard mode == .work else { return }
        guard let remindAt = order.remindAt, let at = Format.parseLocal(remindAt) else { return }
        let target = identifier(base(mode) + snoozeBase + order.id)
        await remove(identifiers: [target])
        guard await ensurePermission() else { return }
        let content = UNMutableNotificationContent()
        content.title = "探记 · 催收跟进"
        let when = days != nil ? "（\(days!) 天前设置的提醒）" : "（\(String(remindAt).prefix(5)) 设的提醒）"
        content.body = "「\(order.store)」尾款该跟进了\(when)"
        content.sound = .default
        let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: at)
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        try? await center.add(UNNotificationRequest(identifier: target, content: content, trigger: trigger))
    }

    // MARK: - 撤销

    static func cancelSnooze(orderId: Int, mode: DataSpace) async {
        await remove(identifiers: [identifier(base(mode) + snoozeBase + orderId)])
    }

    static func cancelOrder(orderId: Int, mode: DataSpace) async {
        await remove(identifiers: [identifier(base(mode) + snoozeBase + orderId),
                                   identifier(base(mode) + deliverBase + orderId)])
    }

    /// 只撤当前数据空间的全部通知（另一套数据空间的提醒指向的数据还在，不能动）。
    static func cancelMode(_ mode: DataSpace) async {
        let ids = await pendingIdentifiers()
        let ours = ids.filter { id in
            guard let value = Int(id.split(separator: ".").last ?? "") else { return false }
            let offset = base(mode)
            return value == offset + dailyID || (value >= offset + snoozeBase && value < offset + 400_000)
        }.sorted()
        await remove(identifiers: ours)
    }
}
