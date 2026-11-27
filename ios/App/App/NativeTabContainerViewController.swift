import UIKit
import Capacitor

final class NativeTabContainerViewController: UIViewController, UITabBarDelegate {
    enum Overlay: String {
        case none, sheet, crop
    }

    private let tabs = ["home", "trip", "orders", "pay", "stats"]
    private let titles = ["首页", "行程", "订单", "收款", "统计"]
    private let symbols = ["house", "calendar", "list.bullet.rectangle", "creditcard", "chart.bar"]
    private let bridgeController = AppBridgeViewController()
    private let tabBar = UITabBar()
    private weak var tabsPlugin: NativeTabsPlugin?
    private var overlay: Overlay = .none
    private var keyboardVisible = false
    private(set) var nativeTabBarHeight: CGFloat = 0

    static func isValidTab(_ tab: String) -> Bool {
        ["home", "trip", "orders", "pay", "stats"].contains(tab)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 244 / 255, green: 241 / 255, blue: 232 / 255, alpha: 1)

        addChild(bridgeController)
        view.addSubview(bridgeController.view)
        bridgeController.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            bridgeController.view.topAnchor.constraint(equalTo: view.topAnchor),
            bridgeController.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            bridgeController.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bridgeController.view.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        bridgeController.didMove(toParent: self)

        configureTabBar()
        view.addSubview(tabBar)
        tabBar.delegate = self

        let keyboardNotifications: [Notification.Name] = [
            UIResponder.keyboardWillChangeFrameNotification,
            UIResponder.keyboardDidChangeFrameNotification,
            UIResponder.keyboardDidShowNotification,
            UIResponder.keyboardDidHideNotification
        ]
        for name in keyboardNotifications {
            NotificationCenter.default.addObserver(self, selector: #selector(keyboardFrameChanged), name: name, object: nil)
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    func attach(_ plugin: NativeTabsPlugin) {
        tabsPlugin = plugin
    }

    func applyState(tab: String, badge: Int, overlayName: String) {
        if Self.isValidTab(tab), let index = tabs.firstIndex(of: tab) {
            let item = tabBar.items?[index]
            if tabBar.selectedItem !== item { tabBar.selectedItem = item }
        }
        tabBar.items?[3].badgeValue = badge > 0 ? "\(badge)" : nil
        if let value = Overlay(rawValue: overlayName), value != overlay {
            overlay = value
            updateTabBarVisibility()
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let fittingHeight = tabBar.sizeThatFits(CGSize(width: view.bounds.width, height: .greatestFiniteMagnitude)).height
        let height = max(49, fittingHeight) + view.safeAreaInsets.bottom
        tabBar.frame = CGRect(x: 0, y: view.bounds.height - height, width: view.bounds.width, height: height)
        if abs(nativeTabBarHeight - height) > 0.5 {
            nativeTabBarHeight = height
            tabsPlugin?.tabBarHeightChanged(height)
        }
    }

    override var childForStatusBarStyle: UIViewController? { bridgeController }
    override var childForStatusBarHidden: UIViewController? { bridgeController }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { bridgeController.supportedInterfaceOrientations }

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        tabsPlugin?.requestTab(tabs[item.tag])
    }

    private func configureTabBar() {
        tabBar.tintColor = UIColor(red: 23 / 255, green: 53 / 255, blue: 47 / 255, alpha: 1)
        tabBar.unselectedItemTintColor = UIColor(red: 98 / 255, green: 109 / 255, blue: 101 / 255, alpha: 1)
        tabBar.accessibilityTraits = .tabBar
        tabBar.accessibilityIdentifier = "native.tabBar"
        tabBar.items = tabs.enumerated().map { index, tab in
            let item = UITabBarItem(
                title: titles[index],
                image: UIImage(systemName: symbols[index]),
                selectedImage: UIImage(systemName: symbols[index])
            )
            item.tag = index
            item.accessibilityLabel = titles[index]
            item.badgeColor = UIColor(red: 166 / 255, green: 61 / 255, blue: 55 / 255, alpha: 1)
            return item
        }

        if #available(iOS 26.0, *) {
            return
        }
        let appearance = UITabBarAppearance()
        appearance.configureWithDefaultBackground()
        appearance.backgroundEffect = UIBlurEffect(style: .systemThinMaterial)
        appearance.backgroundColor = .clear
        appearance.shadowColor = .clear
        tabBar.standardAppearance = appearance
        tabBar.scrollEdgeAppearance = appearance
    }

    private func updateTabBarVisibility() {
        let hidden = overlay != .none || keyboardVisible
        if hidden {
            tabBar.isHidden = true
        } else {
            tabBar.isHidden = false
            tabBar.alpha = 0
            UIView.animate(withDuration: 0.16, delay: 0, options: .curveEaseOut) {
                self.tabBar.alpha = 1
            }
        }
    }

    @objc private func keyboardFrameChanged(_ notification: Notification) {
        let visible: Bool
        if notification.name == UIResponder.keyboardDidHideNotification {
            visible = false
        } else if let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
            let localFrame = view.convert(frame, from: view.window)
            visible = localFrame.minY < tabBar.frame.maxY
        } else {
            visible = notification.name != UIResponder.keyboardWillChangeFrameNotification
        }
        guard keyboardVisible != visible else { return }
        keyboardVisible = visible
        updateTabBarVisibility()
    }
}
