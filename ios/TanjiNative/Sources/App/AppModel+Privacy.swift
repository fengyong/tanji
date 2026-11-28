import Foundation

/// 金额隐私相关动作（原生端只认 Face ID）。
extension AppModel {

    /// 启动时读取隐私状态：读不到就保持隐藏并提示。
    func restoreAmountPrivacy() async {
        privacyHidden = AmountPrivacy.isHidden
    }

    /// 切换金额可见性：必须通过系统 Face ID 验证；取消 / 失败 / 不可用都不改变状态。
    func toggleAmountPrivacy() async {
        let wantsHidden = !privacyHidden
        do {
            try await AmountPrivacy.authenticate(reason: wantsHidden ? "隐藏探记中的金额" : "显示探记中的金额")
            privacyHidden = wantsHidden
            AmountPrivacy.setHidden(wantsHidden)
            showToast(wantsHidden ? "已隐藏金额 · 仅 Face ID 可恢复" : "已恢复显示金额")
        } catch {
            showToast(error.localizedDescription)
        }
    }
}
