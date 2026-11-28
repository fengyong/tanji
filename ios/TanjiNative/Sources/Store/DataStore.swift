import Foundation

/// 一套数据的快照内容（与 Web 版 `db` 结构一致）。
struct SnapshotContent: Codable, Equatable {
    var orders: [Order]
    var payments: [Payment]
    var threshold: Int
    var notifyEnabled: Bool
    var accounts: [Account]
    var providers: [String]

    var data: AppData {
        AppData(orders: orders,
                payments: payments,
                threshold: threshold,
                notifyEnabled: notifyEnabled,
                accounts: accounts,
                providers: providers)
    }

    init(orders: [Order],
         payments: [Payment],
         threshold: Int,
         notifyEnabled: Bool,
         accounts: [Account],
         providers: [String]) {
        self.orders = orders
        self.payments = payments
        self.threshold = threshold
        self.notifyEnabled = notifyEnabled
        self.accounts = accounts
        self.providers = providers
    }

    init(data: AppData) {
        orders = data.orders
        payments = data.payments
        threshold = data.threshold
        notifyEnabled = data.notifyEnabled
        accounts = data.accounts
        providers = data.providers
    }
}

/// 落盘快照：内容 + 修订号 + 时间 + 上一份内容（替换前备份）。
struct Snapshot: Codable, Equatable {
    var v: Int = 3
    var revision: Int64
    var savedAt: String
    var mode: String
    var content: SnapshotContent
    var previous: SnapshotContent?

    init(content: SnapshotContent, revision: Int64, savedAt: String, mode: String, previous: SnapshotContent? = nil) {
        v = 3
        self.revision = revision
        self.savedAt = savedAt
        self.mode = mode
        self.content = content
        self.previous = previous
    }

    var payload: SnapshotContent { content }
}

/// 本机存储：SQLite 为主副本，UserDefaults 为第二副本；两份按修订号取新。
///
/// 表结构与混合版完全一致（orders / payments / accounts / settings 四表，
/// settings 以 `scope=数据空间, key=json|backup` 存快照），导出的 .db 可被混合版读取。
final class DataStore {
    static let shared = DataStore()

    private var database: SQLiteDatabase?
    private let defaults: UserDefaults
    private let fileManager: FileManager
    /// 测试注入：指定数据库文件位置
    private let databaseURLOverride: URL?

    init(defaults: UserDefaults = .standard, fileManager: FileManager = .default, databaseURL: URL? = nil) {
        self.defaults = defaults
        self.fileManager = fileManager
        self.databaseURLOverride = databaseURL
    }

    // MARK: - 路径

    /// 实时数据库：Application Support（不出现在「文件」App 里）
    var databaseURL: URL {
        if let databaseURLOverride { return databaseURLOverride }
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let folder = base.appendingPathComponent("探记HG", isDirectory: true)
        if !fileManager.fileExists(atPath: folder.path) {
            try? fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        }
        return folder.appendingPathComponent("tanji.sqlite")
    }

    /// 导出目录：沙盒 Documents（开启文件共享后即「文件」App 里的「探记 HG」文件夹）
    var documentsURL: URL {
        fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    /// 备份子目录：Documents/备份 —— 「探记 HG」文件夹内再分层，避免和实时库混在一起
    var backupFolderURL: URL {
        let folder = documentsURL.appendingPathComponent("备份", isDirectory: true)
        if !fileManager.fileExists(atPath: folder.path) {
            try? fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        }
        return folder
    }

    // MARK: - 打开与建表

    func open() throws {
        if database != nil { return }
        let db = try SQLiteDatabase(path: databaseURL.path)
        try createSchema(on: db)
        database = db
    }

    private func createSchema(on db: SQLiteDatabase) throws {
        try db.execute("""
        CREATE TABLE IF NOT EXISTS orders(
          mode TEXT NOT NULL,
          id INTEGER NOT NULL, store TEXT NOT NULL, category TEXT, contact TEXT,
          price REAL NOT NULL, deposit REAL DEFAULT 0,
          appt_at TEXT, shot_at TEXT, submitted_at TEXT, short_sent_at TEXT, long_sent_at TEXT,
          deposit_paid_at TEXT, final_paid_at TEXT, settle_via TEXT DEFAULT 'private', remind_at TEXT,
          channel TEXT, partner TEXT,
          location TEXT, gps_place TEXT, deliver_main INTEGER DEFAULT 1, deliver_sub INTEGER DEFAULT 1,
          review_result TEXT DEFAULT '', published_at TEXT,
          account_id INTEGER,
          note TEXT, remind_log TEXT, expect_pay_at TEXT, created_at TEXT, updated_at TEXT,
          PRIMARY KEY(mode,id))
        """)
        try db.execute("""
        CREATE TABLE IF NOT EXISTS payments(
          mode TEXT NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER, kind TEXT, amount REAL, paid_at TEXT, method TEXT, note TEXT)
        """)
        try db.execute("""
        CREATE TABLE IF NOT EXISTS accounts(
          mode TEXT NOT NULL,
          id INTEGER NOT NULL, name TEXT NOT NULL, phone TEXT, douyin TEXT,
          color INTEGER DEFAULT 0, avatar TEXT, created_at TEXT,
          PRIMARY KEY(mode,id))
        """)
        try db.execute("""
        CREATE TABLE IF NOT EXISTS settings(scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(scope,key))
        """)
    }

    // MARK: - 读写快照

    private static let orderColumns = ["id", "store", "category", "contact", "price", "deposit", "appt_at",
                                        "shot_at", "submitted_at", "short_sent_at", "long_sent_at",
                                        "deposit_paid_at", "final_paid_at", "settle_via", "remind_at",
                                        "channel", "partner", "location", "gps_place", "deliver_main", "deliver_sub",
                                        "review_result", "published_at", "account_id", "note", "remind_log",
                                        "expect_pay_at", "created_at", "updated_at"]

    /// 读取某个数据空间的快照：SQLite 与第二副本按修订号取新。
    func loadSnapshot(mode: DataSpace) throws -> LoadedSnapshot {
        try open()
        var sources: [Snapshot] = []
        if let raw = try settingValue(scope: mode.rawValue, key: "json"),
           let snapshot = decodeSnapshot(raw) {
            sources.append(snapshot)
        }
        if let mirror = decodeSnapshot(defaults.string(forKey: mirrorKey(mode))) {
            sources.append(mirror)
        }
        guard !sources.isEmpty else { return LoadedSnapshot(snapshot: nil, uncertain: false) }
        let best = sources.max { $0.revision < $1.revision } ?? sources[0]
        return LoadedSnapshot(snapshot: best, uncertain: false)
    }

    /// 写入快照：SQLite 为主副本，同时写一份 UserDefaults 镜像。
    @discardableResult
    func persist(_ snapshot: Snapshot, mode: DataSpace) throws -> Bool {
        try open()
        guard let db = database else { return false }
        let encoder = JSONEncoder()
        let timestamp = snapshot.savedAt
        try db.execute("BEGIN IMMEDIATE")
        do {
            try db.execute("DELETE FROM orders WHERE mode=?", [.text(mode.rawValue)])
            try db.execute("DELETE FROM payments WHERE mode=?", [.text(mode.rawValue)])
            try db.execute("DELETE FROM accounts WHERE mode=?", [.text(mode.rawValue)])

            let placeholders = Array(repeating: "?", count: Self.orderColumns.count).joined(separator: ",")
            let insertOrder = "INSERT INTO orders (mode,\(Self.orderColumns.joined(separator: ","))) VALUES (?,\(placeholders))"
            for order in snapshot.content.orders {
                try db.execute(insertOrder, [.text(mode.rawValue)] + Self.orderValues(order, timestamp: timestamp))
            }
            for payment in snapshot.content.payments {
                try db.execute("INSERT INTO payments (mode,order_id,kind,amount,paid_at,method,note) VALUES (?,?,?,?,?,?,?)",
                               [.text(mode.rawValue), .integer(Int64(payment.oid)), .text(payment.kind),
                                .real(payment.amount), .text(payment.at), .text(payment.method),
                                payment.note.map { SQLValue.text($0) } ?? SQLValue.null])
            }
            for account in snapshot.content.accounts {
                try db.execute("INSERT INTO accounts (mode,id,name,phone,douyin,color,avatar,created_at) VALUES (?,?,?,?,?,?,?,?)",
                               [.text(mode.rawValue), .integer(Int64(account.id)), .text(account.name),
                                .text(account.phone), .text(account.douyin), .integer(Int64(account.color)),
                                account.avatar.map { SQLValue.text($0) } ?? SQLValue.null,
                                account.createdAt.map { SQLValue.text($0) } ?? SQLValue.null])
            }

            let document = try encoder.encode(snapshot)
            if let text = String(data: document, encoding: .utf8) {
                try db.execute("INSERT OR REPLACE INTO settings (scope,key,value) VALUES (?,?,?)",
                               [.text(mode.rawValue), .text("json"), .text(text)])
                if let previous = snapshot.previous,
                   let previousText = String(data: try encoder.encode(previous), encoding: .utf8) {
                    try db.execute("INSERT OR REPLACE INTO settings (scope,key,value) VALUES (?,?,?)",
                                   [.text(mode.rawValue), .text("backup"), .text(previousText)])
                }
            }
            try db.execute("COMMIT")
        } catch {
            try? db.execute("ROLLBACK")
            throw error
        }
        // 第二副本：SQLite 写失败时至少数据还在，下次启动能按修订号取回
        if let document = try? encoder.encode(snapshot), let text = String(data: document, encoding: .utf8) {
            defaults.set(text, forKey: mirrorKey(mode))
        }
        return true
    }

    /// 读取替换前恢复点。
    func loadRestorePoint(mode: DataSpace) throws -> SnapshotContent? {
        try open()
        guard let raw = try settingValue(scope: mode.rawValue, key: "backup") else { return nil }
        return decodeContent(raw)
    }

    /// 单独保存恢复点（替换数据后调用）。
    func saveRestorePoint(_ content: SnapshotContent, mode: DataSpace) throws {
        try open()
        guard let db = database else { return }
        let encoder = JSONEncoder()
        guard let text = String(data: try encoder.encode(content), encoding: .utf8) else { return }
        try db.execute("INSERT OR REPLACE INTO settings (scope,key,value) VALUES (?,?,?)",
                       [.text(mode.rawValue), .text("backup"), .text(text)])
    }

    private func settingValue(scope: String, key: String) throws -> String? {
        guard let db = database else { return nil }
        let rows = try db.query("SELECT value FROM settings WHERE scope=? AND key=?", [.text(scope), .text(key)])
        return rows.first?["value"]?.stringValue
    }

    private func decodeSnapshot(_ raw: String?) -> Snapshot? {
        guard let raw, let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }

    private func decodeContent(_ raw: String?) -> SnapshotContent? {
        guard let raw, let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(SnapshotContent.self, from: data)
    }

    // MARK: - 数据空间记忆

    func rememberMode(_ mode: DataSpace) {
        let payload: [String: Any] = ["mode": mode.rawValue, "revision": Date().timeIntervalSince1970 * 1000]
        if let data = try? JSONSerialization.data(withJSONObject: payload),
           let text = String(data: data, encoding: .utf8) {
            defaults.set(text, forKey: "tanji_v3_mode")
        }
    }

    func rememberedMode() -> DataSpace? {
        guard let text = defaults.string(forKey: "tanji_v3_mode"),
              let data = text.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let mode = object["mode"] as? String,
              let value = DataSpace(rawValue: mode)
        else { return nil }
        return value
    }

    private func mirrorKey(_ mode: DataSpace) -> String { "tanji_v3_\(mode.rawValue)_json" }

    // MARK: - 行 ↔ 模型

    private static func orderValues(_ order: Order, timestamp: String) -> [SQLValue] {
        let remindLog = (order.remindLog?.isEmpty == false)
            ? (try? String(data: JSONEncoder().encode(order.remindLog ?? []), encoding: .utf8))
            : nil
        return [
            .integer(Int64(order.id)),
            .text(order.store),
            .text(order.cat),
            .text(order.contact),
            .real(order.price),
            .real(order.deposit),
            .text(order.appt),
            order.shotAt.map { SQLValue.text($0) } ?? SQLValue.null,
            order.submittedAt.map { SQLValue.text($0) } ?? SQLValue.null,
            order.shortAt.map { SQLValue.text($0) } ?? SQLValue.null,
            order.longAt.map { SQLValue.text($0) } ?? SQLValue.null,
            order.depositPaidAt.map { SQLValue.text($0) } ?? SQLValue.null,
            order.finalPaidAt.map { SQLValue.text($0) } ?? SQLValue.null,
            .text(order.settleVia),
            order.remindAt.map { SQLValue.text($0) } ?? SQLValue.null,
            .text(order.channel),
            .text(order.partner),
            .text(order.location),
            order.gpsPlace.map { SQLValue.text($0) } ?? SQLValue.null,
            .bool(order.deliverMain),
            .bool(order.deliverSub),
            .text(order.reviewResult),
            order.publishedAt.map { SQLValue.text($0) } ?? SQLValue.null,
            order.accountId.map { SQLValue.integer(Int64($0)) } ?? SQLValue.null,
            .text(order.note),
            remindLog.map { SQLValue.text($0) } ?? SQLValue.null,
            order.expectPayAt.map { SQLValue.text($0) } ?? SQLValue.null,
            .text(timestamp),
            .text(timestamp)
        ]
    }

    /// 从表里读回某个数据空间的全部数据（用于数据库导出前的自检与恢复点读取）。
    func readRows(mode: DataSpace) throws -> SnapshotContent {
        try open()
        guard let db = database else { throw SQLiteError.statementFailed("连接已关闭") }
        var orders: [Order] = []
        let orderRows = try db.query("SELECT * FROM orders WHERE mode=? ORDER BY id", [.text(mode.rawValue)])
        for row in orderRows {
            var order = Order(id: row["id"]?.intValue ?? 0,
                              store: row["store"]?.stringValue ?? "",
                              cat: row["category"]?.stringValue ?? "",
                              contact: row["contact"]?.stringValue ?? "",
                              price: row["price"]?.doubleValue ?? 0,
                              deposit: row["deposit"]?.doubleValue ?? 0,
                              appt: row["appt_at"]?.stringValue ?? "")
            order.shotAt = row["shot_at"]?.stringValue
            order.submittedAt = row["submitted_at"]?.stringValue
            order.shortAt = row["short_sent_at"]?.stringValue
            order.longAt = row["long_sent_at"]?.stringValue
            order.depositPaidAt = row["deposit_paid_at"]?.stringValue
            order.finalPaidAt = row["final_paid_at"]?.stringValue
            order.settleVia = row["settle_via"]?.stringValue ?? "private"
            order.remindAt = row["remind_at"]?.stringValue
            order.channel = row["channel"]?.stringValue ?? "直客"
            order.partner = row["partner"]?.stringValue ?? ""
            order.location = row["location"]?.stringValue ?? ""
            order.gpsPlace = row["gps_place"]?.stringValue
            order.deliverMain = (row["deliver_main"]?.intValue ?? 1) != 0
            order.deliverSub = (row["deliver_sub"]?.intValue ?? 1) != 0
            order.reviewResult = row["review_result"]?.stringValue ?? ""
            order.publishedAt = row["published_at"]?.stringValue
            order.accountId = row["account_id"]?.intValue
            order.note = row["note"]?.stringValue ?? ""
            if let raw = row["remind_log"]?.stringValue, let data = raw.data(using: .utf8),
               let entries = try? JSONDecoder().decode([RemindEntry].self, from: data), !entries.isEmpty {
                order.remindLog = entries
            }
            order.expectPayAt = row["expect_pay_at"]?.stringValue
            orders.append(order)
        }
        var payments: [Payment] = []
        let paymentRows = try db.query("SELECT * FROM payments WHERE mode=? ORDER BY id", [.text(mode.rawValue)])
        for row in paymentRows {
            guard let oid = row["order_id"]?.intValue,
                  let kind = row["kind"]?.stringValue,
                  let amount = row["amount"]?.doubleValue,
                  let at = row["paid_at"]?.stringValue else { continue }
            payments.append(Payment(oid: oid,
                                    kind: kind,
                                    amount: amount,
                                    at: at,
                                    method: row["method"]?.stringValue ?? "其他",
                                    note: row["note"]?.stringValue))
        }
        var accounts: [Account] = []
        let accountRows = try db.query("SELECT * FROM accounts WHERE mode=? ORDER BY id", [.text(mode.rawValue)])
        for row in accountRows {
            guard let id = row["id"]?.intValue, let name = row["name"]?.stringValue else { continue }
            accounts.append(Account(id: id,
                                    name: name,
                                    phone: row["phone"]?.stringValue ?? "",
                                    douyin: row["douyin"]?.stringValue ?? "",
                                    color: row["color"]?.intValue ?? 0,
                                    avatar: row["avatar"]?.stringValue,
                                    createdAt: row["created_at"]?.stringValue))
        }
        let threshold = Int(try settingValue(scope: mode.rawValue, key: "threshold") ?? "") ?? 15
        return SnapshotContent(orders: orders,
                               payments: payments,
                               threshold: threshold,
                               notifyEnabled: true,
                               accounts: accounts,
                               providers: [])
    }
}


/// 读取结果：快照内容 + 是否存疑（副本读不全时为 true）。
struct LoadedSnapshot {
    var snapshot: Snapshot?
    var uncertain: Bool
}
