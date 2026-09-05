import Foundation
import WebKit

// 自定义 URL Scheme Handler：拦截 game:// 请求，从内存字典读取文件
// 这样磁盘上不需要存明文游戏文件
final class GameSchemeHandler: NSObject, WKURLSchemeHandler {

    weak var gameLauncher: GameLauncher?

    // MIME 类型映射
    private static let mimeMap: [String: String] = [
        "html": "text/html", "htm": "text/html",
        "js": "application/javascript",
        "css": "text/css",
        "json": "application/json",
        "png": "image/png",
        "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "gif": "image/gif",
        "svg": "image/svg+xml",
        "mp3": "audio/mpeg",
        "wav": "audio/wav",
        "ogg": "audio/ogg",
        "mp4": "video/mp4",
        "webm": "video/webm",
        "woff": "font/woff",
        "woff2": "font/woff2",
        "ttf": "font/ttf",
        "txt": "text/plain",
        "xml": "application/xml",
    ]

    private func mimeType(for path: String) -> String {
        let ext = (path as NSString).pathExtension.lowercased()
        return Self.mimeMap[ext] ?? "application/octet-stream"
    }

    func urlSchemeHandler(_ handler: WKURLSchemeHandler, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url,
              url.scheme == "game" else {
            urlSchemeTask.didFailWithError(NSError(domain: "GameScheme", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Invalid URL"]))
            return
        }

        var path = url.path
        if path.hasPrefix("/") { path.removeFirst() }
        if path.isEmpty { path = "index.html" }

        guard let data = gameLauncher?.getFile(path) else {
            // 文件不存在，返回 404
            if let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil) {
                urlSchemeTask.didReceive(response)
            }
            urlSchemeTask.didFinish()
            return
        }

        let mime = mimeType(for: path)
        if let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                           headerFields: [
                                            "Content-Type": mime,
                                            "Content-Length": "\(data.count)",
                                            "Cache-Control": "no-cache",
                                           ]) {
            urlSchemeTask.didReceive(response)
        }
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func urlSchemeHandler(_ handler: WKURLSchemeHandler, stop urlSchemeTask: WKURLSchemeTask) {
        // 不需要特殊处理（数据是同步从内存读取的）
    }
}
