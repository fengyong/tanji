import Foundation
import UIKit
import Capacitor

@objc(NativeTabsPlugin)
final class NativeTabsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeTabsPlugin"
    public let jsName = "NativeTabs"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setState", returnType: CAPPluginReturnPromise)
    ]

    private weak var container: NativeTabContainerViewController?
    private var ready = false
    private var pendingTab: String?
    private var commandCounter = 0
    private var lastCommandId: Int?
    private var lastCommandTab: String?

    init(container: NativeTabContainerViewController) {
        self.container = container
        super.init()
    }

    func requestTab(_ tab: String) {
        guard ready else {
            pendingTab = tab
            return
        }
        dispatch(tab)
    }

    func tabBarHeightChanged(_ height: CGFloat) {
        bridge?.triggerWindowJSEvent(
            eventName: "tanjiNativeLayout",
            data: "{\"bottomInset\":\(Int(height.rounded()))}"
        )
    }

    @objc func setState(_ call: CAPPluginCall) {
        let isReady = call.getBool("ready") ?? false
        let tab = call.getString("tab") ?? "home"
        let badge = max(0, call.getInt("badge") ?? 0)
        let overlay = call.getString("overlay") ?? "none"
        let appliedCommandId = call.getInt("appliedCommandId") ?? 0

        DispatchQueue.main.async {
            self.ready = isReady
            self.container?.applyState(tab: tab, badge: badge, overlayName: overlay)
            let bottomInset = Double(self.container?.nativeTabBarHeight ?? 0)

            if !isReady {
                self.pendingTab = nil
                self.lastCommandId = nil
                self.lastCommandTab = nil
            } else {
                if self.lastCommandId == appliedCommandId {
                    self.lastCommandId = nil
                    self.lastCommandTab = nil
                }
                if let pending = self.pendingTab {
                    self.pendingTab = nil
                    self.dispatch(pending)
                } else if self.lastCommandId != appliedCommandId, let commandTab = self.lastCommandTab {
                    self.dispatch(commandTab)
                }
            }
            call.resolve(["bottomInset": bottomInset])
        }
    }

    private func dispatch(_ tab: String) {
        guard NativeTabContainerViewController.isValidTab(tab) else { return }
        commandCounter += 1
        lastCommandId = commandCounter
        lastCommandTab = tab
        bridge?.triggerWindowJSEvent(
            eventName: "tanjiNativeTab",
            data: "{\"tab\":\"\(tab)\",\"commandId\":\(commandCounter)}"
        )
    }
}
