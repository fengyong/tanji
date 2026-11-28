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
}
