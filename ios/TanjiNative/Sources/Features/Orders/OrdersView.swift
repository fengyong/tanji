import SwiftUI

/// 订单列表：工作线分段 + 账号筛选条 + 搜索 + 订单卡片（行内推进）。
///
/// 口径对应 Web 版 `src/app/views/orders.js`：
///   - 搜索命中字段与 Web 一致（商家 / 地点 / 联系人 / 服务商 / 组队 / 备注 / 类型）；
///   - 排序按「拍摄时间，没有则预约时间」倒序；
///   - 行内推进按钮沿用 Web 的 nextStep 口径（提审 → 发副片 → 发正片 → 发布）。
struct OrdersView: View {
    @EnvironmentObject private var model: AppModel

    /// 单一 sheet 载荷：避免同一视图上挂两个 sheet 修饰符。
    private enum Sheet: Identifiable {
        case detail(Order)
        case newOrder

        var id: String {
            switch self {
            case .detail(let order): return "detail-\(order.id)"
            case .newOrder: return "new"
            }
        }
    }

    @State private var sheet: Sheet?

    /// 工作线筛选分段（全部 / 待拍摄 / 后期中 / 发片中 / 已交付）。
    /// 值直接用工作线名，避免与 Web 版的 chip key（doing = 后期中+发片中）语义冲突；
    /// 同时兼容 Web key（wait / doing / unpaid / over / done），供其他页面设置 model.orderChip 时使用。
    private static let chipItems: [(String, String)] = [
        ("all", "全部"),
        ("待拍摄", "待拍摄"),
        ("后期中", "后期中"),
        ("发片中", "发片中"),
        ("已交付", "已交付")
    ]

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    header
                    AccountFilterBar()
                    SearchField(text: $model.orderQuery,
                                placeholder: "搜索商家 / 地点 / 联系人 / 备注")
                    SegmentedTabs(items: Self.chipItems, selection: chipSelection)
                    listContent
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
            }
        }
        .sheet(item: $sheet) { item in
            switch item {
            case .detail(let order):
                OrderDetailView(order: order)
            case .newOrder:
                OrderFormView(order: nil)
            }
        }
    }

    // MARK: - 顶栏

    private var header: some View {
        AppHeader(eyebrow: "Work / 交付与资金双轨",
                  title: "订单",
                  subtitle: "\(baseOrders.count) 笔订单 · 点一行推进下一步") {
            HStack(spacing: 8) {
                IconButton(systemName: model.privacyHidden ? "eye.slash" : "eye",
                           active: model.privacyHidden,
                           accessibility: model.privacyHidden ? "显示金额" : "隐藏金额") {
                    Task { await model.toggleAmountPrivacy() }
                }
                OrderPillButton(title: "预约", systemImage: "plus") {
                    sheet = .newOrder
                }
            }
        }
    }

    // MARK: - 列表

    /// 分段选中值：写入时用工作线名；读取时把别处写入的 Web key 映射到对应分段，
    /// 这样别的页面把 model.orderChip 设成「wait / done」时，分段仍能高亮。
    private var chipSelection: Binding<String> {
        Binding(
            get: {
                switch model.orderChip {
                case "wait": return "待拍摄"
                case "done": return "已交付"
                default: return model.orderChip
                }
            },
            set: { model.orderChip = $0 }
        )
    }

    @ViewBuilder
    private var listContent: some View {
        if visibleOrders.isEmpty {
            EmptyState(title: model.orderQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                       ? "这个分类暂时没有订单"
                       : "没有找到匹配的订单",
                       subtitle: model.orderQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                       ? "点右上角「预约」新建一笔"
                       : nil)
            .padding(.top, 18)
        } else {
            VStack(spacing: 12) {
                ForEach(visibleOrders) { order in
                    OrderCard(order: order,
                              account: model.isMultiAccount ? model.account(order.accountId) : nil,
                              work: Logic.workOf(order),
                              pay: payLabel(order),
                              price: order.price,
                              masked: model.privacyHidden,
                              footnote: footnote(order),
                              onTap: { sheet = .detail(order) },
                              onAdvance: { step in advance(order, step) })
                }
            }
        }
    }

    // MARK: - 数据

    /// 账号筛选后的订单（与 Web 的 accMatch 同口径）。
    private var baseOrders: [Order] { model.filteredOrders }

    private var visibleOrders: [Order] {
        let query = model.orderQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return baseOrders
            .filter { chipMatch($0) }
            .filter { query.isEmpty || searchMatch($0, query) }
            .sorted { sortKey($0) > sortKey($1) }
    }

    /// 工作线筛选：按需求口径用工作线四态；另兼容 Web 版的资金线 key（unpaid / over）。
    private func chipMatch(_ order: Order) -> Bool {
        let work = Logic.workOf(order)
        switch model.orderChip {
        case "待拍摄", "wait": return work == "待拍摄"
        case "后期中": return work == "后期中"
        case "发片中": return work == "发片中"
        case "已交付", "done": return work == "已交付"
        case "doing": return work == "后期中" || work == "发片中"
        case "unpaid": return Logic.owedOf(order, payments: model.payments) > 0
        case "over": return Logic.isOver(order, payments: model.payments, threshold: model.threshold)
        default: return true
        }
    }

    /// 搜索命中：商家 / 地点 / 联系人 / 服务商 / 组队 / 备注 / 类型（与 Web 版一致）。
    private func searchMatch(_ order: Order, _ query: String) -> Bool {
        let fields = [order.store, order.location, order.contact, order.channel,
                      order.partner, order.note, order.cat]
        return fields.contains { $0.lowercased().contains(query) }
    }

    /// 排序键：拍摄时间优先，没有则用预约时间（Web 版 shotAt || appt）。
    private func sortKey(_ order: Order) -> String {
        let shot = order.shotAt ?? ""
        return shot.isEmpty ? order.appt : shot
    }

    /// 收款状态标签（与 Web 版 payChip 同口径：待尾款且逾期才算「已逾期」）。
    private func payLabel(_ order: Order) -> String {
        let state = Logic.payOf(order, payments: model.payments)
        if state == "待尾款" && Logic.isOver(order, payments: model.payments, threshold: model.threshold) {
            return "已逾期"
        }
        return state
    }

    /// 行内副标题：拍摄 / 预约时间 + 出镜搭档。
    private func footnote(_ order: Order) -> String {
        var parts: [String] = []
        if let shot = order.shotAt, !shot.isEmpty {
            parts.append("拍摄 \(Format.fmtD(shot))")
        } else {
            parts.append("预约 \(Format.fmtD(order.appt)) \(Format.fmtHM(order.appt))")
        }
        if !order.partner.isEmpty {
            parts.append("出镜 \(order.partner)")
        }
        return parts.joined(separator: " · ")
    }

    // MARK: - 动作

    /// 行内推进：与 Web 版 stepBtn 的 nextStep 口径一致。
    private func advance(_ order: Order, _ step: OrderStep) {
        Task {
            switch step {
            case .submitted:
                await model.advance(order, field: .submitted)
                model.showToast("已标记提审")
            case .short:
                await model.advance(order, field: .short)
                model.showToast("副片已发出")
            case .long:
                await model.advance(order, field: .long)
                model.showToast("正片已发出")
            case .published:
                await model.setPublishedAt(orderId: order.id, value: Logic.nowString())
                model.showToast("已标记发布")
            }
        }
    }
}

// MARK: - 订单卡片

/// 订单卡片：OrderRow + 行内状态标签 + 行内推进按钮。
private struct OrderCard: View {
    let order: Order
    let account: Account?
    let work: String
    let pay: String
    let price: Double
    let masked: Bool
    let footnote: String
    let onTap: () -> Void
    let onAdvance: (OrderStep) -> Void

    @EnvironmentObject private var model: AppModel

    var body: some View {
        CardBox {
            VStack(alignment: .leading, spacing: 10) {
                OrderRow(order: order,
                         account: account,
                         work: work,
                         pay: pay,
                         price: price,
                         masked: masked,
                         footnote: footnote,
                         onTap: onTap)
                footer
            }
        }
    }

    private var footer: some View {
        let owed = Logic.owedOf(order, payments: model.payments)
        return HStack(spacing: 6) {
            if !order.channel.isEmpty && order.channel != "直客" {
                Chip(text: order.channel)
            }
            // Web 版列表只在「达到催收阈值」时挂「欠 N 天」红标。
            if Logic.isOver(order, payments: model.payments, threshold: model.threshold) {
                let days = Logic.overdueDays(order, payments: model.payments)
                Chip(text: "欠 \(days) 天", ink: Theme.red, background: Theme.redSoft)
            }
            if Logic.snoozed(order) {
                Chip(text: "已设提醒")
            }
            Spacer(minLength: 6)
            Text(owed > 0 ? "待收 \(Format.fmtMoney(owed, masked: masked))" : "已结清")
                .font(Theme.body(11.5, weight: .semibold))
                .foregroundStyle(owed > 0 ? Theme.red : Theme.sub)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            if let step = OrderStep.next(for: order) {
                OrderStepButton(title: step.title) { onAdvance(step) }
            }
        }
    }
}

// MARK: - 行内推进步骤

/// 下一步推进动作（对应 Web 版 detail.js 的 nextStep）。
private enum OrderStep {
    case submitted
    case short
    case long
    case published

    var title: String {
        switch self {
        case .submitted: return "提审"
        case .short: return "发副片"
        case .long: return "发正片"
        case .published: return "发布"
        }
    }

    /// Web 版口径：已拍摄之后，按提审 → 副片 → 正片 → 发布 的顺序推进。
    static func next(for order: Order) -> OrderStep? {
        guard let shot = order.shotAt, !shot.isEmpty else { return nil }
        if (order.submittedAt ?? "").isEmpty { return .submitted }
        if Logic.needSub(order) && (order.shortAt ?? "").isEmpty { return .short }
        if Logic.needMain(order) && (order.longAt ?? "").isEmpty { return .long }
        if Logic.deliveredAll(order) && (order.publishedAt ?? "").isEmpty { return .published }
        return nil
    }
}

// MARK: - 小控件

/// 顶栏药丸按钮（对应 Web 版 .btn-pill）。
private struct OrderPillButton: View {
    let title: String
    var systemImage: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let systemImage {
                    Image(systemName: systemImage).font(Theme.body(12, weight: .bold))
                }
                Text(title).font(Theme.body(12, weight: .bold))
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
            .foregroundStyle(Theme.card)
            .padding(.horizontal, 14)
            .frame(height: 44)
            .background(Theme.ink, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .shadow(color: Theme.shadow, radius: 10, y: 6)
        }
        .buttonStyle(.plain)
    }
}

/// 行内推进按钮（对应 Web 版 .mini-btn）。
private struct OrderStepButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(Theme.body(11.5, weight: .bold))
                .foregroundStyle(Theme.brandInk)
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(Theme.brandSoft, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}
