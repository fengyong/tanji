import SwiftUI

/// 订单详情工作台。
///
/// 结构与 Web 版 `src/app/detail.js` 的 `openDetail` 对齐：
///   商家抬头 → 状态标签 → 交付里程碑 → 行内动作 → 送审结果 → 收款 → 催收跟进 → 平台到账 → 预约与店铺 → 备注 → 删除。
struct OrderDetailView: View {
    let order: Order
    var onChanged: (() -> Void)?

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var showPayment: OrderPaymentTarget?
    @State private var showRemindLog = false
    @State private var showExpectPay = false
    @State private var showEdit = false
    @State private var showAccountPicker = false
    @State private var alertState: DetailAlert?
    /// 待清除的里程碑（单独存一份：alert 的按钮动作执行时 alertState 可能已被置空）。
    @State private var pendingClear: MilestoneClear?

    /// 始终从模型取最新数据（详情内部自行刷新）。
    private var current: Order { model.order(order.id) ?? order }

    /// 详情内的确认弹层（同一视图只能挂一个 alert，故统一成一个枚举）。
    private enum DetailAlert {
        case deleteOrder
        case clearMilestone(MilestoneClear)
    }

    private var alertBinding: Binding<Bool> {
        Binding(get: { alertState != nil }, set: { if !$0 { alertState = nil } })
    }

    private var alertTitle: String {
        switch alertState {
        case .deleteOrder: return "删除订单"
        case .clearMilestone(let target): return "清除「\(target.label)」？"
        case nil: return ""
        }
    }

    private var alertMessage: String {
        switch alertState {
        case .deleteOrder:
            return "删除「\(current.store)」？该单的收款流水会一起删除，操作不可撤销。"
        case .clearMilestone(let target):
            return target.downstreamLabels.isEmpty
                ? "清除「\(target.label)」记录？"
                : "其后的「\(target.downstreamLabels.joined(separator: "」「"))」也将一并清除。"
        case nil:
            return ""
        }
    }

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    hero
                    statusChips
                    overdueBanner
                    milestoneSection
                    nextActions
                    if !(current.submittedAt ?? "").isEmpty {
                        reviewSection
                    }
                    paymentSection
                    remindSection
                    if current.settleVia == "douyin" { expectSection }
                    infoSection
                    if !current.note.isEmpty { noteSection }
                    deleteButton
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 34)
            }
        }
        .sheet(item: $showPayment) { target in
            PaymentFormView(order: current, kind: target.kind) {
                changed()
            }
        }
        .sheet(isPresented: $showRemindLog) {
            RemindLogView(order: current) {
                changed()
            }
        }
        .sheet(isPresented: $showExpectPay) {
            ExpectPayView(order: current) {
                changed()
            }
        }
        .sheet(isPresented: $showEdit) {
            OrderFormView(order: current) {
                changed()
            }
        }
        .sheet(isPresented: $showAccountPicker) {
            OrderAccountPickerSheet(currentAccountId: current.accountId) { picked in
                Task {
                    await model.setOrderAccount(orderId: current.id, accountId: picked)
                    changed()
                }
            }
        }
        // 详情页自己的提示条宿主：这一层是 sheet，根层的提示条会被盖住。
        .toastHost()
        .alert(alertTitle, isPresented: alertBinding) {
            if case .deleteOrder = alertState {
                Button("取消", role: .cancel) {}
                Button("删除", role: .destructive) {
                    Task {
                        await model.deleteOrder(current.id)
                        model.showToast("已删除订单")
                        dismiss()
                    }
                }
            } else {
                Button("取消", role: .cancel) {}
                Button("清除", role: .destructive) {
                    if let target = pendingClear {
                        Task { await clearMilestone(target) }
                    }
                }
            }
        } message: {
            Text(alertMessage)
        }
    }

    // MARK: - 抬头

    private var hero: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text("ORDER / #\(current.id)")
                    .font(Theme.body(10, weight: .heavy))
                    .tracking(1.6)
                    .foregroundStyle(Theme.sub)
                Text(current.store)
                    .font(Theme.display(26))
                    .foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text([current.cat, current.contact].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(Theme.body(11))
                    .foregroundStyle(Theme.sub)
            }
            Spacer(minLength: 0)
            HStack(spacing: 7) {
                IconButton(systemName: "square.and.pencil", accessibility: "编辑订单") {
                    showEdit = true
                }
                IconButton(systemName: "xmark", accessibility: "关闭") {
                    dismiss()
                }
            }
        }
        .padding(.top, 16)
        .padding(.bottom, 12)
        // 抬头高度上报给提示条：提示条落在商家名下方。
        .toastTopAnchor()
    }

    // MARK: - 状态标签

    private var statusChips: some View {
        let overdueDays = Logic.overdueDays(current, payments: model.payments)
        let expectLate = Logic.expectOverdue(current, payments: model.payments)
        return OrderFlowLayout(spacing: 6) {
            Chip.work(Logic.workOf(current))
            Chip.pay(payLabel)
            if !current.reviewResult.isEmpty {
                Chip(text: reviewLabel,
                     ink: current.reviewResult == "pass" ? Theme.green : Theme.red,
                     background: current.reviewResult == "pass" ? Theme.greenSoft : Theme.redSoft)
            }
            if Logic.deliverLate(current) {
                Chip(text: "超 24h 未出片", ink: Theme.red, background: Theme.redSoft)
            }
            if Logic.isOver(current, payments: model.payments, threshold: model.threshold) {
                Chip(text: "欠款 \(overdueDays) 天", ink: Theme.red, background: Theme.redSoft)
            }
            if current.settleVia == "douyin", let expect = current.expectPayAt, Logic.unFin(current, payments: model.payments) > 0 {
                Chip(text: expectLate > 0
                     ? "预计 \(Format.fmtD(expect)) 到账 · 超期 \(expectLate) 天"
                     : "预计 \(Format.fmtD(expect)) 到账",
                     ink: expectLate > 0 ? Theme.red : Theme.blue,
                     background: expectLate > 0 ? Theme.redSoft : Theme.blueSoft)
            }
            if Logic.snoozed(current) {
                Chip(text: "已设提醒")
            }
        }
        .padding(.bottom, 4)
    }

    /// 收款状态标签（与 Web 的 payChip 同口径：待尾款且逾期才算「已逾期」）。
    private var payLabel: String {
        let state = Logic.payOf(current, payments: model.payments)
        if state == "待尾款" && Logic.isOver(current, payments: model.payments, threshold: model.threshold) {
            return "已逾期"
        }
        return state
    }

    private var reviewLabel: String {
        current.reviewResult == "pass" ? "送审合格" : "送审不合格"
    }

    // MARK: - 逾期提示

    @ViewBuilder
    private var overdueBanner: some View {
        let days = Logic.overdueDays(current, payments: model.payments)
        if Logic.isOver(current, payments: model.payments, threshold: model.threshold) {
            Text("尾款自拍摄日（\(Format.fmtD(current.shotAt))）起已欠 \(days) 天，达到 \(model.threshold) 天催收阈值，建议电话跟进。"
                 + (Logic.snoozed(current) ? "已备忘：\(Format.fmtD(current.remindAt)) 再提醒。" : ""))
                .font(Theme.body(11.5, weight: .semibold))
                .foregroundStyle(Theme.red)
                .fixedSize(horizontal: false, vertical: true)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.redSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Theme.red.opacity(0.12), lineWidth: 1))
                .padding(.top, 12)
        }
    }

    // MARK: - 交付里程碑

    private struct Milestone: Identifiable {
        let id: String
        let title: String
        let time: String?
        let ink: Color
        let big: Bool
    }

    private var milestones: [Milestone] {
        var list: [Milestone] = [
            Milestone(id: "shotAt", title: "拍摄", time: current.shotAt, ink: Theme.brandInk, big: false),
            Milestone(id: "submittedAt", title: "提审", time: current.submittedAt, ink: Theme.blue, big: false)
        ]
        if Logic.needSub(current) {
            list.append(Milestone(id: "shortAt", title: "副片发出", time: current.shortAt, ink: Theme.purple, big: true))
        }
        if Logic.needMain(current) {
            list.append(Milestone(id: "longAt", title: "正片发出", time: current.longAt, ink: Theme.green, big: true))
        }
        list.append(Milestone(id: "publishedAt", title: "发布", time: current.publishedAt, ink: Theme.ink2, big: false))
        return list
    }

    private var milestoneSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("交付轨道 / DELIVERY TRACK")
                .font(Theme.body(10, weight: .heavy))
                .tracking(1.2)
                .foregroundStyle(Theme.sub)
            HStack(alignment: .top, spacing: 0) {
                ForEach(Array(milestones.enumerated()), id: \.element.id) { index, step in
                    if index > 0 {
                        Rectangle()
                            .fill(isDone(milestones[index - 1]) ? Theme.brand : Theme.line)
                            .frame(height: 2)
                            .padding(.top, step.big ? 21 : 17)
                            .frame(maxWidth: .infinity)
                    }
                    milestoneCell(step)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 19, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 19, style: .continuous).stroke(Theme.line, lineWidth: 1))
        .padding(.top, 14)
    }

    private func milestoneCell(_ step: Milestone) -> some View {
        let done = isDone(step)
        let isNext = nextMilestoneID == step.id
        return Button {
            mark(step.id)
        } label: {
            VStack(spacing: 5) {
                ZStack {
                    Circle()
                        .fill(done ? step.ink : Theme.paperDeep)
                        .frame(width: step.big ? 34 : 26, height: step.big ? 34 : 26)
                        .overlay {
                            Circle()
                                .stroke(done ? .clear : (isNext ? step.ink : Theme.line), lineWidth: 2)
                        }
                    if done {
                        Image(systemName: "checkmark")
                            .font(Theme.body(step.big ? 13 : 10, weight: .heavy))
                            .foregroundStyle(Theme.card)
                    } else if isNext {
                        Circle()
                            .fill(step.ink)
                            .frame(width: 7, height: 7)
                    }
                }
                .frame(height: 36)
                Text(step.title)
                    .font(Theme.body(10, weight: .bold))
                    .foregroundStyle(done ? step.ink : Theme.ink2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(done ? Format.fmtDT(step.time) : (isNext ? "点击标记" : ""))
                    .font(Theme.body(8.5))
                    .foregroundStyle(Theme.sub)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
        .opacity(isNext || done ? 1 : 0.5)
    }

    private func isDone(_ step: Milestone) -> Bool {
        guard let time = step.time else { return false }
        return !time.isEmpty
    }

    /// 下一个待标记的里程碑 id。
    private var nextMilestoneID: String? {
        milestones.first { isDone($0) == false }?.id
    }

    /// 里程碑是否已打点。
    private func isStamped(_ key: String, _ order: Order) -> Bool {
        switch key {
        case "shotAt": return !(order.shotAt ?? "").isEmpty
        case "submittedAt": return !(order.submittedAt ?? "").isEmpty
        case "shortAt": return !(order.shortAt ?? "").isEmpty
        case "longAt": return !(order.longAt ?? "").isEmpty
        case "publishedAt": return !(order.publishedAt ?? "").isEmpty
        default: return false
        }
    }

    /// 时间线全序（与 Web 版 MILE_ORDER 同序）。
    private static let milestoneOrder = ["shotAt", "submittedAt", "shortAt", "longAt", "publishedAt"]

    /// 清除某节点时，其后已打点的节点也会一并截断（与 Web 版 mile 动作同口径）。
    private func downstreamKeys(after key: String) -> [String] {
        guard let index = Self.milestoneOrder.firstIndex(of: key) else { return [] }
        return Self.milestoneOrder[(index + 1)...].filter { isStamped($0, current) }
    }

    /// 执行清除：清掉目标节点与所有下游节点。
    private func clearMilestone(_ target: MilestoneClear) async {
        var updated = current
        for key in [target.key] + target.downstream {
            switch key {
            case "shotAt":
                updated.shotAt = nil
                // 门口的随手照是「到过店」的凭据：清了拍摄时间就一并删（与 Web 版同口径）。
                updated.photoThumb = nil
            case "submittedAt": updated.submittedAt = nil
            case "shortAt": updated.shortAt = nil
            case "longAt": updated.longAt = nil
            case "publishedAt": updated.publishedAt = nil
            default: break
            }
        }
        await model.saveOrder(updated)
        model.showToast("已清除，可重新标记")
        changed()
    }

    /// 标记里程碑（前置条件与 Web 版 MILE_PRE 同口径）。
    ///
    /// 已打点的里程碑点一下是「清除」：Web 版会连同其后的节点一起截断，
    /// 这里同口径，但先弹确认，避免误触。
    private func mark(_ key: String) {
        let order = current
        // 已打过点的里程碑 → 走清除流程（与 Web 版 mile 动作一致）。
        if isStamped(key, order) {
            let target = MilestoneClear(key: key, downstream: downstreamKeys(after: key))
            pendingClear = target
            alertState = .clearMilestone(target)
            return
        }

        Task {
            switch key {
            case "shotAt":
                await model.advance(order, field: .shot)
                model.showToast("已标记拍摄")
            case "submittedAt":
                guard !(order.shotAt ?? "").isEmpty else {
                    model.showToast("请先完成「拍摄」再标记「提审」")
                    return
                }
                await model.advance(order, field: .submitted)
                model.showToast("已标记提审")
            case "shortAt":
                guard !(order.submittedAt ?? "").isEmpty else {
                    model.showToast("请先完成「提审」再标记「副片发出」")
                    return
                }
                await model.advance(order, field: .short)
                model.showToast("副片已发出")
            case "longAt":
                guard !(order.submittedAt ?? "").isEmpty else {
                    model.showToast("请先完成「提审」再标记「正片发出」")
                    return
                }
                await model.advance(order, field: .long)
                model.showToast("正片已发出")
            case "publishedAt":
                guard !(order.submittedAt ?? "").isEmpty else {
                    model.showToast("请先完成「提审」再标记「发布」")
                    return
                }
                guard Logic.deliveredAll(order) else {
                    model.showToast("正片/副片出齐后才能标记发布")
                    return
                }
                await model.setPublishedAt(orderId: order.id, value: Logic.nowString())
                model.showToast("已标记发布")
            default:
                break
            }
            changed()
        }
    }

    // MARK: - 行内动作

    @ViewBuilder
    private var nextActions: some View {
        if (current.shotAt ?? "").isEmpty {
            PrimaryButton(title: "到店了，标记已拍摄", systemImage: "camera") {
                mark("shotAt")
            }
            .padding(.top, 14)
        } else if (current.submittedAt ?? "").isEmpty {
            PrimaryButton(title: "已选完，标记提审", systemImage: "paperplane") {
                mark("submittedAt")
            }
            .padding(.top, 14)
        } else {
            VStack(spacing: 9) {
                if Logic.needSub(current) {
                    GhostButton(title: (current.shortAt ?? "").isEmpty ? "标记发副片" : "副片已发",
                               systemImage: "film",
                               tint: (current.shortAt ?? "").isEmpty ? Theme.ink : Theme.sub) {
                        mark("shortAt")
                    }
                    .disabled(!(current.shortAt ?? "").isEmpty)
                }
                if Logic.needMain(current) {
                    GhostButton(title: (current.longAt ?? "").isEmpty ? "标记发正片" : "正片已发",
                               systemImage: "photo",
                               tint: (current.longAt ?? "").isEmpty ? Theme.ink : Theme.sub) {
                        mark("longAt")
                    }
                    .disabled(!(current.longAt ?? "").isEmpty)
                }
                if Logic.deliveredAll(current) && (current.publishedAt ?? "").isEmpty {
                    PrimaryButton(title: "标记已发布", systemImage: "megaphone") {
                        mark("publishedAt")
                    }
                }
            }
            .padding(.top, 14)
        }
    }

    // MARK: - 送审结果

    private var reviewSection: some View {
        VStack(alignment: .leading, spacing: 9) {
            SectionTitle("送审结果")
            HStack(spacing: 9) {
                GhostButton(title: current.reviewResult == "pass" ? "✓ 合格" : "合格",
                           tint: current.reviewResult == "pass" ? Theme.green : Theme.ink) {
                    setReview("pass")
                }
                GhostButton(title: current.reviewResult == "fail" ? "✗ 不合格" : "不合格",
                           tint: current.reviewResult == "fail" ? Theme.red : Theme.ink) {
                    setReview("fail")
                }
            }
        }
    }

    private func setReview(_ value: String) {
        Task {
            await model.setReviewResult(orderId: current.id, value: value)
            model.showToast(value == "pass" ? "已标记合格" : "已标记不合格")
            changed()
        }
    }

    // MARK: - 收款

    private var paymentSection: some View {
        VStack(alignment: .leading, spacing: 9) {
            SectionTitle("收款")
            CardBox {
                VStack(spacing: 0) {
                    infoGrid([
                        ("订单总价", .money(current.price)),
                        ("定金", .money(current.deposit)),
                        ("尾款", .money(finalAmount)),
                        ("已收合计", .received(receivedTotal)),
                        ("当前待收", .owed(Logic.owedOf(current, payments: model.payments))),
                        ("结算方式", .text(current.settleVia == "douyin" ? "抖音商单" : "私收"))
                    ])
                    paymentButtons
                }
            }
        }
    }

    @ViewBuilder
    private var paymentButtons: some View {
        let depositDue = Logic.unDep(current, payments: model.payments)
        let finalDue = Logic.unFin(current, payments: model.payments)
        VStack(spacing: 9) {
            if depositDue > 0 {
                OrderPaymentActionButton(title: "收定金", amount: depositDue, tint: Theme.blue) {
                    showPayment = OrderPaymentTarget(kind: "定金")
                }
            }
            if finalDue > 0 {
                OrderPaymentActionButton(title: "收尾款", amount: finalDue, tint: Theme.green) {
                    showPayment = OrderPaymentTarget(kind: "尾款")
                }
            }
            if depositDue <= 0 && finalDue <= 0 {
                Text("款项已全部结清")
                    .font(Theme.body(14, weight: .bold))
                    .foregroundStyle(Theme.green)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            receiptToggles
        }
        .padding(.top, 10)
    }

    /// 撤销 / 补记（对应 Web 编辑表单的收款记录按钮）。
    @ViewBuilder
    private var receiptToggles: some View {
        let depositReceived = Logic.hasReceipt(current, kind: "定金", payments: model.payments)
        let finalReceived = Logic.hasReceipt(current, kind: "尾款", payments: model.payments)
        let depositDue = Logic.unDep(current, payments: model.payments)
        let finalDue = Logic.unFin(current, payments: model.payments)
        if (depositReceived || depositDue > 0) || (finalReceived || finalDue > 0) {
            HStack(spacing: 9) {
                receiptToggle(kind: "定金", received: depositReceived)
                receiptToggle(kind: "尾款", received: finalReceived)
            }
            Text("撤销仅用于纠正错误收款，会同时移除对应流水。")
                .font(Theme.body(10.5))
                .foregroundStyle(Theme.sub)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func receiptToggle(kind: String, received: Bool) -> some View {
        Button {
            Task {
                await model.toggleReceipt(orderId: current.id, kind: kind)
                model.showToast(received ? "已撤销\(kind)记录" : "已补记\(kind)")
                changed()
            }
        } label: {
            Text(received ? "撤销\(kind)记录" : "补记\(kind)已收")
                .font(Theme.body(12, weight: .bold))
                .foregroundStyle(received ? Theme.sub : Theme.ink2)
                .frame(maxWidth: .infinity)
                .frame(height: 42)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous).stroke(Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: - 催收跟进

    @ViewBuilder
    private var remindSection: some View {
        let log = Logic.remindLogOf(current)
        let last = Logic.lastRemind(current)
        let recent = Array(log.suffix(4).reversed())
        // 与 Web 同口径：只有「待尾款」才需要催收跟进区块。
        if Logic.payOf(current, payments: model.payments) == "待尾款" {
            VStack(alignment: .leading, spacing: 9) {
                SectionTitle(text: "催收跟进") {
                    Button("记录这次跟进 ›") {
                        showRemindLog = true
                    }
                    .font(Theme.body(10.5, weight: .bold))
                    .foregroundStyle(Theme.brandInk)
                    .buttonStyle(.plain)
                }
                CardBox {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(log.isEmpty
                             ? "还没催过；第一次跟进也记一笔，对方怎么答下次不用重新问"
                             : "已催 \(log.count >= 50 ? "50+" : "\(log.count)") 次 · 最近 \(Format.fmtDT(last?.at))")
                            .font(Theme.body(11.5))
                            .foregroundStyle(Theme.sub)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.bottom, recent.isEmpty ? 0 : 8)
                        ForEach(recent) { entry in
                            HStack(alignment: .top, spacing: 8) {
                                Text("\(Format.fmtD(entry.at)) \(Format.fmtHM(entry.at))")
                                    .font(Theme.body(11.5))
                                    .foregroundStyle(Theme.sub)
                                    .frame(width: 82, alignment: .leading)
                                Text(entry.note.isEmpty ? "已催" : entry.note)
                                    .font(Theme.body(11.5))
                                    .foregroundStyle(Theme.ink)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .padding(.vertical, 6)
                            .overlay(alignment: .top) {
                                Rectangle().fill(Theme.line).frame(height: 1)
                            }
                        }
                        if log.count > recent.count {
                            Text("另有 \(log.count - recent.count) 次更早的跟进")
                                .font(Theme.body(11.5))
                                .foregroundStyle(Theme.sub)
                                .padding(.top, 6)
                        }
                    }
                }
                Text("下次提醒（以打开 App 查看为准）")
                    .font(Theme.body(11.5))
                    .foregroundStyle(Theme.sub)
                    .padding(.horizontal, 2)
                    .padding(.top, 2)
                HStack(spacing: 9) {
                    ForEach([1, 3, 7], id: \.self) { days in
                        GhostButton(title: "\(days) 天后", tint: Theme.ink) {
                            Task {
                                await model.setRemind(orderId: current.id, days: days)
                                model.showToast("已设 \(days) 天后提醒")
                                changed()
                            }
                        }
                    }
                }
                if Logic.snoozed(current) {
                    HStack(spacing: 6) {
                        Text("已设提醒：\(Format.fmtD(current.remindAt)) 再催收")
                            .font(Theme.body(11.5))
                            .foregroundStyle(Theme.sub)
                        Button("清除") {
                            Task {
                                await model.clearRemind(orderId: current.id)
                                model.showToast("已清除提醒")
                                changed()
                            }
                        }
                        .font(Theme.body(11.5, weight: .bold))
                        .foregroundStyle(Theme.sub)
                        .buttonStyle(.plain)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
    }

    // MARK: - 平台到账

    private var expectSection: some View {
        let late = Logic.expectOverdue(current, payments: model.payments)
        return VStack(alignment: .leading, spacing: 9) {
            SectionTitle("平台到账")
            CardBox {
                Text(current.expectPayAt.map { expect in
                    late > 0
                    ? "预计 \(Format.fmtD(expect)) 到账 · 已超期 \(late) 天，去平台后台看结算状态"
                    : "预计 \(Format.fmtD(expect)) 到账"
                } ?? "还没填预计到账日。填上之后，首页与收款页会提示「预计哪天到账」。")
                    .font(Theme.body(11.5))
                    .foregroundStyle(Theme.sub)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 9) {
                GhostButton(title: current.expectPayAt == nil ? "设置预计到账日" : "修改预计到账日", tint: Theme.ink) {
                    showExpectPay = true
                }
                if current.expectPayAt != nil {
                    GhostButton(title: "清除", tint: Theme.sub) {
                        Task {
                            await model.setExpectPayAt(orderId: current.id, value: nil)
                            model.showToast("已清除预计到账日")
                            changed()
                        }
                    }
                }
            }
        }
    }

    // MARK: - 预约与店铺

    private var infoSection: some View {
        VStack(alignment: .leading, spacing: 9) {
            SectionTitle("预约与店铺")
            CardBox {
                VStack(spacing: 0) {
                    infoGrid([
                        ("预约时间", .text("\(Format.fmtD(current.appt)) \(Format.fmtHM(current.appt))")),
                        ("实际拍摄", .text(Format.fmtDT(current.shotAt))),
                        ("地点", .text(current.location.isEmpty ? "—" : current.location)),
                        ("到店定位", .text(gpsText.isEmpty ? "—" : gpsText)),
                        ("发布时间", .text(Format.fmtDT(current.publishedAt))),
                        ("服务商", .text(current.channel.isEmpty ? "直客" : current.channel)),
                        ("组队 / 出镜", .text(current.partner.isEmpty
                            ? (current.note.contains("不组队") ? "不组队" : "—")
                            : current.partner)),
                        ("定金到账", .text(current.depositPaidAt.map { Format.fmtD($0) } ?? "—")),
                        ("尾款到账", .text(current.finalPaidAt.map { Format.fmtD($0) } ?? "—"))
                    ])
                    if model.isMultiAccount {
                        accountRow
                    }
                }
            }
        }
    }

    private var gpsText: String {
        GeoStore.label(current.gpsPlace)
    }

    private var accountRow: some View {
        Button {
            showAccountPicker = true
        } label: {
            HStack(spacing: 8) {
                Text("账号")
                    .font(Theme.body(9.5))
                    .foregroundStyle(Theme.sub)
                    .frame(width: 62, alignment: .leading)
                AccountBadge(account: model.account(current.accountId))
                Spacer(minLength: 0)
                Text("改挂")
                    .font(Theme.body(11.5, weight: .bold))
                    .foregroundStyle(Theme.brandInk)
            }
            .padding(.top, 12)
        }
        .buttonStyle(.plain)
    }

    // MARK: - 备注

    private var noteSection: some View {
        VStack(alignment: .leading, spacing: 9) {
            SectionTitle("备注")
            CardBox {
                Text(current.note)
                    .font(Theme.body(12))
                    .foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - 删除

    private var deleteButton: some View {
        Button {
            alertState = .deleteOrder
        } label: {
            Text("删除订单")
                .font(Theme.body(13, weight: .semibold))
                .foregroundStyle(Theme.red)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous)
                    .stroke(Theme.red.opacity(0.3), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .padding(.top, 18)
    }

    // MARK: - 通用区块

    /// 信息格子的取值类型。
    private enum InfoValue {
        case text(String)
        case money(Double)
        case owed(Double)
        /// 已收合计：0 显示「—」，否则绿字金额（与 Web 一致）。
        case received(Double)
    }

    private func infoGrid(_ items: [(String, InfoValue)]) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 1), GridItem(.flexible(), spacing: 1)],
                  spacing: 1) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.0)
                        .font(Theme.body(9.5))
                        .foregroundStyle(Theme.sub)
                    switch item.1 {
                    case .text(let value):
                        Text(value)
                            .font(Theme.body(12.5, weight: .bold))
                            .foregroundStyle(Theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    case .money(let value):
                        MoneyText(value: value, masked: model.privacyHidden, font: Theme.body(12.5, weight: .bold))
                    case .owed(let value):
                        if value > 0 {
                            MoneyText(value: value, masked: model.privacyHidden,
                                      font: Theme.body(12.5, weight: .bold),
                                      color: Logic.isOver(current, payments: model.payments, threshold: model.threshold)
                                      ? Theme.red : Theme.orange)
                        } else {
                            Text("已结清")
                                .font(Theme.body(12.5, weight: .bold))
                                .foregroundStyle(Theme.green)
                        }
                    case .received(let value):
                        if value > 0 {
                            MoneyText(value: value, masked: model.privacyHidden,
                                      font: Theme.body(12.5, weight: .bold),
                                      color: Theme.green)
                        } else {
                            Text("—")
                                .font(Theme.body(12.5, weight: .bold))
                                .foregroundStyle(Theme.green)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Theme.card)
            }
        }
        .background(Theme.line)
    }

    private var finalAmount: Double {
        guard let money = Logic.orderMoney(current) else { return 0 }
        return Double(money.final) / 100
    }

    private var receivedTotal: Double {
        let cents = model.payments(of: current.id).reduce(0) { sum, payment in
            sum + (Logic.moneyCents(payment.amount) ?? 0)
        }
        return Double(cents) / 100
    }

    private func changed() {
        onChanged?()
    }
}

// MARK: - 辅助类型

/// 里程碑清除载荷（目标节点 + 其后要一并清除的节点）。
private struct MilestoneClear: Identifiable {
    let key: String
    let downstream: [String]
    var id: String { key }

    var label: String {
        switch key {
        case "shotAt": return "拍摄"
        case "submittedAt": return "提审"
        case "shortAt": return "副片发出"
        case "longAt": return "正片发出"
        case "publishedAt": return "发布"
        default: return key
        }
    }

    var downstreamLabels: [String] {
        downstream.map { key in
            switch key {
            case "shotAt": return "拍摄"
            case "submittedAt": return "提审"
            case "shortAt": return "副片发出"
            case "longAt": return "正片发出"
            case "publishedAt": return "发布"
            default: return key
            }
        }
    }
}

/// 收款弹层载荷（kind = 定金 / 尾款）。
private struct OrderPaymentTarget: Identifiable {
    let kind: String
    var id: String { kind }
}

/// 收款动作按钮（对应 Web 版 .btn.pay / .tint-blue）。
private struct OrderPaymentActionButton: View {
    let title: String
    let amount: Double
    let tint: Color
    let action: () -> Void

    @EnvironmentObject private var model: AppModel

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(title)
                    .font(Theme.body(14, weight: .bold))
                MoneyText(value: amount, masked: model.privacyHidden,
                          font: Theme.body(15, weight: .heavy), color: Theme.card)
            }
            .foregroundStyle(Theme.card)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(tint, in: RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

/// 改挂账号选择弹层。
private struct OrderAccountPickerSheet: View {
    let currentAccountId: Int?
    let onPick: (Int?) -> Void

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 9) {
                    Text("改挂账号")
                        .font(Theme.display(20))
                        .foregroundStyle(Theme.ink)
                        .padding(.top, 18)
                    Button {
                        onPick(nil)
                        dismiss()
                    } label: {
                        pickerRow(name: "未指定", account: nil)
                    }
                    .buttonStyle(.plain)
                    ForEach(model.accounts) { account in
                        Button {
                            onPick(account.id)
                            dismiss()
                        } label: {
                            pickerRow(name: account.name, account: account)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 30)
            }
        }
    }

    private func pickerRow(name: String, account: Account?) -> some View {
        HStack(spacing: 10) {
            AccountBadge(account: account)
            Text(name)
                .font(Theme.body(14, weight: .bold))
                .foregroundStyle(Theme.ink)
            Spacer(minLength: 0)
            if currentAccountId == account?.id {
                Image(systemName: "checkmark")
                    .font(Theme.body(13, weight: .bold))
                    .foregroundStyle(Theme.brand)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.line, lineWidth: 1))
    }
}

/// 流式布局：标签按顺序换行排列（对应 Web 版 .chiprow）。
private struct OrderFlowLayout: Layout {
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
