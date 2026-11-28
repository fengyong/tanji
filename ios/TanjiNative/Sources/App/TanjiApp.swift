import SwiftUI

@main
struct TanjiApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .tint(Theme.brand)
                .task {
                    await model.load()
                    #if DEBUG
                    // UI 测试用：重置成 Demo 种子，保证每次跑的初始状态一致。
                    if DebugSelfCheck.resetOnLaunch { await model.resetToDemoSeed() }
                    if DebugSelfCheck.openSettings { model.settingsPresented = true }
                    if DebugSelfCheck.exportOnLaunch {
                        try? BackupService.exportJSON(model.data)
                        try? BackupService.exportCSV(model.data)
                        try? BackupService.exportSQLite()
                    }
                    #endif
                    await model.restoreAmountPrivacy()
                    await Notifications.syncDaily(orders: model.orders,
                                                  payments: model.payments,
                                                  threshold: model.threshold,
                                                  notifyEnabled: model.data.notifyEnabled,
                                                  mode: model.mode)
                    await Notifications.syncDeliver(orders: model.orders, mode: model.mode)
                }
        }
    }
}

/// 五个主 Tab + 设置页 + 顶部提示。
struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ZStack(alignment: .top) {
            TabView(selection: $model.selectedTab) {
                HomeView()
                    .tabItem { Label("首页", systemImage: "house") }
                    .tag(AppTab.home)
                TripView()
                    .tabItem { Label("行程", systemImage: "calendar") }
                    .tag(AppTab.trip)
                OrdersView()
                    .tabItem { Label("订单", systemImage: "list.bullet.rectangle") }
                    .tag(AppTab.orders)
                PayView()
                    .tabItem { Label("收款", systemImage: "creditcard") }
                    .tag(AppTab.pay)
                    .badge(model.overdueBadgeCount)
                StatsView()
                    .tabItem { Label("统计", systemImage: "chart.bar.xaxis") }
                    .tag(AppTab.stats)
            }
            .sheet(isPresented: $model.settingsPresented) {
                SettingsView()
            }
        }
        // 根层的提示条宿主：sheet 打开时会被上层的宿主接管（见 ToastHost 的宿主栈）。
        // 标签页顶栏高度由 AppHeader 上报，提示条自动落到大标题下方。
        .toastHost()
        .animation(.easeInOut(duration: 0.2), value: model.toastMessage)
        // 版面是按固定字号排的（与 Web 版一致），动态字号封顶到 AX1：
        // 再大就会把卡片和图表挤变形。系统控件（日期选择、输入框）仍跟随放大。
        .dynamicTypeSize(.large ... .accessibility1)
    }
}
