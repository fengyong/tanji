import SwiftUI
import UIKit

/// 设置页：账号管理、数据与备份、提醒与隐私、数据空间、危险操作、关于与支持。
///
/// 复刻 Web 版 `src/app/views/settings.js` 的分区与顺序：
///   我的账号 → 数据与备份 → 提醒与隐私 → 数据空间 → 危险操作 → 关于与支持。
/// 顶栏左侧回到统计页，右侧是金额隐私的眼睛按钮（只走 Face ID）。
struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    /// 页面自身的弹层：账号表单 / 批量改挂 / 导入确认。
    @State private var sheet: SettingsSheet?

    /// 系统文件选择器（导入用）：单独一层挂载，避免和上面的 sheet 抢同一个挂载点。
    @State private var showPicker = false

    /// 危险操作与恢复的二次确认。
    @State private var showClearConfirm = false
    @State private var showRestoreConfirm = false

    /// 勋章门槛的输入值：用文本存，保证用户正在输入的内容不会被重绘覆盖。
    @State private var medalBusyOrders = ""
    @State private var medalSalesAmount = ""
    @State private var medalHotOrders = ""
    @State private var medalAceAmount = ""
    @State private var medalError: String?
    /// 门槛输入是否已从当前配置填过（只填一次，之后不覆盖用户输入）。
    @State private var didFillMedalRules = false

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    accountSection
                    dataSection
                    reminderSection
                    medalSection
                    spaceSection
                    dangerSection
                    aboutSection
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 40)
            }
            // 文件选择器：0×0 的透明挂载点，只为拿到一个独立的 sheet 槽位。
            BackupPickerHost(isPresented: $showPicker) { url in
                handlePickedFile(url)
            }
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
        }
        .sheet(item: $sheet) { payload in
            // 子视图各自带提示条宿主，这里不再重复挂。
            switch payload.kind {
            case .account(let account):
                AccountFormView(account: account) {
                    // 账号变动后列表自动刷新（model 是 @Published 数据源）
                }
            case .assign:
                AssignAccountView {
                    // 改挂后统计页的账号筛选由 model 自行重置
                }
            case .importPreview(let preview):
                ImportBackupView(fileName: preview.fileName, payload: preview.data)
            case .schema:
                SettingsSchemaView()
            }
        }
        // 设置页自己的提示条宿主：这一层是 sheet，根层的提示条会被盖住。
        .toastHost()
        .confirmationDialog("清空当前数据？",
                            isPresented: $showClearConfirm,
                            titleVisibility: .visible) {
            Button("清空订单与流水", role: .destructive) { clearCurrentData() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("订单与流水会清空，账号与设置保留，替换前会自动备份。")
        }
        .confirmationDialog("恢复替换前的数据？",
                            isPresented: $showRestoreConfirm,
                            titleVisibility: .visible) {
            Button("恢复", role: .destructive) { restoreCheckpoint() }
            Button("取消", role: .cancel) {}
        } message: {
            Text(restoreConfirmMessage)
        }
    }

    // MARK: - 顶栏

    private var header: some View {
        HStack(alignment: .center, spacing: 10) {
            IconButton(systemName: "chevron.left", accessibility: "返回统计") {
                dismiss()
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("SETTINGS / 本机与偏好")
                    .font(Theme.body(10, weight: .heavy))
                    .tracking(1.6)
                    .foregroundStyle(Theme.sub)
                Text("设置")
                    .font(Theme.display(30))
                    .foregroundStyle(Theme.ink)
            }
            Spacer(minLength: 0)
            IconButton(systemName: model.privacyHidden ? "eye.slash" : "eye",
                       active: model.privacyHidden,
                       accessibility: model.privacyHidden ? "显示金额" : "隐藏金额") {
                Task { await model.toggleAmountPrivacy() }
            }
        }
        .padding(.top, 12)
        .padding(.bottom, 4)
        // 顶栏高度上报给提示条：提示条落在大标题下方。
        .toastTopAnchor()
    }

    // MARK: - 我的账号

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle(text: "我的账号") {
                Button {
                    sheet = SettingsSheet(kind: .account(nil))
                } label: {
                    HStack(spacing: 3) {
                        Image(systemName: "plus")
                            .font(Theme.body(11, weight: .heavy))
                        Text("添加")
                            .font(Theme.body(11.5, weight: .bold))
                        Image(systemName: "chevron.right")
                            .font(Theme.body(9, weight: .heavy))
                    }
                    .foregroundStyle(Theme.brandInk)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("account.add")
            }
            CardBox(padding: 2) {
                VStack(spacing: 0) {
                    if model.accounts.isEmpty {
                        Button {
                            sheet = SettingsSheet(kind: .account(nil))
                        } label: {
                            SettingsMenuRow(title: "添加账号",
                                           subtitle: "订单挂账号，报名资料一键拷贝",
                                           leading: {
                                               SettingsMenuIcon(systemName: "person.crop.circle",
                                                                background: Theme.brandSoft,
                                                                ink: Theme.brandInk)
                                           },
                                           trailing: { SettingsChevron() })
                        }
                        .buttonStyle(.plain)
                    } else {
                        ForEach(Array(model.accounts.enumerated()), id: \.element.id) { index, account in
                            accountRow(account, showsDivider: index < model.accounts.count - 1)
                        }
                        if unassignedCount > 0 {
                            assignRow
                        }
                    }
                }
            }
        }
    }

    private func accountRow(_ account: Account, showsDivider: Bool) -> some View {
        HStack(spacing: 12) {
            Button {
                sheet = SettingsSheet(kind: .account(account))
            } label: {
                HStack(spacing: 12) {
                    AccountAvatar(account: account)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(account.name)
                            .font(Theme.body(14, weight: .bold))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                        Text("\(account.levelTitle) · 抖音 \(account.douyin.isEmpty ? "—" : account.douyin) · 手机 \(account.phone.isEmpty ? "—" : account.phone) · \(orderCount(of: account)) 单")
                            .font(Theme.body(10.5))
                            .foregroundStyle(Theme.sub)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("account.row.\(account.id)")
            Button {
                copyAccount(account)
            } label: {
                Text("拷贝")
                    .font(Theme.body(11.5, weight: .bold))
                    .foregroundStyle(Theme.brandInk)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Theme.brandSoft, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 13)
        .padding(.horizontal, 13)
        .overlay(alignment: .bottom) {
            if showsDivider {
                Rectangle()
                    .fill(Theme.line)
                    .frame(height: 1)
                    .padding(.leading, 56)
            }
        }
    }

    /// 拷贝账号资料（昵称 / 等级 / 抖音 / 手机，空字段跳过）——报名表、服务商用。
    private func copyAccount(_ account: Account) {
        var lines: [String] = []
        if !account.name.isEmpty { lines.append("昵称:\(account.name)") }
        // 等级总是带上（与混合版 accountCopyText 同口径）。
        lines.append("等级:\(account.levelTitle)")
        if !account.douyin.isEmpty { lines.append("抖音:\(account.douyin)") }
        if !account.phone.isEmpty { lines.append("手机:\(account.phone)") }
        guard !lines.isEmpty else {
            model.showToast("该账号没有可拷贝的资料")
            return
        }
        UIPasteboard.general.string = lines.joined(separator: "\n")
        model.showToast("已拷贝「\(account.name)」资料")
    }

    /// 批量改挂入口：只有在存在未指定账号的订单时才出现（与 Web 版一致）。
    private var assignRow: some View {
        HStack(spacing: 10) {
            Text("\(unassignedCount) 笔订单未指定账号")
                .font(Theme.body(11.5, weight: .semibold))
                .foregroundStyle(Theme.orange)
            Spacer(minLength: 0)
            Button {
                sheet = SettingsSheet(kind: .assign)
            } label: {
                Text("批量改挂")
                    .font(Theme.body(11.5, weight: .bold))
                    .foregroundStyle(Theme.brandInk)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Theme.brandSoft, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 13)
        .padding(.horizontal, 13)
    }

    private func orderCount(of account: Account) -> Int {
        model.orders.filter { $0.accountId == account.id }.count
    }

    private var unassignedCount: Int {
        model.orders.filter { $0.accountId == nil }.count
    }

    // MARK: - 数据与备份

    private var dataSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle(text: "数据与备份") {
                Text("本机 SQLite · 完全离线")
                    .font(Theme.body(11, weight: .semibold))
                    .foregroundStyle(Theme.sub)
            }
            CardBox(padding: 2) {
                VStack(spacing: 0) {
                    importRow(showsDivider: true)
                    BackupExportMenu(kinds: [.json, .sqlite, .csv], lastShowsDivider: true)
                    schemaRow(showsDivider: true)
                    restoreRow(showsDivider: true)
                    checkpointRow(showsDivider: false)
                }
            }
            Text("导出的文件都存在「文件」App 的「探记」文件夹里（我的 iPhone → 探记）；导入时从同一个文件夹里选 JSON 备份。")
                .font(Theme.body(10.5))
                .foregroundStyle(Theme.sub)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 2)
                .padding(.top, 8)
        }
    }

    /// 从文件导入备份：调起系统文件选择器，默认定位到「探记」文件夹。
    private func importRow(showsDivider: Bool) -> some View {
        Button {
            showPicker = true
        } label: {
            SettingsMenuRow(title: "从文件导入备份",
                           subtitle: "默认打开「文件 › 探记」；预览后替换，自动留恢复点",
                           showsDivider: showsDivider,
                           leading: {
                               SettingsMenuIcon(systemName: "square.and.arrow.down",
                                                background: Theme.brandSoft,
                                                ink: Theme.brandInk)
                           },
                           trailing: { SettingsChevron() })
        }
        .buttonStyle(.plain)
    }

    /// 数据结构说明：看一眼本机 SQLite 的表结构（对应 Web 版 `sheet-schema`）。
    private func schemaRow(showsDivider: Bool) -> some View {
        Button {
            sheet = SettingsSheet(kind: .schema)
        } label: {
            SettingsMenuRow(title: "数据结构 · SQLite",
                           subtitle: "orders / payments / accounts / settings",
                           showsDivider: showsDivider,
                           leading: {
                               SettingsMenuIcon(systemName: "cylinder",
                                                background: Theme.blueSoft,
                                                ink: Theme.blue)
                           },
                           trailing: { SettingsChevron() })
        }
        .buttonStyle(.plain)
    }

    /// 恢复替换前的数据：撤回最近一次导入或清空。
    private func restoreRow(showsDivider: Bool) -> some View {
        Button {
            showRestoreConfirm = true
        } label: {
            SettingsMenuRow(title: "恢复替换前的数据",
                           subtitle: "撤回最近一次导入或清空，仅保留最近一份",
                           showsDivider: showsDivider,
                           leading: {
                               SettingsMenuIcon(systemName: "arrow.uturn.backward",
                                                background: Theme.orangeSoft,
                                                ink: Theme.orange)
                           },
                           trailing: { SettingsChevron() })
        }
        .buttonStyle(.plain)
    }

    /// 导出替换前备份：把恢复点另存一份，原存储不动。
    private func checkpointRow(showsDivider: Bool) -> some View {
        Button {
            exportCheckpoint()
        } label: {
            SettingsMenuRow(title: "导出替换前备份",
                           subtitle: checkpointSummary,
                           showsDivider: showsDivider,
                           leading: {
                               SettingsMenuIcon(systemName: "doc.badge.arrow.up",
                                                background: Theme.orangeSoft,
                                                ink: Theme.orange)
                           },
                           trailing: { SettingsChevron() })
        }
        .buttonStyle(.plain)
    }

    /// 导出替换前备份（恢复点的副本，原存储不改动）。
    private func exportCheckpoint() {
        guard let payload = model.checkpointPayload() else {
            model.showToast("没有可用的替换前备份")
            return
        }
        do {
            let url = try BackupService.exportCheckpoint(payload)
            // 这一行没有展示文件名的地方，文件名只在提示里给。
            model.showToast("已保存到「文件 › 探记」：\(url.lastPathComponent)")
        } catch {
            model.showToast("导出失败：\(error.localizedDescription)")
        }
    }

    /// 有没有可恢复点：没有时把入口说明写清楚，别让用户点了才被告知。
    private var checkpointSummary: String {
        guard let payload = model.checkpointPayload() else {
            return "还没有可恢复的替换前备份；仅保留最近一份"
        }
        return "导出替换前的数据（\(payload.orders.count) 笔订单），原存储未改动"
    }

    // MARK: - 提醒与隐私

    private var reminderSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle("提醒与隐私")
            CardBox(padding: 2) {
                VStack(spacing: 0) {
                    Button {
                        Task { await model.toggleAmountPrivacy() }
                    } label: {
                        SettingsMenuRow(title: "隐私模式",
                                       subtitle: "仅 Face ID 可隐藏或显示，重启后保留",
                                       showsDivider: true,
                                       leading: {
                                           SettingsMenuIcon(systemName: "eye.slash",
                                                            background: Theme.brandSoft,
                                                            ink: Theme.brandInk)
                                       },
                                       trailing: {
                                           SettingsTagBadge(text: model.privacyHidden ? "已开启" : "已关闭")
                                       })
                    }
                    .buttonStyle(.plain)

                    thresholdRow

                    Button {
                        let next = !model.data.notifyEnabled
                        Task {
                            await model.setNotifyEnabled(next)
                            // 每日催收通知要跟着开关重排，否则关掉后系统里还挂着提醒。
                            await Notifications.syncDaily(orders: model.orders,
                                                          payments: model.payments,
                                                          threshold: model.threshold,
                                                          notifyEnabled: next,
                                                          mode: model.mode)
                            model.showToast(next ? "已开启每日催收提醒" : "已关闭每日催收提醒")
                        }
                    } label: {
                        SettingsMenuRow(title: "逾期催收每日提醒",
                                       subtitle: "每天 09:00 · 只报条数与最长天数，不含金额",
                                       showsDivider: false,
                                       leading: {
                                           SettingsMenuIcon(systemName: "bell",
                                                            background: Theme.blueSoft,
                                                            ink: Theme.blue)
                                       },
                                       trailing: {
                                           SettingsTagBadge(text: model.data.notifyEnabled ? "已开启" : "已关闭")
                                       })
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    /// 尾款催收阈值：只允许 7 / 15 / 30 / 45 四档（与 Web 版一致）。
    private var thresholdRow: some View {
        SettingsMenuRow(title: "尾款催收阈值",
                       subtitle: "超过该天数未收尾款即标记逾期",
                       showsDivider: true,
                       leading: {
                           SettingsMenuIcon(systemName: "bell.badge",
                                            background: Theme.orangeSoft,
                                            ink: Theme.orange)
                       },
                       trailing: {
                           HStack(spacing: 2) {
                               stepperButton(systemName: "minus", delta: -1)
                               Text("\(model.threshold) 天")
                                   .font(Theme.body(12, weight: .heavy))
                                   .foregroundStyle(Theme.ink)
                                   .frame(minWidth: 52)
                               stepperButton(systemName: "plus", delta: 1)
                           }
                           .padding(2)
                           .background(Theme.paperDeep.opacity(0.75),
                                       in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                       })
    }

    private func stepperButton(systemName: String, delta: Int) -> some View {
        Button {
            changeThreshold(by: delta)
        } label: {
            Image(systemName: systemName)
                .font(Theme.body(14, weight: .bold))
                .foregroundStyle(Theme.ink)
                .frame(width: 38, height: 38)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    /// 阈值按 7 / 15 / 30 / 45 逐档步进。
    ///
    /// 契约口径是 `model.changeThreshold(±1)`；但 AppModel 现在的实现是
    /// 「当前值 + 增量必须正好落在 7/15/30/45」，所以 ±1 会被 15→16 这类中间值挡掉。
    /// 这里先按契约传 ±1，没生效再按「下一档 - 当前档」的差值补一次，两种口径都能走。
    private func changeThreshold(by delta: Int) {
        let options = [7, 15, 30, 45]
        guard let index = options.firstIndex(of: model.threshold) else { return }
        let next = options[min(options.count - 1, max(0, index + delta))]
        guard next != model.threshold else { return }
        Task {
            let before = model.threshold
            await model.changeThreshold(delta)
            if model.threshold == before {
                await model.changeThreshold(next - before)
            }
            // 阈值变了，每日催收汇总的筛选口径也变了，要重排一次。
            await Notifications.syncDaily(orders: model.orders,
                                          payments: model.payments,
                                          threshold: model.threshold,
                                          notifyEnabled: model.data.notifyEnabled,
                                          mode: model.mode)
            model.showToast("催收阈值已设为 \(model.threshold) 天")
        }
    }

    // MARK: - 勋章门槛

    /// 勋章门槛：全账号共用一套标准，改完历史日期立即按新门槛重判。
    ///
    /// 对应混合版设置页的「勋章门槛」子页（`src/app/views/settings.js` 的
    /// `medalSettingsHtml`），四项门槛与校验规则同口径。
    private var medalSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle("勋章门槛")
            Text("所有账号共用这一套标准。金额按当天订单总价计算，不是实收；修改后历史日期会立即按新门槛重新判定。")
                .font(Theme.body(10.5))
                .foregroundStyle(Theme.sub)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 2)
            CardBox {
                VStack(spacing: 0) {
                    medalRow(emoji: "⭐", title: "忙碌日", unit: "单",
                             keyboard: .numberPad, text: $medalBusyOrders,
                             identifier: "medal.busyOrders")
                    medalRow(emoji: "💰", title: "千元日", unit: nil,
                             keyboard: .decimalPad, text: $medalSalesAmount,
                             identifier: "medal.salesAmount")
                    medalRow(emoji: "🔥", title: "爆单", unit: "单",
                             keyboard: .numberPad, text: $medalHotOrders,
                             identifier: "medal.hotOrders")
                    medalRow(emoji: "💎", title: "王牌日", unit: nil,
                             keyboard: .decimalPad, text: $medalAceAmount,
                             identifier: "medal.aceAmount")
                    if let medalError {
                        Text(medalError)
                            .font(Theme.body(11.5))
                            .foregroundStyle(Theme.red)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 8)
                    }
                    PrimaryButton(title: "保存门槛") { saveMedalRules() }
                        .accessibilityIdentifier("medal.save")
                        .padding(.top, 14)
                }
            }
        }
        .onAppear(perform: fillMedalRulesIfNeeded)
    }

    private func medalRow(emoji: String,
                          title: String,
                          unit: String?,
                          keyboard: UIKeyboardType,
                          text: Binding<String>,
                          identifier: String) -> some View {
        HStack(spacing: 9) {
            Text(emoji)
                .font(Theme.body(14))
            Text(title)
                .font(Theme.body(13, weight: .semibold))
                .foregroundStyle(Theme.ink)
            Spacer(minLength: 0)
            if let unit {
                Text(unit)
                    .font(Theme.body(11.5))
                    .foregroundStyle(Theme.sub)
            }
            TextField("", text: text)
                .keyboardType(keyboard)
                .multilineTextAlignment(.trailing)
                .font(Theme.body(15, weight: .bold))
                .foregroundStyle(Theme.ink)
                .frame(width: 96)
                .accessibilityIdentifier(identifier)
        }
        .padding(.vertical, 9)
    }

    /// 首次进入时把当前门槛填进输入框；之后不再覆盖用户正在输入的内容。
    private func fillMedalRulesIfNeeded() {
        guard !didFillMedalRules else { return }
        didFillMedalRules = true
        let rules = model.medalRules
        medalBusyOrders = String(rules.busyOrders)
        medalSalesAmount = medalAmountText(rules.salesAmount)
        medalHotOrders = String(rules.hotOrders)
        medalAceAmount = medalAmountText(rules.aceAmount)
    }

    /// 金额输入框的初始文本：整数不带小数点，小数最多两位。
    private func medalAmountText(_ value: Double) -> String {
        let rounded = (value * 100).rounded() / 100
        if rounded == rounded.rounded() { return String(Int(rounded)) }
        return String(rounded)
    }

    private func saveMedalRules() {
        let busy = Int(medalBusyOrders.trimmingCharacters(in: .whitespaces))
        let hot = Int(medalHotOrders.trimmingCharacters(in: .whitespaces))
        let sales = Double(medalSalesAmount.trimmingCharacters(in: .whitespaces))
        let ace = Double(medalAceAmount.trimmingCharacters(in: .whitespaces))
        guard let busy, let hot, let sales, let ace else {
            medalError = "请填写完整的数字"
            return
        }
        let rules = MedalRules(busyOrders: busy, salesAmount: sales, hotOrders: hot, aceAmount: ace)
        Task {
            do {
                try await model.setMedalRules(rules)
                medalError = nil
                model.showToast("勋章门槛已保存")
            } catch {
                medalError = error.localizedDescription
            }
        }
    }

    // MARK: - 数据空间

    private var spaceSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle("数据空间")
            CardBox(padding: 2) {
                Button {
                    let previous = model.mode
                    let target: DataSpace = previous == .work ? .demo : .work
                    Task {
                        await model.switchMode(target)
                        // 两套数据各自排通知：旧的撤掉，新的按新数据重排。
                        await Notifications.cancelMode(previous)
                        await Notifications.syncDaily(orders: model.orders,
                                                      payments: model.payments,
                                                      threshold: model.threshold,
                                                      notifyEnabled: model.data.notifyEnabled,
                                                      mode: model.mode)
                        await Notifications.syncDeliver(orders: model.orders, mode: model.mode)
                        model.showToast("已切换数据空间，原数据未改动")
                    }
                } label: {
                    SettingsMenuRow(title: "切换数据空间",
                                   subtitle: "两套数据独立保存，切换不会覆盖另一套",
                                   showsDivider: false,
                                   leading: {
                                       SettingsMenuIcon(systemName: "arrow.left.arrow.right",
                                                        background: Theme.ink,
                                                        ink: Theme.card)
                                   },
                                   trailing: { SettingsChevron() })
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - 危险操作

    private var dangerSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle("危险操作")
            CardBox(padding: 2) {
                Button {
                    showClearConfirm = true
                } label: {
                    SettingsMenuRow(title: "清空当前数据",
                                   subtitle: "清空订单与流水，账号与设置保留；替换前自动备份",
                                   titleColor: Theme.red,
                                   showsDivider: false,
                                   leading: {
                                       SettingsMenuIcon(systemName: "trash",
                                                        background: Theme.red,
                                                        ink: Theme.card)
                                   },
                                   trailing: { SettingsChevron() })
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// 清空：只清订单与流水，账号、服务商预设、阈值、通知开关都留着。
    private func clearCurrentData() {
        let emptied = AppData(orders: [],
                              payments: [],
                              threshold: model.threshold,
                              notifyEnabled: model.data.notifyEnabled,
                              accounts: model.accounts,
                              providers: model.data.providers)
        Task {
            let ok = await model.replaceData(emptied, keepNotifyEnabled: true)
            if ok {
                // 数据被整体清空，已排的通知还指着旧数据：先撤掉，再按空数据重排。
                await Notifications.cancelMode(model.mode)
                await Notifications.syncDaily(orders: model.orders,
                                              payments: model.payments,
                                              threshold: model.threshold,
                                              notifyEnabled: model.data.notifyEnabled,
                                              mode: model.mode)
                await Notifications.syncDeliver(orders: model.orders, mode: model.mode)
            }
            model.showToast(ok ? "已清空，替换前数据可在设置页恢复" : "清空失败：数据未被改动")
        }
    }

    /// 恢复确认文案：把要恢复的笔数写清楚（与 Web 版 restoreCheckpoint 同口径）。
    private var restoreConfirmMessage: String {
        guard let payload = model.checkpointPayload() else {
            return "现在没有可用的替换前备份。"
        }
        return "恢复替换前的 \(payload.orders.count) 笔订单和 \(payload.payments.count) 笔流水？当前数据将作为新的替换前备份保留。"
    }

    /// 恢复替换前的数据（恢复点由 replaceData 内部自动维护）。
    private func restoreCheckpoint() {
        Task {
            let ok = await model.restoreFromCheckpoint()
            if ok {
                await Notifications.cancelMode(model.mode)
                await Notifications.syncDaily(orders: model.orders,
                                              payments: model.payments,
                                              threshold: model.threshold,
                                              notifyEnabled: model.data.notifyEnabled,
                                              mode: model.mode)
                await Notifications.syncDeliver(orders: model.orders, mode: model.mode)
            }
            model.showToast(ok ? "已恢复替换前数据" : "没有可用的替换前备份")
        }
    }

    // MARK: - 关于与支持

    private var aboutSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle("关于与支持")
            CardBox(padding: 2) {
                VStack(spacing: 0) {
                    SettingsMenuRow(title: "版本",
                                   subtitle: "探记 · 纯原生 iOS 版",
                                   showsDivider: true,
                                   leading: {
                                       SettingsMenuIcon(systemName: "info.circle",
                                                        background: Theme.blueSoft,
                                                        ink: Theme.blue)
                                   },
                                   trailing: {
                                       SettingsTagBadge(text: SettingsView.versionText)
                                   })
                    SettingsMenuRow(title: "应用说明",
                                   subtitle: "纯本地运行 · 不收集、不上传任何数据",
                                   showsDivider: false,
                                   leading: {
                                       SettingsMenuIcon(systemName: "lock.shield",
                                                        background: Theme.greenSoft,
                                                        ink: Theme.green)
                                   },
                                   trailing: { EmptyView() })
                    Text("探记 · 数据仅存本机，请定期导出 JSON 备份")
                        .font(Theme.body(10.5))
                        .foregroundStyle(Theme.sub)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 12)
                        .padding(.bottom, 3)
                }
            }
        }
    }

    /// 版本号（从 bundle 取，测试包里也能显示）。
    static var versionText: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? "1"
        return "\(short) (\(build))"
    }

    // MARK: - 导入

    /// 选中备份文件：读失败只提示，不进确认页；读成功进确认页。
    private func handlePickedFile(_ url: URL) {
        // 文件选择器收起：把挂载点一起关掉，避免留一层空白的 sheet。
        showPicker = false
        do {
            // 旧备份没有勋章门槛时沿用当前配置（不是回落默认值），与混合版同口径。
            let parsed = try BackupService.loadImport(from: url, fallbackMedalRules: model.medalRules)
            let preview = ImportPreview(fileName: url.lastPathComponent, data: parsed)
            // 等文件选择器 dismiss 完再切到确认页，避免两个 sheet 抢同一个挂载点。
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 450_000_000)
                sheet = SettingsSheet(kind: .importPreview(preview))
            }
        } catch {
            model.showToast("不能导入：\(importErrorText(error))")
        }
    }

    /// 导入失败的原因文案：优先用 BackupError 自带的中文说明。
    private func importErrorText(_ error: Error) -> String {
        if let localized = error as? LocalizedError, let message = localized.errorDescription {
            return message
        }
        return error.localizedDescription
    }
}

// MARK: - sheet 载荷

/// 设置页要弹的几种层：账号表单 / 批量改挂 / 导入确认 / 数据结构说明。
struct SettingsSheet: Identifiable {
    enum Kind {
        case account(Account?)
        case assign
        case importPreview(ImportPreview)
        case schema
    }

    let id = UUID()
    let kind: Kind

    init(kind: Kind) {
        self.kind = kind
    }
}

// MARK: - 菜单行

/// 设置页菜单行：左侧圆底图标 + 中间标题/副标题 + 右侧标签或箭头（对应 Web 版 .menu-row）。
struct SettingsMenuRow<Leading: View, Trailing: View>: View {
    var title: String
    var subtitle: String?
    /// 第三行小字（如导出后的文件名）：独占一行，不与右侧标签抢位置。
    var footnote: String?
    var titleColor: Color = Theme.ink
    var showsDivider: Bool = true
    @ViewBuilder var leading: Leading
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 11) {
            leading
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(Theme.body(14, weight: .bold))
                    .foregroundStyle(titleColor)
                    .lineLimit(1)
                if let subtitle {
                    Text(subtitle)
                        .font(Theme.body(10.5))
                        .foregroundStyle(Theme.sub)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let footnote {
                    Text(footnote)
                        .font(Theme.body(10, weight: .semibold))
                        .foregroundStyle(Theme.green)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .padding(.top, 1)
                }
            }
            // 中间列优先占位：右侧状态标签再长也不许压住标题与副标题。
            .layoutPriority(1)
            .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 0)
            trailing
        }
        .padding(.vertical, 13)
        .padding(.horizontal, 13)
        .overlay(alignment: .bottom) {
            if showsDivider {
                Rectangle()
                    .fill(Theme.line)
                    .frame(height: 1)
                    .padding(.leading, 56)
            }
        }
        .contentShape(Rectangle())
    }
}

/// 菜单行左侧的圆底图标。
struct SettingsMenuIcon: View {
    let systemName: String
    let background: Color
    let ink: Color

    var body: some View {
        Image(systemName: systemName)
            .font(Theme.body(13, weight: .semibold))
            .foregroundStyle(ink)
            .frame(width: 33, height: 33)
            .background(background, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
    }
}

/// 菜单行右侧的箭头（对应 Web 版 chevron）。
struct SettingsChevron: View {
    var body: some View {
        Image(systemName: "chevron.right")
            .font(Theme.body(12, weight: .bold))
            .foregroundStyle(Theme.lineStrong)
    }
}

/// 菜单行右侧的状态标签（对应 Web 版 .tag-badge）。
struct SettingsTagBadge: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Theme.body(9.5, weight: .heavy))
            .foregroundStyle(Theme.blue)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(Theme.blueSoft, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
}

/// 账号头像（对应 Web 版 .acc-avatar）：有头像用图，没有就取昵称首字。
struct AccountAvatar: View {
    let account: Account
    var size: CGFloat = 42

    var body: some View {
        let swatch = AccountPalette.swatch(account.color)
        Group {
            if let avatar = account.avatar, let image = ImageTools.image(fromDataURL: avatar) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Text(String(account.name.prefix(1)))
                    .font(Theme.body(size > 30 ? 14 : 17, weight: .bold))
                    .foregroundStyle(swatch.ink)
            }
        }
        .frame(width: size, height: size)
        .background(swatch.background)
        .clipShape(Circle())
        .overlay(Circle().stroke(Theme.line, lineWidth: 1))
    }
}

// MARK: - 数据结构说明

/// 数据结构说明弹层（对应 Web 版 `sheet-schema`）。
///
/// 说明本机 SQLite 的四张表：两套数据空间靠 mode 列区分。
struct SettingsSchemaView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    ScrollView(.horizontal, showsIndicators: false) {
                        Text(SettingsSchemaView.schema)
                            .font(.system(size: 10.5, design: .monospaced))
                            .foregroundStyle(Color(hex: "#D9E3DA"))
                            .lineSpacing(3)
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.ink, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 34)
                }
            }
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("数据结构 · SQLite")
                    .font(Theme.display(20))
                    .foregroundStyle(Theme.ink)
                Text("orders / payments / accounts / settings")
                    .font(Theme.body(11))
                    .foregroundStyle(Theme.sub)
            }
            Spacer(minLength: 0)
            IconButton(systemName: "xmark", accessibility: "关闭") {
                dismiss()
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 10)
    }

    /// 结构说明文本：与 `DataStore` 实际建表语句一致。
    static let schema = """
    -- 探记 · 本机 SQLite 结构
    -- 两套数据空间靠 mode 列区分（work / demo）；本页是去掉 mode 的单数据集视图。
    -- 跨设备搬运请用 JSON 备份，不要直接对拷 .db。

    CREATE TABLE orders (
      id              INTEGER NOT NULL,  -- 订单号
      store           TEXT NOT NULL,     -- 品名 / 商家
      category        TEXT,              -- 店铺类型
      contact         TEXT,              -- 联系人 / 电话
      price           REAL NOT NULL,     -- 成交总价
      deposit         REAL DEFAULT 0,    -- 定金
      appt_at         TEXT,              -- 预约时间
      shot_at         TEXT,              -- 实际拍摄时间
      submitted_at    TEXT,              -- 提审时间
      short_sent_at   TEXT,              -- 副片（短片）发出
      long_sent_at    TEXT,              -- 正片（长片）发出
      deposit_paid_at TEXT,              -- 定金到账时间
      final_paid_at   TEXT,              -- 尾款到账时间
      settle_via      TEXT DEFAULT 'private',  -- private 私收 / douyin 抖音商单
      remind_at       TEXT,              -- 催收备忘：下次提醒时间
      channel         TEXT,              -- 服务商
      partner         TEXT,              -- 组队 / 出镜搭档
      location        TEXT,              -- 地点
      gps_place       TEXT,              -- 到店定位 "lat,lng"
      deliver_main    INTEGER DEFAULT 1, -- 需要正片
      deliver_sub     INTEGER DEFAULT 1, -- 需要副片
      review_result   TEXT DEFAULT '',   -- '' 待审 / pass 合格 / fail 不合格
      published_at    TEXT,              -- 发布时间
      account_id      INTEGER,           -- 所属账号，空 = 未指定
      note            TEXT,
      remind_log      TEXT,              -- 催收跟进痕迹：JSON 数组
      expect_pay_at   TEXT,              -- 平台单预计到账
      created_at TEXT, updated_at TEXT,
      PRIMARY KEY(mode, id)
    );

    CREATE TABLE payments (
      mode     TEXT NOT NULL,
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,  -- 对应 orders.id
      kind     TEXT,     -- 定金 / 尾款
      amount   REAL,
      paid_at  TEXT,
      method   TEXT,     -- 微信 / 支付宝 / 银行卡 / 抖音商单 / 其他
      note     TEXT
    );

    CREATE TABLE accounts (
      mode       TEXT NOT NULL,
      id         INTEGER NOT NULL,
      name       TEXT NOT NULL,     -- 昵称
      phone      TEXT,              -- 手机号
      douyin     TEXT,              -- 抖音账号
      color      INTEGER DEFAULT 0, -- 标识色 0-7
      avatar     TEXT,              -- 头像 dataURL
      created_at TEXT,
      level      TEXT DEFAULT 'Lv.5', -- 对外登记等级 Lv.5/Lv.6/Lv.7
      PRIMARY KEY(mode, id)
    );

    CREATE TABLE settings (
      scope TEXT NOT NULL,  -- mode（数据空间）
      key   TEXT NOT NULL,  -- json / backup
      value TEXT,
      PRIMARY KEY(scope, key)
    );
    """
}
