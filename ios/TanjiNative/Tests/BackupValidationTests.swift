import XCTest
@testable import TanjiNative

/// 备份校验与导入导出的回归测试。
///
/// 对应 Web 版 `src/app/storage.js` 的 `validateState` 与 `src/app/export.js`：
/// 旧版备份必须继续可导入，报错文案要能直接告诉用户哪里不对。
final class BackupValidationTests: XCTestCase {

    private func json(_ text: String) -> Data { Data(text.utf8) }

    private var minimalBackup: String {
        """
        {"app":"探记 TanJi","version":"0.6","exportedAt":"2026-11-20T10:00:00Z",
         "threshold":15,"notifyEnabled":true,
         "accounts":[],"providers":[],
         "orders":[{"id":1,"store":"麓野日料","cat":"餐饮","contact":"王店长","price":1600,"deposit":500,
                    "appt":"2026-11-22T14:00","settleVia":"private","deliverMain":true,"deliverSub":true}],
         "payments":[]}
        """
    }

    // MARK: - 基本解析

    func testParsesMinimalBackup() throws {
        let state = try BackupValidator.parse(json(minimalBackup))
        XCTAssertEqual(state.orders.count, 1)
        XCTAssertEqual(state.orders[0].store, "麓野日料")
        XCTAssertEqual(state.threshold, 15)
        XCTAssertTrue(state.notifyEnabled)
        XCTAssertEqual(state.orders[0].settleVia, "private")
        XCTAssertTrue(state.orders[0].deliverMain, "缺省必须是要正片（不能把老单的副片要求静默关掉）")
        XCTAssertTrue(state.orders[0].deliverSub)
    }

    func testAcceptsLegacyVersions() throws {
        for version in ["0.2", "0.3", "0.4", "0.5", "0.6"] {
            let text = minimalBackup.replacingOccurrences(of: "\"version\":\"0.6\"", with: "\"version\":\"\(version)\"")
            let state = try BackupValidator.parse(json(text))
            XCTAssertEqual(state.orders.count, 1, "版本 \(version) 必须可导入")
        }
    }

    func testRejectsUnknownVersion() {
        let text = minimalBackup.replacingOccurrences(of: "\"version\":\"0.6\"", with: "\"version\":\"0.9\"")
        XCTAssertThrowsError(try BackupValidator.parse(json(text))) { error in
            XCTAssertEqual(error.localizedDescription, "暂不支持这个备份版本")
        }
    }

    func testRejectsMissingArrays() {
        let text = "{\"threshold\":15}"
        XCTAssertThrowsError(try BackupValidator.parse(json(text))) { error in
            XCTAssertEqual(error.localizedDescription, "备份必须包含订单与收款流水数组")
        }
    }

    func testRejectsBadThreshold() {
        let text = minimalBackup.replacingOccurrences(of: "\"threshold\":15", with: "\"threshold\":9")
        XCTAssertThrowsError(try BackupValidator.parse(json(text))) { error in
            XCTAssertEqual(error.localizedDescription, "催收阈值应为 7、15、30 或 45 天")
        }
    }

    func testRejectsDuplicateOrderId() {
        let text = minimalBackup.replacingOccurrences(
            of: "\"orders\":[{\"id\":1",
            with: "\"orders\":[{\"id\":1,\"store\":\"重复\"},{\"id\":1")
        XCTAssertThrowsError(try BackupValidator.parse(json(text)))
    }

    func testRejectsOrderIdOverLimit() {
        let text = minimalBackup.replacingOccurrences(of: "\"id\":1,\"store\"", with: "\"id\":100000,\"store\"")
        XCTAssertThrowsError(try BackupValidator.parse(json(text))) { error in
            XCTAssertEqual(error.localizedDescription, "第 1 笔订单的 ID 无效、重复或超过上限(99999)")
        }
    }

    func testRejectsMissingStore() {
        let text = minimalBackup.replacingOccurrences(of: "\"store\":\"麓野日料\"", with: "\"store\":\"\"")
        XCTAssertThrowsError(try BackupValidator.parse(json(text))) { error in
            XCTAssertEqual(error.localizedDescription, "第 1 笔订单缺少商家名称")
        }
    }

    func testRejectsBadAppt() {
        let text = minimalBackup.replacingOccurrences(of: "\"appt\":\"2026-11-22T14:00\"", with: "\"appt\":\"2026-13-40T99:00\"")
        XCTAssertThrowsError(try BackupValidator.parse(json(text))) { error in
            XCTAssertEqual(error.localizedDescription, "第 1 笔订单的预约时间无效")
        }
    }

    func testRejectsPaymentWithoutOrder() {
        let text = minimalBackup.replacingOccurrences(
            of: "\"payments\":[]",
            with: "\"payments\":[{\"oid\":99,\"kind\":\"定金\",\"amount\":100,\"at\":\"2026-11-22T10:00\",\"method\":\"微信\"}]")
        XCTAssertThrowsError(try BackupValidator.parse(json(text))) { error in
            XCTAssertEqual(error.localizedDescription, "第 1 笔流水找不到对应订单")
        }
    }

    func testRejectsBadMethod() {
        let text = minimalBackup.replacingOccurrences(
            of: "\"payments\":[]",
            with: "\"payments\":[{\"oid\":1,\"kind\":\"定金\",\"amount\":100,\"at\":\"2026-11-22T10:00\",\"method\":\"比特币\"}]")
        XCTAssertThrowsError(try BackupValidator.parse(json(text))) { error in
            XCTAssertEqual(error.localizedDescription, "第 1 笔流水的收款方式无效")
        }
    }

    func testRejectsInvalidAvatar() {
        let text = minimalBackup.replacingOccurrences(
            of: "\"accounts\":[]",
            with: "\"accounts\":[{\"id\":1,\"name\":\"大王\",\"avatar\":\"<img src=x onerror=alert(1)>\"}]")
        XCTAssertThrowsError(try BackupValidator.parse(json(text))) { error in
            XCTAssertEqual(error.localizedDescription, "第 1 个账号的头像数据无效")
        }
    }

    func testNormalizesDanglingAccountId() throws {
        let text = minimalBackup.replacingOccurrences(
            of: "\"accounts\":[]",
            with: "\"accounts\":[{\"id\":1,\"name\":\"大王\"}]")
            .replacingOccurrences(of: "\"settleVia\":\"private\"", with: "\"settleVia\":\"private\",\"accountId\":77")
        let state = try BackupValidator.parse(json(text))
        XCTAssertNil(state.orders[0].accountId, "指向不存在账号的 accountId 归一为未指定，不报错")
    }

    // MARK: - 与混合版「探记 HG」备份的互通

    /// 混合版（Capacitor，bundle `ord.tanji`）的 `backupDocument()` 产出的真实结构。
    ///
    /// 结构来源：src/app/storage.js 的
    /// `backupDocument(){return {app:'探记 TanJi',version:'0.6',exportedAt:...,threshold:...,
    /// notifyEnabled:...,accounts:...,providers:...,orders:...,payments:...}}`
    /// 订单字段名来自 `validateState` 的 `clean` 对象（camelCase），
    /// 这里刻意填满所有混合版会写出的字段，验证原生版能整份吃下。
    func testImportsHybridAppBackup() throws {
        let hybridBackup = """
        {
          "app": "探记 TanJi",
          "version": "0.6",
          "exportedAt": "2026-11-28T09:30:00.000Z",
          "threshold": 15,
          "notifyEnabled": true,
          "accounts": [
            {"id":1,"name":"大王","phone":"13800000000","douyin":"dawang","color":2,
             "avatar":"","createdAt":"2026-11-01T10:00:00Z"}
          ],
          "providers": ["蜂向","小爱","金城"],
          "orders": [
            {"id":1,"store":"麓野日料","cat":"餐饮","contact":"王店长",
             "price":1600,"deposit":500,"appt":"2026-11-22T14:00",
             "shotAt":"2026-11-22T15:00","submittedAt":"2026-11-23T10:00",
             "shortAt":"2026-11-24T10:00","longAt":"2026-11-25T10:00",
             "depositPaidAt":"2026-11-23T12:00","finalPaidAt":"2026-11-26T12:00",
             "settleVia":"private","remindAt":"2026-11-27T09:00","channel":"蜂向",
             "partner":"花花","location":"万象城 L3","deliverMain":true,"deliverSub":true,
             "reviewResult":"pass","publishedAt":"2026-11-27T18:00","accountId":1,
             "note":"加急","remindLog":[{"at":"2026-11-26T09:00","note":"微信问了一次"}],
             "expectPayAt":"2026-11-30T00:00","gpsPlace":"22.543096,114.057865"}
          ],
          "payments": [
            {"oid":1,"kind":"定金","amount":500,"at":"2026-11-23T12:00","method":"微信","note":null},
            {"oid":1,"kind":"尾款","amount":1100,"at":"2026-11-26T12:00","method":"支付宝","note":"结清"}
          ]
        }
        """
        let state = try BackupValidator.parse(json(hybridBackup))

        XCTAssertEqual(state.orders.count, 1)
        let order = try XCTUnwrap(state.orders.first)
        XCTAssertEqual(order.store, "麓野日料")
        XCTAssertEqual(order.price, 1600)
        XCTAssertEqual(order.deposit, 500)
        XCTAssertEqual(order.settleVia, "private")
        XCTAssertEqual(order.channel, "蜂向")
        XCTAssertEqual(order.partner, "花花")
        XCTAssertEqual(order.location, "万象城 L3")
        XCTAssertEqual(order.reviewResult, "pass")
        XCTAssertEqual(order.accountId, 1)
        XCTAssertEqual(order.deliverMain, true)
        XCTAssertEqual(order.deliverSub, true)
        XCTAssertEqual(order.shotAt, "2026-11-22T15:00")
        XCTAssertEqual(order.remindEntries.count, 1)
        XCTAssertEqual(order.remindEntries.first?.note, "微信问了一次")
        // 到店定位：混合版存储格式是 `lat,lng`（英文逗号、无空格，
        // 见 www/geo.js 的 format()）；带空格的是展示格式 label()，两版解析口径一致。
        XCTAssertEqual(order.gpsPlace, "22.543096,114.057865")

        XCTAssertEqual(state.payments.count, 2)
        XCTAssertEqual(state.payments[0].kind, "定金")
        XCTAssertEqual(state.payments[1].kind, "尾款")
        XCTAssertEqual(state.payments[1].method, "支付宝")

        XCTAssertEqual(state.accounts.count, 1)
        XCTAssertEqual(state.accounts.first?.name, "大王")
        XCTAssertEqual(state.providers, ["蜂向","小爱","金城"])
        XCTAssertEqual(state.threshold, 15)
        XCTAssertTrue(state.notifyEnabled)
    }

    /// 混合版导出带 UTF-8 BOM（`download()` 里给文本加了 `\ufeff`），
    /// 原生版必须能剥掉 BOM 再解析。
    func testImportsHybridBackupWithBOM() throws {
        var data = Data("\u{FEFF}".utf8)
        data.append(Data(minimalBackup.utf8))
        let state = try BackupValidator.parse(data)
        XCTAssertEqual(state.orders.count, 1)
    }

    // MARK: - 往返

    func testExportImportRoundTrip() throws {
        var temp = FileManager.default.temporaryDirectory
        temp.appendPathComponent("tanji-backup-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temp) }

        let source = AppData(
            orders: [SampleOrder.make(id: 7, store: "麓野日料·万象城店", price: 1600, deposit: 500,
                                      appt: "2026-11-22T14:00", depositPaidAt: "2026-11-20T10:00",
                                      remindLog: [RemindEntry(at: "2026-11-21T09:00", note: "微信问了一次")])],
            payments: [Payment(oid: 7, kind: "定金", amount: 500, at: "2026-11-20T10:00", method: "微信", note: nil)],
            threshold: 30,
            notifyEnabled: false,
            accounts: [Account(id: 1, name: "大王", phone: "13800000000", douyin: "dawang", color: 2)],
            providers: ["蜂向"]
        )

        let url = try BackupService.exportJSON(source, folder: temp)
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
        XCTAssertTrue(url.lastPathComponent.hasPrefix("探记-备份-"))
        XCTAssertEqual(url.pathExtension, "json")

        let imported = try BackupService.loadImport(from: url)
        XCTAssertEqual(imported.orders.count, 1)
        XCTAssertEqual(imported.orders[0].store, "麓野日料·万象城店")
        XCTAssertEqual(imported.orders[0].price, 1600)
        XCTAssertEqual(imported.orders[0].remindEntries.count, 1)
        XCTAssertEqual(imported.payments.count, 1)
        XCTAssertEqual(imported.payments[0].amount, 500)
        XCTAssertEqual(imported.threshold, 30)
        XCTAssertFalse(imported.notifyEnabled)
        XCTAssertEqual(imported.accounts.first?.name, "大王")
        XCTAssertEqual(imported.providers, ["蜂向"])
    }

    func testExportFileNameGetsDate() throws {
        var temp = FileManager.default.temporaryDirectory
        temp.appendPathComponent("tanji-backup-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temp) }

        let url = try BackupService.exportJSON(AppData(), folder: temp)
        XCTAssertTrue(url.lastPathComponent.contains(Format.today()), "备份文件名要带日期")
    }

    func testExportDoesNotOverwriteExistingFile() throws {
        var temp = FileManager.default.temporaryDirectory
        temp.appendPathComponent("tanji-backup-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temp) }

        let first = try BackupService.exportJSON(AppData(), folder: temp)
        let second = try BackupService.exportJSON(AppData(), folder: temp)
        XCTAssertNotEqual(first.lastPathComponent, second.lastPathComponent, "同名文件不能被覆盖")
        XCTAssertTrue(FileManager.default.fileExists(atPath: first.path))
    }

    func testCSVExportContainsOrdersAndPayments() throws {
        var temp = FileManager.default.temporaryDirectory
        temp.appendPathComponent("tanji-csv-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temp) }

        let source = AppData(
            orders: [SampleOrder.make(id: 7, store: "麓野日料", price: 1600, deposit: 500)],
            payments: [Payment(oid: 7, kind: "定金", amount: 500, at: "2026-11-20T10:00", method: "微信", note: nil)],
            threshold: 15, notifyEnabled: true, accounts: [], providers: [])
        let url = try BackupService.exportCSV(source, folder: temp)
        let raw = try Data(contentsOf: url)
        XCTAssertEqual(Array(raw.prefix(3)), [0xEF, 0xBB, 0xBF], "带 BOM，Excel 打开中文才不乱码")
        let text = String(decoding: raw, as: UTF8.self)
        XCTAssertTrue(text.contains("麓野日料"))
        XCTAssertTrue(text.contains("收款方式"))
        XCTAssertTrue(text.contains("定金"))
    }

    func testImportRejectsPaymentMismatch() {
        let source = AppData(
            orders: [SampleOrder.make(id: 7, store: "麓野日料", price: 1600, deposit: 500,
                                      depositPaidAt: "2026-11-20T10:00")],
            payments: [Payment(oid: 7, kind: "定金", amount: 400, at: "2026-11-20T10:00", method: "微信", note: nil)],
            threshold: 15, notifyEnabled: true, accounts: [], providers: [])
        XCTAssertThrowsError(try BackupService.verifyPaymentsConsistency(source)) { error in
            XCTAssertTrue(error.localizedDescription.contains("流水与已收状态不一致"))
        }
    }

    // MARK: - 勋章门槛与账号等级

    private var backupWithMedalRules: String {
        """
        {"app":"探记 TanJi","version":"0.6","exportedAt":"2026-11-20T10:00:00Z",
         "threshold":15,"notifyEnabled":true,
         "accounts":[{"id":1,"name":"小满","phone":"","douyin":"","color":0,"level":"Lv.7"}],
         "providers":[],
         "medalRules":{"busyOrders":2,"salesAmount":800,"hotOrders":4,"aceAmount":2000},
         "orders":[],"payments":[]}
        """
    }

    func testParsesMedalRulesAndAccountLevel() throws {
        let state = try BackupValidator.parse(json(backupWithMedalRules))
        XCTAssertEqual(state.medalRules.busyOrders, 2)
        XCTAssertEqual(state.medalRules.salesAmount, 800)
        XCTAssertEqual(state.medalRules.hotOrders, 4)
        XCTAssertEqual(state.medalRules.aceAmount, 2000)
        XCTAssertEqual(state.accounts.first?.levelTitle, "Lv.7")
    }

    func testRejectsInvalidAccountLevel() {
        let text = backupWithMedalRules.replacingOccurrences(of: "\"level\":\"Lv.7\"", with: "\"level\":\"Lv.9\"")
        XCTAssertThrowsError(try BackupValidator.parse(json(text))) { error in
            XCTAssertTrue(error.localizedDescription.contains("等级"), "错误文案要说明等级不合法")
        }
    }

    func testRejectsInvalidMedalRules() {
        // 爆单单数必须严于忙碌日单数。
        let text = backupWithMedalRules.replacingOccurrences(of: "\"hotOrders\":4", with: "\"hotOrders\":1")
        XCTAssertThrowsError(try BackupValidator.parse(json(text))) { error in
            XCTAssertTrue(error.localizedDescription.contains("爆单"))
        }
    }

    func testLegacyBackupHasNoMedalRules() throws {
        // 旧备份没有门槛字段：解析结果要能区分「没有」和「恰好是默认值」。
        let parsed = try BackupValidator.parseDetailed(json(minimalBackup))
        XCTAssertFalse(parsed.hasMedalRules)
        XCTAssertEqual(parsed.data.medalRules, MedalRules.standard)
    }

    func testImportKeepsCurrentMedalRulesForLegacyBackup() throws {
        var temp = FileManager.default.temporaryDirectory
        temp.appendPathComponent("tanji-legacy-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temp) }

        let url = temp.appendingPathComponent("legacy.json")
        try json(minimalBackup).write(to: url)

        let current = MedalRules(busyOrders: 1, salesAmount: 100, hotOrders: 2, aceAmount: 200)
        let imported = try BackupService.loadImport(from: url, fallbackMedalRules: current)
        XCTAssertEqual(imported.medalRules, current, "旧备份没有门槛配置时应沿用当前配置，而不是回落默认值")
    }

    func testExportImportKeepsMedalRulesAndLevel() throws {
        var temp = FileManager.default.temporaryDirectory
        temp.appendPathComponent("tanji-backup-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temp) }

        let source = AppData(
            orders: [],
            payments: [],
            threshold: 15,
            notifyEnabled: true,
            accounts: [Account(id: 1, name: "小满", level: "Lv.6")],
            providers: [],
            medalRules: MedalRules(busyOrders: 2, salesAmount: 800, hotOrders: 4, aceAmount: 2000))

        let url = try BackupService.exportJSON(source, folder: temp)
        let imported = try BackupService.loadImport(from: url)
        XCTAssertEqual(imported.medalRules, source.medalRules)
        XCTAssertEqual(imported.accounts.first?.levelTitle, "Lv.6")
    }

    /// 混合版（Capacitor）导出的备份，原生版要能原样读进去。
    ///
    /// 样本是混合版 `storage.js` 的 `backupDocument()` 真实输出（用 Node 跑出来的原样 JSON）：
    /// 顶层带 `medalRules`，账号带 `level`，其中一条账号没有 `level`（旧备份形态）。
    func testReadsHybridVersionBackup() throws {
        let json = """
        {
          "app": "探记 TanJi",
          "version": "0.6",
          "exportedAt": "2026-11-28T11:55:58.466Z",
          "threshold": 15,
          "notifyEnabled": true,
          "accounts": [
            { "id": 1, "name": "混合版账号甲", "level": "Lv.7", "phone": "13800000000", "douyin": "hg_a", "color": 2, "createdAt": "2026-11-01T10:00" },
            { "id": 2, "name": "混合版账号乙", "level": "Lv.6", "phone": "", "douyin": "", "color": 5, "createdAt": "2026-11-02T10:00" },
            { "id": 3, "name": "没有等级的旧账号", "phone": "", "douyin": "", "color": 1, "createdAt": "2026-11-03T10:00" }
          ],
          "providers": ["蜂向"],
          "medalRules": { "busyOrders": 4, "salesAmount": 1200, "hotOrders": 6, "aceAmount": 3200 },
          "orders": [
            { "id": 1, "store": "麓野日料", "cat": "餐饮", "contact": "王店长", "price": 1600, "deposit": 500,
              "appt": "2026-11-28T14:00", "deliverMain": true, "deliverSub": true,
              "settleVia": "private", "reviewResult": "", "note": "", "remindLog": [] }
          ],
          "payments": []
        }
        """
        let data = Data(json.utf8)
        let parsed = try BackupValidator.parseDetailed(data)
        XCTAssertTrue(parsed.hasMedalRules, "混合版备份带了门槛，不该走旧备份兜底")
        XCTAssertEqual(parsed.data.medalRules,
                       MedalRules(busyOrders: 4, salesAmount: 1200, hotOrders: 6, aceAmount: 3200))
        XCTAssertEqual(parsed.data.accounts.count, 3)
        XCTAssertEqual(parsed.data.accounts[0].levelTitle, "Lv.7")
        XCTAssertEqual(parsed.data.accounts[1].levelTitle, "Lv.6")
        XCTAssertEqual(parsed.data.accounts[2].levelTitle, "Lv.5", "没等级的账号要回落 Lv.5")
        XCTAssertEqual(parsed.data.orders.count, 1)
        XCTAssertEqual(parsed.data.orders[0].store, "麓野日料")
        XCTAssertEqual(parsed.data.providers, ["蜂向"])
    }
}
