import Foundation

/// 备份文件的解析与校验。
///
/// 逐条对应 Web 版 `src/app/storage.js` 的 `validateState`：
/// 字段名、版本白名单与报错文案都保持一致，旧版备份（0.2 ~ 0.6）必须继续可导入。
enum BackupError: LocalizedError {
    case invalid(String)

    var errorDescription: String? {
        switch self {
        case .invalid(let message): return message
        }
    }
}

/// 已存图片的合法性校验（对应 Web 版 `www/imaging.js`）。
enum ImageStore {
    /// 随手拍缩略图上限 12KB 字符
    static let doorLimit = 12 * 1024
    /// 头像上限 200KB 字符
    static let avatarLimit = 200 * 1024

    private static let dataURLPattern = try? NSRegularExpression(pattern: "^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$")

    static func isDataURL(_ value: String) -> Bool {
        guard let regex = dataURLPattern else { return false }
        let range = NSRange(value.startIndex..., in: value)
        return regex.firstMatch(in: value, range: range) != nil
    }

    static func isValidStored(_ value: String, max: Int = avatarLimit) -> Bool {
        isDataURL(value) && value.count <= max
    }
}

/// 到店定位串（`lat,lng`）的解析（对应 Web 版 `www/geo.js`）。
enum GeoStore {
    private static let numberPattern = try? NSRegularExpression(pattern: "^-?\\d{1,3}(?:\\.\\d{1,6})?$")

    static func parse(_ place: String?) -> (lat: Double, lng: Double)? {
        guard let place, place.count <= 40 else { return nil }
        let parts = place.split(separator: ",", omittingEmptySubsequences: false)
        guard parts.count == 2,
              let regex = numberPattern,
              regex.firstMatch(in: String(parts[0]), range: NSRange(String(parts[0]).startIndex..., in: String(parts[0]))) != nil,
              regex.firstMatch(in: String(parts[1]), range: NSRange(String(parts[1]).startIndex..., in: String(parts[1]))) != nil,
              let lat = Double(parts[0]), let lng = Double(parts[1]),
              abs(lat) <= 90, abs(lng) <= 180
        else { return nil }
        return (lat, lng)
    }

    static func isValid(_ place: String?) -> Bool { parse(place) != nil }

    /// 展示用：`22.543096, 114.057865`
    static func label(_ place: String?) -> String {
        guard let point = parse(place) else { return "" }
        return String(format: "%.6f, %.6f", point.lat, point.lng)
    }
}

/// 备份文件解析器。
enum BackupValidator {

    private static let supportedVersions = ["0.2", "0.3", "0.4", "0.5", "0.6"]
    private static let supportedDataVersions: Set<Int> = [2, 3]

    /// 解析备份 JSON，返回可直接落库的一套数据。
    static func parse(_ data: Data) throws -> AppData {
        let text = String(data: data, encoding: .utf8) ?? ""
        let stripped = text.hasPrefix("\u{FEFF}") ? String(text.dropFirst()) : text
        let object: Any
        do {
            object = try JSONSerialization.jsonObject(with: Data(stripped.utf8), options: [.fragmentsAllowed])
        } catch {
            throw BackupError.invalid("不是有效的 JSON 文件")
        }
        guard let root = object as? [String: Any] else {
            throw BackupError.invalid("备份必须包含订单与收款流水数组")
        }
        return try parse(root)
    }

    static func parse(_ root: [String: Any]) throws -> AppData {
        // 版本白名单只增不减：0.2~0.4 是老 Web 版备份，0.5 起带正/副片与送审字段，0.6 起带 accounts/providers。
        if let version = root["version"], !(version is NSNull) {
            guard let text = version as? String, supportedVersions.contains(text) else {
                throw BackupError.invalid("暂不支持这个备份版本")
            }
        }
        if let v = root["v"], !(v is NSNull) {
            guard let number = v as? NSNumber, supportedDataVersions.contains(number.intValue) else {
                throw BackupError.invalid("暂不支持这个数据版本")
            }
        }
        guard let ordersRaw = root["orders"] as? [Any] else {
            throw BackupError.invalid("备份必须包含订单与收款流水数组")
        }
        guard let paymentsRaw = root["payments"] as? [Any] else {
            throw BackupError.invalid("备份必须包含订单与收款流水数组")
        }

        let threshold = try parseThreshold(root["threshold"] ?? root["collectThresholdDays"])
        let notifyEnabled: Bool
        if let value = root["notifyEnabled"], !(value is NSNull) {
            guard let number = value as? NSNumber else { throw BackupError.invalid("notifyEnabled 必须是布尔值") }
            notifyEnabled = number.boolValue
        } else {
            notifyEnabled = true
        }

        let accounts = try parseAccounts(root["accounts"])
        let providers = try parseProviders(root["providers"])
        let orders = try parseOrders(ordersRaw, accountIds: Set(accounts.map(\.id)))
        let payments = try parsePayments(paymentsRaw, orderIds: Set(orders.map(\.id)))

        return AppData(orders: orders,
                       payments: payments,
                       threshold: threshold,
                       notifyEnabled: notifyEnabled,
                       accounts: accounts,
                       providers: providers)
    }

    // MARK: - 分项校验

    private static func parseThreshold(_ value: Any?) throws -> Int {
        let threshold: Int
        if let value, !(value is NSNull) {
            if let number = value as? NSNumber { threshold = number.intValue }
            else if let text = value as? String, let parsed = Int(text) { threshold = parsed }
            else { throw BackupError.invalid("催收阈值应为 7、15、30 或 45 天") }
        } else {
            threshold = 15
        }
        guard [7, 15, 30, 45].contains(threshold) else {
            throw BackupError.invalid("催收阈值应为 7、15、30 或 45 天")
        }
        return threshold
    }

    private static func parseAmount(_ value: Any?) -> Bool {
        guard let number = value as? NSNumber, !(value is NSNull) else { return false }
        let double = number.doubleValue
        guard double.isFinite, double >= 0 else { return false }
        let cents = (double * 100).rounded()
        guard cents.isFinite, cents <= Double(Int64.max) else { return false }
        return abs(double * 100 - cents) < 0.00001
    }

    private static func text(_ value: Any?, _ label: String, fallback: String = "") throws -> String {
        if let value, !(value is NSNull) {
            guard let text = value as? String else { throw BackupError.invalid("\(label)必须是文本") }
            return text
        }
        return fallback
    }

    private static func parseAccounts(_ value: Any?) throws -> [Account] {
        guard let list = value as? [Any] else { return [] }
        var seen = Set<Int>()
        var accounts: [Account] = []
        for (index, item) in list.enumerated() {
            let label = "第 \(index + 1) 个账号"
            guard let dict = item as? [String: Any] else {
                throw BackupError.invalid("\(label)的 ID 无效或重复")
            }
            guard let idNumber = dict["id"] as? NSNumber, idNumber.intValue >= 1 else {
                throw BackupError.invalid("\(label)的 ID 无效或重复")
            }
            let id = idNumber.intValue
            guard !seen.contains(id) else { throw BackupError.invalid("\(label)的 ID 无效或重复") }
            seen.insert(id)
            guard let name = dict["name"] as? String, !name.trimmingCharacters(in: .whitespaces).isEmpty else {
                throw BackupError.invalid("\(label)缺少昵称")
            }
            let phone = try text(dict["phone"], "\(label)的手机号")
            let douyin = try text(dict["douyin"], "\(label)的抖音账号")
            let color: Int
            if let colorNumber = dict["color"] as? NSNumber {
                color = max(0, min(7, colorNumber.intValue))
            } else {
                color = index % 8
            }
            var avatar: String?
            if let raw = dict["avatar"], !(raw is NSNull) {
                guard let avatarText = raw as? String,
                      ImageStore.isValidStored(avatarText),
                      avatarText.count <= ImageStore.avatarLimit
                else { throw BackupError.invalid("\(label)的头像数据无效") }
                avatar = avatarText
            }
            let createdAt = try text(dict["createdAt"], "\(label)的创建时间")
            accounts.append(Account(id: id,
                                    name: name,
                                    phone: phone,
                                    douyin: douyin,
                                    color: color,
                                    avatar: avatar,
                                    createdAt: createdAt.isEmpty ? nil : createdAt))
        }
        return accounts
    }

    private static func parseProviders(_ value: Any?) throws -> [String] {
        guard let list = value as? [Any] else { return [] }
        var seen = Set<String>()
        var providers: [String] = []
        for item in list {
            guard let text = item as? String else { throw BackupError.invalid("服务商预设必须是文本") }
            let trimmed = text.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty, !seen.contains(trimmed) else { continue }
            seen.insert(trimmed)
            providers.append(trimmed)
        }
        return providers
    }

    private static let orderDateFields = ["shotAt", "submittedAt", "shortAt", "longAt", "depositPaidAt", "finalPaidAt", "remindAt", "publishedAt"]

    private static func parseOrders(_ list: [Any], accountIds: Set<Int>) throws -> [Order] {
        var seen = Set<Int>()
        var orders: [Order] = []
        for (index, item) in list.enumerated() {
            let label = "第 \(index + 1) 笔订单"
            guard let dict = item as? [String: Any] else {
                throw BackupError.invalid("\(label)的 ID 无效、重复或超过上限(99999)")
            }
            guard let idNumber = dict["id"] as? NSNumber else {
                throw BackupError.invalid("\(label)的 ID 无效、重复或超过上限(99999)")
            }
            let id = idNumber.intValue
            guard id >= 1, id < 100000, !seen.contains(id) else {
                throw BackupError.invalid("\(label)的 ID 无效、重复或超过上限(99999)")
            }
            seen.insert(id)
            guard let store = dict["store"] as? String, !store.trimmingCharacters(in: .whitespaces).isEmpty else {
                throw BackupError.invalid("\(label)缺少商家名称")
            }
            guard parseAmount(dict["price"]), parseAmount(dict["deposit"]) else {
                throw BackupError.invalid("\(label)的总价或定金不合法")
            }
            let price = (dict["price"] as! NSNumber).doubleValue
            let deposit = (dict["deposit"] as! NSNumber).doubleValue
            guard deposit <= price else { throw BackupError.invalid("\(label)的总价或定金不合法") }
            let appt = try text(dict["appt"], "\(label)的预约时间")
            guard Logic.validDateTime(appt) else { throw BackupError.invalid("\(label)的预约时间无效") }
            var settleVia = "private"
            if let raw = dict["settleVia"], !(raw is NSNull) {
                guard let text = raw as? String, ["private", "douyin"].contains(text) else {
                    throw BackupError.invalid("\(label)的结算方式无效")
                }
                settleVia = text
            }
            var reviewResult = ""
            if let raw = dict["reviewResult"], !(raw is NSNull) {
                guard let text = raw as? String, ["", "pass", "fail"].contains(text) else {
                    throw BackupError.invalid("\(label)的送审结果无效")
                }
                reviewResult = text
            }
            let accountId: Int?
            if let raw = dict["accountId"], !(raw is NSNull), let number = raw as? NSNumber {
                let value = number.intValue
                accountId = accountIds.contains(value) ? value : nil
            } else {
                accountId = nil
            }

            var order = Order(id: id,
                              store: store,
                              cat: try text(dict["cat"], "\(label)的cat", fallback: "其他"),
                              contact: try text(dict["contact"], "\(label)的contact"),
                              price: Format.round2(price),
                              deposit: Format.round2(deposit),
                              appt: appt,
                              settleVia: settleVia,
                              channel: try text(dict["channel"], "\(label)的channel", fallback: "直客"),
                              partner: try text(dict["partner"], "\(label)的partner"),
                              location: try text(dict["location"], "\(label)的location"),
                              deliverMain: (dict["deliverMain"] as? NSNumber)?.boolValue ?? true,
                              deliverSub: (dict["deliverSub"] as? NSNumber)?.boolValue ?? true,
                              reviewResult: reviewResult,
                              accountId: accountId,
                              note: try text(dict["note"], "\(label)的note"))

            for field in orderDateFields {
                let raw = dict[field]
                if let raw, !(raw is NSNull) {
                    guard let value = raw as? String, Logic.validDateTime(value) else {
                        throw BackupError.invalid("\(label)的\(field)时间无效")
                    }
                    switch field {
                    case "shotAt": order.shotAt = value
                    case "submittedAt": order.submittedAt = value
                    case "shortAt": order.shortAt = value
                    case "longAt": order.longAt = value
                    case "depositPaidAt": order.depositPaidAt = value
                    case "finalPaidAt": order.finalPaidAt = value
                    case "remindAt": order.remindAt = value
                    case "publishedAt": order.publishedAt = value
                    default: break
                    }
                } else {
                    switch field {
                    case "shotAt": order.shotAt = nil
                    case "submittedAt": order.submittedAt = nil
                    case "shortAt": order.shortAt = nil
                    case "longAt": order.longAt = nil
                    case "depositPaidAt": order.depositPaidAt = nil
                    case "finalPaidAt": order.finalPaidAt = nil
                    case "remindAt": order.remindAt = nil
                    case "publishedAt": order.publishedAt = nil
                    default: break
                    }
                }
            }
            if let raw = dict["expectPayAt"], !(raw is NSNull), let value = raw as? String, !value.isEmpty {
                guard Logic.validDateTime(value) else { throw BackupError.invalid("\(label)的预计到账时间无效") }
                order.expectPayAt = value
            }
            // 催收跟进痕迹：坏条目丢弃不抛错（与到店定位一致），只留最近 50 条
            if let log = dict["remindLog"] as? [Any] {
                let entries: [RemindEntry] = log.compactMap { item in
                    guard let entry = item as? [String: Any],
                          let at = entry["at"] as? String,
                          Logic.validDateTime(at) else { return nil }
                    let note = (entry["note"] as? String).map { String($0.prefix(200)) } ?? ""
                    return RemindEntry(at: at, note: note)
                }
                if !entries.isEmpty {
                    order.remindLog = Array(entries.suffix(50))
                }
            }
            if let raw = dict["photoThumb"], !(raw is NSNull) {
                guard let value = raw as? String,
                      ImageStore.isValidStored(value, max: ImageStore.doorLimit) else {
                    throw BackupError.invalid("\(label)的随手拍照片无效或过大")
                }
                order.photoThumb = value
            }
            if let raw = dict["gpsPlace"], let value = raw as? String, !value.trimmingCharacters(in: .whitespaces).isEmpty {
                if GeoStore.isValid(value) {
                    order.gpsPlace = value.trimmingCharacters(in: .whitespaces)
                }
            }
            orders.append(order)
        }
        return orders
    }

    private static func parsePayments(_ list: [Any], orderIds: Set<Int>) throws -> [Payment] {
        var payments: [Payment] = []
        for (index, item) in list.enumerated() {
            let label = "第 \(index + 1) 笔流水"
            guard let dict = item as? [String: Any] else {
                throw BackupError.invalid("\(label)找不到对应订单")
            }
            guard let oidNumber = dict["oid"] as? NSNumber, orderIds.contains(oidNumber.intValue) else {
                throw BackupError.invalid("\(label)找不到对应订单")
            }
            let oid = oidNumber.intValue
            guard let kind = dict["kind"] as? String, Payment.kinds.contains(kind) else {
                throw BackupError.invalid("\(label)的类型、金额或日期无效")
            }
            guard parseAmount(dict["amount"]) else {
                throw BackupError.invalid("\(label)的类型、金额或日期无效")
            }
            let at = try text(dict["at"], "\(label)的到账时间")
            guard Logic.validDateTime(at) else { throw BackupError.invalid("\(label)的类型、金额或日期无效") }
            guard let method = dict["method"] as? String, Payment.methods.contains(method) else {
                throw BackupError.invalid("\(label)的收款方式无效")
            }
            var note: String?
            if let raw = dict["note"], !(raw is NSNull) {
                note = try text(raw, "\(label)备注")
            }
            payments.append(Payment(oid: oid,
                                    kind: kind,
                                    amount: Format.round2((dict["amount"] as! NSNumber).doubleValue),
                                    at: at,
                                    method: method,
                                    note: note))
        }
        return payments
    }
}
