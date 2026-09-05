import Foundation
import WebKit

// 自定义 URL Scheme Handler：拦截 game:// 请求，从内存字典读取文件
// 这样磁盘上不需要存明文游戏文件
final class GameSchemeHandler: NSObject {

    weak var gameLauncher: GameLauncher?

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
}

extension GameSchemeHandler: WKURLSchemeHandler {

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
            // 404
            let response = URLResponse(url: url, mimeType: "text/plain",
                                        expectedContentLength: 0, textEncodingName: "utf-8")
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didFinish()
            return
        }

        let mime = mimeType(for: path)
        let response = URLResponse(url: url, mimeType: mime,
                                    expectedContentLength: data.count, textEncodingName: nil)
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func urlSchemeHandler(_ handler: WKURLSchemeHandler, stop urlSchemeTask: WKURLSchemeTask) {
        // 同步从内存读取，不需要特殊处理
    }
}
