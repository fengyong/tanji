import SwiftUI
import Charts

/// 每日实收图表。
///
/// 混合版是一排细柱 + 只有 tooltip（手机上根本看不到金额），这里重做：
///   - 有刻度的纵轴（紧凑金额：1.28万）；
///   - 点选任意一天 → 顶部显示当日金额与笔数，柱子高亮；
///   - 零收入的日期保留基线刻度，不留空；
///   - 图上方给「区间合计 / 日均 / 最高单日」，不看图也知道大概数；
///   - 隐私模式下金额一律打码。
struct DailyIncomeChart: View {
    struct Point: Identifiable {
        var id: String { day }
        let day: String
        let date: Date
        let amount: Double
        let count: Int
    }

    let points: [Point]
    let total: Double
    let masked: Bool
    @Binding var selectedDay: String?

    private var selected: Point? {
        guard let selectedDay else { return nil }
        return points.first { $0.day == selectedDay }
    }

    private var average: Double {
        guard !points.isEmpty else { return 0 }
        return (total / Double(points.count) * 100).rounded() / 100
    }

    private var best: Point? {
        points.max { $0.amount < $1.amount }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("每日实收")
                    .font(Theme.body(13, weight: .heavy))
                    .foregroundStyle(Theme.ink)
                Spacer(minLength: 8)
                Text(maskAmount(total))
                    .font(Theme.body(13, weight: .heavy))
                    .monospacedDigit()
                    .foregroundStyle(Theme.green)
            }

            // 摘要：不看图也知道量级
            HStack(spacing: 8) {
                summaryCell(title: "区间合计", value: maskAmount(total))
                summaryCell(title: "日均", value: maskAmount(average))
                summaryCell(title: "最高单日", value: best.map { maskAmount($0.amount) } ?? maskAmount(0),
                            footnote: best.map { Format.fmtD($0.day) })
            }

            if let selected {
                HStack(spacing: 6) {
                    Circle()
                        .fill(Theme.brand)
                        .frame(width: 7, height: 7)
                    Text("\(Format.fmtD(selected.day)) 实收 \(maskAmount(selected.amount))")
                        .font(Theme.body(12, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(Theme.ink)
                    Text("· \(selected.count) 笔")
                        .font(Theme.body(11.5))
                        .foregroundStyle(Theme.sub)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(Theme.brandSoft.opacity(0.55), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            } else {
                Text("点柱子看当日金额")
                    .font(Theme.body(11))
                    .foregroundStyle(Theme.sub)
            }

            chart
                .frame(height: 148)
        }
    }

    private func summaryCell(title: String, value: String, footnote: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(Theme.body(10))
                .foregroundStyle(Theme.sub)
            Text(value)
                .font(Theme.body(13.5, weight: .heavy))
                .monospacedDigit()
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let footnote {
                Text(footnote)
                    .font(Theme.body(9.5))
                    .foregroundStyle(Theme.sub.opacity(0.8))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 9)
        .padding(.vertical, 8)
        .background(Theme.paper.opacity(0.7), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func maskAmount(_ value: Double) -> String {
        Format.fmtMoney(value, masked: masked)
    }

    private var chart: some View {
        Chart {
            ForEach(points) { point in
                BarMark(
                    x: .value("日", point.date, unit: .day),
                    y: .value("实收", point.amount)
                )
                .foregroundStyle(barStyle(point))
                .cornerRadius(4)
                .annotation(position: .top, alignment: .center, spacing: 2) {
                    if let selectedDay, selectedDay == point.day {
                        Text(maskAmount(point.amount))
                            .font(Theme.body(9.5, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(Theme.brandInk)
                    } else if points.count <= 10, point.amount > 0 {
                        Text(Format.compactMoney(point.amount))
                            .font(Theme.body(9))
                            .monospacedDigit()
                            .foregroundStyle(Theme.sub)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [3, 3]))
                    .foregroundStyle(Theme.line)
                AxisValueLabel {
                    if let amount = value.as(Double.self) {
                        Text(masked ? "—" : Format.compactMoney(amount))
                            .font(Theme.body(9))
                            .foregroundStyle(Theme.sub)
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 4)) { value in
                AxisValueLabel {
                    if let date = value.as(Date.self) {
                        Text(Format.fmtD(Format.dayString(date)))
                            .font(Theme.body(9))
                            .foregroundStyle(Theme.sub)
                    }
                }
            }
        }
        .chartOverlay { proxy in
            GeometryReader { geometry in
                Rectangle()
                    .fill(.clear)
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { drag in
                                guard let plotFrame = proxy.plotFrame else { return }
                                let origin = geometry[plotFrame].origin
                                let x = drag.location.x - origin.x
                                guard let date: Date = proxy.value(atX: x) else { return }
                                let day = Format.dayString(date)
                                if let match = points.first(where: { $0.day == day }) {
                                    selectedDay = match.day
                                }
                            }
                    )
            }
        }
    }

    private func barStyle(_ point: Point) -> LinearGradient {
        let dim = selected != nil && selected?.day != point.day
        if point.amount <= 0 {
            return LinearGradient(colors: [Theme.line, Theme.line], startPoint: .bottom, endPoint: .top)
        }
        let top = dim ? Theme.brand.opacity(0.42) : Color(hex: "#E9A07D")
        let bottom = dim ? Theme.brand.opacity(0.22) : Theme.brand
        return LinearGradient(colors: [top, bottom], startPoint: .top, endPoint: .bottom)
    }
}
