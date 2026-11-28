import Foundation
import UIKit
import UniformTypeIdentifiers
import Capacitor

@objc(BackupFilesPlugin)
final class BackupFilesPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "BackupFilesPlugin"
    public let jsName = "BackupFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickBackup", returnType: CAPPluginReturnPromise)
    ]

    private static let directoryName = "探记 HG"
    private static let maxFileSize = 10 * 1024 * 1024
    private var pendingPick: CAPPluginCall?

    @objc func saveBackup(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? ""
        guard !name.isEmpty, name == (name as NSString).lastPathComponent, name.lowercased().hasSuffix(".json") else {
            call.reject("备份文件名无效。", "INVALID_NAME")
            return
        }
        guard let content = call.getString("content") else {
            call.reject("备份内容为空。", "INVALID_CONTENT")
            return
        }
        let data = Data(content.utf8)
        guard data.count <= Self.maxFileSize else {
            call.reject("备份文件不能超过 10 MB。", "FILE_TOO_LARGE")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let directory = try self.backupDirectory()
                let url = directory.appendingPathComponent(name)
                try data.write(to: url, options: .atomic)
                DispatchQueue.main.async {
                    call.resolve([
                        "name": name,
                        "path": "\(Self.directoryName)/\(name)",
                        "size": data.count
                    ])
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject("保存失败：\(error.localizedDescription)", "SAVE_FAILED")
                }
            }
        }
    }

    @objc func pickBackup(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pendingPick == nil else {
                call.reject("文件选择器已经打开。", "PICK_IN_PROGRESS")
                return
            }
            do {
                let directory = try self.backupDirectory()
                guard let presenter = self.bridge?.viewController else {
                    call.reject("当前无法打开文件选择器。", "PICKER_UNAVAILABLE")
                    return
                }
                let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.json], asCopy: true)
                picker.directoryURL = directory
                picker.delegate = self
                self.pendingPick = call
                presenter.present(picker, animated: true)
            } catch {
                call.reject("无法打开备份目录：\(error.localizedDescription)", "DIRECTORY_FAILED")
            }
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pendingPick else { return }
        pendingPick = nil
        guard let url = urls.first else {
            call.reject("未选择备份文件。", "PICK_CANCELED")
            return
        }
        guard url.pathExtension.lowercased() == "json" else {
            call.reject("请选择 JSON 备份文件。", "INVALID_FILE_TYPE")
            return
        }

        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            guard data.count <= Self.maxFileSize else {
                call.reject("备份文件不能超过 10 MB。", "FILE_TOO_LARGE")
                return
            }
            guard let content = String(data: data, encoding: .utf8) else {
                call.reject("备份不是 UTF-8 编码的 JSON 文件。", "INVALID_ENCODING")
                return
            }
            call.resolve([
                "name": url.lastPathComponent,
                "content": content,
                "size": data.count
            ])
        } catch {
            call.reject("读取失败：\(error.localizedDescription)", "READ_FAILED")
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingPick?.reject("已取消选择备份。", "PICK_CANCELED")
        pendingPick = nil
    }

    private func backupDirectory() throws -> URL {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let directory = documents.appendingPathComponent(Self.directoryName, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }
}
