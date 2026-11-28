import SwiftUI

/// 确认收款（金额可改）。
///
/// 对应 Web 版 `src/app/order-actions.js` 的 `openPay` + `www/index.html` 的 `#sheet-pay`：
///   抬头金额 → 收款方式 → 确认收款。
///
/// 原生版在 Web 弹层之上补了三项（Web 那边没有，但收款本身需要）：
///   - 金额可改（默认填该单待收额，且不允许超过待收额）；
///   - 到账时间可选（默认现在）；
///   - 备注可选。
///
/// 保存：`await model.addPayment(Payment(oid:kind:amount:at:method:note:))` → 关闭弹层 → `onSaved?()`。
struct PaymentFormView: View {
    let order: Order
    var kind: String
    var onSaved: (() -> Void)?

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var amountText: String
    @State private var method: String
    @State private var paidAt: Date
    @State private var note: String
    @State private var errorText: String?

    init(order: Order, kind: String, onSaved: (() -> Void)? = nil) {
        self.order = order
        self.kind = kind
        self.onSaved = onSaved

        // 弹层只在「该笔还有待收金额」时打开，所以名义金额就是待收金额。
        let nominal = kind == "定金" ? order.deposit : max(0, order.price - order.deposit)
        _amountText = State(initialValue: PaymentFormView.plainNumber(nominal))
        _method = State(initialValue: order.settleVia == "douyin" ? "抖音商单" : "微信")
        _paidAt = State(initialValue: Date())
        _note = State(initialValue: "")
        _errorText = State(initialValue: nil)
    }

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    PaySheetHeader(title: "确认收款") {
                        dismiss()
                    }

                    hero
                        .padding(.horizontal, 20)
                        .padding(.bottom, 18)

                    VStack(alignment: .leading, spacing: 0) {
                        PayFormRow(label: "订单商家") {
                            Text(order.store)
                                .font(Theme.body(14, weight: .semibold))
                                .foregroundStyle(Theme.ink)
                                .lineLimit(1)
                        }
                        PayFormRow(label: "待收金额") {
                            MoneyText(value: dueAmount,
                                      masked: model.privacyHidden,
                                      font: Theme.body(14, weight: .bold),
                                      color: Theme.orange)
                        }
                        PayFormRow(label: "本次金额") {
                            TextField(model.privacyHidden ? "¥✱✱✱" : "0.00", text: $amountText)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .font(Theme.body(14))
                                .foregroundStyle(Theme.ink)
                                .disabled(model.privacyHidden)
                        }
                        PayFormRow(label: "到账时间") {
                            HStack(spacing: 10) {
                                DatePicker("日期", selection: $paidAt, displayedComponents: .date)
                                    .labelsHidden()
                                    .datePickerStyle(.compact)
                                    .tint(Theme.ink)
                                DatePicker("时间", selection: $paidAt, displayedComponents: .hourAndMinute)
                                    .labelsHidden()
                                    .datePickerStyle(.compact)
                                    .tint(Theme.ink)
                            }
                        }
                        PayFormRow(label: "备注") {
                            TextField("如：微信转账，已确认到账", text: $note)
                                .multilineTextAlignment(.trailing)
                                .font(Theme.body(13))
                                .foregroundStyle(Theme.ink)
                        }
                    }
                    .padding(.horizontal, 20)

                    methodSection
                        .padding(.horizontal, 20)

                    Text("记一笔，不会自动转账；金额不能超过该单待收额。")
                        .font(Theme.body(10.5))
                        .foregroundStyle(Theme.sub)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 20)
                        .padding(.top, 11)

                    if let errorText {
                        Text(errorText)
                            .font(Theme.body(11.5))
                            .foregroundStyle(Theme.red)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 20)
                            .padding(.top, 9)
                    }

                    PrimaryButton(title: "确认收款 \(Format.fmtMoney(displayAmount, masked: model.privacyHidden))",
                                 tint: Theme.green) {
                        save()
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 18)
                    .padding(.bottom, 30)
                }
            }
        }
        // 弹层自己的提示条宿主：这一层是 sheet，根层的提示条会被盖住。
        .toastHost()
    }

    // MARK: - 抬头金额

    private var hero: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("\(kind) / 本次入账")
                .font(Theme.body(9.5, weight: .heavy))
                .tracking(1.5)
                .foregroundStyle(Theme.card.opacity(0.58))
            MoneyText(value: displayAmount,
                      masked: model.privacyHidden,
                      font: Theme.display(38),
                      color: Theme.card)
                .padding(.top, 9)
                .padding(.bottom, 8)
            Text("\(order.store) · \(order.settleVia == "douyin" ? "约定抖音商单结算" : "私收款项") · 仅作入账记录")
                .font(Theme.body(11))
                .foregroundStyle(Theme.card.opacity(0.66))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(19)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.ink, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: Theme.ink.opacity(0.16), radius: 16, y: 8)
    }

    // MARK: - 收款方式

    private var methodSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text("收款方式")
                    .font(Theme.body(13, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                Text("记一笔，不会自动转账")
                    .font(Theme.body(11))
                    .foregroundStyle(Theme.sub)
            }
            .padding(.top, 18)
            .padding(.bottom, 4)

            PayFlowLayout(spacing: 8) {
                ForEach(Payment.methods, id: \.self) { item in
                    Button {
                        method = item
                    } label: {
                        Text(item)
                            .font(Theme.body(12.5, weight: .bold))
                            .foregroundStyle(method == item ? Theme.card : Theme.ink2)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 11)
                            .background(method == item ? Theme.ink : Theme.card, in: Capsule())
                            .overlay(Capsule().stroke(method == item ? .clear : Theme.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - 派生

    /// 该笔（定金 / 尾款）当前待收金额。
    private var dueAmount: Double {
        kind == "定金"
            ? Logic.unDep(order, payments: model.payments)
            : Logic.unFin(order, payments: model.payments)
    }

    /// 输入框里的金额（非法时回落到待收额）。
    private var displayAmount: Double {
        guard let cents = PaymentFormView.parseAmount(amountText), cents > 0 else { return dueAmount }
        return Double(cents) / 100
    }

    // MARK: - 保存

    private func save() {
        guard let cents = PaymentFormView.parseAmount(amountText), cents > 0 else {
            errorText = "金额必须是大于 0 的数字，最多两位小数"
            return
        }
        let dueCents = Int((dueAmount * 100).rounded())
        guard cents <= dueCents else {
            errorText = "金额不能超过该单待收 \(Format.fmtMoney(dueAmount, masked: model.privacyHidden))"
            return
        }
        let at = Format.localString(paidAt)
        guard Logic.validDateTime(at) else {
            errorText = "请填写有效的到账时间"
            return
        }

        let amount = Double(cents) / 100
        let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let payment = Payment(oid: order.id,
                              kind: kind,
                              amount: amount,
                              at: at,
                              method: method,
                              note: trimmedNote.isEmpty ? nil : trimmedNote)

        Task {
            await model.addPayment(payment)
            if kind == "尾款" {
                // 尾款收齐：这张单不该再被提醒催收（与 Web 版 pay() 里的 clearSnooze 同口径）。
                await model.clearRemind(orderId: order.id)
            }
            model.showToast("已收\(kind) \(Format.fmtMoney(amount, masked: model.privacyHidden)) · \(method)")
            dismiss()
            onSaved?()
        }
    }

    // MARK: - 静态工具

    /// 金额字符串（不带千分位、不带多余小数位）。
    static func plainNumber(_ value: Double) -> String {
        if value == value.rounded() && abs(value) < 1e15 {
            return String(Int(value))
        }
        return String(format: "%.2f", value)
    }

    /// 金额解析：只允许数字、最多两位小数；非法或非正返回 nil。
    static func parseAmount(_ text: String) -> Int? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        guard trimmed.range(of: #"^\d+(\.\d{1,2})?$"#, options: .regularExpression) != nil else { return nil }
        guard let value = Double(trimmed), value > 0 else { return nil }
        return Logic.moneyCents(value)
    }
}
