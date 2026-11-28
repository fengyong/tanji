import SwiftUI

/// 收款页：待收款总额大卡 · 逾期分桶 · 待收订单卡片 · 最近收款流水。
///
/// 结构与 Web 版 `src/app/views/pay.js` 对齐：
///   顶栏 → 账号筛选条 → 待收款总额（money-hero）→ 逾期分桶分段器 → 待收订单列表 → 最近收款。
///
/// 口径要点（与 Web 版逐条一致）：
///   - 待收款订单 = 账号筛选后「仍有欠款（owedOf > 0）」的单；
///   - 逾期天数从拍摄日起算，私收单才计逾期，平台单（抖音商单）不计；
///   - 分桶：全部 / ≤7 天 / 8–30 天 / 30 天+，另有两个快捷筛选「待催收 / 已设提醒」；
///   - 排序：未设提醒的在前 → 逾期天数多的在前 → 预约时间早的在前。
///
/// 与 Web 版的取舍：
///   - Web 行内是「标记已收 / 标记到账」（直接入账），原生改成「收定金 / 收尾款」，
///     先走 PaymentFormView 确认金额与收款方式，避免误点就入账；
///   - Web 的「导出流水 ›」入口未复刻：原生导出在设置页，契约未给页面级导出入口。
struct PayView: View {
    @EnvironmentObject private var model: AppModel

    /// 单一 sheet 载荷：避免同一视图上挂多个 sheet 修饰符。
    private enum PaySheet: Identifiable {
        case detail(Order)
        case payment(order: Order, kind: String)
        case remind(Order)

        var id: String {
            switch self {
            case .detail(let order): return "detail-\(order.id)"
            case .payment(let order, let kind): return "payment-\(order.id)-\(kind)"
            case .remind(let order): return "remind-\(order.id)"
            }
        }
    }

    @State private var sheet: PaySheet?

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    AccountFilterBar()
                    moneyHero
                    bucketSegment
                    bucketChips
                    orderSection
                    recentSection
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 28)
            }
        }
        .sheet(item: $sheet) { item in
            switch item {
            case .detail(let order):
                OrderDetailView(order: order)
            case .payment(let order, let kind):
                PaymentFormView(order: order, kind: kind) { }
            case .remind(let order):
                RemindLogView(order: order) { }
            }
        }
    }

    // MARK: - 顶栏

    private var header: some View {
        AppHeader(eyebrow: "Cash flow / 账期自拍摄日起算",
                  title: "收款",
                  subtitle: "钱要收回，过程也要留得清。") {
            IconButton(systemName: model.privacyHidden ? "eye.slash" : "eye",
                       active: model.privacyHidden,
                       accessibility: model.privacyHidden ? "显示金额" : "隐藏金额") {
                Task { await model.toggleAmountPrivacy() }
            }
        }
    }

    // MARK: - 待收款总额（money-hero）

    /// 深色大卡：总额 + 分类标签（私收尾款 / 抖音商单 / 定金 / 逾期 / 已设提醒）。
    private var moneyHero: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Outstanding / 待收款总额")
                .font(Theme.body(9.5, weight: .heavy))
                .tracking(1.5)
                .foregroundStyle(Theme.card.opacity(0.58))
            MoneyText(value: totalDue,
                      masked: model.privacyHidden,
                      font: Theme.display(40),
                      color: Theme.card)
                .padding(.top, 9)
                .padding(.bottom, 13)
            PayFlowLayout(spacing: 6) {
                heroChip("私收尾款 \(Format.fmtMoney(privateFinalSum, masked: model.privacyHidden))")
                if douyinFinalSum > 0 {
                    heroChip("抖音商单 \(Format.fmtMoney(douyinFinalSum, masked: model.privacyHidden))", .blue)
                }
                heroChip("定金 \(Format.fmtMoney(depositSum, masked: model.privacyHidden))")
                if overdueOrders.isEmpty {
                    heroChip("无逾期", .green)
                } else {
                    heroChip("逾期 \(overdueOrders.count) 笔 · \(Format.fmtMoney(overdueSum, masked: model.privacyHidden))", .red)
                }
                if snoozedCount > 0 {
                    heroChip("\(snoozedCount) 笔已设提醒")
                }
            }
        }
        .padding(19)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.ink, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: Theme.ink.opacity(0.16), radius: 16, y: 8)
        .padding(.top, 4)
        .padding(.bottom, 14)
    }

    /// 深色底上的标签配色（对应 Web 版 .money-hero .chip 的四种变体）。
    private enum HeroTint {
        case plain
        case red
        case blue
        case green
    }

    private func heroChip(_ text: String, _ tint: HeroTint = .plain) -> some View {
        let background: Color
        let ink: Color
        switch tint {
        case .plain:
            background = Theme.card.opacity(0.10)
            ink = Theme.card.opacity(0.78)
        case .red:
            background = Color(hex: "#C34F47").opacity(0.28)
            ink = Color(hex: "#FFD7CF")
        case .blue:
            background = Color(hex: "#4B7092").opacity(0.30)
            ink = Color(hex: "#D6E6F4")
        case .green:
            background = Color(hex: "#5FA680").opacity(0.22)
            ink = Color(hex: "#CDEBD9")
        }
        return Text(text)
            .font(Theme.body(10, weight: .bold))
            .foregroundStyle(ink)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(background, in: Capsule())
    }

    // MARK: - 分桶

    /// 逾期分桶分段器（全部 / ≤7 天 / 8–30 天 / 30 天+）。
    private var bucketSegment: some View {
        SegmentedTabs(items: Self.bucketItems, selection: $model.payBucket)
            .padding(.bottom, 12)
    }

    private static let bucketItems: [(String, String)] = [
        ("all", "全部"),
        ("s7", "≤ 7 天"),
        ("m830", "8–30 天"),
        ("g30", "30 天+")
    ]

    /// 两个快捷筛选：待催收 / 已设提醒（对应 Web 版 .chips 里的 fchip）。
    private var bucketChips: some View {
        HStack(spacing: 8) {
            PayFilterChip(title: "待催收 \(overdueOrders.count)", on: model.payBucket == "over") {
                model.payBucket = "over"
            }
            PayFilterChip(title: "已设提醒 \(snoozedCount)", on: model.payBucket == "snoozed") {
                model.payBucket = "snoozed"
            }
            Spacer(minLength: 0)
        }
        .padding(.bottom, 11)
    }

    // MARK: - 待收订单

    private var orderSection: some View {
        CardBox {
            if visibleOrders.isEmpty {
                EmptyState(title: "这个区间暂无待收款",
                           subtitle: "换个分桶看看，或去订单页补录收款")
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(visibleOrders.enumerated()), id: \.element.id) { index, order in
                        if index > 0 { PayHairLine() }
                        PayOrderCard(order: order,
                                     account: model.isMultiAccount ? model.account(order.accountId) : nil,
                                     masked: model.privacyHidden,
                                     due: due(for: order),
                                     remindStatus: remindStatus(for: order),
                                     onOpen: { sheet = .detail(order) },
                                     onCollect: { sheet = .payment(order: order, kind: due(for: order).kind) },
                                     onRemind: { sheet = .remind(order) })
                    }
                }
            }
        }
    }

    // MARK: - 最近收款

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle("最近收款")
            CardBox {
                if recentPayments.isEmpty {
                    EmptyState(title: "暂无收款记录")
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(recentPayments.enumerated()), id: \.element.id) { index, payment in
                            if index > 0 { PayHairLine() }
                            recentRow(payment)
                        }
                    }
                }
            }
        }
    }

    private func recentRow(_ payment: Payment) -> some View {
        let order = model.order(payment.oid)
        return HStack(spacing: 11) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 5) {
                    Text("+")
                        .font(Theme.body(13.5, weight: .heavy))
                        .foregroundStyle(Theme.green)
                    MoneyText(value: payment.amount,
                              masked: model.privacyHidden,
                              font: Theme.body(13.5, weight: .bold),
                              color: Theme.green)
                    Text("· \(order?.store ?? "")")
                        .font(Theme.body(13.5, weight: .bold))
                        .foregroundStyle(Theme.green)
                        .lineLimit(1)
                }
                HStack(spacing: 6) {
                    Text("\(payment.kind) · \(Format.fmtD(payment.at)) \(Format.fmtHM(payment.at))")
                        .font(Theme.body(11.5))
                        .foregroundStyle(Theme.sub)
                    if model.isMultiAccount, let order {
                        AccountBadge(account: model.account(order.accountId))
                    }
                }
            }
            Spacer(minLength: 0)
            Chip.method(payment.method)
        }
        .padding(.vertical, 13)
    }

    // MARK: - 数据

    /// 待收款订单（账号筛选后仍有欠款的单，与 Web 的 accMatch + owedOf>0 同口径）。
    private var owingOrders: [Order] {
        model.filteredOrders.filter { Logic.owedOf($0, payments: model.payments) > 0 }
    }

    /// 待收定金合计。
    private var depositSum: Double {
        owingOrders.reduce(0) { $0 + Logic.unDep($1, payments: model.payments) }
    }

    /// 待收尾款合计（含平台单）。
    private var finalSum: Double {
        owingOrders.reduce(0) { $0 + Logic.unFin($1, payments: model.payments) }
    }

    /// 抖音商单的待收尾款（平台结算部分）。
    private var douyinFinalSum: Double {
        owingOrders
            .filter { $0.settleVia == "douyin" }
            .reduce(0) { $0 + Logic.unFin($1, payments: model.payments) }
    }

    /// 私收尾款合计（总尾款减去平台结算部分）。
    private var privateFinalSum: Double {
        finalSum - douyinFinalSum
    }

    /// 待收款总额（定金 + 尾款）。
    private var totalDue: Double {
        depositSum + finalSum
    }

    /// 达到催收阈值的单（平台单不计）。
    private var overdueAll: [Order] {
        model.filteredOrders.filter {
            Logic.isOver($0, payments: model.payments, threshold: model.threshold)
        }
    }

    /// 逾期且没设提醒（Web 的 over）。
    private var overdueOrders: [Order] {
        overdueAll.filter { !Logic.snoozed($0) }
    }

    /// 逾期尾款合计（按未收尾款算，与 Web 的 overSum 同口径）。
    private var overdueSum: Double {
        overdueOrders.reduce(0) { $0 + Logic.unFin($1, payments: model.payments) }
    }

    /// 已设提醒、暂时不催的单数。
    private var snoozedCount: Int {
        max(0, overdueAll.count - overdueOrders.count)
    }

    /// 当前分桶下的待收订单。
    private var visibleOrders: [Order] {
        owingOrders
            .filter { matchesBucket($0) }
            .sorted(by: orderedBefore)
    }

    /// 最近 8 笔收款流水（按账号筛选后的口径）。
    private var recentPayments: [Payment] {
        model.filteredPayments
            .sorted { $0.at > $1.at }
            .prefix(8)
            .map { $0 }
    }

    // MARK: - 分桶与排序

    private func matchesBucket(_ order: Order) -> Bool {
        switch model.payBucket {
        case "all":
            return true
        case "over":
            return isOver(order) && !Logic.snoozed(order)
        case "snoozed":
            return isOver(order) && Logic.snoozed(order)
        default:
            return bucketKey(order) == model.payBucket
        }
    }

    /// 逾期分桶：≤7 天 / 8–30 天 / 30 天+。
    private func bucketKey(_ order: Order) -> String {
        let days = Logic.overdueDays(order, payments: model.payments)
        if days > 30 { return "g30" }
        if days > 7 { return "m830" }
        return "s7"
    }

    private func isOver(_ order: Order) -> Bool {
        Logic.isOver(order, payments: model.payments, threshold: model.threshold)
    }

    /// 排序：未设提醒在前 → 逾期天数多的在前 → 预约时间早的在前。
    private func orderedBefore(_ lhs: Order, _ rhs: Order) -> Bool {
        let lhsSnoozed = Logic.snoozed(lhs) ? 1 : 0
        let rhsSnoozed = Logic.snoozed(rhs) ? 1 : 0
        if lhsSnoozed != rhsSnoozed { return lhsSnoozed < rhsSnoozed }
        let lhsDays = Logic.overdueDays(lhs, payments: model.payments)
        let rhsDays = Logic.overdueDays(rhs, payments: model.payments)
        if lhsDays != rhsDays { return lhsDays > rhsDays }
        return lhs.appt < rhs.appt
    }

    // MARK: - 单笔口径

    /// 一笔待收款的口径（对应 Web 版 renderPay 里的 due / chip 计算）。
    private func due(for order: Order) -> PayDue {
        let unDep = Logic.unDep(order, payments: model.payments)
        let unFin = Logic.unFin(order, payments: model.payments)
        let days = Logic.overdueDays(order, payments: model.payments)
        let late = Logic.expectOverdue(order, payments: model.payments)
        let isDouyin = order.settleVia == "douyin"
        let shot = order.shotAt ?? ""
        let expectNote: String = {
            guard isDouyin, let expect = order.expectPayAt, !expect.isEmpty else { return "" }
            return late > 0
                ? " · 预计 \(Format.fmtD(expect)) 到账（已超 \(late) 天）"
                : " · 预计 \(Format.fmtD(expect)) 到账"
        }()

        let subtitle: String
        let kind: String
        let amount: Double
        if unDep > 0 && !isOver(order) {
            kind = "定金"
            amount = unDep
            subtitle = "预约 \(Format.fmtD(order.appt)) \(Format.fmtHM(order.appt)) · 定金"
        } else if isDouyin {
            kind = "尾款"
            amount = unFin
            subtitle = (shot.isEmpty ? "待拍摄" : "拍摄 \(Format.fmtD(shot))") + " · 抖音商单结算" + expectNote
        } else {
            kind = "尾款"
            amount = unFin
            subtitle = (shot.isEmpty ? "预约 \(Format.fmtD(order.appt))" : "拍摄 \(Format.fmtD(shot))")
                + " · \(Logic.workOf(order))"
        }

        let chip: (String, Color, Color)
        if unDep > 0 && !isOver(order) {
            chip = ("待定金", Theme.sub, Theme.paperDeep)
        } else if isDouyin {
            let expect = order.expectPayAt.flatMap { $0.isEmpty ? nil : $0 }
            let text = "平台结算" + (expect.map { value -> String in
                let base = " · \(Format.fmtD(value))"
                return late > 0 ? base + " 已超期" : base
            } ?? "")
            chip = (text, late > 0 ? Theme.red : Theme.blue, late > 0 ? Theme.redSoft : Theme.blueSoft)
        } else if isOver(order) {
            if Logic.snoozed(order) {
                chip = ("已设提醒 · \(Format.fmtD(order.remindAt)) 再催", Theme.sub, Theme.paperDeep)
            } else {
                chip = ("逾期 · 欠 \(days) 天", Theme.red, Theme.redSoft)
            }
        } else if shot.isEmpty {
            chip = ("未拍摄 · 尚未起算账期", Theme.sub, Theme.paperDeep)
        } else {
            chip = ("欠款 \(days) 天", days > 7 ? Theme.orange : Theme.sub, days > 7 ? Theme.orangeSoft : Theme.paperDeep)
        }

        return PayDue(kind: kind,
                      amount: amount,
                      subtitle: subtitle,
                      chipText: chip.0,
                      chipInk: chip.1,
                      chipBackground: chip.2,
                      extraDeposit: (kind == "定金") ? 0 : unDep)
    }

    /// 催收跟进状态文案。
    private func remindStatus(for order: Order) -> String {
        let log = Logic.remindLogOf(order)
        if !log.isEmpty, let last = Logic.lastRemind(order) {
            return "已催 \(log.count >= 50 ? "50+" : "\(log.count)") 次 · 最近 \(Format.fmtDT(last.at))"
        }
        return "还没催过 · 记一笔，下次不用重新问"
    }
}

// MARK: - 单笔待收款口径

/// 一笔待收款的口径描述（供列表行渲染）。
struct PayDue {
    /// 定金 / 尾款
    let kind: String
    /// 本次待收金额
    let amount: Double
    /// 副标题（时间 + 结算方式 + 工作线）
    let subtitle: String
    /// 状态标签文字
    let chipText: String
    let chipInk: Color
    let chipBackground: Color
    /// 另待定金（0 = 无）
    let extraDeposit: Double
}

// MARK: - 订单行

/// 待收订单行：商家 + 待收说明 + 金额 + 行内收款按钮 + 状态标签 + 催收跟进入口。
private struct PayOrderCard: View {
    let order: Order
    let account: Account?
    let masked: Bool
    let due: PayDue
    let remindStatus: String
    let onOpen: () -> Void
    let onCollect: () -> Void
    let onRemind: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 11) {
                Button(action: onOpen) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(order.store)
                            .font(Theme.body(15, weight: .bold))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                        Text(due.subtitle)
                            .font(Theme.body(11.5))
                            .foregroundStyle(Theme.sub)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                VStack(alignment: .trailing, spacing: 7) {
                    MoneyText(value: due.amount, masked: masked, font: Theme.body(15, weight: .heavy))
                    PayCollectButton(title: due.kind == "定金" ? "收定金" : "收尾款", action: onCollect)
                }
            }

            PayFlowLayout(spacing: 6) {
                if let account {
                    AccountBadge(account: account)
                }
                Chip.work(Logic.workOf(order))
                Chip(text: due.chipText, ink: due.chipInk, background: due.chipBackground)
                if due.extraDeposit > 0 {
                    Chip(text: "另待定金 \(Format.fmtMoney(due.extraDeposit, masked: masked))")
                }
            }

            HStack(spacing: 8) {
                Image(systemName: "bell")
                    .font(Theme.body(11, weight: .semibold))
                    .foregroundStyle(Theme.sub)
                Text(remindStatus)
                    .font(Theme.body(11.5))
                    .foregroundStyle(Theme.sub)
                    .lineLimit(1)
                Spacer(minLength: 6)
                Button(action: onRemind) {
                    Text("记一次跟进")
                        .font(Theme.body(11.5, weight: .bold))
                        .foregroundStyle(Theme.brandInk)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                        .background(Theme.brandSoft, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 14)
    }
}

// MARK: - 小控件

/// 行内收款按钮（对应 Web 版 .mini-btn.green）。
private struct PayCollectButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(Theme.body(11.5, weight: .bold))
                .foregroundStyle(Theme.green)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Theme.greenSoft, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

/// 快捷筛选药丸（对应 Web 版 .fchip）。
private struct PayFilterChip: View {
    let title: String
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(Theme.body(11.5, weight: .bold))
                .foregroundStyle(on ? Theme.card : Theme.ink2)
                .padding(.horizontal, 15)
                .padding(.vertical, 10)
                .background(on ? Theme.ink : Theme.card, in: Capsule())
                .overlay(Capsule().stroke(on ? .clear : Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

/// 卡片内行间细线（对应 Web 版 .row 的 border-bottom）。
struct PayHairLine: View {
    var body: some View {
        Rectangle()
            .fill(Theme.line)
            .frame(height: 0.5)
    }
}

// MARK: - 共用布局

/// 流式布局：标签按顺序换行排列（对应 Web 版 .chiprow）。
struct PayFlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > maxWidth {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: maxWidth.isFinite ? maxWidth : x, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// 表单行：左标签右内容（对应 Web 版 .frow）。
struct PayFormRow<Content: View>: View {
    let label: String
    var alignTop: Bool = false
    @ViewBuilder var content: Content

    var body: some View {
        HStack(alignment: alignTop ? .top : .center, spacing: 10) {
            Text(label)
                .font(Theme.body(13, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .frame(width: 76, alignment: .leading)
                .padding(.top, alignTop ? 8 : 0)
            content
                .frame(maxWidth: .infinity, alignment: alignTop ? .leading : .trailing)
        }
        .padding(.vertical, 6)
        .frame(minHeight: 56)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.line).frame(height: 1)
        }
    }
}

/// 弹层头部：标题 + 关闭（对应 Web 版 .sheet-head）。
struct PaySheetHeader: View {
    let title: String
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Text(title)
                .font(Theme.display(20))
                .foregroundStyle(Theme.ink)
            Spacer(minLength: 0)
            IconButton(systemName: "xmark", accessibility: "关闭", action: onClose)
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 8)
        // 顶栏高度上报给提示条：提示条落在标题下方。
        .toastTopAnchor()
    }
}
