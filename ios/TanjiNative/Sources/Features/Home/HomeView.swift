import SwiftUI

/// 首页：今日安排 · 下一站 · 逾期提醒 · 今日拍摄 · 待发片 · 本月速览。
///
/// 信息结构与文案逐句对齐 Web 版 `src/app/views/home.js`：
///   顶栏 → 账号筛选条 → 下一站卡片 → 逾期提醒 → 今日拍摄 → 待发片 → 本月速览。
///
/// 跨标签页跳转：「整月行程 ›」「全部 ›」「统计 ›」「催收清单」直接切标签页，
/// 与 Web 版的 `data-act="tab"` 口径一致；切过去之前先预置目标页的筛选状态。
struct HomeView: View {
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

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    AccountFilterBar()
                    nextCard
                    alertCard
                    todaySection
                    sendingSection
                    monthSection
                }
                .padding(.horizontal, 18)
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
        AppHeader(eyebrow: headerEyebrow,
                  title: "今日安排",
                  subtitle: headerSubtitle) {
            HStack(spacing: 8) {
                ScheduleShareButton(text: shareText)
                IconButton(systemName: model.privacyHidden ? "eye.slash" : "eye",
                           active: model.privacyHidden,
                           accessibility: model.privacyHidden ? "显示金额" : "隐藏金额") {
                    Task { await model.toggleAmountPrivacy() }
                }
                HomePillButton(title: "预约", systemImage: "plus") {
                    sheet = .newOrder
                }
            }
        }
    }

    private var headerEyebrow: String {
        let parts = Calendar.current.dateComponents([.month, .day], from: Date())
        return "\(parts.month ?? 0)月\(parts.day ?? 0)日 · 周\(Format.dowOf(Format.today()))"
    }

    private var headerSubtitle: String {
        guard !todays.isEmpty else { return "今天没有预约，按自己的节奏来" }
        if todoToday.isEmpty { return "\(todays.count) 个预约 · 已全部拍完" }
        return "\(todays.count) 个预约 · 待拍 \(todoToday.count)"
    }

    // MARK: - 下一站卡片

    @ViewBuilder
    private var nextCard: some View {
        if let next = todays.first(where: { ($0.shotAt ?? "").isEmpty }) {
            nextStopCard(
                kicker: "Next stop / 下一站",
                badge: "待到店",
                time: Format.fmtHM(next.appt),
                store: next.store,
                meta: nextMeta(next),
                secondaryTitle: "查看预约",
                secondaryAction: { sheet = .detail(next) },
                primaryTitle: "到店打卡",
                primaryAction: { punch(next) })
        } else if !todays.isEmpty {
            nextEmptyCard(
                kicker: "Today / 今日完成",
                badge: "全部拍完",
                title: "今天的店，都拍完了。",
                subtitle: "接下来把交付和收款收好，就可以安心收工。",
                secondaryTitle: "去推进待发片",
                secondaryAction: gotoSending,
                primaryTitle: "看接下来行程",
                primaryAction: gotoTrip)
        } else if let upcoming = nextUpcoming {
            nextStopCard(
                kicker: "Next stop / 下一站",
                badge: Format.fmtD(upcoming.appt),
                time: Format.fmtHM(upcoming.appt),
                store: upcoming.store,
                meta: upcoming.location.isEmpty ? upcoming.cat : upcoming.location,
                secondaryTitle: "提前看预约",
                secondaryAction: { sheet = .detail(upcoming) },
                primaryTitle: "打开整月行程",
                primaryAction: gotoTrip)
        } else {
            nextEmptyCard(
                kicker: "A clear day / 空白档期",
                badge: "从容一点",
                title: "今天没有安排。",
                subtitle: "可以提前录下一趟预约，也可以先把待发片清一清。",
                secondaryTitle: "新建预约",
                secondaryAction: { sheet = .newOrder },
                primaryTitle: "看待发片",
                primaryAction: gotoSending)
        }
    }

    private func nextStopCard(kicker: String,
                              badge: String,
                              time: String,
                              store: String,
                              meta: String,
                              secondaryTitle: String,
                              secondaryAction: @escaping () -> Void,
                              primaryTitle: String,
                              primaryAction: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(kicker)
                    .font(Theme.body(9.5, weight: .heavy))
                    .tracking(1.5)
                    .foregroundStyle(Theme.card.opacity(0.58))
                Spacer(minLength: 0)
                Text(badge)
                    .font(Theme.body(9, weight: .heavy))
                    .tracking(1)
                    .foregroundStyle(Theme.card.opacity(0.68))
            }
            HStack(alignment: .center, spacing: 15) {
                Text(time)
                    .font(Theme.display(42))
                    .foregroundStyle(Theme.card)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                VStack(alignment: .leading, spacing: 5) {
                    Text(store)
                        .font(Theme.body(17, weight: .bold))
                        .foregroundStyle(Theme.card)
                        .lineLimit(1)
                    Text(meta)
                        .font(Theme.body(10.5))
                        .foregroundStyle(Theme.card.opacity(0.62))
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.top, 14)
            HStack(spacing: 8) {
                NextActionButton(title: secondaryTitle, primary: false, action: secondaryAction)
                NextActionButton(title: primaryTitle, primary: true, action: primaryAction)
            }
            .padding(.top, 17)
        }
        .padding(19)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.ink, in: RoundedRectangle(cornerRadius: 25, style: .continuous))
        .shadow(color: Theme.ink.opacity(0.18), radius: 16, y: 8)
        .padding(.bottom, 13)
    }

    private func nextEmptyCard(kicker: String,
                               badge: String,
                               title: String,
                               subtitle: String,
                               secondaryTitle: String,
                               secondaryAction: @escaping () -> Void,
                               primaryTitle: String,
                               primaryAction: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(kicker)
                    .font(Theme.body(9.5, weight: .heavy))
                    .tracking(1.5)
                    .foregroundStyle(Theme.card.opacity(0.58))
                Spacer(minLength: 0)
                Text(badge)
                    .font(Theme.body(9, weight: .heavy))
                    .tracking(1)
                    .foregroundStyle(Theme.card.opacity(0.68))
            }
            VStack(alignment: .leading, spacing: 7) {
                Text(title)
                    .font(Theme.display(24))
                    .foregroundStyle(Theme.card)
                    .fixedSize(horizontal: false, vertical: true)
                Text(subtitle)
                    .font(Theme.body(11))
                    .foregroundStyle(Theme.card.opacity(0.62))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, 21)
            HStack(spacing: 8) {
                NextActionButton(title: secondaryTitle, primary: false, action: secondaryAction)
                NextActionButton(title: primaryTitle, primary: true, action: primaryAction)
            }
            .padding(.top, 17)
        }
        .padding(19)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.ink, in: RoundedRectangle(cornerRadius: 25, style: .continuous))
        .shadow(color: Theme.ink.opacity(0.18), radius: 16, y: 8)
        .padding(.bottom, 13)
    }

    private func nextMeta(_ order: Order) -> String {
        var parts: [String] = []
        let place = order.location.isEmpty ? order.cat : order.location
        if !place.isEmpty { parts.append(place) }
        if let account = model.account(order.accountId) {
            parts.append(account.name)
        }
        return parts.joined(separator: " · ")
    }

    // MARK: - 逾期提醒

    @ViewBuilder
    private var alertCard: some View {
        if !overdueOrders.isEmpty {
            Button {
                gotoCollect()
            } label: {
                AlertCard(tone: .danger,
                          icon: "bell.fill",
                          title: "\(overdueOrders.count) 笔尾款逾期 · 待催收 \(Format.fmtMoney(overdueSum, masked: model.privacyHidden))",
                          subtitle: "最长已欠 \(maxOverdueDays) 天"
                              + (overdueAll.count > overdueOrders.count
                                 ? " · 另有 \(overdueAll.count - overdueOrders.count) 笔已设提醒" : "")
                              + " · 点击进入催收清单")
            }
            .buttonStyle(.plain)
        } else if !overdueAll.isEmpty {
            Button {
                gotoCollect()
            } label: {
                AlertCard(tone: .warning,
                          icon: "bell.fill",
                          title: "\(overdueAll.count) 笔尾款已设催收提醒",
                          subtitle: "最早 \(Format.fmtD(nextRemindAt)) 再提醒 · 点击查看清单")
            }
            .buttonStyle(.plain)
        } else {
            AlertCard(tone: .calm,
                      icon: "checkmark",
                      title: "收款状态健康",
                      subtitle: "暂无逾期尾款 · 共待收 \(Format.fmtMoney(totalOwed, masked: model.privacyHidden))")
        }
    }

    // MARK: - 今日拍摄

    private var todaySection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle(text: "今日拍摄") {
                HStack(spacing: 10) {
                    Text("\(todays.count - todoToday.count)/\(todays.count) 已拍")
                        .font(Theme.body(11, weight: .semibold))
                        .foregroundStyle(Theme.sub)
                    moreLink("整月行程 ›", action: gotoTrip)
                }
            }
            CardBox {
                if todays.isEmpty {
                    EmptyState(title: "今天暂无拍摄安排",
                               subtitle: "去行程页看看接下来的档期")
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(todays.enumerated()), id: \.element.id) { index, order in
                            if index > 0 { HairLine() }
                            HomeTodayRow(order: order,
                                         account: model.isMultiAccount ? model.account(order.accountId) : nil,
                                         work: Logic.workOf(order),
                                         pay: payChipLabel(order),
                                         depositDue: Logic.unDep(order, payments: model.payments),
                                         masked: model.privacyHidden,
                                         onTap: { sheet = .detail(order) },
                                         onPunch: { punch(order) })
                        }
                    }
                }
            }
        }
    }

    // MARK: - 待发片

    private var sendingSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle(text: "待发片") {
                moreLink("全部 ›", action: gotoSending)
            }
            CardBox {
                if sendingOrders.isEmpty {
                    EmptyState(title: "待发片已清空，做得漂亮。")
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(sendingOrders.prefix(4).enumerated()), id: \.element.id) { index, order in
                            if index > 0 { HairLine() }
                            HomeSendingRow(order: order,
                                           account: model.isMultiAccount ? model.account(order.accountId) : nil,
                                           masked: model.privacyHidden,
                                           missing: missingChips(order),
                                           late: Logic.deliverLate(order),
                                           step: HomeAdvanceStep.next(for: order),
                                           onTap: { sheet = .detail(order) },
                                           onAdvance: { advance(order, $0) })
                        }
                        if sendingOrders.count > 4 {
                            HairLine()
                            Button {
                                gotoSending()
                            } label: {
                                HStack(spacing: 8) {
                                    Text("还有 \(sendingOrders.count - 4) 单待推进 · 查看全部")
                                        .font(Theme.body(12))
                                        .foregroundStyle(Theme.sub)
                                    Spacer(minLength: 0)
                                    Image(systemName: "chevron.right")
                                        .font(Theme.body(13, weight: .semibold))
                                        .foregroundStyle(Theme.lineStrong)
                                }
                                .padding(.vertical, 14)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    // MARK: - 本月速览

    private var monthSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle(text: "本月速览") {
                moreLink("统计 ›", action: gotoStats)
            }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)],
                      spacing: 10) {
                MiniStat(value: Format.fmtMoney(monthStats.paidSum, masked: model.privacyHidden),
                         label: "本月实收 · \(monthStats.paid.count) 笔",
                         valueColor: Theme.green)
                MiniStat(value: Format.fmtMoney(monthStats.dealSum, masked: model.privacyHidden),
                         label: "本月成交 · \(monthStats.deals.count) 单")
                MiniStat(value: Format.fmtMoney(totalOwed, masked: model.privacyHidden),
                         label: "当前待收款",
                         valueColor: Theme.orange)
                MiniStat(value: "\(sendingOrders.count)",
                         label: "待发片订单",
                         valueColor: Theme.brandInk)
            }
        }
    }

    // MARK: - 数据

    /// 账号筛选后的订单（与 Web 的 accMatch 同口径）。
    private var scopedOrders: [Order] { model.filteredOrders }

    private var todays: [Order] {
        let today = Format.today()
        return scopedOrders
            .filter { $0.appt.hasPrefix(today) }
            .sorted { $0.appt < $1.appt }
    }

    private var todoToday: [Order] {
        todays.filter { ($0.shotAt ?? "").isEmpty }
    }

    /// 下一趟未拍摄的预约（今天之后）。
    private var nextUpcoming: Order? {
        let today = Format.today()
        return scopedOrders
            .filter { order in
                guard order.appt.count >= 10 else { return false }
                return String(order.appt.prefix(10)) > today && (order.shotAt ?? "").isEmpty
            }
            .sorted { $0.appt < $1.appt }
            .first
    }

    /// 待发片：后期中 / 发片中，按拍摄时间升序。
    private var sendingOrders: [Order] {
        scopedOrders
            .filter { ["后期中", "发片中"].contains(Logic.workOf($0)) }
            .sorted { ($0.shotAt ?? "") < ($1.shotAt ?? "") }
    }

    private var overdueAll: [Order] {
        scopedOrders.filter { Logic.isOver($0, payments: model.payments, threshold: model.threshold) }
    }

    /// 逾期且没设提醒（Web 的 over）。
    private var overdueOrders: [Order] {
        overdueAll.filter { !Logic.snoozed($0) }
    }

    private var overdueSum: Double {
        overdueOrders.reduce(0) { $0 + Logic.owedOf($1, payments: model.payments) }
    }

    private var maxOverdueDays: Int {
        overdueOrders.map { Logic.overdueDays($0, payments: model.payments) }.max() ?? 0
    }

    /// 最早的一次催收提醒时间。
    private var nextRemindAt: String? {
        overdueAll.compactMap { $0.remindAt }.filter { !$0.isEmpty }.sorted().first
    }

    /// 当前待收款（含定金与尾款）。
    private var totalOwed: Double {
        scopedOrders.reduce(0) { $0 + Logic.owedOf($1, payments: model.payments) }
    }

    /// 本月统计（按账号筛选后的订单口径，与 Web 的 statsFor('M', flt) 一致）。
    private var monthStats: Logic.Stats {
        Logic.statsFor(orders: model.orders,
                       payments: model.payments,
                       period: "M",
                       list: model.filteredOrders)
    }

    /// 收款状态标签：逾期优先显示「已逾期」（Web 的 payChip 口径）。
    private func payChipLabel(_ order: Order) -> String {
        if Logic.isOver(order, payments: model.payments, threshold: model.threshold) {
            return "已逾期"
        }
        return Logic.payOf(order, payments: model.payments)
    }

    /// 待发片缺件标签（Web 的 miss 列表）。
    private func missingChips(_ order: Order) -> [String] {
        var items: [String] = []
        if (order.submittedAt ?? "").isEmpty { items.append("待提审") }
        if Logic.needMain(order) && (order.longAt ?? "").isEmpty { items.append("待正片") }
        if Logic.needSub(order) && (order.shortAt ?? "").isEmpty { items.append("待副片") }
        if Logic.deliveredAll(order) && (order.publishedAt ?? "").isEmpty { items.append("待发布") }
        return items
    }

    // MARK: - 动作

    /// 到店打卡。
    private func punch(_ order: Order) {
        Task {
            await model.advance(order, field: .shot)
            model.showToast("已记录实际拍摄时间 ✓")
        }
    }

    /// 待发片行内推进。
    private func advance(_ order: Order, _ step: HomeAdvanceStep) {
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

    /// 跳到「行程」标签：预置今天。
    private func gotoTrip() {
        model.tripMonth = Date()
        model.selectedDay = Format.today()
        model.selectedTab = .trip
    }

    /// 跳到「订单」标签：预置待发片筛选。
    private func gotoSending() {
        model.orderChip = "sending"
        model.selectedTab = .orders
    }

    /// 跳到「统计」标签：预置本月。
    private func gotoStats() {
        model.statsPeriod = "M"
        model.selectedTab = .stats
    }

    /// 跳到「收款」标签：预置催收筛选。
    private func gotoCollect() {
        model.payBucket = model.orders.contains {
            Logic.isOver($0, payments: model.payments, threshold: model.threshold) && !Logic.snoozed($0)
        } ? "over" : "snoozed"
        model.selectedTab = .pay
    }

    /// 分享今天的行程（不含金额，与 Web 的分享图口径一致）。
    private var shareText: String {
        ScheduleShare.text(day: Format.today(), orders: scopedOrders)
    }
}

// MARK: - 今日拍摄行

/// 今日拍摄行：预约时间 + 商家 + 状态标签 + 价格 + 到店打卡。
private struct HomeTodayRow: View {
    let order: Order
    let account: Account?
    let work: String
    let pay: String
    let depositDue: Double
    let masked: Bool
    let onTap: () -> Void
    let onPunch: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 11) {
                Button(action: onTap) {
                    HStack(alignment: .center, spacing: 11) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(Format.fmtHM(order.appt))
                                .font(Theme.display(19))
                                .foregroundStyle(Theme.brandInk)
                                .lineLimit(1)
                                .fixedSize(horizontal: true, vertical: false)
                            Text("预约")
                                .font(Theme.body(10.5))
                                .foregroundStyle(Theme.sub)
                        }
                        .frame(minWidth: 60, alignment: .leading)
                        Text(order.store)
                            .font(Theme.body(15, weight: .bold))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        MoneyText(value: order.price, masked: masked, font: Theme.body(15, weight: .heavy))
                            .layoutPriority(1)
                            .fixedSize(horizontal: true, vertical: false)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if !(order.shotAt ?? "").isEmpty {
                    Image(systemName: "chevron.right")
                        .font(Theme.body(13, weight: .semibold))
                        .foregroundStyle(Theme.lineStrong)
                }
            }
            HStack(alignment: .center, spacing: 8) {
                WrapLayout(spacing: 6, lineSpacing: 6) {
                    if let account {
                        AccountBadge(account: account)
                    }
                    Chip.work(work)
                    if depositDue > 0 {
                        Chip(text: "待定金 \(Format.fmtMoney(depositDue, masked: masked))",
                             ink: Theme.orange,
                             background: Theme.orangeSoft)
                    } else {
                        Chip.pay(pay)
                    }
                    Chip(text: order.cat)
                }
                Spacer(minLength: 0)
                if (order.shotAt ?? "").isEmpty {
                    HomeMiniButton(title: "到店打卡", action: onPunch)
                }
            }
            .padding(.leading, 71)
        }
        .padding(.vertical, 14)
        .opacity((order.shotAt ?? "").isEmpty ? 1 : 0.62)
    }
}

// MARK: - 待发片行

/// 待发片行：商家 + 拍摄时间 + 缺件标签 + 行内推进按钮。
private struct HomeSendingRow: View {
    let order: Order
    let account: Account?
    let masked: Bool
    let missing: [String]
    let late: Bool
    let step: HomeAdvanceStep?
    let onTap: () -> Void
    let onAdvance: (HomeAdvanceStep) -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 11) {
            Button(action: onTap) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(order.store)
                        .font(Theme.body(15, weight: .bold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    Text("拍摄于 \(Format.fmtD(order.shotAt)) · \(Format.fmtMoney(order.price, masked: masked))")
                        .font(Theme.body(11.5))
                        .foregroundStyle(Theme.sub)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        if let account {
                            AccountBadge(account: account)
                        }
                        if late {
                            Chip(text: "超 24h", ink: Theme.red, background: Theme.redSoft)
                        }
                        ForEach(missing, id: \.self) { item in
                            Chip(text: item, ink: Theme.orange, background: Theme.orangeSoft)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if let step {
                HomeMiniButton(title: step.title, action: { onAdvance(step) })
            } else {
                Image(systemName: "chevron.right")
                    .font(Theme.body(13, weight: .semibold))
                    .foregroundStyle(Theme.lineStrong)
            }
        }
        .padding(.vertical, 14)
    }
}

// MARK: - 行内推进步骤

/// 待发片的下一步（对应 Web 版 detail.js 的 nextStep）。
enum HomeAdvanceStep {
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
    static func next(for order: Order) -> HomeAdvanceStep? {
        guard let shot = order.shotAt, !shot.isEmpty else { return nil }
        if (order.submittedAt ?? "").isEmpty { return .submitted }
        if Logic.needSub(order) && (order.shortAt ?? "").isEmpty { return .short }
        if Logic.needMain(order) && (order.longAt ?? "").isEmpty { return .long }
        if Logic.deliveredAll(order) && (order.publishedAt ?? "").isEmpty { return .published }
        return nil
    }
}

// MARK: - 提醒卡片

/// 逾期提醒卡片（红 / 橙 / 绿三态）。
private struct AlertCard: View {
    enum Tone {
        case danger
        case warning
        case calm

        var background: Color {
            switch self {
            case .danger: return Theme.red
            case .warning: return Theme.orange
            case .calm: return Theme.green
            }
        }
    }

    let tone: Tone
    let icon: String
    let title: String
    let subtitle: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(Theme.body(17, weight: .semibold))
                .foregroundStyle(Theme.card)
                .frame(width: 24, height: 24)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(Theme.body(14, weight: .heavy))
                    .foregroundStyle(Theme.card)
                    .fixedSize(horizontal: false, vertical: true)
                Text(subtitle)
                    .font(Theme.body(10.5))
                    .foregroundStyle(Theme.card.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 14)
        .background(tone.background, in: RoundedRectangle(cornerRadius: 19, style: .continuous))
        .shadow(color: tone.background.opacity(0.16), radius: 9, y: 5)
        .padding(.bottom, 4)
    }
}

// MARK: - 小控件

/// 顶栏药丸按钮（对应 Web 版 .btn-pill）。
private struct HomePillButton: View {
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

/// 行内小按钮（对应 Web 版 .mini-btn）。
private struct HomeMiniButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(Theme.body(11.5, weight: .bold))
                .foregroundStyle(Theme.brandInk)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Theme.brandSoft, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

/// 下一站卡片里的动作按钮。
private struct NextActionButton: View {
    let title: String
    let primary: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(Theme.body(11.5, weight: .bold))
                .foregroundStyle(Theme.card)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(primary ? Theme.brandAction : Theme.card.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .stroke(Theme.card.opacity(0.17), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

/// 分区标题右侧的「更多 ›」链接。
private struct HomeMoreLink: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(Theme.body(11, weight: .bold))
                .foregroundStyle(Theme.brandInk)
                .frame(minHeight: 28)
        }
        .buttonStyle(.plain)
    }
}

/// 卡片内行间细线（对应 Web 版 .row 的 border-bottom）。
private struct HairLine: View {
    var body: some View {
        Rectangle()
            .fill(Theme.line)
            .frame(height: 0.5)
    }
}

// MARK: - 行程分享

/// 行程分享文案（对应 Web 版 share-image.js 的分享图内容，不含金额）。
enum ScheduleShare {

    /// 把某天的拍摄安排整理成纯文本。
    static func text(day: String, orders: [Order]) -> String {
        let list = orders
            .filter { $0.appt.hasPrefix(day) }
            .sorted { $0.appt < $1.appt }
        var lines: [String] = []
        lines.append("探记 · 拍摄行程")
        lines.append("\(day) 周\(Format.dowOf(day))")
        lines.append(list.isEmpty ? "当天暂无拍摄安排" : "\(list.count) 个拍摄安排")
        lines.append("")
        if list.isEmpty {
            lines.append("今天不排片，给自己留点余量。")
        } else {
            for order in list {
                lines.append("\(Format.fmtHM(order.appt)) \(order.store) · \(Logic.workOf(order)) · \(order.cat)")
            }
        }
        lines.append("")
        lines.append("由「探记」生成 · 不含金额信息")
        return lines.joined(separator: "\n")
    }
}

/// 顶栏分享按钮（Web 版顶栏的分享图标）。
struct ScheduleShareButton: View {
    let text: String

    var body: some View {
        ShareLink(item: text) {
            Image(systemName: "square.and.arrow.up")
                .font(Theme.body(15, weight: .semibold))
                .foregroundStyle(Theme.ink2)
                .frame(width: 44, height: 44)
                .background(Theme.card.opacity(0.76), in: RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous)
                    .stroke(Theme.line, lineWidth: 1))
        }
        .accessibilityLabel("分享行程")
    }
}

private extension View {
    /// 分区标题右侧的「更多 ›」链接。
    func moreLink(_ title: String, action: @escaping () -> Void) -> some View {
        HomeMoreLink(title: title, action: action)
    }
}
