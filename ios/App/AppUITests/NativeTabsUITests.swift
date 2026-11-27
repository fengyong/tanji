import XCTest

final class NativeTabsUITests: XCTestCase {
    private let app = XCUIApplication()
    private let tabNames = ["首页", "行程", "订单", "收款", "统计"]

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launch()
    }

    func testNativeTabsAndSettingsRoute() throws {
        let tabBar = try requireTabBar()
        for name in tabNames {
            let tab = tabBar.buttons[name]
            XCTAssertTrue(tab.waitForExistence(timeout: 5), "缺少原生 Tab：\(name)")
            tab.tap()
            let selected = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "isSelected == true"),
                object: tab
            )
            XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 5), .completed, "原生 Tab 未选中：\(name)")
        }

        let gear = app.webViews.buttons["打开设置"]
        XCTAssertTrue(gear.waitForExistence(timeout: 5))
        gear.tap()
        let settingsHeading = app.webViews.staticTexts["设置"]
        XCTAssertTrue(settingsHeading.waitForExistence(timeout: 5))
        XCTAssertTrue(tabBar.buttons["统计"].isSelected, "设置页应保持统计 Tab 选中")

        let back = app.webViews.buttons["返回统计"]
        XCTAssertTrue(back.waitForExistence(timeout: 5))
        back.tap()
        XCTAssertTrue(gear.waitForExistence(timeout: 5), "返回后应恢复统计页")

        tabBar.buttons["行程"].tap()
        let settingsGone = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: settingsHeading
        )
        XCTAssertEqual(XCTWaiter.wait(for: [settingsGone], timeout: 5), .completed, "切换业务 Tab 应退出设置页")
        XCTAssertTrue(tabBar.buttons["行程"].isSelected)
    }

    func testSheetHidesTabBarAndRestoresAfterCloseAnimation() throws {
        let tabBar = try requireTabBar()
        try openSettings()

        let addAccount = app.webViews.buttons["+ 添加 ›"]
        XCTAssertTrue(addAccount.waitForExistence(timeout: 5))
        addAccount.tap()
        let cancel = app.webViews.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 5))
        waitForTabHidden(tabBar)

        cancel.tap()
        waitForHittable(tabBar.buttons["首页"])
    }

    func testKeyboardHidesNativeTabBar() throws {
        let tabBar = try requireTabBar()
        tabBar.buttons["订单"].tap()
        let search = app.webViews.textFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        waitForTabHidden(tabBar)

        let returnKey = app.keyboards.buttons.matching(
            NSPredicate(format: "label MATCHES %@", "(Return|换行|完成|Done)")
        ).firstMatch
        if returnKey.exists {
            returnKey.tap()
        }
        if app.keyboards.firstMatch.exists {
            app.webViews.staticTexts["订单"].firstMatch.tap()
        }
        let dismissed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: app.keyboards.firstMatch
        )
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 3), .completed)
        waitForHittable(tabBar.buttons["首页"])
    }

    private func openSettings() throws {
        let tabBar = try requireTabBar()
        tabBar.buttons["统计"].tap()
        let gear = app.webViews.buttons["打开设置"]
        XCTAssertTrue(gear.waitForExistence(timeout: 5))
        gear.tap()
        XCTAssertTrue(app.webViews.staticTexts["设置"].waitForExistence(timeout: 5))
    }

    private func requireTabBar() throws -> XCUIElement {
        let tabBar = app.tabBars["native.tabBar"]
        XCTAssertTrue(tabBar.waitForExistence(timeout: 20), "原生底栏未加载")
        waitForHittable(tabBar)
        return tabBar
    }

    private func waitForHittable(_ element: XCUIElement) {
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "isHittable == true"),
            object: element
        )
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed)
    }

    private func waitForTabHidden(_ tabBar: XCUIElement) {
        let tab = tabBar.buttons["首页"]
        let hidden = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: tab
        )
        XCTAssertEqual(XCTWaiter.wait(for: [hidden], timeout: 3), .completed)
    }
}
