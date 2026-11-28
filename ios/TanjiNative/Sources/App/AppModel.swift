import Foundation
import Combine

/// 主标签页。
///
/// 放在状态中枢里而不是 `RootView` 的 `@State`：这样任何页面都能直接切换
/// （首页「整月行程 ›」「全部 ›」「统计 ›」「催收清单」都是跨标签跳转）。
enum AppTab: Int, Hashable {
    case home = 0
    case trip
    case orders
    case pay
    case stats
}

/// 全局状态中枢：数据装载、保存、替换、切换数据空间，以及各页筛选条件。
///
/// 数据流与 Web 版一致：任何改动先改内存，再整体落一份快照（SQLite + 第二副本）。
@MainActor
final class AppModel: ObservableObject {

    // MARK: - 数据

    @Published private(set) var data = AppData()
    @Published private(set) var mode: DataSpace = .work
    @Published private(set) var ready = false
    @Published private(set) var busy = false
    /// 存储状态横幅文案（为空表示一切正常）
    @Published var status: String?
    /// 顶部轻提示
    @Published var toastMessage: String?

    /// 弹一条顶部轻提示（2.4 秒后自动收起）。
    func showToast(_ message: String) {
        toastMessage = message
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_400_000_000)
            guard !Task.isCancelled else { return }
            self?.toastMessage = nil
        }
    }

    private var toastTask: Task<Void, Never>?

    // MARK: - 提示条宿主

    /// 提示条宿主栈（后进先出）。
    ///
    /// 设置页、订单详情这些都是 `.sheet`，盖在根页面之上；
    /// 若每层都渲染提示条，同一句话会在两层各画一次。
    /// 这里登记「当前最上层的宿主」，只有它渲染提示条。
    @Published private(set) var toastHostStack: [UUID] = []

    /// 当前该显示提示条的宿主（栈顶）。
    var activeToastHostID: UUID? { toastHostStack.last }

    func registerToastHost(_ id: UUID) {
        guard !toastHostStack.contains(id) else { return }
        toastHostStack.append(id)
    }

    func unregisterToastHost(_ id: UUID) {
        toastHostStack.removeAll { $0 == id }
    }

    // MARK: - 偏好与筛选

    /// 当前标签页。跨标签跳转统一改这里（`model.selectedTab = .trip`）。
    @Published var selectedTab: AppTab = .home

    /// 金额隐私（原生端只能经 Face ID 切换）
    @Published var privacyHidden = false
    /// 全局账号筛选：nil = 全部
    @Published var accountFilter: Int?
    @Published var orderQuery = ""
    @Published var orderChip = "all"
    @Published var payBucket = "all"
    @Published var statsPeriod = "7"
    @Published var selectedDay = Format.today()
    @Published var tripMonth = Date()
    @Published var settingsPresented = false

    private let store: DataStore
    private var revision: Int64 = 0
    private var restorePoint: SnapshotContent?
    private var saveTask: Task<Void, Never>?

    init(store: DataStore = .shared) {
        self.store = store
        #if DEBUG
        // 调试启动参数 `-tanji-tab N`：直接落到第 N 个标签页（截图 / UI 验收）。
        if let raw = DebugSelfCheck.tab, let tab = AppTab(rawValue: raw) {
            selectedTab = tab
        }
        #endif
    }

    // MARK: - 装载

    func load() async {
        do {
            try store.open()
        } catch {
            status = "本机数据读取失败，已暂停写入以保护原数据。请重试，或先导出替换前备份留存。"
            ready = true
            return
        }
        let work = (try? store.loadSnapshot(mode: .work)) ?? LoadedSnapshot(snapshot: nil, uncertain: false)
        let demo = (try? store.loadSnapshot(mode: .demo)) ?? LoadedSnapshot(snapshot: nil, uncertain: false)
        let remembered = store.rememberedMode()
        let selected = remembered ?? (work.snapshot != nil ? .work : .demo)
        let snapshot = selected == .work ? work.snapshot : demo.snapshot
        mode = selected
        if let snapshot {
            data = snapshot.payload.data
            revision = snapshot.revision
            restorePoint = snapshot.previous
        } else {
            data = selected == .work ? AppData() : DemoSeed.seed()
        }
        ready = true
        if data.orders.isEmpty && data.payments.isEmpty && snapshot == nil && selected == .work {
            await save()
        }
    }

    // MARK: - 保存

    /// 落一份快照（SQLite 主副本 + UserDefaults 第二副本）。
    func save() async {
        guard ready, !busy else { return }
        busy = true
        defer { busy = false }
        status = "正在保存…"
        revision = max(Int64(Date().timeIntervalSince1970 * 1000), revision + 1)
        let snapshot = Snapshot(content: SnapshotContent(data: data),
                                revision: revision,
                                savedAt: Format.isoString(),
                                mode: mode.rawValue,
                                previous: restorePoint)
        do {
            try store.persist(snapshot, mode: mode)
            status = nil
        } catch {
            status = "保存失败：改动仅在当前页面，请勿关闭，先导出 JSON 备份再重试。"
        }
    }

    /// 整体替换数据（导入、清空、恢复）。替换前自动留一份恢复点。
    @discardableResult
    func replaceData(_ newData: AppData, keepNotifyEnabled: Bool = false) async -> Bool {
        guard ready, !busy else { return false }
        busy = true
        defer { busy = false }
        var payload = newData
        if keepNotifyEnabled { payload.notifyEnabled = data.notifyEnabled }

        let before = Snapshot(content: SnapshotContent(data: data),
                              revision: revision,
                              savedAt: Format.isoString(),
                              mode: mode.rawValue)
        revision = max(Int64(Date().timeIntervalSince1970 * 1000), revision + 1)
        let next = Snapshot(content: SnapshotContent(data: payload),
                            revision: revision,
                            savedAt: Format.isoString(),
                            mode: mode.rawValue,
                            previous: before.content)
        do {
            try store.persist(next, mode: mode)
            try? store.saveRestorePoint(before.content, mode: mode)
        } catch {
            status = "替换失败：数据未被改动。请重试；持续失败请先导出 JSON 备份。"
            return false
        }
        restorePoint = before.content
        data = payload
        status = nil
        resetFilters()
        return true
    }

    /// 恢复替换前的数据（当前数据会成为新的恢复点）。
    @discardableResult
    func restoreFromCheckpoint() async -> Bool {
        guard !busy else { return false }
        guard let point = restorePoint else { return false }
        return await replaceData(point.data, keepNotifyEnabled: true)
    }

    /// 导出替换前备份的内容（不改动原数据）。
    func checkpointPayload() -> AppData? { restorePoint?.data }

    /// 切换数据空间：两套数据独立保存，切换不会覆盖另一套。
    func switchMode(_ target: DataSpace) async {
        guard target != mode, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try store.open()
            let current = (try? store.loadSnapshot(mode: mode)) ?? LoadedSnapshot(snapshot: nil, uncertain: false)
            if let snapshot = current.snapshot {
                revision = max(revision, snapshot.revision)
                restorePoint = snapshot.previous
            }
            store.rememberMode(target)
            let targetSnapshot = (try? store.loadSnapshot(mode: target)) ?? LoadedSnapshot(snapshot: nil, uncertain: false)
            mode = target
            if let snapshot = targetSnapshot.snapshot {
                data = snapshot.payload.data
                revision = snapshot.revision
                restorePoint = snapshot.previous
            } else {
                data = target == .work ? AppData() : DemoSeed.seed()
                restorePoint = nil
            }
            resetFilters()
            status = nil
        } catch {
            status = "目标数据读取失败，未切换或覆盖数据。"
        }
    }

    func resetFilters() {
        orderQuery = ""
        orderChip = "all"
        payBucket = "all"
        accountFilter = nil
        selectedDay = Format.today()
    }

    #if DEBUG
    /// 把当前数据空间重置成 Demo 种子（仅 Debug 构建，UI 测试用）。
    ///
    /// UI 测试会推进订单状态、打卡，改一次数据后面的用例起点就变了；
    /// 每次启动先重置成同一份种子，跑测才可重复。
    func resetToDemoSeed() async {
        await replaceData(DemoSeed.seed(), keepNotifyEnabled: true)
    }
    #endif

    // MARK: - 派生数据

    var accounts: [Account] { data.accounts }
    var orders: [Order] { data.orders }
    var payments: [Payment] { data.payments }
    var threshold: Int { data.threshold }
    /// 勋章门槛：全账号共用一套标准。
    var medalRules: MedalRules { data.medalRules }

    /// 账号筛选后的订单
    var filteredOrders: [Order] {
        guard let filter = accountFilter else { return data.orders }
        return data.orders.filter { $0.accountId == filter }
    }

    /// 账号筛选后的流水（按订单归属筛，不能直接取全部流水）
    var filteredPayments: [Payment] {
        guard let filter = accountFilter else { return data.payments }
        let ids = Set(data.orders.filter { $0.accountId == filter }.map(\.id))
        return data.payments.filter { ids.contains($0.oid) }
    }

    var isMultiAccount: Bool { data.accounts.count >= 2 }

    func account(_ id: Int?) -> Account? {
        guard let id else { return nil }
        return data.accounts.first { $0.id == id }
    }

    func order(_ id: Int) -> Order? {
        data.orders.first { $0.id == id }
    }

    /// 逾期未收尾款、且没设提醒的单数（底栏角标）
    var overdueBadgeCount: Int {
        filteredOrders.filter { Logic.isOver($0, payments: data.payments, threshold: data.threshold) && !Logic.snoozed($0) }.count
    }

    func payments(of orderId: Int) -> [Payment] {
        data.payments.filter { $0.oid == orderId }
    }

    // MARK: - 账号

    /// 保存勋章门槛：全账号共用一套标准，改完历史日期立即按新门槛重判。
    func setMedalRules(_ rules: MedalRules) async throws {
        data.medalRules = try Logic.validateMedalRules(rules)
        await save()
    }

    func upsertAccount(_ account: Account) async {
        if let index = data.accounts.firstIndex(where: { $0.id == account.id }) {
            data.accounts[index] = account
        } else {
            data.accounts.append(account)
        }
        await save()
    }

    func nextAccountId() -> Int {
        (data.accounts.map(\.id).max() ?? 0) + 1
    }

    /// 删除账号：其名下订单变为「未指定」。
    func deleteAccount(_ id: Int) async {
        data.accounts.removeAll { $0.id == id }
        for index in data.orders.indices where data.orders[index].accountId == id {
            data.orders[index].accountId = nil
        }
        if accountFilter == id { accountFilter = nil }
        await save()
    }

    /// 批量改挂：把未指定账号的订单全部挂到某个账号。
    func assignUnassigned(to accountId: Int) async {
        for index in data.orders.indices where data.orders[index].accountId == nil {
            data.orders[index].accountId = accountId
        }
        await save()
    }

    // MARK: - 订单

    func nextOrderId() -> Int {
        (data.orders.map(\.id).max() ?? 0) + 1
    }

    func saveOrder(_ order: Order) async {
        if let index = data.orders.firstIndex(where: { $0.id == order.id }) {
            data.orders[index] = order
        } else {
            data.orders.append(order)
        }
        await save()
    }

    func deleteOrder(_ id: Int) async {
        data.orders.removeAll { $0.id == id }
        data.payments.removeAll { $0.oid == id }
        await save()
    }

    /// 行内推进：到店打卡 / 提审 / 副片发出 / 正片发出。
    func advance(_ order: Order, field: AdvanceField) async {
        guard let index = data.orders.firstIndex(where: { $0.id == order.id }) else { return }
        let stamp = Logic.nowString()
        switch field {
        case .shot: data.orders[index].shotAt = stamp
        case .submitted: data.orders[index].submittedAt = stamp
        case .short: data.orders[index].shortAt = stamp
        case .long: data.orders[index].longAt = stamp
        }
        await save()
    }

    enum AdvanceField {
        case shot, submitted, short, long
    }

    /// 收/退定金与尾款：写流水并同步已收状态字段。
    func toggleReceipt(orderId: Int, kind: String) async {
        guard let order = self.order(orderId) else { return }
        let spec = Logic.paymentSpec(kind)
        let received = Logic.hasReceipt(order, kind: kind, payments: data.payments)
        guard let index = data.orders.firstIndex(where: { $0.id == orderId }) else { return }
        if received {
            data.payments.removeAll { $0.oid == orderId && $0.kind == kind }
            switch kind {
            case "定金": data.orders[index].depositPaidAt = nil
            default: data.orders[index].finalPaidAt = nil
            }
        } else {
            let amount: Double
            switch kind {
            case "定金": amount = order.deposit
            default: amount = Format.round2(order.price - order.deposit)
            }
            data.payments.append(Payment(oid: orderId,
                                         kind: kind,
                                         amount: amount,
                                         at: Logic.nowString(),
                                         method: order.settleVia == "douyin" ? "抖音商单" : "微信",
                                         note: nil))
            switch kind {
            case "定金": data.orders[index].depositPaidAt = Logic.nowString()
            default: data.orders[index].finalPaidAt = Logic.nowString()
            }
        }
        _ = spec
        await save()
    }

    /// 记一笔收款（金额可与订单默认不同）。
    func addPayment(_ payment: Payment) async {
        data.payments.append(payment)
        if let index = data.orders.firstIndex(where: { $0.id == payment.oid }) {
            if payment.kind == "定金" { data.orders[index].depositPaidAt = payment.at }
            if payment.kind == "尾款" { data.orders[index].finalPaidAt = payment.at }
        }
        await save()
    }

    func deletePayment(_ payment: Payment) async {
        data.payments.removeAll { $0.id == payment.id }
        await save()
    }

    /// 催收备忘：设几天后再提醒。
    func setRemind(orderId: Int, days: Int) async {
        guard let index = data.orders.firstIndex(where: { $0.id == orderId }) else { return }
        data.orders[index].remindAt = Format.localOffset(days, hourMinute: "09:00")
        await save()
    }

    func clearRemind(orderId: Int) async {
        guard let index = data.orders.firstIndex(where: { $0.id == orderId }) else { return }
        data.orders[index].remindAt = nil
        await save()
    }

    /// 记一次催收跟进。
    func addRemindEntry(orderId: Int, note: String) async {
        guard let index = data.orders.firstIndex(where: { $0.id == orderId }) else { return }
        var entries = data.orders[index].remindEntries
        entries.append(RemindEntry(at: Logic.nowString(), note: note))
        data.orders[index].remindLog = Array(entries.suffix(50))
        await save()
    }

    /// 平台单预计到账日。
    func setExpectPayAt(orderId: Int, value: String?) async {
        guard let index = data.orders.firstIndex(where: { $0.id == orderId }) else { return }
        data.orders[index].expectPayAt = value
        await save()
    }

    /// 送审结果 / 发布时间。
    func setReviewResult(orderId: Int, value: String) async {
        guard let index = data.orders.firstIndex(where: { $0.id == orderId }) else { return }
        data.orders[index].reviewResult = value
        await save()
    }

    func setPublishedAt(orderId: Int, value: String?) async {
        guard let index = data.orders.firstIndex(where: { $0.id == orderId }) else { return }
        data.orders[index].publishedAt = value
        await save()
    }

    /// 改挂单个订单的账号。
    func setOrderAccount(orderId: Int, accountId: Int?) async {
        guard let index = data.orders.firstIndex(where: { $0.id == orderId }) else { return }
        data.orders[index].accountId = accountId
        await save()
    }

    // MARK: - 设置

    func changeThreshold(_ delta: Int) async {
        let next = data.threshold + delta
        guard [7, 15, 30, 45].contains(next) else { return }
        data.threshold = next
        await save()
    }

    func setNotifyEnabled(_ enabled: Bool) async {
        data.notifyEnabled = enabled
        await save()
    }

    /// 新增服务商预设（去重）。
    func rememberProvider(_ name: String) async {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, !data.providers.contains(trimmed) else { return }
        data.providers.append(trimmed)
        await save()
    }

    var providerList: [String] {
        var seen = Set<String>()
        var result: [String] = []
        for name in AccountPalette.presetProviders + data.providers where !seen.contains(name) {
            seen.insert(name)
            result.append(name)
        }
        return result
    }
}
