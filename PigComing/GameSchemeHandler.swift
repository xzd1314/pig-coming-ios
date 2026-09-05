import Foundation
import WebKit

final class GameSchemeHandler: NSObject, WKURLSchemeHandler {

    weak var gameLauncher: GameLauncher?

    private static let mimeMap: [String: String] = [
        "html": "text/html", "htm": "text/html",
        "js": "text/javascript",
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

    // 文本类型需要指定 utf-8 编码
    private static let textExts: Set<String> = ["html", "htm", "js", "css", "json", "txt", "xml", "svg"]

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let url = urlSchemeTask.request.url!
        var path = url.path
        if path.hasPrefix("/") { path.removeFirst() }
        if path.isEmpty { path = "index.html" }

        NSLog("[GameScheme] request: \(url.absoluteString) -> path: \(path)")

        if let data = gameLauncher?.getFile(path) {
            let ext = (path as NSString).pathExtension.lowercased()
            let mime = Self.mimeMap[ext] ?? "application/octet-stream"
            let encoding = Self.textExts.contains(ext) ? "utf-8" : nil
            NSLog("[GameScheme] HIT: \(path) (\(data.count) bytes, mime: \(mime), encoding: \(encoding ?? "nil"))")
            // 自定义 scheme 用 URLResponse（不是 HTTPURLResponse），确保 MIME 和编码正确
            let response = URLResponse(url: url, mimeType: mime,
                                        expectedContentLength: data.count, textEncodingName: encoding)
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } else {
            NSLog("[GameScheme] MISS: \(path) (gameLauncher=\(gameLauncher != nil), files=\(gameLauncher?.gameFiles.count ?? 0))")
            let response = URLResponse(url: url, mimeType: "text/plain",
                                        expectedContentLength: 0, textEncodingName: "utf-8")
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didFinish()
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // 同步从内存读取，不需要特殊处理
    }
}
