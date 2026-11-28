import XCTest
@testable import TanjiNative

/// SQLite 存储层回归：写进去要能原样读回来，两套数据空间互不干扰。
///
/// 这一组专门防「列数与占位符对不上」那类静默失败 —— 写坏了必须在这里报错，
/// 不能等到用户点导出时才发现空文件。
final class DataStoreTests: XCTestCase {

    private var tempFolder: URL!
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        tempFolder = FileManager.default.temporaryDirectory.appendingPathComponent("tanji-store-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: tempFolder, withIntermediateDirectories: true)
        suiteName = "tanji.test.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        try? FileManager.default.removeItem(at: tempFolder)
        super.tearDown()
    }

    private func makeStore() -> DataStore {
        DataStore(defaults: defaults,
                  fileManager: .default,
                  databaseURL: tempFolder.appendingPathComponent("tanji.sqlite"))
    }

    private func sampleContent() -> SnapshotContent {
        SnapshotContent(data: AppData(
            orders: [
                SampleOrder.make(id: 1, store: "麓野日料", price: 1600, deposit: 500,
                                 appt: "2026-11-22T14:00", depositPaidAt: "2026-11-20T10:00",
                                 location: "万象城 3F", gpsPlace: "22.543096,114.057865",
                                 remindLog: [RemindEntry(at: "2026-11-21T09:00", note: "微信问了一次")]),
                SampleOrder.make(id: 2, store: "澄川咖啡", price: 800, deposit: 300,
                                 appt: "2026-11-23T09:30", settleVia: "douyin")
            ],
            payments: [
                Payment(oid: 1, kind: "定金", amount: 500, at: "2026-11-20T10:00", method: "微信", note: "首款")
            ],
            threshold: 30,
            notifyEnabled: false,
            accounts: [Account(id: 1, name: "大王", phone: "13800000000", douyin: "dawang", color: 3, level: "Lv.7")],
            providers: ["蜂向", "小爱"]
        ))
    }

    func testPersistAndLoadRoundTrip() throws {
        let store = makeStore()
        let content = sampleContent()
        let snapshot = Snapshot(content: content, revision: 100, savedAt: Format.isoString(), mode: DataSpace.work.rawValue)
        try store.persist(snapshot, mode: .work)

        let loaded = try store.loadSnapshot(mode: .work)
        let result = try XCTUnwrap(loaded.snapshot)
        XCTAssertEqual(result.content.orders.count, 2)
        XCTAssertEqual(result.content.orders[0].store, "麓野日料")
        XCTAssertEqual(result.content.orders[0].price, 1600)
        XCTAssertEqual(result.content.orders[0].location, "万象城 3F")
        XCTAssertEqual(result.content.orders[0].gpsPlace, "22.543096,114.057865")
        XCTAssertEqual(result.content.orders[0].remindEntries.count, 1, "催收跟进痕迹要能原样读回")
        XCTAssertEqual(result.content.orders[1].settleVia, "douyin")
        XCTAssertEqual(result.content.payments.count, 1)
        XCTAssertEqual(result.content.payments[0].note, "首款")
        XCTAssertEqual(result.content.accounts.first?.name, "大王")
        XCTAssertEqual(result.content.threshold, 30)
        XCTAssertFalse(result.content.notifyEnabled)
        XCTAssertEqual(result.content.providers, ["蜂向", "小爱"])
        // 勋章门槛与账号等级都要能原样存回、读回。
        XCTAssertEqual(result.content.medalRules, MedalRules.standard)
        XCTAssertEqual(result.content.accounts.first?.levelTitle, "Lv.7")
    }

    /// 勋章门槛存进快照再读回来要一模一样（两套数据空间各存各的）。
    func testMedalRulesRoundTrip() throws {
        let store = makeStore()
        let rules = MedalRules(busyOrders: 4, salesAmount: 1200, hotOrders: 6, aceAmount: 3200)
        var content = sampleContent()
        content.medalRules = rules
        try store.persist(Snapshot(content: content, revision: 1, savedAt: Format.isoString(),
                                   mode: DataSpace.work.rawValue), mode: .work)

        let loaded = try XCTUnwrap(try store.loadSnapshot(mode: .work).snapshot)
        XCTAssertEqual(loaded.content.medalRules, rules, "门槛要能原样存回")
    }

    func testTwoDataSpacesAreIsolated() throws {
        let store = makeStore()
        let work = Snapshot(content: sampleContent(), revision: 1, savedAt: Format.isoString(), mode: DataSpace.work.rawValue)
        var demoContent = sampleContent()
        demoContent.orders = [SampleOrder.make(id: 9, store: "演示单", price: 100)]
        let demo = Snapshot(content: demoContent, revision: 1, savedAt: Format.isoString(), mode: DataSpace.demo.rawValue)
        try store.persist(work, mode: .work)
        try store.persist(demo, mode: .demo)

        let loadedWork = try XCTUnwrap(try store.loadSnapshot(mode: .work).snapshot)
        let loadedDemo = try XCTUnwrap(try store.loadSnapshot(mode: .demo).snapshot)
        XCTAssertEqual(loadedWork.content.orders.count, 2)
        XCTAssertEqual(loadedDemo.content.orders.count, 1)
        XCTAssertEqual(loadedDemo.content.orders[0].store, "演示单")
    }

    func testRestorePointIsKept() throws {
        let store = makeStore()
        let before = Snapshot(content: sampleContent(), revision: 1, savedAt: Format.isoString(), mode: DataSpace.work.rawValue)
        var afterContent = sampleContent()
        afterContent.orders = []
        afterContent.payments = []
        let after = Snapshot(content: afterContent, revision: 2, savedAt: Format.isoString(),
                             mode: DataSpace.work.rawValue, previous: before.content)
        try store.persist(after, mode: .work)

        let point = try XCTUnwrap(try store.loadRestorePoint(mode: .work))
        XCTAssertEqual(point.orders.count, 2, "恢复点要能读回替换前的数据")
        XCTAssertEqual(point.orders[0].store, "麓野日料")
    }

    func testNewerRevisionWins() throws {
        let store = makeStore()
        let older = Snapshot(content: sampleContent(), revision: 10, savedAt: Format.isoString(), mode: DataSpace.work.rawValue)
        try store.persist(older, mode: .work)

        // 第二副本比主副本新：读回来应取新的
        var newerContent = sampleContent()
        newerContent.orders = [SampleOrder.make(id: 99, store: "更新的数据")]
        let newer = Snapshot(content: newerContent, revision: 99, savedAt: Format.isoString(), mode: DataSpace.work.rawValue)
        let encoder = JSONEncoder()
        let text = String(data: try encoder.encode(newer), encoding: .utf8)!
        defaults.set(text, forKey: "tanji_v3_work_json")

        let loaded = try XCTUnwrap(try store.loadSnapshot(mode: .work).snapshot)
        XCTAssertEqual(loaded.revision, 99)
        XCTAssertEqual(loaded.content.orders.first?.store, "更新的数据")
    }

    func testTablesMatchSchema() throws {
        // 直接查表：确认列与写入语句对得上（Web 版曾因列数与占位符不一致而静默写空）
        let store = makeStore()
        try store.persist(Snapshot(content: sampleContent(), revision: 1, savedAt: Format.isoString(),
                                   mode: DataSpace.work.rawValue), mode: .work)
        let db = try SQLiteDatabase(path: store.databaseURL.path)
        let orders = try db.query("SELECT COUNT(*) AS c FROM orders WHERE mode=?", [.text("work")])
        XCTAssertEqual(orders.first?["c"]?.intValue, 2)
        let payments = try db.query("SELECT COUNT(*) AS c FROM payments WHERE mode=?", [.text("work")])
        XCTAssertEqual(payments.first?["c"]?.intValue, 1)
        let accounts = try db.query("SELECT COUNT(*) AS c FROM accounts WHERE mode=?", [.text("work")])
        XCTAssertEqual(accounts.first?["c"]?.intValue, 1)
        let settings = try db.query("SELECT COUNT(*) AS c FROM settings WHERE scope=?", [.text("work")])
        XCTAssertEqual(settings.first?["c"]?.intValue, 1)
        let columns = try db.query("PRAGMA table_info(orders)")
        XCTAssertEqual(columns.count, 30, "orders 表列数要与写入语句一致")
    }

    /// 老库升级：accounts 表是后加 `level` 列的，旧库没有这一列。
    ///
    /// 打开旧库时必须自动补列，且**旧账号的等级要回落 Lv.5**（不是 nil、也不是空串）。
    func testOldDatabaseGetsLevelColumn() throws {
        let url = tempFolder.appendingPathComponent("tanji.sqlite")
        // 先按老结构建一个库：accounts 表没有 level 列，且已有一条账号。
        try createLegacyDatabase(at: url)

        // 打开旧库即触发建表与补列。
        let store = makeStore()
        try store.open()

        let db = try SQLiteDatabase(path: url.path)
        let columns = try db.query("PRAGMA table_info(accounts)")
        XCTAssertTrue(columns.contains { $0["name"]?.stringValue == "level" },
                      "老库打开后要自动补上 level 列")

        // 老账号那一行：等级列是新加的，值应回落 Lv.5。
        let rows = try db.query("SELECT id,name,level FROM accounts WHERE mode=? AND id=1", [.text("work")])
        XCTAssertEqual(rows.first?["name"]?.stringValue, "老账号", "补列不能动已有数据")
        XCTAssertEqual(rows.first?["level"]?.stringValue, "Lv.5", "老账号等级应回落 Lv.5")
    }

    /// 建一个「升级前」的库：accounts 表没有 level 列，已有一条账号。
    private func createLegacyDatabase(at url: URL) throws {
        let legacy = try SQLiteDatabase(path: url.path)
        try legacy.execute("""
        CREATE TABLE accounts(
          mode TEXT NOT NULL,
          id INTEGER NOT NULL, name TEXT NOT NULL, phone TEXT, douyin TEXT,
          color INTEGER DEFAULT 0, avatar TEXT, created_at TEXT,
          PRIMARY KEY(mode,id))
        """)
        try legacy.execute("INSERT INTO accounts (mode,id,name) VALUES ('work',1,'老账号')")
    }
}
