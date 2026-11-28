import Foundation
import LocalAuthentication

/// 金额隐私：原生端隐藏与显示都必须经过系统 Face ID。
///
/// 口径与混合版未提交的原生实现一致：
///   - 只接受 Face ID，不接受 Touch ID，也不接受设备密码 fallback；
///   - 取消 / 失败 / 锁定 / 未录入 / 不可用都不改变状态；
///   - 隐藏状态跨 App 重启保留（存 UserDefaults）。
enum AmountPrivacyError: LocalizedError {
    case unavailable
    case cancelled
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return "本机没有可用的 Face ID，无法隐藏或显示金额"
        case .cancelled:
            return "已取消验证，金额未改变"
        case .failed(let message):
            return "Face ID 验证失败：\(message)"
        }
    }
}

enum AmountPrivacy {
    static let storageKey = "tanji.amountPrivacy.hidden.v1"

    static var isHidden: Bool {
        UserDefaults.standard.bool(forKey: storageKey)
    }

    static func setHidden(_ hidden: Bool) {
        UserDefaults.standard.set(hidden, forKey: storageKey)
    }

    /// 走一次系统 Face ID 验证。成功返回，失败抛错（调用方保持原状态）。
    @MainActor
    static func authenticate(reason: String) async throws {
        let context = LAContext()
        context.localizedFallbackTitle = ""
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            throw AmountPrivacyError.unavailable
        }
        guard context.biometryType == .faceID else {
            throw AmountPrivacyError.unavailable
        }
        do {
            let ok = try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                                                       localizedReason: reason)
            if !ok { throw AmountPrivacyError.cancelled }
        } catch let error as AmountPrivacyError {
            throw error
        } catch {
            throw AmountPrivacyError.failed(error.localizedDescription)
        }
    }
}
