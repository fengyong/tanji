import SwiftUI

/// 统计页：看清收入，也看清还有多少没收回来。
///
/// 对应 Web 版 `src/app/views/stats.js`，其中「每日实收」的柱状图重做为
/// `DailyIncomeChart`（可点选、有刻度、带金额摘要）。
struct StatsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var selectedChartDay: String?

    private var stats: Logic.Stats {
        Logic.statsFor(orders: model.filteredOrders,
                       payments: model.filteredPayments,
                       period: model.statsPeriod,
                       list: model.filteredOrders,
                       now: Date())
    }

    /// 图表的日期序列：本月 1 日至今，或近 N 天
    private var days: [String] {
        let calendar = Calendar.current
        let now = Date()
        if model.statsPeriod == "M" {
            let start = calendar.date(from: calendar.dateComponents([.year, .month], from: now)) ?? now
            var result: [String] = []
            var cursor = start
            while cursor <= now {
                result.append(Format.dayString(cursor))
                guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
                cursor = next
            }
            return result
        }
        let count = max(1, Int(model.statsPeriod) ?? 7)
        let today = calendar.startOfDay(for: now)
        return (0..<count).reversed().compactMap { offset in
            calendar.date(byAdding: .day, value: -offset, to: today).map(Format.dayString)
        }
    }

    private var dailyPoints: [DailyIncomeChart.Point] {
        let paid = stats.paid
        return days.compactMap { day in
            guard let date = Format.parseDay(day) else { return nil }
            let entries = paid.filter { $0.at.hasPrefix(day) }
            let amount = (entries.reduce(0) { $0 + ($1.amount * 100).rounded() }) / 100
            return DailyIncomeChart.Point(day: day,
                                          date: date,
                                          amount: amount,
                                          count: entries.count)
        }
    }

    private var channelBreakdown: [(method: String, amount: Double)] {
        var grouped: [String: Double] = [:]
        for payment in stats.paid {
            grouped[payment.method, default: 0] += payment.amount
        }
        return grouped.map { (method: $0.key, amount: Format.round2($0.value)) }
            .sorted { $0.amount > $1.amount }
    }

    private var averageDeal: Double {
        stats.deals.isEmpty ? 0 : (stats.dealSum / Double(stats.deals.count) * 100).rounded() / 100
    }

    private var totalOwed: Double {
        let sum = model.filteredOrders.reduce(0) { $0 + Logic.owedOf($1, payments: model.payments) }
        return (sum * 100).rounded() / 100
    }

    private var sendingCount: Int {
        model.filteredOrders.filter { ["后期中", "发片中"].contains(Logic.workOf($0)) }.count
    }

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    AppHeader(eyebrow: "Overview / 打开即刷新",
                              title: "统计",
                              subtitle: "看清收入，也看清还有多少没收回来。") {
                        HStack(spacing: 8) {
                            IconButton(systemName: model.privacyHidden ? "eye.slash" : "eye",
                                       active: model.privacyHidden,
                                       accessibility: model.privacyHidden ? "显示金额" : "隐藏金额") {
                                Task { await model.toggleAmountPrivacy() }
                            }
                            IconButton(systemName: "gearshape",
                                       accessibility: "打开设置") {
                                model.settingsPresented = true
                            }
                        }
                    }

                    AccountFilterBar()

                    SegmentedTabs(items: [("7", "近 7 天"), ("30", "近 30 天"), ("M", "本月")],
                                  selection: $model.statsPeriod)
                        .padding(.bottom, 15)

                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)],
                              spacing: 10) {
                        MiniStat(value: Format.fmtMoney(stats.dealSum, masked: model.privacyHidden),
                                 label: "成交额 · \(stats.deals.count) 单")
                        MiniStat(value: Format.fmtMoney(stats.paidSum, masked: model.privacyHidden),
                                 label: "实收金额 · \(stats.paid.count) 笔",
                                 valueColor: Theme.green)
                        MiniStat(value: "\(stats.done.count) 单",
                                 label: "已交付完结（按交付日）",
                                 valueColor: Theme.brandInk)
                        MiniStat(value: Format.fmtMoney(averageDeal, masked: model.privacyHidden),
                                 label: "客单价")
                    }

                    CardBox {
                        DailyIncomeChart(points: dailyPoints,
                                         total: stats.paidSum,
                                         masked: model.privacyHidden,
                                         selectedDay: $selectedChartDay)
                    }
                    .padding(.top, 13)

                    CardBox {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack(alignment: .firstTextBaseline) {
                                Text("收款渠道构成")
                                    .font(Theme.body(13, weight: .heavy))
                                    .foregroundStyle(Theme.ink)
                                Spacer(minLength: 8)
                                Text(model.statsPeriod == "M" ? "本月" : "近 \(model.statsPeriod) 天")
                                    .font(Theme.body(10))
                                    .foregroundStyle(Theme.sub)
                            }
                            if channelBreakdown.isEmpty {
                                EmptyState(title: "该区间暂无收款")
                            } else {
                                ForEach(channelBreakdown, id: \.method) { item in
                                    channelRow(item)
                                }
                            }
                        }
                    }
                    .padding(.top, 12)

                    CardBox(padding: 1) {
                        VStack(spacing: 0) {
                            summaryRow(title: "当前待收款",
                                       subtitle: "含定金与尾款",
                                       value: Format.fmtMoney(totalOwed, masked: model.privacyHidden),
                                       valueColor: Theme.orange)
                            Divider().overlay(Theme.line).padding(.horizontal, 14)
                            summaryRow(title: "待发片订单",
                                       subtitle: "后期中 / 发片中",
                                       value: "\(sendingCount) 单",
                                       valueColor: Theme.orange)
                        }
                    }
                    .padding(.top, 12)
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 28)
            }
            .scrollIndicators(.hidden)
        }
    }

    private func channelRow(_ item: (method: String, amount: Double)) -> some View {
        let peak = channelBreakdown.first?.amount ?? 1
        let ratio = peak > 0 ? item.amount / peak : 0
        let share = stats.paidSum > 0 ? Int((item.amount / stats.paidSum * 100).rounded()) : 0
        return HStack(spacing: 10) {
            Chip.method(item.method)
                .frame(width: 74)
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Theme.ink.opacity(0.07))
                    Capsule()
                        .fill(Theme.brand)
                        .frame(width: max(4, geometry.size.width * ratio))
                }
            }
            .frame(height: 7)
            VStack(alignment: .trailing, spacing: 1) {
                Text(Format.fmtMoney(item.amount, masked: model.privacyHidden))
                    .font(Theme.body(13, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(Theme.ink)
                Text(model.privacyHidden ? "—" : "\(share)%")
                    .font(Theme.body(9.5))
                    .foregroundStyle(Theme.sub)
            }
            .frame(width: 78, alignment: .trailing)
        }
        .padding(.vertical, 4)
    }

    private func summaryRow(title: String, subtitle: String, value: String, valueColor: Color) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(Theme.body(13.5, weight: .bold))
                    .foregroundStyle(Theme.ink)
                Text(subtitle)
                    .font(Theme.body(11.5))
                    .foregroundStyle(Theme.sub)
            }
            Spacer(minLength: 0)
            Text(value)
                .font(Theme.body(15, weight: .heavy))
                .monospacedDigit()
                .foregroundStyle(valueColor)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
    }
}
