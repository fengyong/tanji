import SwiftUI

/// 导入确认弹层 + 导出入口 UI。
///
/// - `ImportBackupView`：导入确认弹层（对应 Web 版 `sheet-import`）。
///   展示文件名、订单数、流水数、实收金额、催收阈值，确认后替换当前数据；
///   替换前自动留一份可恢复备份（由 `AppModel.replaceData` 内部维护恢复点）。
/// - `BackupExportMenu`：设置页「数据与备份」分区的导出入口。
///   三种导出全部写进沙盒 Documents ——「文件」App 里的「探记」文件夹，
///   导出后把文件名显示在界面上，用户知道去哪找。
/// - `ImportPreview`：文件选择器读到的备份内容（已校验，未落库）。
/// - `BackupPickerHost`：系统文件选择器的挂载点（单独一层，避免抢 sheet 槽位）。

// MARK: - 导入预览载荷

/// 已读取并校验通过的备份内容（尚未落库）。
struct ImportPreview {
    let fileName: String
    let data: AppData
}

// MARK: - 导入确认弹层

/// 导入确认弹层：确认后用备份替换当前数据。
struct ImportBackupView: View {
    let fileName: String
    let payload: AppData
    var onConfirmed: (() -> Void)?

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var working = false

    /// 实收金额 = 全部流水金额之和（与 Web 版 previewImport 同口径）。
    private var receivedTotal: Double {
        payload.payments.reduce(0) { $0 + $1.amount }
    }

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    VStack(alignment: .leading, spacing: 12) {
                        summaryCard
                        Text("探记旧版导出的 JSON 可直接导入。确认后会替换当前数据，替换前自动留一份可恢复备份。")
                            .font(Theme.body(10.5))
                            .foregroundStyle(Theme.sub)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 2)
                        PrimaryButton(title: "确认替换并恢复") {
                            confirm()
                        }
                        .disabled(working)
                        .opacity(working ? 0.6 : 1)
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 34)
                }
            }
        }
        // 弹层自己的提示条宿主：这一层是 sheet，根层的提示条会被盖住。
        .toastHost()
    }

    // MARK: - 顶栏

    private var header: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("恢复 JSON 备份")
                    .font(Theme.display(20))
                    .foregroundStyle(Theme.ink)
                Text(fileName)
                    .font(Theme.body(11))
                    .foregroundStyle(Theme.sub)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 0)
            IconButton(systemName: "xmark", accessibility: "取消导入") {
                dismiss()
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 8)
        // 顶栏高度上报给提示条：提示条落在标题下方。
        .toastTopAnchor()
    }

    // MARK: - 摘要

    private var summaryCard: some View {
        CardBox {
            VStack(alignment: .leading, spacing: 10) {
                summaryRow(title: "订单", value: "\(payload.orders.count) 笔")
                summaryRow(title: "流水", value: "\(payload.payments.count) 笔")
                summaryRow(title: "实收金额",
                           value: Format.fmtMoney(receivedTotal, masked: model.privacyHidden))
                summaryRow(title: "催收阈值", value: "\(payload.threshold) 天")
                summaryRow(title: "账号", value: "\(payload.accounts.count) 个")
            }
        }
    }

    private func summaryRow(title: String, value: String) -> some View {
        HStack(spacing: 10) {
            Text(title)
                .font(Theme.body(12, weight: .semibold))
                .foregroundStyle(Theme.sub)
                .frame(width: 72, alignment: .leading)
            Text(value)
                .font(Theme.body(13, weight: .bold))
                .foregroundStyle(Theme.ink)
                .monospacedDigit()
            Spacer(minLength: 0)
        }
    }

    // MARK: - 确认

    private func confirm() {
        guard !working else { return }
        working = true
        Task {
            // keepNotifyEnabled：导入的备份若没带通知开关，沿用本机当前设置。
            let ok = await model.replaceData(payload, keepNotifyEnabled: true)
            working = false
            if ok {
                // 数据被整体替换，已排的通知还指着旧数据：先撤掉，再按新数据重排。
                await Notifications.cancelMode(model.mode)
                await Notifications.syncDaily(orders: model.orders,
                                              payments: model.payments,
                                              threshold: model.threshold,
                                              notifyEnabled: model.data.notifyEnabled,
                                              mode: model.mode)
                await Notifications.syncDeliver(orders: model.orders, mode: model.mode)
                model.showToast("备份已恢复，替换前数据可在设置页恢复")
                dismiss()
                onConfirmed?()
            } else {
                model.showToast("导入失败：数据未被改动，请重试")
            }
        }
    }
}

// MARK: - 导出入口

/// 设置页「数据与备份」分区的导出入口：JSON / SQLite / CSV。
///
/// 所有导出都写进沙盒 Documents ——「文件」App 里的「探记」文件夹，
/// 不走系统分享面板：导完把文件名留在界面上，用户知道去哪找。
struct BackupExportMenu: View {
    /// 要展示的导出方式，顺序与设置页一致（JSON → SQLite → CSV）。
    var kinds: [BackupExportKind] = [.json, .sqlite, .csv]
    /// 最后一行是否画分隔线（后面还接着别的行时为 true）。
    var lastShowsDivider: Bool = true

    @EnvironmentObject private var model: AppModel

    /// 每种导出最近一次的文件名（显示在对应行上）。
    @State private var exported: [BackupExportKind: String] = [:]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(kinds.enumerated()), id: \.element) { index, kind in
                exportRow(kind, showsDivider: lastShowsDivider || index < kinds.count - 1)
            }
        }
    }

    private func exportRow(_ kind: BackupExportKind, showsDivider: Bool) -> some View {
        Button {
            run(kind)
        } label: {
            SettingsMenuRow(title: kind.title,
                           subtitle: kind.subtitle,
                           // 文件名单独占一行：放在右侧会与副标题抢位置、糊成一团。
                           footnote: exported[kind],
                           showsDivider: showsDivider,
                           leading: {
                               SettingsMenuIcon(systemName: kind.systemImage,
                                                background: kind.iconBackground,
                                                ink: kind.iconInk)
                           },
                           trailing: {
                               SettingsChevron()
                           })
        }
        .buttonStyle(.plain)
        // 稳定的可访问性标识：按钮的可访问性标签是「标题 + 副标题」的拼接串，
        // 靠标识定位比靠文案稳（UI 测试、辅助功能都用得上）。
        .accessibilityIdentifier("export.\(kind.identifier)")
    }

    /// 执行导出：成功提示文件名，失败提示原因。
    private func run(_ kind: BackupExportKind) {
        do {
            let url: URL
            switch kind {
            case .json:
                url = try BackupService.exportJSON(model.data)
            case .csv:
                url = try BackupService.exportCSV(model.data)
            case .sqlite:
                url = try BackupService.exportSQLite()
            }
            let name = url.lastPathComponent
            exported[kind] = name
            model.showToast("已保存到「文件 › 探记」")
        } catch {
            model.showToast("导出失败：\(exportErrorText(error))")
        }
    }

    /// 导出失败的原因文案：优先用自带的中文说明。
    private func exportErrorText(_ error: Error) -> String {
        if let localized = error as? LocalizedError, let message = localized.errorDescription {
            return message
        }
        return error.localizedDescription
    }
}

// MARK: - 文件选择器挂载点

/// 系统文件选择器的挂载点：单独一层承载 `.sheet`，
/// 避免与页面自身的弹层抢同一个挂载点。
struct BackupPickerHost: View {
    @Binding var isPresented: Bool
    let onPick: (URL) -> Void

    var body: some View {
        Color.clear
            .sheet(isPresented: $isPresented) {
                DocumentPicker(onPick: onPick)
                    // 用户在系统选择器里按「取消」时，它会自己收起；
                    // 这里把绑定复位，下次再点导入才弹得出来。
                    .onDisappear { isPresented = false }
            }
    }
}

/// 三种导出的元信息（标题、副标题、图标）。
///
/// 标题与副标题跟混合版原生形态逐句对齐：
/// JSON 走「保存到文件 App」，SQLite / CSV 是存档。
enum BackupExportKind: CaseIterable {
    case json
    case csv
    case sqlite

    var title: String {
        switch self {
        case .json: return "保存 JSON 备份"
        case .csv: return "导出 CSV"
        case .sqlite: return "导出 SQLite（.db）"
        }
    }

    var subtitle: String {
        switch self {
        case .json: return "直接存入「文件 › 探记」；换机迁移选这个"
        case .csv: return "订单表 + 收款流水，Excel / Numbers 可直接打开"
        case .sqlite: return "完整数据库存档，可用 SQLite 工具打开"
        }
    }

    var systemImage: String {
        switch self {
        case .json: return "doc.on.doc"
        case .csv: return "tablecells"
        case .sqlite: return "cylinder"
        }
    }

    var iconBackground: Color {
        switch self {
        case .json: return Theme.greenSoft
        case .csv: return Theme.greenSoft
        case .sqlite: return Theme.blueSoft
        }
    }

    var iconInk: Color {
        switch self {
        case .json: return Theme.green
        case .csv: return Theme.green
        case .sqlite: return Theme.blue
        }
    }

    /// 标识用的短名（可访问性 identifier / 文件名）。
    var identifier: String {
        switch self {
        case .json: return "json"
        case .csv: return "csv"
        case .sqlite: return "sqlite"
        }
    }
}
