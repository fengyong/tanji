import SwiftUI

/// 全局轻提示宿主：把「已保存 / 已复制 / 出错了」这类短提示挂在页面最上层。
///
/// 为什么不用 RootView 里的普通 overlay：
/// 设置页、订单详情、收款表单都是 `.sheet` 呈现的，sheet 盖在 RootView 之上，
/// 挂在 RootView 的提示条会被整块遮住（实测导出后只能看见状态栏下方露出的半截）。
/// 所以每个能弹提示的页面层级都自己挂一个宿主，由 `AppModel` 的宿主栈仲裁，
/// 保证同一时刻只有最上面那层显示提示条。
struct ToastHost: View {
    @EnvironmentObject private var model: AppModel

    /// 本宿主的标识：入栈时登记，出栈时注销。
    @State private var hostID = UUID()

    /// 顶栏高度：提示条落到顶栏下方，不压标题。
    var topInset: CGFloat = 0

    var body: some View {
        ZStack {
            if let toast = model.toastMessage, model.activeToastHostID == hostID {
                ToastOverlay(message: toast)
                    .padding(.top, 8 + topInset)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .allowsHitTesting(false)
        .onAppear { model.registerToastHost(hostID) }
        .onDisappear { model.unregisterToastHost(hostID) }
        .animation(.easeInOut(duration: 0.2), value: model.toastMessage)
    }
}

/// 顶部提示条（对应 Web 版 `.toast`）。
struct ToastOverlay: View {
    let message: String

    var body: some View {
        Text(message)
            .font(Theme.body(13, weight: .semibold))
            .foregroundStyle(Theme.card)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .frame(maxWidth: 340)
            // 接近不透明：半透明会让底下的标题透出来，两层文字叠着看不清。
            .background(Theme.ink.opacity(0.97), in: Capsule())
            .shadow(color: .black.opacity(0.18), radius: 12, y: 6)
            .padding(.horizontal, 24)
    }
}

// MARK: - 顶栏避让

/// 顶栏高度偏好键：页面顶栏上报自己的高度，提示条据此避让。
private struct ToastTopInsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        // 嵌套顶栏取更高的那个（外层顶栏 + 内层顶栏）
        value = max(value, nextValue())
    }
}

extension View {
    /// 标记这是页面的顶栏：提示条会自动落到它下方。
    ///
    /// 用测量而不是写死像素值：顶栏高度会随标题文案、动态字号变化，
    /// 写死的数值迟早会压住标题。
    func toastTopAnchor() -> some View {
        background {
            GeometryReader { proxy in
                Color.clear.preference(key: ToastTopInsetKey.self, value: proxy.size.height)
            }
        }
    }

    /// 在视图最上层挂一条全局提示条。
    ///
    /// 根页面（`RootView`）与每个 sheet 的内容视图都要调用，
    /// 这样无论提示是在标签页里触发、还是在设置页 / 详情页里触发，都能看见。
    /// 顶栏标了 `toastTopAnchor()` 的话，提示条会自动避让。
    func toastHost() -> some View {
        modifier(ToastHostModifier())
    }
}

/// 提示条宿主修饰器：读顶栏高度 → 渲染提示条。
private struct ToastHostModifier: ViewModifier {
    @State private var topInset: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .onPreferenceChange(ToastTopInsetKey.self) { topInset = $0 }
            .overlay {
                ToastHost(topInset: topInset)
            }
    }
}
