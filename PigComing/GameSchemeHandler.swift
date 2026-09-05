import Foundation
import WebKit

// 自定义 URL Scheme Handler：拦截 game:// 请求，从内存字典读取文件
final class GameSchemeHandler: NSObject, WKURLSchemeHandler {

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

    func urlSchemeHandler(_ handler: WKURLSchemeHandler, start urlSchemeTask: WKURLSchemeTask) {
        let url = urlSchemeTask.request.url!
        var path = url.path
        if path.hasPrefix("/") { path.removeFirst() }
        if path.isEmpty { path = "index.html" }

        if let data = gameLauncher?.getFile(path) {
            let ext = (path as NSString).pathExtension.lowercased()
            let mime = Self.mimeMap[ext] ?? "application/octet-stream"
            let response = URLResponse(url: url, mimeType: mime,
                                        expectedContentLength: data.count, textEncodingName: nil)
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } else {
            let response = URLResponse(url: url, mimeType: "text/plain",
                                        expectedContentLength: 0, textEncodingName: "utf-8")
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didFinish()
        }
    }

    func urlSchemeHandler(_ handler: WKURLSchemeHandler, stop urlSchemeTask: WKURLSchemeTask) {
        // 同步从内存读取，不需要特殊处理
    }
}
