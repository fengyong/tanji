import SwiftUI

/// 新建 / 编辑订单表单（传 nil = 新建）。
///
/// 字段与校验口径对应 Web 版 `src/app/order-forms.js`：
///   - 金额用字符串输入，保存时按 Web 的 `moneyCents` 规则校验（最多两位小数、定金 ≤ 总价）；
///   - 预约时间用 DatePicker，保存成 'YYYY-MM-DDTHH:mm'；
///   - 排期重叠只提示不拦截（与 Web 一致）。
struct OrderFormView: View {
    let order: Order?
    var presetAppt: String?
    var onSaved: (() -> Void)?

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var store = ""
    @State private var cat = "餐饮"
    @State private var contact = ""
    @State private var settleVia = "private"
    @State private var priceText = ""
    @State private var depositText = ""
    @State private var apptDay = Date()
    @State private var apptTime = Date()
    @State private var needMain = true
    @State private var needSub = false
    @State private var provider = ""
    @State private var providerCustom = ""
    @State private var partner = ""
    @State private var location = ""
    @State private var accountId: Int?
    @State private var accountTouched = false
    @State private var note = ""
    @State private var reviewResult = ""
    @State private var errorText: String?
    /// 待撤销的收款（订单 id + 类型），二次确认后执行。
    @State private var revokeTarget: (id: Int, kind: String)?
    /// 打开表单时的内容指纹（用于判断「有未保存的修改」）。
    @State private var initialFingerprint = ""

    private var isEditing: Bool { order != nil }

    init(order: Order?, presetAppt: String? = nil, onSaved: (() -> Void)? = nil) {
        self.order = order
        self.presetAppt = presetAppt
        self.onSaved = onSaved

        let appt = order?.appt ?? presetAppt ?? ""
        let parsed = Format.parseLocal(appt)
        _store = State(initialValue: order?.store ?? "")
        _cat = State(initialValue: order?.cat ?? "餐饮")
        _contact = State(initialValue: order?.contact ?? "")
        _settleVia = State(initialValue: order?.settleVia ?? "private")
        _priceText = State(initialValue: order.map { OrderFormView.plainNumber($0.price) } ?? "")
        _depositText = State(initialValue: order.map { OrderFormView.plainNumber($0.deposit) } ?? "")
        _apptDay = State(initialValue: parsed ?? OrderFormView.defaultDay())
        _apptTime = State(initialValue: parsed ?? OrderFormView.defaultTime())
        _needMain = State(initialValue: order?.deliverMain ?? true)
        _needSub = State(initialValue: order?.deliverSub ?? false)
        _provider = State(initialValue: order?.channel ?? "")
        _providerCustom = State(initialValue: "")
        _partner = State(initialValue: order?.partner ?? "")
        _location = State(initialValue: order?.location ?? "")
        _accountId = State(initialValue: order?.accountId)
        _accountTouched = State(initialValue: order != nil)
        _note = State(initialValue: order?.note ?? "")
        _reviewResult = State(initialValue: order?.reviewResult ?? "")
        _errorText = State(initialValue: nil)
        _initialFingerprint = State(initialValue: OrderFormView.fingerprint(
            store: order?.store ?? "",
            cat: order?.cat ?? "餐饮",
            contact: order?.contact ?? "",
            settleVia: order?.settleVia ?? "private",
            priceText: order.map { OrderFormView.plainNumber($0.price) } ?? "",
            depositText: order.map { OrderFormView.plainNumber($0.deposit) } ?? "",
            appt: Format.localString(OrderFormView.combine(day: parsed ?? OrderFormView.defaultDay(),
                                                            time: parsed ?? OrderFormView.defaultTime())),
            provider: order?.channel ?? "",
            providerCustom: "",
            partner: order?.partner ?? "",
            location: order?.location ?? "",
            note: order?.note ?? "",
            reviewResult: order?.reviewResult ?? "",
            needMain: order?.deliverMain ?? true,
            needSub: order?.deliverSub ?? false,
            accountId: order?.accountId))
    }

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    VStack(alignment: .leading, spacing: 0) {
                        sectionTitle("去哪拍")
                        OrderFormRow(label: "品名 / 商家") {
                            TextField("如：澄川咖啡 · 滨江店", text: $store)
                                .multilineTextAlignment(.trailing)
                        }
                        OrderFormRow(label: "地点") {
                            TextField("如：万象城 3 层", text: $location)
                                .multilineTextAlignment(.trailing)
                        }
                        if model.isMultiAccount {
                            accountRow
                        }
                        OrderFormRow(label: "类型") {
                            Picker("类型", selection: $cat) {
                                ForEach(categoryOptions, id: \.self) { item in
                                    Text(item).tag(item)
                                }
                            }
                            .labelsHidden()
                            .tint(Theme.ink)
                        }

                        sectionTitle("什么时候 · 怎么结")
                        appointmentRow
                        OrderFormRow(label: "结算方式") {
                            Picker("结算方式", selection: $settleVia) {
                                Text("私收（微信 / 支付宝 / 银行卡）").tag("private")
                                Text("抖音商单（平台结算）").tag("douyin")
                            }
                            .labelsHidden()
                            .tint(Theme.ink)
                        }
                        providerBlock
                        OrderFormRow(label: "总价（¥）") {
                            TextField(model.privacyHidden ? "¥✱✱✱" : "0", text: priceBinding)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .disabled(moneyLocked)
                        }
                        OrderFormRow(label: "定金（¥）") {
                            TextField(model.privacyHidden ? "¥✱✱✱" : "0 表示未约定定金", text: depositBinding)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .disabled(moneyLocked)
                        }
                        moneyHelp

                        sectionTitle("交付与其他")
                        OrderFormRow(label: "组队") {
                            TextField("出镜搭档；单人可空", text: $partner)
                                .multilineTextAlignment(.trailing)
                        }
                        OrderFormRow(label: "出片要求") {
                            HStack(spacing: 18) {
                                OrderCheckOption(title: "正片", isOn: $needMain)
                                OrderCheckOption(title: "副片", isOn: $needSub)
                            }
                        }
                        if isEditing {
                            OrderFormRow(label: "送审结果") {
                                Picker("送审结果", selection: $reviewResult) {
                                    Text("未送审 / 待审").tag("")
                                    Text("合格").tag("pass")
                                    Text("不合格").tag("fail")
                                }
                                .labelsHidden()
                                .tint(Theme.ink)
                            }
                        }
                        OrderFormRow(label: "联系方式") {
                            TextField("店长 / 电话", text: $contact)
                                .multilineTextAlignment(.trailing)
                        }
                        OrderFormRow(label: "备注", alignTop: true) {
                            TextField("拍摄要点、机位、交付要求…", text: $note, axis: .vertical)
                                .lineLimit(2...5)
                                .multilineTextAlignment(.leading)
                        }

                        if isEditing {
                            receiptSection
                        }

                        conflictBanner
                        if let errorText {
                            Text(errorText)
                                .font(Theme.body(11.5))
                                .foregroundStyle(Theme.red)
                                .lineLimit(3)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.top, 9)
                        }
                        PrimaryButton(title: isEditing ? "保存修改" : "保存预约") {
                            save()
                        }
                        .padding(.top, 18)
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 30)
                }
            }
        }
        // 弹层自己的提示条宿主：这一层是 sheet，根层的提示条会被盖住。
        .toastHost()
        .alert("撤销\(revokeTarget?.kind ?? "")记录", isPresented: revokeBinding) {
            Button("取消", role: .cancel) {}
            Button("撤销记录", role: .destructive) {
                guard let target = revokeTarget else { return }
                Task {
                    await model.toggleReceipt(orderId: target.id, kind: target.kind)
                    model.showToast("已撤销\(target.kind)记录")
                }
            }
        } message: {
            Text("撤销\(revokeTarget?.kind ?? "")记录并删除对应流水？仅用于纠正错误收款，不表示退款。")
        }
    }

    private var revokeBinding: Binding<Bool> {
        Binding(get: { revokeTarget != nil }, set: { if !$0 { revokeTarget = nil } })
    }

    // MARK: - 顶栏

    private var header: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(isEditing ? "编辑订单" : "新建探店预约")
                    .font(Theme.display(20))
                    .foregroundStyle(Theme.ink)
            }
            Spacer(minLength: 0)
            IconButton(systemName: "xmark", accessibility: "关闭") {
                dismiss()
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 8)
        // 顶栏高度上报给提示条：提示条落在标题下方。
        .toastTopAnchor()
    }

    private func sectionTitle(_ text: String) -> some View {
        HStack(spacing: 8) {
            Text(text)
                .font(Theme.body(10, weight: .heavy))
                .tracking(1.2)
                .foregroundStyle(Theme.sub)
            Rectangle()
                .fill(Theme.line)
                .frame(height: 1)
        }
        .padding(.top, 18)
        .padding(.bottom, 4)
    }

    // MARK: - 行

    private var appointmentRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                Text("预约时间")
                    .font(Theme.body(13, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .frame(width: 76, alignment: .leading)
                DatePicker("日期", selection: $apptDay, displayedComponents: .date)
                    .labelsHidden()
                    .datePickerStyle(.compact)
                    .tint(Theme.ink)
                DatePicker("时间", selection: $apptTime, displayedComponents: .hourAndMinute)
                    .labelsHidden()
                    .datePickerStyle(.compact)
                    .tint(Theme.ink)
            }
            .padding(.vertical, 6)
            .frame(minHeight: 56)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Theme.line).frame(height: 1)
            }
            let relative = Format.relativeDayLabel(Format.dayString(apptDay))
            if !relative.isEmpty {
                Text(relative)
                    .font(Theme.body(10.5, weight: .bold))
                    .foregroundStyle(Theme.brandInk)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 4)
                    .background(Theme.brandSoft, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .padding(.leading, 86)
                    .padding(.bottom, 4)
            }
        }
    }

    private var providerBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text("服务商")
                    .font(Theme.body(13, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                Text("预设点选，或直接输入")
                    .font(Theme.body(11))
                    .foregroundStyle(Theme.sub)
            }
            .padding(.top, 8)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(model.providerList, id: \.self) { item in
                        Button {
                            provider = item
                            providerCustom = ""
                        } label: {
                            Text(item)
                                .font(Theme.body(11.5, weight: .bold))
                                .foregroundStyle(provider == item ? Theme.card : Theme.ink2)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 9)
                                .background(provider == item ? Theme.ink : Theme.card,
                                            in: Capsule())
                                .overlay(Capsule().stroke(provider == item ? .clear : Theme.line, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .scrollClipDisabled()
            TextField("输入自定义服务商…保存后自动记入预设", text: $providerCustom)
                .font(Theme.body(13))
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 12)
                .frame(height: 44)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous).stroke(Theme.line, lineWidth: 1))
                .onChange(of: providerCustom) { _, newValue in
                    if !newValue.isEmpty { provider = "" }
                }
        }
        .padding(.bottom, 4)
    }

    @ViewBuilder
    private var accountRow: some View {
        OrderFormRow(label: "账号归属") {
            Menu {
                Button("未指定") {
                    accountId = nil
                    accountTouched = true
                }
                ForEach(model.accounts) { account in
                    Button(account.name) {
                        accountId = account.id
                        accountTouched = true
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    if let account = model.account(displayAccountId) {
                        AccountBadge(account: account)
                    } else {
                        Chip(text: "未指定")
                    }
                    Image(systemName: "chevron.up.chevron.down")
                        .font(Theme.body(10, weight: .bold))
                        .foregroundStyle(Theme.sub)
                }
            }
        }
    }

    /// 账号行展示用：新建时先显示默认归属，避免一进来就是「未指定」。
    private var displayAccountId: Int? {
        if model.isMultiAccount {
            if accountTouched { return accountId }
            if let filter = model.accountFilter, model.account(filter) != nil { return filter }
            return accountId ?? model.accounts.first?.id
        }
        return model.accounts.first?.id
    }

    private var moneyHelp: some View {
        Text(moneyHelpText)
            .font(Theme.body(11))
            .foregroundStyle(Theme.sub)
            .lineLimit(3)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 6)
            .padding(.bottom, 2)
    }

    /// 隐私模式下不显示金额原文（与 Web 编辑表单一致：留空 + 占位符，取值回落到原值）。
    /// 新建单不受隐私模式影响（与 Web 的 openNew 一致：新建表单的金额输入始终可填）。
    private var priceBinding: Binding<String> {
        Binding(get: { (isEditing && model.privacyHidden) ? "" : priceText },
                set: { priceText = $0 })
    }

    private var depositBinding: Binding<String> {
        Binding(get: { (isEditing && model.privacyHidden) ? "" : depositText },
                set: { depositText = $0 })
    }

    /// 已有收款记录或隐私模式下，总价与定金不可改（与 Web 编辑表单同口径；新建单不受限制）。
    private var moneyLocked: Bool {
        guard let order else { return false }
        return model.privacyHidden || Logic.hasAnyReceipt(order, payments: model.payments)
    }

    private var moneyHelpText: String {
        if isEditing && model.privacyHidden {
            return "隐私模式已隐藏金额：总价与定金暂不可查看、不可修改，关掉隐私模式后再编辑。"
        }
        if isEditing && order.map({ Logic.hasAnyReceipt($0, payments: model.payments) }) == true {
            return "已有收款记录或已收标记，不能修改总价和定金；请先撤销错误收款再改。"
        }
        return "金额最多两位小数，定金不能超过总价；支持 0 元无定金。"
    }

    /// 收款记录：撤销 / 补记（对应 Web 编辑表单的 e-payments 区块）。
    @ViewBuilder
    private var receiptSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("收款记录 · 可撤销 / 补记")
            if let order {
                let deposits = Logic.unDep(order, payments: model.payments)
                let finals = Logic.unFin(order, payments: model.payments)
                HStack(spacing: 9) {
                    receiptButton(kind: "定金", due: deposits)
                    receiptButton(kind: "尾款", due: finals)
                }
                Text("补记前请先保存修改。撤销仅用于纠正错误收款，会同时移除对应流水。")
                    .font(Theme.body(10.5))
                    .foregroundStyle(Theme.sub)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// 撤销某笔收款前二次确认（与 Web 版 confirm 同口径）。
    private func receiptButton(kind: String, due: Double) -> some View {
        let received = order.map { Logic.hasReceipt($0, kind: kind, payments: model.payments) } ?? false
        let title = received ? "撤销\(kind)记录" : "补记\(kind)已收"
        let tint: Color = received ? Theme.sub : (kind == "定金" ? Theme.blue : Theme.green)
        return Button {
            guard let order else { return }
            if received {
                revokeTarget = (order.id, kind)
            } else {
                // Web 版：有未保存的修改时不允许补记（先保存再补记）。
                if draftFingerprint != initialFingerprint {
                    fail("有未保存的修改，请先保存，再补记收款")
                    return
                }
                Task {
                    await model.toggleReceipt(orderId: order.id, kind: kind)
                    model.showToast("已补记\(kind)")
                }
            }
        } label: {
            Text(title)
                .font(Theme.body(12.5, weight: .bold))
                .foregroundStyle(tint)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous).stroke(Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(due <= 0 && !received)
        .opacity(due <= 0 && !received ? 0.45 : 1)
    }

    /// 当前表单内容的指纹：用来判断「有未保存的修改」（与 Web 版 editDraft 同思路）。
    private var draftFingerprint: String {
        OrderFormView.fingerprint(store: store,
                                  cat: cat,
                                  contact: contact,
                                  settleVia: settleVia,
                                  priceText: priceText,
                                  depositText: depositText,
                                  appt: Format.localString(combinedAppointment),
                                  provider: provider,
                                  providerCustom: providerCustom,
                                  partner: partner,
                                  location: location,
                                  note: note,
                                  reviewResult: reviewResult,
                                  needMain: needMain,
                                  needSub: needSub,
                                  accountId: accountId)
    }

    // MARK: - 排期冲突（只提示，不拦截保存）

    private var conflictBanner: some View {
        let overlap = Logic.apptOverlap(orders: model.orders,
                                        date: Format.dayString(apptDay),
                                        time: appointmentTimeText,
                                        excludeId: order?.id)
        let list = overlap.overlap.isEmpty ? overlap.same : overlap.overlap
        return Group {
            if list.isEmpty {
                EmptyView()
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    Text(overlap.overlap.isEmpty
                         ? "当天已有 \(overlap.same.count) 个排期:"
                         : "该时段已有排期(前后 2 小时内):")
                        .font(Theme.body(11.5, weight: .bold))
                    ForEach(list, id: \.id) { other in
                        Text("· \(Format.fmtHM(other.appt)) 「\(other.store)」" + conflictPlace(other))
                            .font(Theme.body(11.5))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if !overlap.overlap.isEmpty {
                        Text("不影响保存——可找人代拍或错峰。")
                            .font(Theme.body(11.5, weight: .semibold))
                    }
                }
                .foregroundStyle(Theme.orange)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.orangeSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Theme.orange.opacity(0.14), lineWidth: 1))
                .padding(.top, 13)
            }
        }
    }

    private func conflictPlace(_ other: Order) -> String {
        let place = other.location.trimmingCharacters(in: .whitespaces)
        if !place.isEmpty { return " · \(place)" }
        let gps = GeoStore.label(other.gpsPlace)
        return gps.isEmpty ? "" : " · \(gps)"
    }

    // MARK: - 保存

    private func save() {
        let trimmedStore = store.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedStore.isEmpty else {
            fail("请填写商家名称")
            return
        }

        let priceSource = (isEditing && model.privacyHidden)
            ? OrderFormView.plainNumber(order?.price ?? 0)
            : priceText
        let depositSource = (isEditing && model.privacyHidden)
            ? OrderFormView.plainNumber(order?.deposit ?? 0)
            : depositText
        let priceCents = OrderFormView.parseMoney(priceSource)
        let depositCents = OrderFormView.parseMoney(depositSource, blankZero: true)
        guard let priceCents, let depositCents, depositCents <= priceCents else {
            fail("总价和定金须为有效非负金额，最多两位小数，定金不能超过总价")
            return
        }

        let needMainValue = needMain
        let needSubValue = needSub
        guard needMainValue || needSubValue else {
            fail("出片要求至少要勾选正片或副片")
            return
        }

        guard ["private", "douyin"].contains(settleVia) else {
            fail("请选择有效的结算方式")
            return
        }

        let appt = Format.localString(combinedAppointment)
        guard Logic.validDateTime(appt) else {
            fail("请填写有效的预约日期和时间")
            return
        }

        let existing = order
        if let existing, Logic.hasAnyReceipt(existing, payments: model.payments) {
            let samePrice = OrderFormView.parseMoney(OrderFormView.plainNumber(existing.price)) == priceCents
            let sameDeposit = OrderFormView.parseMoney(OrderFormView.plainNumber(existing.deposit)) == depositCents
            if !samePrice || !sameDeposit {
                fail("已有收款记录，请先撤销错误收款，再修改总价或定金")
                return
            }
        }

        let channel = resolvedProvider
        let targetAccount = resolvedAccountId

        Task {
            if let existing {
                var updated = existing
                updated.store = trimmedStore
                updated.cat = cat
                updated.contact = contact.trimmingCharacters(in: .whitespacesAndNewlines)
                updated.price = Double(priceCents) / 100
                updated.deposit = Double(depositCents) / 100
                updated.appt = appt
                updated.settleVia = settleVia
                updated.channel = channel
                updated.partner = partner.trimmingCharacters(in: .whitespacesAndNewlines)
                updated.location = location.trimmingCharacters(in: .whitespacesAndNewlines)
                updated.deliverMain = needMainValue
                updated.deliverSub = needSubValue
                updated.accountId = targetAccount
                updated.note = note.trimmingCharacters(in: .whitespacesAndNewlines)
                updated.reviewResult = reviewResult
                // 改回私收时清掉平台预计到账日（与 Web 同口径）
                if settleVia != "douyin" { updated.expectPayAt = nil }
                // 平台单不催收；尾款已结清也不该再提醒
                if settleVia == "douyin" || Logic.unFin(updated, payments: model.payments) <= 0 {
                    updated.remindAt = nil
                }
                await model.saveOrder(updated)
            } else {
                let created = Order(id: model.nextOrderId(),
                                    store: trimmedStore,
                                    cat: cat,
                                    contact: contact.trimmingCharacters(in: .whitespacesAndNewlines),
                                    price: Double(priceCents) / 100,
                                    deposit: Double(depositCents) / 100,
                                    appt: appt,
                                    settleVia: settleVia,
                                    channel: channel,
                                    partner: partner.trimmingCharacters(in: .whitespacesAndNewlines),
                                    location: location.trimmingCharacters(in: .whitespacesAndNewlines),
                                    deliverMain: needMainValue,
                                    deliverSub: needSubValue,
                                    accountId: targetAccount,
                                    note: note.trimmingCharacters(in: .whitespacesAndNewlines))
                await model.saveOrder(created)
            }

            if !channel.isEmpty && !model.providerList.contains(channel) {
                await model.rememberProvider(channel)
            }
            model.showToast(isEditing ? "已保存修改" : "已添加预约:\(trimmedStore)")
            dismiss()
            onSaved?()
        }
    }

    private func fail(_ message: String) {
        errorText = message
    }

    // MARK: - 派生

    /// 日期 + 时间合并成一个 Date。
    private var combinedAppointment: Date {
        let calendar = Calendar.current
        var components = calendar.dateComponents([.year, .month, .day], from: apptDay)
        let time = calendar.dateComponents([.hour, .minute], from: apptTime)
        components.hour = time.hour
        components.minute = time.minute
        return calendar.date(from: components) ?? apptDay
    }

    /// 'HH:mm'（排期重叠判定用）。
    private var appointmentTimeText: String {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: apptTime)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }

    /// 服务商：预设点选优先，其次自定义输入，空则回落「直客」。
    private var resolvedProvider: String {
        let custom = providerCustom.trimmingCharacters(in: .whitespacesAndNewlines)
        if !custom.isEmpty { return custom }
        let picked = provider.trimmingCharacters(in: .whitespacesAndNewlines)
        return picked.isEmpty ? "直客" : picked
    }

    /// 账号归属：多账号可选（含「未指定」）；单账号自动归属；无账号则未指定。
    ///
    /// 新建单默认落在当前账号筛选上（与 Web 版 openNew 的默认口径一致），
    /// 筛选无效时回落到首个账号；用户显式选过「未指定」后不再被兜底。
    private var resolvedAccountId: Int? {
        if model.isMultiAccount {
            if accountTouched { return accountId }
            if let filter = model.accountFilter, model.account(filter) != nil { return filter }
            return accountId ?? model.accounts.first?.id
        }
        return model.accounts.first?.id
    }

    // MARK: - 静态工具

    /// 表单内容指纹（用于「有未保存的修改」判定）。
    static func fingerprint(store: String, cat: String, contact: String, settleVia: String,
                            priceText: String, depositText: String, appt: String,
                            provider: String, providerCustom: String, partner: String,
                            location: String, note: String, reviewResult: String,
                            needMain: Bool, needSub: Bool, accountId: Int?) -> String {
        [store, cat, contact, settleVia, priceText, depositText, appt,
         provider, providerCustom, partner, location, note, reviewResult,
         needMain ? "1" : "0", needSub ? "1" : "0",
         accountId.map(String.init) ?? "-"].joined(separator: "\u{1}")
    }

    /// 日期 + 时间合并成一个 Date（与 combinedAppointment 同口径）。
    static func combine(day: Date, time: Date) -> Date {
        let calendar = Calendar.current
        var components = calendar.dateComponents([.year, .month, .day], from: day)
        let parts = calendar.dateComponents([.hour, .minute], from: time)
        components.hour = parts.hour
        components.minute = parts.minute
        return calendar.date(from: components) ?? day
    }

    private static let categories = ["餐饮", "咖啡", "烧烤", "火锅", "茶饮", "甜品", "烘焙",
                                     "美发", "健身", "民宿", "零售", "体验馆", "露营", "服饰",
                                     "快餐", "其他"]

    /// 类型选项：预设列表 + 订单里已有的自定义类型（与 Web 编辑表单同口径）。
    private var categoryOptions: [String] {
        var list = OrderFormView.categories
        let current = cat.trimmingCharacters(in: .whitespacesAndNewlines)
        if !current.isEmpty && !list.contains(current) {
            list.insert(current, at: 0)
        }
        return list
    }

    /// 金额字符串（不带千分位、不带多余小数位）。
    static func plainNumber(_ value: Double) -> String {
        if value == value.rounded() && abs(value) < 1e15 {
            return String(Int(value))
        }
        return String(format: "%.2f", value)
    }

    /// 金额解析：与 Web 版 `moneyCents` 同口径（只允许数字、最多两位小数）。
    static func parseMoney(_ text: String, blankZero: Bool = false) -> Int? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return blankZero ? 0 : nil }
        guard trimmed.range(of: #"^\d+(\.\d{1,2})?$"#, options: .regularExpression) != nil else { return nil }
        guard let value = Double(trimmed) else { return nil }
        return Logic.moneyCents(value)
    }

    private static func defaultDay() -> Date {
        Calendar.current.startOfDay(for: Date())
    }

    private static func defaultTime() -> Date {
        var components = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        components.hour = 10
        components.minute = 0
        return Calendar.current.date(from: components) ?? Date()
    }
}

// MARK: - 表单行

/// 表单行：左标签右输入（对应 Web 版 .frow）。
private struct OrderFormRow<Content: View>: View {
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
        }
        .padding(.vertical, 6)
        .frame(minHeight: 56)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.line).frame(height: 1)
        }
    }
}

/// 复选项（对应 Web 版 .check-opt）。
private struct OrderCheckOption: View {
    let title: String
    @Binding var isOn: Bool

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            HStack(spacing: 7) {
                Image(systemName: isOn ? "checkmark.square.fill" : "square")
                    .font(Theme.body(15))
                    .foregroundStyle(isOn ? Theme.brand : Theme.sub)
                Text(title)
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.ink)
            }
            .frame(minHeight: 44)
        }
        .buttonStyle(.plain)
    }
}
