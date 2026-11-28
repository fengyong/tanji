import SwiftUI

// MARK: - 页面骨架

/// 页面底：暖纸色 + 两团柔光。
struct ScreenBackground: View {
    var body: some View {
        ZStack {
            Theme.paper
            RadialGradient(colors: [.white.opacity(0.7), .clear],
                           center: .init(x: 0.12, y: 0.08), startRadius: 8, endRadius: 320)
            RadialGradient(colors: [Color(hex: "#B6C5B0").opacity(0.32), .clear],
                           center: .init(x: 0.88, y: 0.85), startRadius: 8, endRadius: 340)
        }
        .ignoresSafeArea()
    }
}

/// 页面顶部：眉题 + 大标题 + 副标题 + 右侧动作区。
struct AppHeader<Trailing: View>: View {
    let eyebrow: String
    let title: String
    var subtitle: String?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .bottom, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(eyebrow.uppercased())
                    .font(Theme.body(10, weight: .heavy))
                    .tracking(1.8)
                    .foregroundStyle(Theme.sub)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                Text(title)
                    .font(Theme.display(34))
                    .foregroundStyle(Theme.ink)
                if let subtitle {
                    Text(subtitle)
                        .font(Theme.body(12))
                        .foregroundStyle(Theme.sub)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            trailing
        }
        .padding(.bottom, 16)
        // 顶栏高度上报给提示条：提示条落在这里下方，不压大标题。
        .toastTopAnchor()
    }
}

/// 分区标题。
struct SectionTitle<Trailing: View>: View {
    let text: String
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 8) {
            Text(text)
                .font(Theme.body(12, weight: .heavy))
                .foregroundStyle(Theme.ink)
            Spacer(minLength: 0)
            trailing
        }
        .padding(.top, 20)
        .padding(.bottom, 10)
        .padding(.horizontal, 2)
    }
}

extension SectionTitle where Trailing == EmptyView {
    init(_ text: String) { self.init(text: text) { EmptyView() } }
}

/// 卡片容器。
struct CardBox<Content: View>: View {
    var padding: CGFloat = 15
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                    .stroke(Theme.line, lineWidth: 1)
            )
            .shadow(color: Theme.shadow, radius: 14, x: 0, y: 8)
    }
}

// MARK: - 标签与状态

/// 状态小标签。
struct Chip: View {
    let text: String
    var ink: Color = Theme.sub
    var background: Color = Theme.paperDeep
    var font: Font = Theme.body(11, weight: .semibold)

    var body: some View {
        Text(text)
            .font(font)
            .foregroundStyle(ink)
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(background, in: Capsule())
    }
}

extension Chip {
    static func work(_ work: String) -> Chip {
        let tint = Palette.workTint(work)
        return Chip(text: work, ink: tint.0, background: tint.1)
    }

    static func pay(_ pay: String) -> Chip {
        let tint = Palette.payTint(pay)
        return Chip(text: pay, ink: tint.0, background: tint.1)
    }

    static func method(_ method: String) -> Chip {
        let tint = Palette.methodTint(method)
        return Chip(text: method, ink: tint.0, background: tint.1)
    }
}

/// 账号筛选条。
struct AccountFilterBar: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        if model.isMultiAccount {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    filterChip(title: "全部", id: nil)
                    ForEach(model.accounts) { account in
                        filterChip(title: account.name, id: account.id)
                    }
                }
                .padding(.horizontal, 1)
            }
            .scrollClipDisabled()
        }
    }

    @ViewBuilder
    private func filterChip(title: String, id: Int?) -> some View {
        let on = model.accountFilter == id
        let swatch = AccountPalette.swatch(model.account(id)?.color)
        Button {
            model.accountFilter = on && id != nil ? nil : id
        } label: {
            Text(title)
                .font(Theme.body(12, weight: on ? .bold : .semibold))
                .foregroundStyle(on ? Color.white : (id == nil ? Theme.ink : swatch.ink))
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(on ? (id == nil ? Theme.ink : swatch.ink) : (id == nil ? Theme.card : swatch.background),
                            in: Capsule())
                .overlay(Capsule().stroke(on ? .clear : Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - 金额

/// 金额文本：隐私模式下打码。
struct MoneyText: View {
    let value: Double
    var masked: Bool
    var font: Font = Theme.body(15, weight: .bold)
    var color: Color = Theme.ink

    var body: some View {
        Text(Format.fmtMoney(value, masked: masked))
            .font(font)
            .monospacedDigit()
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
    }
}

/// 统计小格。
struct MiniStat: View {
    let value: String
    let label: String
    var valueColor: Color = Theme.ink

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value)
                .font(Theme.body(19, weight: .heavy))
                .monospacedDigit()
                .foregroundStyle(valueColor)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(label)
                .font(Theme.body(10.5))
                .foregroundStyle(Theme.sub)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous).stroke(Theme.line, lineWidth: 1))
    }
}

// MARK: - 按钮

/// 主按钮。
struct PrimaryButton: View {
    let title: String
    var systemImage: String?
    var tint: Color = Theme.ink
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let systemImage {
                    Image(systemName: systemImage).font(Theme.body(13, weight: .bold))
                }
                Text(title).font(Theme.body(14, weight: .bold))
            }
            .foregroundStyle(Theme.card)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(tint, in: RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

/// 次按钮（描边）。
struct GhostButton: View {
    let title: String
    var systemImage: String?
    var tint: Color = Theme.ink
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let systemImage {
                    Image(systemName: systemImage).font(Theme.body(13, weight: .semibold))
                }
                Text(title).font(Theme.body(13, weight: .semibold))
            }
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous).stroke(Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

/// 图标按钮（顶栏用）。
struct IconButton: View {
    let systemName: String
    var active: Bool = false
    var accessibility: String = ""
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(Theme.body(15, weight: .semibold))
                .foregroundStyle(active ? Theme.card : Theme.ink2)
                .frame(width: 44, height: 44)
                .background(active ? Theme.ink : Theme.card.opacity(0.76),
                            in: RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous)
                    .stroke(active ? .clear : Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibility)
    }
}

/// 分段切换（近 7 天 / 近 30 天 / 本月）。
struct SegmentedTabs: View {
    let items: [(String, String)]
    @Binding var selection: String

    var body: some View {
        HStack(spacing: 4) {
            ForEach(items, id: \.0) { item in
                let on = selection == item.0
                Button {
                    selection = item.0
                } label: {
                    Text(item.1)
                        .font(Theme.body(12.5, weight: on ? .bold : .semibold))
                        .foregroundStyle(on ? Theme.card : Theme.ink2)
                        .frame(maxWidth: .infinity)
                        .frame(height: 36)
                        .background(on ? Theme.ink : .clear,
                                    in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(Theme.paperDeep.opacity(0.55), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
    }
}

// MARK: - 行

/// 通用行：标题 + 副标题 + 右侧内容。
struct RowItem<Leading: View, Trailing: View>: View {
    var title: String
    var subtitle: String?
    var titleColor: Color = Theme.ink
    @ViewBuilder var leading: Leading
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 11) {
            leading
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(Theme.body(15, weight: .bold))
                    .foregroundStyle(titleColor)
                    .lineLimit(1)
                if let subtitle {
                    Text(subtitle)
                        .font(Theme.body(11.5))
                        .foregroundStyle(Theme.sub)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            trailing
        }
        .padding(.vertical, 14)
    }
}

/// 账号标识（头像 + 昵称）。
struct AccountBadge: View {
    let account: Account?
    var compact: Bool = false

    var body: some View {
        if let account {
            let swatch = AccountPalette.swatch(account.color)
            HStack(spacing: 5) {
                if let avatar = account.avatar, let image = ImageTools.image(fromDataURL: avatar) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: compact ? 16 : 20, height: compact ? 16 : 20)
                        .clipShape(Circle())
                } else {
                    Text(String(account.name.prefix(1)))
                        .font(Theme.body(compact ? 9 : 11, weight: .bold))
                        .foregroundStyle(swatch.ink)
                        .frame(width: compact ? 16 : 20, height: compact ? 16 : 20)
                        .background(swatch.background, in: Circle())
                }
                if !compact {
                    Text(account.name)
                        .font(Theme.body(11, weight: .semibold))
                        .foregroundStyle(swatch.ink)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, compact ? 0 : 7)
            .padding(.vertical, compact ? 0 : 3)
            .background(compact ? .clear : swatch.background, in: Capsule())
        } else {
            Chip(text: "未指定", ink: Theme.sub, background: Theme.paperDeep)
        }
    }
}

/// 空状态。
struct EmptyState: View {
    let title: String
    var subtitle: String?

    var body: some View {
        VStack(spacing: 6) {
            Text(title)
                .font(Theme.body(13, weight: .semibold))
                .foregroundStyle(Theme.sub)
            if let subtitle {
                Text(subtitle)
                    .font(Theme.body(11.5))
                    .foregroundStyle(Theme.sub.opacity(0.8))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 26)
    }
}

/// 搜索框。
struct SearchField: View {
    @Binding var text: String
    var placeholder: String = "搜索商家、类型、备注"

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: "magnifyingglass")
                .font(Theme.body(13, weight: .semibold))
                .foregroundStyle(Theme.sub)
            TextField(placeholder, text: $text)
                .font(Theme.body(13))
                .foregroundStyle(Theme.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(Theme.body(13))
                        .foregroundStyle(Theme.sub)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 42)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous).stroke(Theme.line, lineWidth: 1))
    }
}

// MARK: - 订单行

/// 订单列表行（订单页 / 收款页 / 搜索结果共用）。
struct OrderRow: View {
    let order: Order
    var account: Account?
    var work: String = ""
    var pay: String = ""
    var price: Double = 0
    var masked: Bool = false
    var footnote: String?
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 11) {
                if let account {
                    AccountBadge(account: account, compact: true)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(order.store)
                        .font(Theme.body(15, weight: .bold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        if !work.isEmpty { Chip.work(work) }
                        if !pay.isEmpty { Chip.pay(pay) }
                        Chip(text: order.cat)
                    }
                    if let footnote {
                        Text(footnote)
                            .font(Theme.body(11.5))
                            .foregroundStyle(Theme.sub)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 3) {
                    MoneyText(value: price, masked: masked, font: Theme.body(15, weight: .heavy))
                    Text("总价")
                        .font(Theme.body(10.5))
                        .foregroundStyle(Theme.sub)
                }
            }
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // 稳定的可访问性标识：订单行按 id 命名，UI 测试与辅助功能都能精确定位到某一行。
        .accessibilityIdentifier("order.row.\(order.id)")
    }
}

/// 首页 / 行程用的紧凑行：左侧预约时间。
struct CompactOrderRow: View {
    let order: Order
    var account: Account?
    var work: String = ""
    var pay: String = ""
    var price: Double = 0
    var masked: Bool = false
    var leading: String?
    var footnote: String?
    var showAccount: Bool = false
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 11) {
                if let leading {
                    Text(leading)
                        .font(Theme.display(17))
                        .foregroundStyle(Theme.brandInk)
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                        .frame(width: 54, alignment: .leading)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(order.store)
                        .font(Theme.body(15, weight: .bold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        if let account, showAccount { AccountBadge(account: account, compact: true) }
                        if !work.isEmpty { Chip.work(work) }
                        if !pay.isEmpty { Chip.pay(pay) }
                    }
                    if let footnote {
                        Text(footnote)
                            .font(Theme.body(11.5))
                            .foregroundStyle(Theme.sub)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                MoneyText(value: price, masked: masked, font: Theme.body(15, weight: .heavy))
            }
            .padding(.vertical, 13)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

