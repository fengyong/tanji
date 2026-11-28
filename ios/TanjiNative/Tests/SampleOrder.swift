import Foundation
@testable import TanjiNative

/// 测试用订单构造器（对应 Web 版 logic.test.cjs 的 order()）。
///
/// 参数顺序与 `Order` 的初始化器保持一致，避免调用点写乱。
enum SampleOrder {
    static func make(id: Int = 1,
                     store: String = "店",
                     cat: String = "其他",
                     contact: String = "",
                     price: Double = 1000,
                     deposit: Double = 200,
                     appt: String = "2026-11-01T10:00",
                     shotAt: String? = "2026-11-01T11:00",
                     submittedAt: String? = "2026-11-01T12:00",
                     shortAt: String? = nil,
                     longAt: String? = nil,
                     depositPaidAt: String? = nil,
                     finalPaidAt: String? = nil,
                     settleVia: String = "private",
                     remindAt: String? = nil,
                     channel: String = "直客",
                     partner: String = "",
                     location: String = "",
                     gpsPlace: String? = nil,
                     deliverMain: Bool = true,
                     deliverSub: Bool = true,
                     note: String = "",
                     remindLog: [RemindEntry]? = nil,
                     expectPayAt: String? = nil) -> Order {
        Order(id: id,
              store: store,
              cat: cat,
              contact: contact,
              price: price,
              deposit: deposit,
              appt: appt,
              shotAt: shotAt,
              submittedAt: submittedAt,
              shortAt: shortAt,
              longAt: longAt,
              depositPaidAt: depositPaidAt,
              finalPaidAt: finalPaidAt,
              settleVia: settleVia,
              remindAt: remindAt,
              channel: channel,
              partner: partner,
              location: location,
              gpsPlace: gpsPlace,
              deliverMain: deliverMain,
              deliverSub: deliverSub,
              note: note,
              remindLog: remindLog,
              expectPayAt: expectPayAt)
    }
}
