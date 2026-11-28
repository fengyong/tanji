import UIKit

/// 图片处理：头像裁圆压缩、随手拍缩略图。
///
/// 与 Web 版 `www/imaging.js` 同一套口径：
///   头像 = 正方形中心裁剪 + 128×128 + JPEG dataURL（上限 200KB 字符）
///   随手拍 = 长边缩到 320 + JPEG dataURL（上限 12KB 字符）
enum ImageTools {

    static func image(fromDataURL dataURL: String) -> UIImage? {
        guard let range = dataURL.range(of: "base64,") else { return nil }
        let base64 = String(dataURL[range.upperBound...])
        guard let data = Data(base64Encoded: base64) else { return nil }
        return UIImage(data: data)
    }

    /// 缩放到长边不超过 maxDimension
    static func resized(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
        let size = image.size
        let longest = max(size.width, size.height)
        guard longest > maxDimension, longest > 0 else { return image }
        let scale = maxDimension / longest
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let renderer = UIGraphicsImageRenderer(size: target)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }

    /// 正方形中心裁剪
    static func squareCropped(_ image: UIImage) -> UIImage {
        let size = image.size
        let side = min(size.width, size.height)
        let origin = CGPoint(x: (size.width - side) / 2, y: (size.height - side) / 2)
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side))
        return renderer.image { _ in
            image.draw(in: CGRect(x: -origin.x, y: -origin.y, width: side, height: side))
        }
    }

    /// 压成 JPEG dataURL，体积不超过 maxBytes（逐步降质）。
    static func dataURL(from image: UIImage, maxBytes: Int) -> String? {
        var quality: CGFloat = 0.9
        var payload = image.jpegData(compressionQuality: quality)
        while let data = payload, data.count > maxBytes, quality > 0.2 {
            quality -= 0.1
            payload = image.jpegData(compressionQuality: quality)
        }
        guard let data = payload, data.count <= maxBytes else { return nil }
        return "data:image/jpeg;base64,\(data.base64EncodedString())"
    }

    /// 账号头像：正方裁剪 → 128×128 → JPEG（≤200KB）
    static func avatarDataURL(from image: UIImage) -> String? {
        let cropped = squareCropped(image)
        let target = resized(cropped, maxDimension: 128)
        return dataURL(from: target, maxBytes: ImageStore.avatarLimit)
    }

    /// 随手拍缩略图：长边 320 → JPEG（≤12KB）
    static func doorThumbDataURL(from image: UIImage) -> String? {
        let target = resized(image, maxDimension: 320)
        return dataURL(from: target, maxBytes: ImageStore.doorLimit)
    }
}
