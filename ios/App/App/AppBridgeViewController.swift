import UIKit
import Capacitor

final class AppBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let container = parent as? NativeTabContainerViewController else { return }
        let plugin = NativeTabsPlugin(container: container)
        bridge?.registerPluginInstance(plugin)
        let privacyPlugin = AmountPrivacyPlugin()
        bridge?.registerPluginInstance(privacyPlugin)
        let backupFilesPlugin = BackupFilesPlugin()
        bridge?.registerPluginInstance(backupFilesPlugin)
        container.attach(plugin)
    }
}
