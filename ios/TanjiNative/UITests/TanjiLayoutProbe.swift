import XCTest

/// 人工版面核对工具：逐页截图，供人眼检查排版，**不做任何断言**。
///
/// 默认测试用 `-skip-testing:TanjiNativeUITests/TanjiLayoutProbe` 跳过（一轮约 4–5 分钟）。
/// 单独跑法见 `CONTRACT.md` 的「4.1 测试约定」。
///
/// 注意：必须用长距离拖动，短 swipeUp 在 iOS 26 浮动标签栏下滚不动，
/// 会误判成「内容被标签栏压住」。
final class TanjiLayoutProbe: XCTestCase {
    func testCaptureScrolledPages() {
        let app = XCUIApplication()
        app.launchArguments = ["-tanji-reset"]
        app.launch()
        sleep(UInt32(2))

        func shoot(_ name: String) {
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = name
            shot.lifetime = .keepAlways
            add(shot)
        }

        for tab in ["首页", "行程", "订单", "收款", "统计"] {
            app.buttons[tab].tap()
            sleep(UInt32(1))
            shoot("首屏-\(tab)")

            let scroll = app.scrollViews.firstMatch
            for _ in 0..<30 {
                scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                    .press(forDuration: 0.02,
                           thenDragTo: scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05)))
                sleep(UInt32(0.12))
            }
            sleep(UInt32(0.8))
            shoot("滚到底-\(tab)")
        }
    }

    /// 设置页与账号表单的版面核对：勋章门槛分区、账号等级 chip。
    ///
    /// 单独跑：
    /// xcodebuild test -only-testing:TanjiNativeUITests/TanjiLayoutProbe/testCaptureSettings
    func testCaptureSettings() {
        let app = XCUIApplication()
        app.launchArguments = ["-tanji-reset"]
        app.launch()
        sleep(UInt32(2))

        func shoot(_ name: String) {
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = name
            shot.lifetime = .keepAlways
            self.add(shot)
        }

        // 设置页是统计页顶栏齿轮打开的 sheet。
        app.tabBars.buttons["统计"].tap()
        sleep(UInt32(1))
        let gear = app.buttons["打开设置"].firstMatch
        XCTAssertTrue(gear.waitForExistence(timeout: 6), "统计页应有设置入口")
        gear.tap()
        sleep(UInt32(1))
        shoot("设置-首屏")

        // 账号表单在设置页顶部（我的账号 → 添加），先看它，再滚到下面的门槛分区。
        let addButton = app.buttons["account.add"].firstMatch
        if addButton.waitForExistence(timeout: 4) {
            addButton.tap()
            sleep(UInt32(1))
            shoot("账号表单-等级")
            let lv7 = app.buttons["account.level.Lv.7"].firstMatch
            if lv7.exists {
                lv7.tap()
                sleep(UInt32(0.4))
                shoot("账号表单-选中Lv7")
            }
            // 关掉表单回到设置页。
            let close = app.buttons["关闭"].firstMatch
            if close.exists {
                close.tap()
                sleep(UInt32(0.8))
            }
        }

        // 账号行副标题是「等级 · 抖音 · 手机 · N 单」，比较长：建一个资料填满的账号看会不会截断。
        let addAgain = app.buttons["account.add"].firstMatch
        if addAgain.waitForExistence(timeout: 4) {
            addAgain.tap()
            sleep(UInt32(1))
            let nameField = app.textFields["account.field.name"]
            if nameField.exists {
                nameField.tap()
                nameField.typeText("探记小分队")
            }
            let douyinField = app.textFields["account.field.douyin"]
            if douyinField.exists {
                douyinField.tap()
                douyinField.typeText("tanji_media")
            }
            let phoneField = app.textFields["account.field.phone"]
            if phoneField.exists {
                phoneField.tap()
                phoneField.typeText("13800006678")
            }
            let lv6 = app.buttons["account.level.Lv.6"].firstMatch
            if lv6.exists {
                lv6.tap()
                sleep(UInt32(0.3))
            }
            shoot("账号表单-填资料")
            let save = app.buttons["account.save"].firstMatch
            if save.exists {
                save.tap()
                sleep(UInt32(1.2))
            }
            shoot("设置-账号行")
        }

        // 滚到「勋章门槛」分区：长距离拖动（dy 0.7 → 0.15），短 swipeUp 在 iOS 26 标签栏下滚不动。
        let scroll = app.scrollViews.firstMatch
        for step in 1...6 {
            scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
                .press(forDuration: 0.02,
                       thenDragTo: scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)))
            sleep(UInt32(0.4))
            if app.staticTexts["勋章门槛"].isHittable {
                shoot("设置-勋章门槛")
                break
            }
            shoot("设置-滚动\(step)")
        }

        // 输入框有值时的排版：填金额，看是否挤压错位。
        let aceField = app.textFields["medal.aceAmount"]
        if aceField.exists {
            aceField.tap()
            aceField.typeText("3000")
            sleep(UInt32(0.5))
            shoot("设置-门槛输入")
        }
    }
}
