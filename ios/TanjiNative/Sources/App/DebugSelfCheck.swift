import Foundation

#if DEBUG
/// 调试自检钩子（仅 Debug 构建，Release 不含）：
///   -tanji-tab N      启动后直接落到第 N 个 Tab
///   -tanji-settings   启动后直接打开设置页
///   -tanji-export     启动后把三种导出各写一份到「探记 HG」文件夹
///   -tanji-reset      启动后把当前数据空间重置成 Demo 种子（UI 测试用，保证每次跑的状态一样）
enum DebugSelfCheck {
    static var arguments: [String] { ProcessInfo.processInfo.arguments }

    static var tab: Int? {
        guard let index = arguments.firstIndex(of: "-tanji-tab"), index + 1 < arguments.count,
              let value = Int(arguments[index + 1]), (0..<5).contains(value) else { return nil }
        return value
    }

    static var openSettings: Bool { arguments.contains("-tanji-settings") }

    static var exportOnLaunch: Bool { arguments.contains("-tanji-export") }

    static var resetOnLaunch: Bool { arguments.contains("-tanji-reset") }
}
#endif
