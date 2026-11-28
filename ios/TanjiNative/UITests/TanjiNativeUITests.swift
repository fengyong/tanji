import XCTest

/// 原生 UI 回归：覆盖「只能靠点按验证」的几条路径。
///
/// 自动化跑不了真机手势，这一组负责守住主干：
/// 启动 → 五个 Tab 可切换 → 订单详情能打开 → 设置页能导出备份。
///
/// 定位方式：能用 `accessibilityIdentifier` 就用标识（订单行 `order.row.<id>`、
/// 导出按钮 `export.json`）；只有标识缺失时才退回文案匹配，
/// 且一律用 CONTAINS（这些按钮的可访问性标签是「标题 + 副标题」的拼接串）。
final class TanjiNativeUITests: XCTestCase {

    private var app: XCUIApplication!

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        app = XCUIApplication()
        // 每次启动先重置成 Demo 种子：测试会推进订单状态、打卡，
        // 不重置的话后一个用例的起点会被前一个改掉。
        app.launchArguments = ["-tanji-reset"]
        app.launch()
    }

    private func tabBarButton(_ name: String) -> XCUIElement {
        app.tabBars.buttons[name]
    }

    /// 按文案包含关系找按钮（.plain 按钮的标签是子元素拼接，不能用等值匹配）。
    private func button(containing text: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    func testLaunchShowsHome() {
        XCTAssertTrue(app.staticTexts["今日安排"].waitForExistence(timeout: 8), "首页应显示「今日安排」")
        // 首屏卡片有三种形态（下一站 / 今天的店都拍完了 / 今天没有安排），
        // 取决于当天的数据状态，这里只断言首屏卡片确实出现了。
        let kickers = ["下一站", "Next stop / 下一站", "Today / 今日完成", "A clear day / 空白档期"]
        let hasCard = kickers.contains { app.staticTexts[$0].exists }
        XCTAssertTrue(hasCard, "首页应显示首屏安排卡片")
    }

    func testSwitchesAcrossTabs() {
        XCTAssertTrue(tabBarButton("行程").waitForExistence(timeout: 8))
        tabBarButton("行程").tap()
        XCTAssertTrue(app.staticTexts["行程"].waitForExistence(timeout: 5), "切到行程页")

        tabBarButton("订单").tap()
        XCTAssertTrue(app.staticTexts["订单"].waitForExistence(timeout: 5), "切到订单页")

        tabBarButton("收款").tap()
        XCTAssertTrue(app.staticTexts["收款"].waitForExistence(timeout: 5), "切到收款页")

        tabBarButton("统计").tap()
        XCTAssertTrue(app.staticTexts["统计"].waitForExistence(timeout: 5), "切到统计页")
        XCTAssertTrue(app.staticTexts["每日实收"].waitForExistence(timeout: 5), "统计页应有「每日实收」图表")
    }

    /// 首页的跨标签跳转必须**直接切过去**，不能只弹「请在底部切到…」的提示。
    func testHomeJumpsAcrossTabs() {
        XCTAssertTrue(app.staticTexts["今日安排"].waitForExistence(timeout: 8), "应在首页")

        // 「今日拍摄」分区标题右侧的「整月行程 ›」
        let tripLink = app.buttons.matching(
            NSPredicate(format: "label CONTAINS %@", "整月行程")
        ).firstMatch
        XCTAssertTrue(tripLink.waitForExistence(timeout: 6), "首页应有「整月行程 ›」入口")
        tripLink.tap()

        XCTAssertTrue(app.staticTexts["行程"].waitForExistence(timeout: 6), "点「整月行程 ›」应直接切到行程页")
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "请在底部")).firstMatch.exists,
            "跨标签跳转不应再弹「请在底部切到…」的提示"
        )

        // 切回首页，验证「统计 ›」
        tabBarButton("首页").tap()
        let statsLink = app.buttons.matching(
            NSPredicate(format: "label CONTAINS %@", "统计 ›")
        ).firstMatch
        XCTAssertTrue(statsLink.waitForExistence(timeout: 6), "首页应有「统计 ›」入口")
        statsLink.tap()
        XCTAssertTrue(app.staticTexts["统计"].waitForExistence(timeout: 6), "点「统计 ›」应直接切到统计页")
    }

    func testOpensOrderDetail() {
        tabBarButton("订单").tap()
        // 用标识找订单行：靠「第一个按钮」会误命中顶栏的隐私开关。
        let firstRow = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "order.row.")
        ).firstMatch
        XCTAssertTrue(firstRow.waitForExistence(timeout: 8), "订单页应有订单行")
        firstRow.tap()

        // 详情弹层里必须有可执行的动作，才算打开成功。
        // 详情页的行内动作随工作线状态变化，这里只要出现任一推进按钮即可。
        let candidates = ["到店了，标记已拍摄", "已选完，标记提审", "标记发副片", "标记发正片", "标记已发布"]
        let opened = candidates.contains { button(containing: $0).waitForExistence(timeout: 3) }
        XCTAssertTrue(opened, "订单详情应打开并给出推进动作按钮")
    }

    func testSettingsExportsBackup() {
        tabBarButton("统计").tap()
        let gear = app.buttons["打开设置"].firstMatch
        XCTAssertTrue(gear.waitForExistence(timeout: 6), "统计页应有设置入口")
        gear.tap()
        XCTAssertTrue(app.staticTexts["设置"].waitForExistence(timeout: 6), "应进入设置页")

        let export = app.buttons["export.json"].firstMatch
        XCTAssertTrue(export.waitForExistence(timeout: 6), "设置页应有「保存 JSON 备份」")
        export.tap()

        // 导出后要能看到「已保存到「文件 › 探记」」的提示。
        // 提示条挂在设置页这一层的宿主上（sheet 会盖住根层的提示条）。
        let saved = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "探记")
        ).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 8), "导出后应提示文件落在「探记」文件夹")
    }
}
