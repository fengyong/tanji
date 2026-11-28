import SwiftUI

/// 视觉规范：与混合版同一套暖纸色 + 墨绿 + 橘色。
enum Theme {
    static let paper = Color(hex: "#F4F1E8")
    static let paperDeep = Color(hex: "#ECE8DD")
    static let card = Color(hex: "#FFFCF6")
    static let ink = Color(hex: "#17352F")
    static let ink2 = Color(hex: "#35564E")
    static let sub = Color(hex: "#626D65")
    static let line = Color(hex: "#17352F").opacity(0.13)
    static let lineStrong = Color(hex: "#17352F").opacity(0.22)
    static let brand = Color(hex: "#E9683C")
    static let brandInk = Color(hex: "#A94326")
    static let brandAction = Color(hex: "#C54E2C")
    static let brandSoft = Color(hex: "#FBE5D9")
    static let green = Color(hex: "#2F6F58")
    static let greenSoft = Color(hex: "#E5F0E8")
    static let orange = Color(hex: "#8A5B16")
    static let orangeSoft = Color(hex: "#F6ECD9")
    static let red = Color(hex: "#A63D37")
    static let redSoft = Color(hex: "#F9E5E1")
    static let blue = Color(hex: "#406482")
    static let blueSoft = Color(hex: "#E6EEF5")
    static let purple = Color(hex: "#6C507F")
    static let purpleSoft = Color(hex: "#EEE8F4")

    static let radius: CGFloat = 22
    static let radiusSmall: CGFloat = 14
    static let shadow = Color.black.opacity(0.06)

    /// 标题用的衬线体（与 Web 版 --display 同源）。
    ///
    /// 用系统衬线（`.serif`）而不是 `Font.custom("Songti SC")`：
    /// 自定义字体一旦再套 `.weight()`，SwiftUI 会退回可随动态字号放大的字体，
    /// 在「超大」字号下标题会被撑到两倍并逐字换行。系统衬线在中文上会自动回落到宋体。
    static func display(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }

    static func body(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        Font.system(size: size, weight: weight)
    }
}

extension Color {
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)
        let r = Double((value >> 16) & 0xFF) / 255
        let g = Double((value >> 8) & 0xFF) / 255
        let b = Double(value & 0xFF) / 255
        self.init(.sRGB, red: r, green: g, blue: b, opacity: 1)
    }
}

/// 状态色映射（工作线 / 资金线 / 收款方式）。
enum Palette {
    static func workTint(_ work: String) -> (Color, Color) {
        switch work {
        case "待拍摄": return (Theme.blue, Theme.blueSoft)
        case "后期中": return (Theme.purple, Theme.purpleSoft)
        case "发片中": return (Theme.orange, Theme.orangeSoft)
        case "已交付": return (Theme.green, Theme.greenSoft)
        default: return (Theme.sub, Theme.paperDeep)
        }
    }

    static func payTint(_ pay: String) -> (Color, Color) {
        switch pay {
        case "待定金": return (Theme.sub, Theme.paperDeep)
        case "待尾款": return (Theme.orange, Theme.orangeSoft)
        case "平台结算": return (Theme.blue, Theme.blueSoft)
        case "已逾期": return (Theme.red, Theme.redSoft)
        case "已结清": return (Theme.green, Theme.greenSoft)
        default: return (Theme.sub, Theme.paperDeep)
        }
    }

    static func methodTint(_ method: String) -> (Color, Color) {
        switch method {
        case "微信": return (Theme.green, Theme.greenSoft)
        case "支付宝": return (Theme.blue, Theme.blueSoft)
        case "银行卡": return (Theme.orange, Theme.orangeSoft)
        case "抖音商单": return (Theme.ink, Theme.paperDeep)
        default: return (Theme.sub, Theme.paperDeep)
        }
    }
}
