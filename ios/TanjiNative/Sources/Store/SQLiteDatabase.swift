import Foundation
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// SQLite 参数值。
enum SQLValue {
    case null
    case integer(Int64)
    case real(Double)
    case text(String)

    static func bool(_ value: Bool) -> SQLValue { .integer(value ? 1 : 0) }

    var stringValue: String? {
        switch self {
        case .text(let value): return value
        case .integer(let value): return String(value)
        case .real(let value): return String(value)
        case .null: return nil
        }
    }

    var intValue: Int? {
        switch self {
        case .integer(let value): return Int(value)
        case .real(let value): return Int(value)
        case .text(let value): return Int(value)
        case .null: return nil
        }
    }

    var doubleValue: Double? {
        switch self {
        case .integer(let value): return Double(value)
        case .real(let value): return value
        case .text(let value): return Double(value)
        case .null: return nil
        }
    }
}

enum SQLiteError: LocalizedError {
    case openFailed(String)
    case statementFailed(String)

    var errorDescription: String? {
        switch self {
        case .openFailed(let message): return "数据库打开失败：\(message)"
        case .statementFailed(let message): return "数据库写入失败：\(message)"
        }
    }
}

/// 轻量 SQLite 封装（系统 libsqlite3，无第三方依赖）。
final class SQLiteDatabase {
    private var handle: OpaquePointer?
    let path: String

    init(path: String) throws {
        self.path = path
        var handle: OpaquePointer?
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(path, &handle, flags, nil) == SQLITE_OK, let handle else {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "未知错误"
            if let handle { sqlite3_close_v2(handle) }
            throw SQLiteError.openFailed(message)
        }
        self.handle = handle
        try execute("PRAGMA foreign_keys = ON")
    }

    deinit {
        if let handle { sqlite3_close_v2(handle) }
    }

    func close() {
        if let handle { sqlite3_close_v2(handle) }
        handle = nil
    }

    private func errorMessage() -> String {
        guard let handle else { return "连接已关闭" }
        return String(cString: sqlite3_errmsg(handle))
    }

    /// 执行一条语句（可带参数）。
    func execute(_ sql: String, _ params: [SQLValue] = []) throws {
        guard let handle else { throw SQLiteError.statementFailed("连接已关闭") }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw SQLiteError.statementFailed(errorMessage())
        }
        defer { sqlite3_finalize(statement) }
        bind(params, to: statement)
        let result = sqlite3_step(statement)
        guard result == SQLITE_DONE || result == SQLITE_ROW else {
            throw SQLiteError.statementFailed(errorMessage())
        }
    }

    /// 查询多行。
    func query(_ sql: String, _ params: [SQLValue] = []) throws -> [[String: SQLValue]] {
        guard let handle else { throw SQLiteError.statementFailed("连接已关闭") }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw SQLiteError.statementFailed(errorMessage())
        }
        defer { sqlite3_finalize(statement) }
        bind(params, to: statement)
        var rows: [[String: SQLValue]] = []
        while true {
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { break }
            guard step == SQLITE_ROW else { throw SQLiteError.statementFailed(errorMessage()) }
            var row: [String: SQLValue] = [:]
            let columnCount = sqlite3_column_count(statement)
            for index in 0..<columnCount {
                guard let namePointer = sqlite3_column_name(statement, index) else { continue }
                let name = String(cString: namePointer)
                switch sqlite3_column_type(statement, index) {
                case SQLITE_INTEGER:
                    row[name] = .integer(sqlite3_column_int64(statement, index))
                case SQLITE_FLOAT:
                    row[name] = .real(sqlite3_column_double(statement, index))
                case SQLITE_TEXT:
                    if let text = sqlite3_column_text(statement, index) {
                        row[name] = .text(String(cString: text))
                    } else {
                        row[name] = .null
                    }
                case SQLITE_NULL:
                    row[name] = .null
                default:
                    row[name] = .null
                }
            }
            rows.append(row)
        }
        return rows
    }

    private func bind(_ params: [SQLValue], to statement: OpaquePointer?) {
        for (offset, value) in params.enumerated() {
            let index = Int32(offset + 1)
            switch value {
            case .null:
                sqlite3_bind_null(statement, index)
            case .integer(let number):
                sqlite3_bind_int64(statement, index, number)
            case .real(let number):
                sqlite3_bind_double(statement, index, number)
            case .text(let text):
                sqlite3_bind_text(statement, index, text, -1, SQLITE_TRANSIENT)
            }
        }
    }
}
