import SwiftUI

/// 平台单（抖音商单）预计到账日。
///
/// 对应 Web 版 `src/app/order-actions.js` 的 `openExpect` / `saveExpect` / `clearExpect`
/// 与 `www/index.html` 的 `#sheet-expect`：
///   说明行 → 到账日期 → 说明文案 →「保存预计到账日」（可清除）。
///
/// 与 Web 版同口径：保存成 'YYYY-MM-DDT10:00'（当天上午 10 点），
/// 这样 `Logic.expectOverdue` 的超期天数判定与 Web 完全一致。
struct ExpectPayView: View {
    let order: Order
    var onSaved: (() -> Void)?

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var day: Date
    @State private var errorText: String?

    init(order: Order, onSaved: (() -> Void)? = nil) {
        self.order = order
        self.onSaved = onSaved
        let parsed = order.expectPayAt.flatMap { Format.parseLocal($0) ?? Format.parseDay($0) }
        _day = State(initialValue: parsed ?? Calendar.current.startOfDay(for: Date()))
        _errorText = State(initialValue: nil)
    }

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    PaySheetHeader(title: "平台预计到账日") {
                        dismiss()
                    }

                    summary
                        .padding(.horizontal, 20)

                    PayFormRow(label: "到账日期") {
                        DatePicker("到账日期", selection: $day, displayedComponents: .date)
                            .labelsHidden()
                            .datePickerStyle(.compact)
                            .tint(Theme.ink)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 14)

                    quickSection
                        .padding(.horizontal, 20)

                    Text("把约定日期落下来。到期还未到账时，详情和收款页会标红提醒你查看平台结算状态。")
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

                    PrimaryButton(title: "保存预计到账日") {
                        save()
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 18)

                    if order.expectPayAt != nil {
                        GhostButton(title: "清除预计到账日", tint: Theme.sub) {
                            clear()
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 9)
                    }

                    Spacer(minLength: 0)
                        .frame(height: 30)
                }
            }
        }
        // 弹层自己的提示条宿主：这一层是 sheet，根层的提示条会被盖住。
        .toastHost()
    }

    // MARK: - 说明行

    private var summary: some View {
        RowItem(title: order.store,
                subtitle: "抖音商单，尾款 \(Format.fmtMoney(Logic.unFin(order, payments: model.payments), masked: model.privacyHidden)) 由平台结算",
                titleColor: Theme.ink,
                leading: {
                    Chip(text: "平台结算", ink: Theme.blue, background: Theme.blueSoft)
                },
                trailing: {
                    EmptyView()
                })
    }

    // MARK: - 快捷日期

    /// 快捷选项：今天 / 明天 / 3 天后 / 7 天后。
    private var quickSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("快捷选择")
                .font(Theme.body(10, weight: .heavy))
                .tracking(1.3)
                .foregroundStyle(Theme.sub)
                .padding(.bottom, 8)
            PayFlowLayout(spacing: 8) {
                ForEach(Self.quickOffsets, id: \.self) { offset in
                    Button {
                        day = Calendar.current.date(byAdding: .day, value: offset, to: Date()) ?? Date()
                    } label: {
                        Text(Self.quickTitle(offset))
                            .font(Theme.body(11.5, weight: .bold))
                            .foregroundStyle(Theme.ink2)
                            .padding(.horizontal, 15)
                            .padding(.vertical, 10)
                            .background(Theme.card, in: Capsule())
                            .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.top, 16)
    }

    private static let quickOffsets = [0, 1, 3, 7]

    private static func quickTitle(_ offset: Int) -> String {
        switch offset {
        case 0: return "今天"
        case 1: return "明天"
        default: return "\(offset) 天后"
        }
    }

    // MARK: - 保存 / 清除

    private func save() {
        let value = "\(Format.dayString(day))T10:00"
        guard Logic.validDateTime(value) else {
            errorText = "先选一个有效的到账日期"
            return
        }
        Task {
            await model.setExpectPayAt(orderId: order.id, value: value)
            model.showToast("已记下预计 \(Format.fmtD(value)) 到账")
            dismiss()
            onSaved?()
        }
    }

    private func clear() {
        Task {
            await model.setExpectPayAt(orderId: order.id, value: nil)
            model.showToast("已清除预计到账日")
            dismiss()
            onSaved?()
        }
    }
}
