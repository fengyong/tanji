import Foundation

/// 时间与金额格式化。
///
/// 全部使用本地时间串 'YYYY-MM-DDTHH:mm'，与 Web 版 `src/app/util.js` 口径一致
/// （Web 版同样用本地时间字符串，不带时区）。
enum Format {

    private static let localFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return formatter
    }()

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let preciseFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return formatter
    }()

    /// 解析 'YYYY-MM-DDTHH:mm'（也接受带秒的写法），非法返回 nil。
    /// 与 Web 版 validDateTime 同口径：解析后回读一次，确认不是 2026-02-30 这类非法日期。
    static func parseLocal(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 16 else { return nil }
        let head = String(trimmed.prefix(16))
        guard let date = localFormatter.date(from: head) else { return nil }
        // 回读校验：年/月/日/时/分必须与输入一致
        let local = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        let datePart = String(head.prefix(10))
        let timePart = String(head.suffix(5))
        let dateParts = datePart.split(separator: "-")
        guard dateParts.count == 3,
              let year = Int(dateParts[0]), let month = Int(dateParts[1]), let day = Int(dateParts[2]),
              let hour = Int(timePart.prefix(2)), let minute = Int(timePart.suffix(2))
        else { return nil }
        guard local.year == year, local.month == month, local.day == day,
              local.hour == hour, local.minute == minute
        else { return nil }
        return date
    }

    /// 解析 'YYYY-MM-DD'
    static func parseDay(_ value: String?) -> Date? {
        guard let value, value.count == 10 else { return nil }
        guard let date = dayFormatter.date(from: value) else { return nil }
        let parts = value.split(separator: "-")
        guard parts.count == 3, let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]) else {
            return nil
        }
        let local = Calendar.current.dateComponents([.year, .month, .day], from: date)
        guard local.year == year, local.month == month, local.day == day else { return nil }
        return date
    }

    /// 'YYYY-MM-DDTHH:mm' → Date
    static func date(fromLocal value: String) -> Date? { parseLocal(value) }

    /// Date → 'YYYY-MM-DDTHH:mm'
    static func localString(_ date: Date) -> String { localFormatter.string(from: date) }

    /// Date → 'YYYY-MM-DD'
    static func dayString(_ date: Date) -> String { dayFormatter.string(from: date) }

    /// Date → ISO8601（备份文件的 exportedAt 用）
    static func isoString(_ date: Date = Date()) -> String {
        ISO8601DateFormatter().string(from: date)
    }

    /// 今天的 'YYYY-MM-DD'
    static func today(_ date: Date = Date()) -> String { dayString(date) }

    /// 'YYYY-MM-DDTHH:mm' → 'M-DD'
    static func fmtD(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "—" }
        guard let date = parseLocal(value) ?? parseDay(value) else { return "—" }
        let parts = Calendar.current.dateComponents([.month, .day], from: date)
        return "\(parts.month ?? 0)-\(Logic.pad(parts.day ?? 0))"
    }

    /// 'YYYY-MM-DDTHH:mm' → 'HH:mm'
    static func fmtHM(_ value: String?) -> String {
        guard let value, value.count >= 16 else { return "—" }
        return String(value[value.index(value.startIndex, offsetBy: 11)..<value.index(value.startIndex, offsetBy: 16)])
    }

    /// 'YYYY-MM-DDTHH:mm' → 'M-DD HH:mm'
    static func fmtDT(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "—" }
        return "\(fmtD(value)) \(fmtHM(value))"
    }

    /// 金额展示：隐私模式下一律打码
    static func fmtMoney(_ value: Double, masked: Bool) -> String {
        if masked { return "¥✱✱✱" }
        return "¥" + moneyText(value)
    }

    /// 金额本体（不带符号）
    static func moneyText(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 2
        formatter.minimumFractionDigits = 0
        formatter.usesGroupingSeparator = true
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// 轴刻度用的紧凑金额：12800 → 1.28万
    static func compactMoney(_ value: Double) -> String {
        if abs(value) >= 10000 {
            var text = String(format: "%.2f", value / 10000)
            while text.hasSuffix("0") { text.removeLast() }
            if text.hasSuffix(".") { text.removeLast() }
            return text + "万"
        }
        return moneyText(value)
    }

    private static let dowNames = ["一", "二", "三", "四", "五", "六", "日"]

    /// 'YYYY-MM-DD' → 星期几（周一为 1）
    static func dowOf(_ value: String) -> String {
        guard let date = parseDay(value) ?? parseLocal(value) else { return "" }
        let weekday = Calendar.current.component(.weekday, from: date)
        return dowNames[(weekday + 5) % 7]
    }

    /// 完整日期 + 星期 + 今天/明天/后天/N 天后
    static func relativeDayLabel(_ value: String, baseDay: String = today()) -> String {
        guard value.count == 10, baseDay.count == 10,
              let target = parseDay(value), let base = parseDay(baseDay) else { return "" }
        let days = Calendar.current.dateComponents([.day],
                                                   from: Calendar.current.startOfDay(for: base),
                                                   to: Calendar.current.startOfDay(for: target)).day ?? 0
        let relative: String
        switch days {
        case 0: relative = "今天"
        case 1: relative = "明天"
        case 2: relative = "后天"
        case -1: relative = "昨天"
        case -2: relative = "前天"
        case let d where d > 2: relative = "\(d) 天后"
        case let d where d < -2: relative = "\(-d) 天前"
        default: relative = ""
        }
        return "\(value) 周\(dowOf(value)) · \(relative)"
    }

    /// 日期加减，返回 'YYYY-MM-DD'
    static func dayOffset(_ days: Int, from date: Date = Date()) -> String {
        let calendar = Calendar.current
        let shifted = calendar.date(byAdding: .day, value: days, to: date) ?? date
        return dayString(shifted)
    }

    /// 'YYYY-MM-DDTHH:mm' 加减天数
    static func localOffset(_ days: Int, hourMinute: String, from date: Date = Date()) -> String {
        let calendar = Calendar.current
        let shifted = calendar.date(byAdding: .day, value: days, to: date) ?? date
        let parts = hourMinute.split(separator: ":")
        let hour = parts.first.flatMap { Int($0) } ?? 10
        let minute = parts.count > 1 ? (Int(parts[1]) ?? 0) : 0
        var components = Calendar.current.dateComponents([.year, .month, .day], from: shifted)
        components.hour = hour
        components.minute = minute
        let result = calendar.date(from: components) ?? shifted
        return localString(result)
    }

    /// 金额四舍五入到分（与 Web 版 Math.round(x*100)/100 同口径）
    static func round2(_ value: Double) -> Double {
        (value * 100).rounded() / 100
    }
}
