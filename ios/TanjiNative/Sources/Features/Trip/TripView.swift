import SwiftUI

/// 行程：整月档期 · 未来 7 天 · 当日安排 · 本月全部档期。
///
/// 信息结构与文案逐句对齐 Web 版 `src/app/views/trip.js`：
///   顶栏 → 账号筛选条 → 月历网格 → 未来 7 天 → 当日行程 → 本月全部档期。
///
/// 与 Web 版的两处差异（原生能力边界内）：
///   - Web 的「左右滑动切日」是触摸手势，原生改用「点日期 / 未来 7 天横条 / 上月下月」完成同样的切日；
///   - Web 的「分享当日」是 canvas 生成 PNG 再弹分享面板，原生没有对应服务，
///     改用系统分享（纯文本，不含金额）。
///
/// 状态：`model.tripMonth`（当前月份）与 `model.selectedDay`（当前选中日）由本页读写，
/// 与 Web 版 `ui.vMon` / `ui.selDay` 一一对应。
struct TripView: View {
    @EnvironmentObject private var model: AppModel

    /// 单一 sheet 载荷：避免同一视图上挂多个 sheet 修饰符。
    private enum Sheet: Identifiable {
        case detail(Order)
        case edit(Order)
        case newOrder

        var id: String {
            switch self {
            case .detail(let order): return "detail-\(order.id)"
            case .edit(let order): return "edit-\(order.id)"
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
                    monthCard
                    weekSection
                    daySection
                    monthAllSection
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 28)
            }
        }
        .sheet(item: $sheet) { item in
            switch item {
            case .detail(let order):
                OrderDetailView(order: order)
            case .edit(let order):
                OrderFormView(order: order)
            case .newOrder:
                OrderFormView(order: nil)
            }
        }
    }

    // MARK: - 顶栏

    private var header: some View {
        AppHeader(eyebrow: "Monthly schedule / 整月档期",
                  title: "行程",
                  subtitle: "左右滑动切日 · 点日期查看当天安排") {
            HStack(spacing: 8) {
                ScheduleShareButton(text: shareText)
                IconButton(systemName: model.privacyHidden ? "eye.slash" : "eye",
                           active: model.privacyHidden,
                           accessibility: model.privacyHidden ? "显示金额" : "隐藏金额") {
                    Task { await model.toggleAmountPrivacy() }
                }
                TripPillButton(title: "预约", systemImage: "plus") {
                    sheet = .newOrder
                }
            }
        }
    }

    // MARK: - 月历网格

    private var monthCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 5) {
                    HStack(alignment: .center, spacing: 12) {
                        Text("\(year)年 \(month)月")
                            .font(Theme.display(20, weight: .bold))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        monthNav
                    }
                    // 摘要独占一行：挤在标题右侧会在窄屏断成两行，把末尾的徽标数甩到孤立的一行。
                    Text(monthSummary)
                        .font(Theme.body(9.5, weight: .semibold))
                        .foregroundStyle(Theme.sub)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 12)
            HStack(spacing: 3) {
                ForEach(Self.dowHeaders, id: \.self) { text in
                    Text(text)
                        .font(Theme.body(9.5, weight: .bold))
                        .foregroundStyle(Theme.sub)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.vertical, 8)
            monthGrid
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
            .stroke(Theme.line, lineWidth: 1))
        .shadow(color: Theme.shadow, radius: 14, x: 0, y: 8)
        .padding(.top, 14)
    }

    private var monthNav: some View {
        HStack(spacing: 5) {
            navButton(systemName: "chevron.left", label: "上个月") { shiftMonth(-1) }
            Button {
                jumpToday()
            } label: {
                Text("今天")
                    .font(Theme.body(10.5, weight: .bold))
                    .foregroundStyle(Theme.ink2)
                    .frame(minWidth: 40, minHeight: 40)
                    .background(.clear, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .stroke(Theme.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
            navButton(systemName: "chevron.right", label: "下个月") { shiftMonth(1) }
        }
    }

    private func navButton(systemName: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(Theme.body(14, weight: .bold))
                .foregroundStyle(Theme.ink2)
                .frame(width: 40, height: 40)
                .background(.clear, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .stroke(Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var monthGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 3), count: 7), spacing: 3) {
            ForEach(0..<leadingBlanks, id: \.self) { _ in
                Color.clear.frame(height: 46)
            }
            ForEach(1...daysInMonth, id: \.self) { day in
                let iso = isoDay(day)
                let list = ordersOfDay(iso)
                TripDayCell(day: day,
                            count: list.count,
                            badge: Logic.dayBadge(count: list.count, sum: list.reduce(0) { $0 + $1.price }, rules: model.medalRules),
                            isSelected: iso == model.selectedDay,
                            isToday: iso == Format.today()) {
                    selectDay(iso)
                }
            }
        }
    }

    // MARK: - 未来 7 天

    private var weekSection: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                Text(weekTitle)
                    .font(Theme.body(12, weight: .heavy))
                    .foregroundStyle(Theme.ink)
                Spacer(minLength: 0)
                if weekSum > 0 {
                    MoneyText(value: weekSum, masked: model.privacyHidden, font: Theme.body(12, weight: .bold))
                }
            }
            .padding(.top, 18)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(week.enumerated()), id: \.element.day) { index, item in
                        weekCell(item, index: index)
                    }
                }
                .padding(.vertical, 2)
                .padding(.bottom, 5)
            }
            .scrollClipDisabled()
        }
    }

    private func weekCell(_ item: Logic.DaySummary, index: Int) -> some View {
        let on = item.day == model.selectedDay
        let weekday = index == 0 ? "今天" : (index == 1 ? "明天" : "周\(Format.dowOf(item.day))")
        return Button {
            selectDay(item.day)
        } label: {
            VStack(spacing: 0) {
                Text(weekday)
                    .font(Theme.body(9.5, weight: .bold))
                    .foregroundStyle(on ? Theme.card.opacity(0.62) : Theme.sub)
                Text(String(item.day.dropFirst(5)))
                    .font(Theme.body(13, weight: .heavy))
                    .foregroundStyle(on ? Theme.card : Theme.ink)
                    .padding(.top, 3)
                Text(item.count > 0 ? "\(item.count) 单" : "空")
                    .font(Theme.body(10))
                    .foregroundStyle(on ? Theme.card.opacity(0.62) : Theme.sub)
                    .padding(.top, 4)
            }
            .frame(width: 68)
            .padding(.vertical, 10)
            .background(on ? Theme.ink : Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(on ? .clear : Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: - 当日行程

    private var daySection: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(daySectionTitle)
                    .font(Theme.body(12, weight: .heavy))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                ShareLink(item: shareText) {
                    Text("分享当日 ›")
                        .font(Theme.body(11, weight: .bold))
                        .foregroundStyle(Theme.brandInk)
                        .frame(minHeight: 28)
                }
            }
            .padding(.top, 20)
            .padding(.bottom, 10)
            .padding(.horizontal, 2)
            CardBox {
                if dayOrders.isEmpty {
                    EmptyState(title: "这一天暂无拍摄安排",
                               subtitle: "点右上角预约，把下一趟记下来")
                } else {
                    VStack(spacing: 0) {
                        ForEach(dayOrders) { order in
                            TripOrderRow(order: order,
                                         account: model.isMultiAccount ? model.account(order.accountId) : nil,
                                         work: Logic.workOf(order),
                                         pay: payLabel(order),
                                         depositDue: Logic.unDep(order, payments: model.payments),
                                         owed: Logic.owedOf(order, payments: model.payments),
                                         masked: model.privacyHidden,
                                         onTap: { sheet = .detail(order) },
                                         onEdit: { sheet = .edit(order) })
                            if order.id != dayOrders.last?.id {
                                TripHairLine()
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - 本月全部档期

    private var monthAllSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text("\(month) 月全部档期")
                    .font(Theme.body(12, weight: .heavy))
                    .foregroundStyle(Theme.ink)
                Text("往下滚看整月")
                    .font(Theme.body(11, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                Spacer(minLength: 0)
            }
            .padding(.top, 22)
            .padding(.bottom, 10)
            .padding(.horizontal, 2)
            if monthDays.isEmpty {
                Text("\(month) 月暂无档期 · 点右上角「预约」新增")
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.sub)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 35)
            } else {
                ForEach(monthDays, id: \.self) { day in
                    VStack(alignment: .leading, spacing: 0) {
                        Text("\(dayParts(day).month)月\(dayParts(day).day)日 · 周\(Format.dowOf(day))\(relativeTag(day))")
                            .font(Theme.body(12, weight: .heavy))
                            .foregroundStyle(Theme.ink)
                            .padding(.top, 18)
                            .padding(.bottom, 10)
                            .padding(.horizontal, 2)
                        CardBox {
                            VStack(spacing: 0) {
                                ForEach(ordersOfDay(day)) { order in
                                    TripOrderRow(order: order,
                                                 account: model.isMultiAccount ? model.account(order.accountId) : nil,
                                                 work: Logic.workOf(order),
                                                 pay: payLabel(order),
                                                 depositDue: Logic.unDep(order, payments: model.payments),
                                                 owed: Logic.owedOf(order, payments: model.payments),
                                                 masked: model.privacyHidden,
                                                 onTap: { sheet = .detail(order) },
                                                 onEdit: { sheet = .edit(order) })
                                    if order.id != ordersOfDay(day).last?.id {
                                        TripHairLine()
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - 数据

    /// 账号筛选后的订单（与 Web 的 accMatch 同口径）。
    private var scopedOrders: [Order] { model.filteredOrders }

    private var year: Int { Calendar.current.component(.year, from: model.tripMonth) }
    private var month: Int { Calendar.current.component(.month, from: model.tripMonth) }

    private static let dowHeaders = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

    /// 本月第一天是周几（周一为 0），用于补齐月历空位。
    private var leadingBlanks: Int {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = 1
        guard let first = Calendar.current.date(from: components) else { return 0 }
        let weekday = Calendar.current.component(.weekday, from: first)
        return (weekday + 5) % 7
    }

    private var daysInMonth: Int {
        Calendar.current.range(of: .day, in: .month, for: model.tripMonth)?.count ?? 30
    }

    /// 本月的预约（按预约时间归月）。
    private var monthOrders: [Order] {
        scopedOrders.filter { $0.appt.hasPrefix(monthPrefix) }
    }

    private var monthPrefix: String {
        String(format: "%04d-%02d", year, month)
    }

    /// 本月有档期的日期（升序）。
    private var monthDays: [String] {
        Array(Set(monthOrders.map { String($0.appt.prefix(10)) })).sorted()
    }

    /// 某天的订单（按预约时间升序）。
    private func ordersOfDay(_ day: String) -> [Order] {
        scopedOrders
            .filter { $0.appt.hasPrefix(day) }
            .sorted { $0.appt < $1.appt }
    }

    /// 当前选中日的订单。
    private var dayOrders: [Order] { ordersOfDay(model.selectedDay) }

    /// 月份摘要文案（对应 Web 的 mtitle + msum）。
    private var monthSummary: String {
        var text = "\(monthOrders.count) 个档期 · 成交 \(Format.fmtMoney(monthSum, masked: model.privacyHidden))"
            + " · 实收 \(Format.fmtMoney(monthPaidSum, masked: model.privacyHidden))"
        text += monthBadgeSummary
        return text
    }

    private var monthSum: Double {
        monthOrders.reduce(0) { $0 + $1.price }
    }

    /// 本月实收：账号范围内的流水里落在本月的金额（对应 Web 的 mPaidSum）。
    private var monthPaidSum: Double {
        let ids = Set(scopedOrders.map(\.id))
        return model.payments
            .filter { ids.contains($0.oid) && $0.at.hasPrefix(monthPrefix) }
            .reduce(0) { $0 + $1.amount }
    }

    /// 本月的 🔥 / 💰 日数量（对应 Web 的 mBadges）。
    private var monthBadgeSummary: String {
        var fire = 0
        var money = 0
        for day in monthDays {
            let list = ordersOfDay(day)
            guard let badge = Logic.dayBadge(count: list.count, sum: list.reduce(0) { $0 + $1.price }, rules: model.medalRules) else { continue }
            if badge.emoji == "🔥" { fire += 1 }
            if badge.emoji == "💰" { money += 1 }
        }
        var parts: [String] = []
        if fire > 0 { parts.append("🔥\(fire)") }
        if money > 0 { parts.append("💰\(money)") }
        return parts.isEmpty ? "" : " · " + parts.joined(separator: " · ")
    }

    /// 未来 7 天（对应 Web 的 upcoming7）。
    private var week: [Logic.DaySummary] {
        Logic.upcomingByDay(orders: scopedOrders, fromISO: Format.today(), days: 7)
    }

    private var weekCount: Int { week.reduce(0) { $0 + $1.count } }
    private var weekSum: Double { week.reduce(0) { $0 + $1.sum } }

    private var weekTitle: String {
        weekCount > 0 ? "未来 7 天 · \(weekCount) 单" : "未来 7 天 · 暂无档期"
    }

    /// 当日分区标题（对应 Web 的 sec-title）。
    private var daySectionTitle: String {
        var title = model.selectedDay == Format.today()
            ? "今日行程"
            : "\(dayParts(model.selectedDay).month)月\(dayParts(model.selectedDay).day)日 · 周\(Format.dowOf(model.selectedDay))"
        let sum = dayOrders.reduce(0) { $0 + $1.price }
        if let badge = Logic.dayBadge(count: dayOrders.count, sum: sum, rules: model.medalRules) {
            title += " · \(badge.emoji) \(badge.title)"
        }
        return title
    }

    /// 日期拆分（'YYYY-MM-DD' → 年月日）。
    private func dayParts(_ day: String) -> (year: Int, month: Int, day: Int) {
        (Int(day.prefix(4)) ?? 0,
         Int(day.dropFirst(5).prefix(2)) ?? 0,
         Int(day.dropFirst(8).prefix(2)) ?? 0)
    }

    /// 「今天 / 明天」后缀（对应 Web 的 tag）。
    private func relativeTag(_ day: String) -> String {
        let label = Format.relativeDayLabel(day, baseDay: Format.today())
        guard let range = label.range(of: " · ") else { return "" }
        let tag = String(label[range.upperBound...])
        return (tag == "今天" || tag == "明天") ? " · \(tag)" : ""
    }

    /// 收款状态标签：逾期优先显示「已逾期」（Web 的 payChip 口径）。
    private func payLabel(_ order: Order) -> String {
        if Logic.isOver(order, payments: model.payments, threshold: model.threshold) {
            return "已逾期"
        }
        return Logic.payOf(order, payments: model.payments)
    }

    /// 分享文案（不含金额，与 Web 的分享图口径一致）。
    private var shareText: String {
        ScheduleShare.text(day: model.selectedDay, orders: scopedOrders)
    }

    // MARK: - 动作

    /// 选中某一天；若不在当前显示的月份则同步翻月（对应 Web 的 day 动作）。
    private func selectDay(_ day: String) {
        model.selectedDay = day
        guard let date = Format.parseDay(day) else { return }
        let parts = Calendar.current.dateComponents([.year, .month], from: date)
        if parts.year != year || parts.month != month {
            model.tripMonth = date
        }
    }

    /// 上月 / 下月；选中日尽量保持在同一个「几号」（对应 Web 的 mnav 动作）。
    private func shiftMonth(_ delta: Int) {
        let calendar = Calendar.current
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = 1
        guard let base = calendar.date(from: components),
              let shifted = calendar.date(byAdding: .month, value: delta, to: base) else { return }
        model.tripMonth = shifted
        let shiftedParts = calendar.dateComponents([.year, .month], from: shifted)
        let dim = calendar.range(of: .day, in: .month, for: shifted)?.count ?? 30
        let day = max(1, min(dayParts(model.selectedDay).day, dim))
        model.selectedDay = String(format: "%04d-%02d-%02d",
                                    shiftedParts.year ?? year,
                                    shiftedParts.month ?? month,
                                    day)
    }

    /// 回到今天（对应 Web 的 mtoday 动作）。
    private func jumpToday() {
        model.tripMonth = Date()
        model.selectedDay = Format.today()
    }

    /// 月历格子里的 'YYYY-MM-DD'。
    private func isoDay(_ day: Int) -> String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }
}

// MARK: - 月历格子

/// 月历格子：日期 + 预约小圆点 + 单日勋章。
private struct TripDayCell: View {
    let day: Int
    let count: Int
    let badge: Logic.Badge?
    let isSelected: Bool
    let isToday: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Text("\(day)")
                    .font(Theme.body(12.5, weight: .bold))
                    .foregroundStyle(numberColor)
                    .lineLimit(1)
                HStack(spacing: 2) {
                    ForEach(0..<min(count, 6), id: \.self) { _ in
                        Circle()
                            .fill(Theme.brand)
                            .frame(width: 3, height: 3)
                    }
                }
                .frame(height: 4)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 46)
            .background(background, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous)
                .stroke(border, lineWidth: 1))
            .overlay(alignment: .topTrailing) {
                if let badge {
                    Text(badge.emoji)
                        .font(Theme.body(9))
                        .padding(.trailing, 2)
                        .padding(.top, 1)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(day) 日，\(count) 个预约")
    }

    private var background: Color {
        if isSelected { return Theme.ink }
        if isToday { return Theme.brandSoft }
        return .clear
    }

    private var border: Color {
        if isSelected { return Theme.ink }
        if isToday { return Theme.brand }
        return .clear
    }

    private var numberColor: Color {
        if isSelected { return Theme.card }
        if isToday { return Theme.brandInk }
        return Theme.ink2
    }
}

// MARK: - 行程行

/// 行程里的单条预约（对应 Web 的 orderRowTrip）：时间 + 商家 + 金额 + 状态标签 + 编辑入口。
private struct TripOrderRow: View {
    let order: Order
    let account: Account?
    let work: String
    let pay: String
    let depositDue: Double
    let owed: Double
    let masked: Bool
    let onTap: () -> Void
    let onEdit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 11) {
                Button(action: onTap) {
                    HStack(alignment: .top, spacing: 11) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(Format.fmtHM(order.appt))
                                .font(Theme.display(21))
                                .foregroundStyle(Theme.brandInk)
                                .lineLimit(1)
                                .fixedSize(horizontal: true, vertical: false)
                            Text(order.cat)
                                .font(Theme.body(10.5))
                                .foregroundStyle(Theme.sub)
                                .lineLimit(1)
                        }
                        .frame(minWidth: 64, alignment: .leading)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(order.store)
                                .font(Theme.body(15, weight: .bold))
                                .foregroundStyle(Theme.ink)
                                .fixedSize(horizontal: false, vertical: true)
                            if !order.location.isEmpty {
                                Text(order.location)
                                    .font(Theme.body(11.5))
                                    .foregroundStyle(Theme.sub)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        VStack(alignment: .trailing, spacing: 3) {
                            MoneyText(value: order.price, masked: masked, font: Theme.body(15, weight: .heavy))
                            Text(owed > 0 ? "待收 \(Format.fmtMoney(owed, masked: masked))" : "已结清")
                                .font(Theme.body(10.5))
                                .foregroundStyle(owed > 0 ? Theme.red : Theme.sub)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Button(action: onEdit) {
                    Image(systemName: "square.and.pencil")
                        .font(Theme.body(13, weight: .semibold))
                        .foregroundStyle(Theme.brandInk)
                        .frame(width: 34, height: 34)
                        .background(Theme.brandSoft, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("编辑 \(order.store)")
            }
            WrapLayout(spacing: 6, lineSpacing: 6) {
                if let account {
                    AccountBadge(account: account, compact: true)
                }
                Chip.work(work)
                if depositDue > 0 {
                    Chip(text: "待定金 \(Format.fmtMoney(depositDue, masked: masked))",
                         ink: Theme.red,
                         background: Theme.redSoft)
                } else {
                    Chip.pay(pay)
                }
                if !order.channel.isEmpty && order.channel != "直客" {
                    Chip(text: order.channel)
                }
            }
            .padding(.leading, 75)
        }
        .padding(.vertical, 15)
    }
}

// MARK: - 小控件

/// 顶栏药丸按钮（对应 Web 版 .btn-pill）。
private struct TripPillButton: View {
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

/// 卡片内行间细线（对应 Web 版 .row 的 border-bottom）。
private struct TripHairLine: View {
    var body: some View {
        Rectangle()
            .fill(Theme.line)
            .frame(height: 0.5)
    }
}
