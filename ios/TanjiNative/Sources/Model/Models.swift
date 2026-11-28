import Foundation
import SwiftUI

/// 数据空间：两套数据独立保存（工作 / 演示）。
enum DataSpace: String, CaseIterable, Codable, Identifiable {
    case work
    case demo

    var id: String { rawValue }
    var title: String { self == .work ? "工作" : "演示" }
}

/// 催收跟进痕迹：只记「什么时候问的、对方怎么答」，不含金额。
struct RemindEntry: Codable, Equatable, Identifiable {
    var at: String
    var note: String

    var id: String { "\(at)|\(note)" }
}

/// 订单。字段名与混合版 JSON 备份完全一致，保证旧备份可原样导入。
struct Order: Codable, Equatable, Identifiable {
    var id: Int
    var store: String
    var cat: String
    var contact: String
    var price: Double
    var deposit: Double
    /// 预约时间，'YYYY-MM-DDTHH:mm'
    var appt: String
    var shotAt: String?
    var submittedAt: String?
    /// 副片发出时间
    var shortAt: String?
    /// 正片发出时间
    var longAt: String?
    var depositPaidAt: String?
    var finalPaidAt: String?
    /// private 私收 / douyin 抖音商单
    var settleVia: String
    /// 催收备忘：下次提醒时间
    var remindAt: String?
    var channel: String
    var partner: String
    var location: String
    var gpsPlace: String?
    var deliverMain: Bool
    var deliverSub: Bool
    /// '' 待审 / pass 合格 / fail 不合格
    var reviewResult: String
    var publishedAt: String?
    var accountId: Int?
    var note: String
    var remindLog: [RemindEntry]?
    /// 随手拍缩略图（dataURL）
    var photoThumb: String?
    /// 平台单预计到账时间
    var expectPayAt: String?

    init(id: Int,
         store: String,
         cat: String = "其他",
         contact: String = "",
         price: Double = 0,
         deposit: Double = 0,
         appt: String = "",
         shotAt: String? = nil,
         submittedAt: String? = nil,
         shortAt: String? = nil,
         longAt: String? = nil,
         depositPaidAt: String? = nil,
         finalPaidAt: String? = nil,
         settleVia: String = "private",
         remindAt: String? = nil,
         channel: String = "直客",
         partner: String = "",
         location: String = "",
         gpsPlace: String? = nil,
         deliverMain: Bool = true,
         deliverSub: Bool = true,
         reviewResult: String = "",
         publishedAt: String? = nil,
         accountId: Int? = nil,
         note: String = "",
         remindLog: [RemindEntry]? = nil,
         photoThumb: String? = nil,
         expectPayAt: String? = nil) {
        self.id = id
        self.store = store
        self.cat = cat
        self.contact = contact
        self.price = price
        self.deposit = deposit
        self.appt = appt
        self.shotAt = shotAt
        self.submittedAt = submittedAt
        self.shortAt = shortAt
        self.longAt = longAt
        self.depositPaidAt = depositPaidAt
        self.finalPaidAt = finalPaidAt
        self.settleVia = settleVia
        self.remindAt = remindAt
        self.channel = channel
        self.partner = partner
        self.location = location
        self.gpsPlace = gpsPlace
        self.deliverMain = deliverMain
        self.deliverSub = deliverSub
        self.reviewResult = reviewResult
        self.publishedAt = publishedAt
        self.accountId = accountId
        self.note = note
        self.remindLog = remindLog
        self.photoThumb = photoThumb
        self.expectPayAt = expectPayAt
    }

    /// 催收跟进条目（脏数据按空处理）
    var remindEntries: [RemindEntry] { remindLog ?? [] }
}

/// 收款流水。`kind` 存中文标签：定金 / 尾款。
struct Payment: Codable, Equatable, Identifiable {
    var oid: Int
    var kind: String
    var amount: Double
    /// 到账时间，'YYYY-MM-DDTHH:mm'
    var at: String
    var method: String
    var note: String?

    var id: String { "\(oid)-\(kind)-\(at)-\(amount)" }

    static let kinds = ["定金", "尾款"]
    static let methods = ["微信", "支付宝", "银行卡", "抖音商单", "其他"]
}

/// 账号。昵称必填，其余选填。
struct Account: Codable, Equatable, Identifiable {
    var id: Int
    var name: String
    var phone: String
    var douyin: String
    /// 标识色序号 0-7
    var color: Int
    /// 头像 dataURL
    var avatar: String?
    var createdAt: String?
    /// 对外登记等级（Lv.5 / Lv.6 / Lv.7）。不参与勋章判定。
    ///
    /// 可选：旧备份与旧库里没有这个字段，缺失时按 `AccountLevel.standard` 兜底。
    var level: String?

    init(id: Int,
         name: String,
         phone: String = "",
         douyin: String = "",
         color: Int = 0,
         avatar: String? = nil,
         createdAt: String? = nil,
         level: String? = nil) {
        self.id = id
        self.name = name
        self.phone = phone
        self.douyin = douyin
        self.color = color
        self.avatar = avatar
        self.createdAt = createdAt
        self.level = level
    }

    /// 对外等级的可读值：缺失或非法时回落到 Lv.5（与混合版 `accLevel` 同口径）。
    var levelTitle: String {
        guard let level, AccountLevel.titles.contains(level) else { return AccountLevel.standard.rawValue }
        return level
    }
}

/// 一整套数据（工作 / 演示 各自一份）。
struct AppData: Equatable {
    var orders: [Order] = []
    var payments: [Payment] = []
    var threshold: Int = 15
    var notifyEnabled: Bool = true
    var accounts: [Account] = []
    var providers: [String] = []
    /// 勋章门槛：所有账号共用一套标准。
    var medalRules: MedalRules = .standard
}

/// 账号对外登记等级（与混合版 `ACCOUNT_LEVELS` 同口径，便于两版备份互导）。
enum AccountLevel: String, CaseIterable, Codable, Identifiable {
    case l5 = "Lv.5"
    case l6 = "Lv.6"
    case l7 = "Lv.7"

    var id: String { rawValue }
    var title: String { rawValue }
    /// 缺省等级。
    static let standard: AccountLevel = .l5
    /// 合法值集合：导入校验用。
    static let titles: [String] = AccountLevel.allCases.map(\.rawValue)
}

/// 勋章门槛：判定某一天拿到哪枚徽标，四档共用一套标准。
///
/// 与混合版 `DEFAULT_MEDAL_RULES` 同字段同默认值，两版备份可以互导。
/// 金额按当天订单总价计算，不是实收。
struct MedalRules: Codable, Equatable {
    /// ⭐ 忙碌日：当天订单单数达到即得。
    var busyOrders: Int
    /// 💰 千元日：当天订单总价达到即得。
    var salesAmount: Double
    /// 🔥 爆单：当天订单单数达到即得。
    var hotOrders: Int
    /// 💎 王牌日：当天订单总价达到即得。
    var aceAmount: Double

    static let standard = MedalRules(busyOrders: 3, salesAmount: 1000, hotOrders: 5, aceAmount: 2500)
}

/// 账号标识色板（与混合版一致：浅底 + 墨色）。
enum AccountPalette {
    struct Swatch {
        let name: String
        let background: Color
        let ink: Color
    }

    static let swatches: [Swatch] = [
        Swatch(name: "蜜橙", background: Color(hex: "#FFF3EC"), ink: Color(hex: "#E85D1F")),
        Swatch(name: "雾蓝", background: Color(hex: "#EEF4FF"), ink: Color(hex: "#3E7BFA")),
        Swatch(name: "抹茶", background: Color(hex: "#EDF7EF"), ink: Color(hex: "#339966")),
        Swatch(name: "香芋", background: Color(hex: "#F4EEFB"), ink: Color(hex: "#8E5CD9")),
        Swatch(name: "杏黄", background: Color(hex: "#FFF6E3"), ink: Color(hex: "#C97C10")),
        Swatch(name: "玫瑰", background: Color(hex: "#FCEFF2"), ink: Color(hex: "#CE5478")),
        Swatch(name: "黛青", background: Color(hex: "#EDF5F6"), ink: Color(hex: "#3D8CA0")),
        Swatch(name: "卵石灰", background: Color(hex: "#F2F2F6"), ink: Color(hex: "#67676F"))
    ]

    static func swatch(_ index: Int?) -> Swatch {
        swatches[((index ?? 0) % swatches.count + swatches.count) % swatches.count]
    }

    static let presetProviders = ["蜂向", "小爱", "金城", "食物", "直客"]
}
