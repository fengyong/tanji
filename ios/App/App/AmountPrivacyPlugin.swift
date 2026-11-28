import Foundation
import LocalAuthentication
import UIKit
import Capacitor

@objc(AmountPrivacyPlugin)
final class AmountPrivacyPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AmountPrivacyPlugin"
    public let jsName = "AmountPrivacy"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "toggle", returnType: CAPPluginReturnPromise)
    ]

    private static let hiddenKey = "tanji.amountPrivacy.hidden.v1"
    private let defaults = UserDefaults.standard
    private var authenticating = false

    @objc func getState(_ call: CAPPluginCall) {
        call.resolve(["enabled": defaults.bool(forKey: Self.hiddenKey)])
    }

    @objc func toggle(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard !self.authenticating else {
                call.reject("正在验证 Face ID，请稍候。", "AUTH_IN_PROGRESS")
                return
            }
            self.authenticating = true

            let context = LAContext()
            context.localizedFallbackTitle = ""
            var availabilityError: NSError?
            guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &availabilityError) else {
                self.authenticating = false
                let message = self.unavailableMessage(for: availabilityError)
                call.reject(message, "FACE_ID_UNAVAILABLE")
                return
            }
            guard context.biometryType == .faceID else {
                self.authenticating = false
                call.reject("金额隐私开关仅支持 Face ID，不能使用触控 ID 或设备密码。", "FACE_ID_UNAVAILABLE")
                return
            }

            let hidden = self.defaults.bool(forKey: Self.hiddenKey)
            context.localizedReason = hidden ? "确认是你本人后显示探记中的金额" : "确认是你本人后隐藏探记中的金额"
            context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: context.localizedReason) { success, error in
                DispatchQueue.main.async {
                    self.authenticating = false
                    guard success else {
                        let (message, code) = self.failure(error: error as NSError?)
                        call.reject(message, code)
                        return
                    }
                    let enabled = !self.defaults.bool(forKey: Self.hiddenKey)
                    self.defaults.set(enabled, forKey: Self.hiddenKey)
                    call.resolve(["enabled": enabled])
                }
            }
        }
    }

    private func unavailableMessage(for error: NSError?) -> String {
        guard let error = error, error.domain == LAError.errorDomain else {
            return "Face ID 当前不可用，请检查系统设置。金额状态未改变。"
        }
        switch error.code {
        case LAError.Code.biometryNotEnrolled.rawValue:
            return "尚未录入 Face ID，请先在 iPhone 设置中录入。金额状态未改变。"
        case LAError.Code.biometryLockout.rawValue:
            return "Face ID 已锁定，请稍后重试。金额状态未改变。"
        case LAError.Code.passcodeNotSet.rawValue:
            return "设备尚未设置密码，无法启用 Face ID。金额状态未改变。"
        case LAError.Code.biometryNotAvailable.rawValue:
            return "此设备当前无法使用 Face ID。金额状态未改变。"
        default:
            return "Face ID 当前不可用，请检查系统设置。金额状态未改变。"
        }
    }

    private func failure(error: NSError?) -> (message: String, code: String) {
        guard let error = error, error.domain == LAError.errorDomain else {
            return ("Face ID 验证失败，金额状态未改变。", "AUTH_FAILED")
        }
        switch error.code {
        case LAError.Code.userCancel.rawValue, LAError.Code.appCancel.rawValue, LAError.Code.systemCancel.rawValue:
            return ("已取消 Face ID 验证，金额状态未改变。", "USER_CANCELED")
        case LAError.Code.userFallback.rawValue:
            return ("此功能仅接受 Face ID，不能使用备用验证方式。金额状态未改变。", "AUTH_FAILED")
        case LAError.Code.biometryLockout.rawValue:
            return ("Face ID 已锁定，请稍后重试。金额状态未改变。", "BIOMETRY_LOCKOUT")
        case LAError.Code.biometryNotEnrolled.rawValue:
            return ("尚未录入 Face ID，请先在 iPhone 设置中录入。金额状态未改变。", "FACE_ID_UNAVAILABLE")
        case LAError.Code.biometryNotAvailable.rawValue:
            return ("Face ID 当前不可用。金额状态未改变。", "FACE_ID_UNAVAILABLE")
        case LAError.Code.authenticationFailed.rawValue:
            return ("Face ID 验证失败，金额状态未改变。", "AUTH_FAILED")
        default:
            return ("Face ID 验证未完成，金额状态未改变。", "AUTH_FAILED")
        }
    }
}
