import SwiftUI

/// 横向流式布局：子视图从左到右排布，一行放不下时整体折到下一行。
///
/// 对齐 Web 版 `.chiprow{display:flex;gap:6px;flex-wrap:wrap}` 的口径：
/// 标签行在窄容器（首页「今日拍摄」行右侧同时有金额和「到店打卡」按钮）
/// 里折行，而不是把标签压成省略号、或溢出盖住相邻的金额。
struct WrapLayout: Layout {
    /// 同一行内子视图之间的间距。
    var spacing: CGFloat = 6
    /// 行与行之间的间距。
    var lineSpacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize,
                      subviews: Subviews,
                      cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        let rows = arrange(subviews: subviews, maxWidth: maxWidth)
        let height = rows.reduce(0) { $0 + $1.height }
            + lineSpacing * CGFloat(max(0, rows.count - 1))
        let widest = rows.map(\.width).max() ?? 0
        return CGSize(width: maxWidth.isFinite ? min(widest, maxWidth) : widest,
                      height: height)
    }

    func placeSubviews(in bounds: CGRect,
                       proposal: ProposedViewSize,
                       subviews: Subviews,
                       cache: inout ()) {
        var y = bounds.minY
        for row in arrange(subviews: subviews, maxWidth: bounds.width) {
            var x = bounds.minX
            for item in row.items {
                subviews[item.index].place(at: CGPoint(x: x, y: y),
                                           anchor: .topLeading,
                                           proposal: ProposedViewSize(width: item.size.width,
                                                                     height: item.size.height))
                x += item.size.width + spacing
            }
            y += row.height + lineSpacing
        }
    }

    // MARK: - 内部排布

    private struct Item {
        let index: Int
        let size: CGSize
    }

    private struct Row {
        var items: [Item] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    /// 按 maxWidth 逐个装行：装不下就换到下一行。
    private func arrange(subviews: Subviews, maxWidth: CGFloat) -> [Row] {
        var rows: [Row] = []
        var current = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = current.items.isEmpty
                ? size.width
                : current.width + spacing + size.width
            if !current.items.isEmpty, maxWidth.isFinite, needed > maxWidth {
                rows.append(current)
                current = Row()
            }
            let used = current.items.isEmpty
                ? size.width
                : current.width + spacing + size.width
            current.items.append(Item(index: index, size: size))
            current.width = used
            current.height = max(current.height, size.height)
        }
        if !current.items.isEmpty { rows.append(current) }
        return rows
    }
}
