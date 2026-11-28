import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// 系统原生文件选择器（导入用），默认定位到「探记 HG」文件夹。
///
/// 只接受 JSON；默认打开沙盒 Documents ——「文件」App 里的「探记 HG」文件夹，
/// 用户导出的备份就在这个目录里，导入时不用到处找。
struct DocumentPicker: UIViewControllerRepresentable {
    var onPick: (URL) -> Void

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.json])
        picker.directoryURL = BackupService.exportFolder()
        picker.allowsMultipleSelection = false
        picker.shouldShowFileExtensions = true
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {
        // 父视图重建后把最新的回调同步给协调器，避免拿到旧的闭包。
        context.coordinator.onPick = onPick
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onPick: onPick)
    }

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        var onPick: (URL) -> Void

        init(onPick: @escaping (URL) -> Void) {
            self.onPick = onPick
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let url = urls.first else { return }
            onPick(url)
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            // 取消导入：什么都不做。
        }
    }
}
