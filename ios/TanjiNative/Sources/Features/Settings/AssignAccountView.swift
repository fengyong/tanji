import SwiftUI

/// 批量把未指定账号的订单改挂到某个账号。
///
/// 复刻 Web 版 `sheet-assign`（`src/app/actions.js` 的 `assign-open` / `assign-run`）：
/// 列出账号（带各自单数），选中后「改挂全部未指定订单」。
struct AssignAccountView: View {
    var onSaved: (() -> Void)?

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var selectedId: Int?

    private var unassignedCount: Int {
        model.orders.filter { $0.accountId == nil }.count
    }

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    VStack(alignment: .leading, spacing: 0) {
                        Text("把未指定账号的历史订单一并归位。个别挂错的，之后可在订单编辑里单独修改。")
                            .font(Theme.body(10.5))
                            .foregroundStyle(Theme.sub)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 2)
                            .padding(.bottom, 11)
                        VStack(spacing: 9) {
                            ForEach(model.accounts) { account in
                                accountOption(account)
                            }
                        }
                        if unassignedCount == 0 {
                            EmptyState(title: "没有未指定的订单",
                                       subtitle: "所有订单都已经挂上账号了")
                            .padding(.top, 10)
                        }
                        PrimaryButton(title: "改挂全部未指定订单") {
                            run()
                        }
                        .padding(.top, 18)
                        .disabled(unassignedCount == 0 || selectedId == nil)
                        .opacity(unassignedCount == 0 || selectedId == nil ? 0.5 : 1)
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 34)
                }
            }
        }
        // 弹层自己的提示条宿主：这一层是 sheet，根层的提示条会被盖住。
        .toastHost()
        .onAppear {
            // 默认选中第一个账号（与 Web 版 assign-open 同口径）。
            if selectedId == nil {
                selectedId = model.accounts.first?.id
            }
        }
    }

    // MARK: - 顶栏

    private var header: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("批量改挂订单")
                    .font(Theme.display(20))
                    .foregroundStyle(Theme.ink)
                Text("待改挂 \(unassignedCount) 笔")
                    .font(Theme.body(11))
                    .foregroundStyle(unassignedCount > 0 ? Theme.orange : Theme.sub)
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

    // MARK: - 账号选项

    private func accountOption(_ account: Account) -> some View {
        let selected = selectedId == account.id
        let swatch = AccountPalette.swatch(account.color)
        let count = model.orders.filter { $0.accountId == account.id }.count
        return Button {
            selectedId = selected ? nil : account.id
        } label: {
            HStack(spacing: 10) {
                Circle()
                    .strokeBorder(selected ? Theme.brand : Color(hex: "#B9BDB5"), lineWidth: 2)
                    .frame(width: 19, height: 19)
                    .overlay {
                        if selected {
                            Circle()
                                .inset(by: 3)
                                .fill(Theme.brand)
                        }
                    }
                AccountAvatar(account: account, size: 30)
                Text(account.name)
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Text("\(count) 单")
                    .font(Theme.body(11))
                    .foregroundStyle(Theme.sub)
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 12)
            .background(selected ? swatch.background : Theme.card,
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(selected ? swatch.ink : Theme.line, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - 执行

    private func run() {
        guard let id = selectedId, let account = model.account(id) else {
            model.showToast("先选一个账号")
            return
        }
        let count = unassignedCount
        guard count > 0 else {
            model.showToast("没有未指定的订单")
            return
        }
        Task {
            await model.assignUnassigned(to: id)
            model.showToast("已把 \(count) 笔订单改挂到「\(account.name)」")
            dismiss()
            onSaved?()
        }
    }
}
