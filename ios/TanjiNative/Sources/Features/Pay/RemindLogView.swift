import SwiftUI

/// 记一次催收跟进（不含金额的沟通痕迹）。
///
/// 对应 Web 版 `src/app/order-actions.js` 的 `openRemind` / `saveRemind`
/// 与 `www/index.html` 的 `#sheet-remind`：
///   说明行 → 快速记录 chips → 对方答复输入框 → 说明文案 →「记下这次跟进」。
///
/// 与 Web 版口径一致：只记「什么时候问的、对方怎么答」，不带金额；
/// 跟进痕迹上限 50 条（超出时最早一条被挤出），时间自动取现在。
struct RemindLogView: View {
    let order: Order
    var onSaved: (() -> Void)?

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var note = ""

    /// Web 版的快捷回复文案（`REMIND_QUICK`）。
    private static let quickReplies = ["说这周给", "说月底统一结", "财务走流程", "没回复/不接", "已转对公", "说拍完再结"]

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    PaySheetHeader(title: "记一次催收跟进") {
                        dismiss()
                    }

                    summary
                        .padding(.horizontal, 20)

                    quickSection
                        .padding(.horizontal, 20)

                    PayFormRow(label: "对方答复") {
                        TextField("如：财务走流程，15 号打款", text: $note)
                            .multilineTextAlignment(.trailing)
                            .font(Theme.body(14))
                            .foregroundStyle(Theme.ink)
                            .onChange(of: note) { _, newValue in
                                if newValue.count > 200 {
                                    note = String(newValue.prefix(200))
                                }
                            }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 9)

                    Text("只记「什么时候问的、对方怎么答」，不含金额。想几天后再提醒，记完可用详情页的 1 / 3 / 7 天按钮。")
                        .font(Theme.body(10.5))
                        .foregroundStyle(Theme.sub)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 20)
                        .padding(.top, 11)

                    PrimaryButton(title: "记下这次跟进") {
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

    // MARK: - 说明行

    private var summary: some View {
        RowItem(title: order.store,
                subtitle: summaryText,
                titleColor: Theme.ink,
                leading: {
                    Chip(text: "催收", ink: Theme.brandInk, background: Theme.brandSoft)
                },
                trailing: {
                    EmptyView()
                })
    }

    /// 「哪一单」+ 当前欠款天数 + 已催次数（Web 口径：只显示单子与天数，不显示金额）。
    private var summaryText: String {
        var parts: [String] = [daysText]
        let log = Logic.remindLogOf(order)
        if log.isEmpty {
            parts.append("还没催过")
        } else {
            let count = log.count >= 50 ? "50+" : "\(log.count)"
            parts.append("已催 \(count) 次，最近 \(Format.fmtDT(Logic.lastRemind(order)?.at))")
        }
        parts.append("记录时间自动取现在")
        return parts.joined(separator: " · ")
    }

    /// 欠款天数：私收单从拍摄日起算；平台单不催收。
    private var daysText: String {
        let shot = order.shotAt ?? ""
        if shot.isEmpty { return "未拍摄 · 尚未起算账期" }
        let days = Logic.overdueDays(order, payments: model.payments)
        return "欠款 \(days) 天"
    }

    // MARK: - 快速记录

    private var quickSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("快速记录")
                .font(Theme.body(10, weight: .heavy))
                .tracking(1.3)
                .foregroundStyle(Theme.sub)
                .padding(.bottom, 8)
            PayFlowLayout(spacing: 8) {
                ForEach(Self.quickReplies, id: \.self) { item in
                    Button {
                        note = item
                    } label: {
                        Text(item)
                            .font(Theme.body(11.5, weight: .bold))
                            .foregroundStyle(note == item ? Theme.card : Theme.ink2)
                            .padding(.horizontal, 15)
                            .padding(.vertical, 10)
                            .background(note == item ? Theme.ink : Theme.card, in: Capsule())
                            .overlay(Capsule().stroke(note == item ? .clear : Theme.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.top, 16)
    }

    // MARK: - 保存

    private func save() {
        // Web 版允许留空：留空就记一条「已催」，详情页按「已催」显示。
        let trimmed = String(note.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
        // 追加前先取条数：封顶 50 条之后 length 不再增长，事后读会把「第 51 次」报成「第 50 次」。
        let seq = Logic.remindLogOf(order).count
        let capped = seq >= 50

        Task {
            await model.addRemindEntry(orderId: order.id, note: trimmed)
            model.showToast(capped
                            ? "已记录 · 最早一条已被挤出，只保留最近 50 次 · \(trimmed)"
                            : "已记录第 \(seq + 1) 次催收 · \(trimmed)")
            dismiss()
            onSaved?()
        }
    }
}
