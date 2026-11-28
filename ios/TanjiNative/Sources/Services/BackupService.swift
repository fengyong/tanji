import Foundation

/// 导出与导入。
///
/// 导出：全部写进沙盒 Documents —— 开启文件共享后，「文件」App 的「我的 iPhone → 探记 HG」
/// 里就能直接看到带日期的 JSON / CSV / .db 文件，不需要再过系统分享面板。
/// 导入：用系统原生文件选择器（`UIDocumentPickerViewController`），默认定位到同一目录；
/// 导入前自动留一份可恢复的恢复点。
enum BackupService {

    // MARK: - 目录

    /// 导出目录 = 沙盒 Documents = 「文件」App 里的「探记 HG」文件夹
    static func exportFolder() -> URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    /// 导出到指定目录（测试用；默认写到「探记 HG」文件夹）
    static func exportFolder(_ folder: URL?) -> URL {
        folder ?? exportFolder()
    }

    /// 今天的日期串
    static func today() -> String { Format.today() }

    /// 生成不重名的文件路径：同名时追加 -2、-3 …
    static func uniqueURL(folder: URL, baseName: String, pathExtension: String) -> URL {
        let fileManager = FileManager.default
        var candidate = folder.appendingPathComponent("\(baseName).\(pathExtension)")
        var index = 2
        while fileManager.fileExists(atPath: candidate.path) {
            candidate = folder.appendingPathComponent("\(baseName)-\(index).\(pathExtension)")
            index += 1
        }
        return candidate
    }

    // MARK: - JSON 备份

    /// 导出 JSON 备份（与混合版格式一致，旧版可直接导入）。
    @discardableResult
    static func exportJSON(_ data: AppData, folder: URL? = nil) throws -> URL {
        let document = BackupDocument(data: data)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
        let payload = try encoder.encode(document)
        let url = uniqueURL(folder: exportFolder(folder),
                            baseName: "探记-备份-\(today())",
                            pathExtension: "json")
        try payload.write(to: url, options: .atomic)
        return url
    }

    /// 导出替换前备份（不改动原数据）。
    @discardableResult
    static func exportCheckpoint(_ data: AppData, folder: URL? = nil) throws -> URL {
        let document = BackupDocument(data: data)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
        let payload = try encoder.encode(document)
        let url = uniqueURL(folder: exportFolder(folder),
                            baseName: "探记-替换前备份-\(today())",
                            pathExtension: "json")
        try payload.write(to: url, options: .atomic)
        return url
    }

    // MARK: - CSV 导出

    /// 导出 CSV（订单 + 流水，Excel/Numbers 可直接打开；带 UTF-8 BOM，中文不乱码）。
    @discardableResult
    static func exportCSV(_ data: AppData, folder: URL? = nil) throws -> URL {
        let head = ["ID", "品名/商家", "类型", "结算方式", "服务商", "组队", "账号", "地点", "到店定位", "联系方式",
                    "总价", "定金", "预约时间", "实际拍摄", "提审时间", "副片发出", "正片发出", "出片要求", "送审结果",
                    "发布时间", "工作状态", "收款状态", "待收金额", "欠款天数", "催收备忘", "催收次数", "最近催收",
                    "预计到账", "备注"]
        var lines = [head.map(quote).joined(separator: ",")]
        for order in data.orders {
            let account = data.accounts.first { $0.id == order.accountId }
            let fields: [String] = [
                String(order.id), order.store, order.cat,
                order.settleVia == "douyin" ? "抖音商单" : "私收",
                order.channel, order.partner, account?.name ?? "",
                order.location, GeoStore.label(order.gpsPlace), order.contact,
                Format.moneyText(order.price), Format.moneyText(order.deposit),
                order.appt, order.shotAt ?? "", order.submittedAt ?? "", order.shortAt ?? "", order.longAt ?? "",
                [Logic.needMain(order) ? "正片" : "", Logic.needSub(order) ? "副片" : ""].filter { !$0.isEmpty }.joined(separator: "+"),
                order.reviewResult.isEmpty ? "" : (order.reviewResult == "pass" ? "送审合格" : "送审不合格"),
                order.publishedAt ?? "",
                Logic.workOf(order),
                Logic.payOf(order, payments: data.payments),
                Format.moneyText(Logic.owedOf(order, payments: data.payments)),
                String(Logic.overdueDays(order, payments: data.payments)),
                order.remindAt ?? "",
                String(Logic.remindCount(order)),
                Logic.lastRemind(order).map { Format.fmtD($0.at) } ?? "",
                order.expectPayAt ?? "",
                order.note
            ]
            lines.append(fields.map(quote).joined(separator: ","))
        }
        lines.append("")
        lines.append("")
        let paymentHead = ["序号", "订单ID", "商家", "类型", "金额", "到账时间", "收款方式"]
        lines.append(paymentHead.map(quote).joined(separator: ","))
        for (index, payment) in data.payments.enumerated() {
            let store = data.orders.first { $0.id == payment.oid }?.store ?? ""
            let fields = [String(index + 1), String(payment.oid), store, payment.kind,
                          Format.moneyText(payment.amount), payment.at, payment.method]
            lines.append(fields.map(quote).joined(separator: ","))
        }
        let text = lines.joined(separator: "\n")
        let url = uniqueURL(folder: exportFolder(folder),
                            baseName: "探记-导出-\(today())",
                            pathExtension: "csv")
        try Data(("\u{FEFF}" + text).utf8).write(to: url, options: .atomic)
        return url
    }

    private static func quote(_ value: String) -> String {
        let text = value
        // 与 Web 版同口径：前导空白后紧跟 = + @ - 的值要补一个单引号，避免被表格软件当成公式
        let trimmed = text.drop { $0 == " " || $0 == "\t" || $0 == "\n" || $0 == "\r" }
        let needsPrefix = trimmed.first.map { "=+@-".contains($0) } ?? false
        let body = needsPrefix ? "'" + text : text
        return "\"\(body.replacingOccurrences(of: "\"", with: "\"\""))\""
    }

    // MARK: - SQLite 导出

    /// 导出完整数据库存档（.db）。
    @discardableResult
    static func exportSQLite(store: DataStore = .shared) throws -> URL {
        try store.open()
        let source = store.databaseURL
        let url = uniqueURL(folder: exportFolder(),
                            baseName: "探记-\(today())",
                            pathExtension: "db")
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
        try FileManager.default.copyItem(at: source, to: url)
        return url
    }

    // MARK: - 导入

    /// 读取用户选中的备份文件并校验（不落库）。
    static func loadImport(from url: URL) throws -> AppData {
        let scoped = url.startAccessingSecurityScopedResource()
        defer {
            if scoped { url.stopAccessingSecurityScopedResource() }
        }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size <= 10 * 1024 * 1024 else {
            throw BackupError.invalid("备份文件不能超过 10 MB")
        }
        let data = try Data(contentsOf: url)
        let parsed = try BackupValidator.parse(data)
        try verifyPaymentsConsistency(parsed)
        return parsed
    }

    /// 导入前的流水一致性自检：流水金额必须与订单的已收状态对得上。
    static func verifyPaymentsConsistency(_ state: AppData) throws {
        for order in state.orders {
            let checks: [(kind: String, expected: Double, paid: Bool)] = [
                ("定金", order.deposit, !(order.depositPaidAt?.isEmpty ?? true)),
                ("尾款", order.price - order.deposit, !(order.finalPaidAt?.isEmpty ?? true))
            ]
            for check in checks {
                let entries = state.payments.filter { $0.oid == order.id && $0.kind == check.kind }
                let total = entries.reduce(0) { $0 + ($1.amount * 100).rounded() }
                let recorded = check.paid ? (check.expected * 100).rounded() : 0
                let mismatch = entries.count > 1
                    || (!entries.isEmpty && !check.paid)
                    || total != recorded
                if mismatch {
                    throw BackupError.invalid("订单「\(order.store)」的\(check.kind)流水与已收状态不一致，请先核对备份")
                }
            }
        }
    }
}

/// 备份文件（与混合版 `backupDocument()` 的结构一致）。
struct BackupDocument: Encodable {
    var app = "探记 TanJi"
    var version = "0.6"
    var exportedAt: String
    var threshold: Int
    var notifyEnabled: Bool
    var accounts: [Account]
    var providers: [String]
    var orders: [Order]
    var payments: [Payment]

    init(data: AppData) {
        exportedAt = Format.isoString()
        threshold = data.threshold
        notifyEnabled = data.notifyEnabled
        accounts = data.accounts
        providers = data.providers
        orders = data.orders
        payments = data.payments
    }
}
