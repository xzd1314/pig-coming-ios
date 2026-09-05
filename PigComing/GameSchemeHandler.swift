import Foundation
import WebKit

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

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let url = urlSchemeTask.request.url!
        var path = url.path
        if path.hasPrefix("/") { path.removeFirst() }
        if path.isEmpty { path = "index.html" }

        NSLog("[GameScheme] request: \(url.absoluteString) -> path: \(path)")

        if let data = gameLauncher?.getFile(path) {
            let ext = (path as NSString).pathExtension.lowercased()
            let mime = Self.mimeMap[ext] ?? "application/octet-stream"
            NSLog("[GameScheme] HIT: \(path) (\(data.count) bytes, mime: \(mime))")
            // 用 HTTPURLResponse 返回正确的状态码和 header
            let headers = ["Content-Type": mime, "Content-Length": "\(data.count)"]
            if let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) {
                urlSchemeTask.didReceive(response)
            } else {
                let response = URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: nil)
                urlSchemeTask.didReceive(response)
            }
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } else {
            NSLog("[GameScheme] MISS: \(path) (gameLauncher=\(gameLauncher != nil), files=\(gameLauncher?.gameFiles.count ?? 0))")
            let headers = ["Content-Type": "text/plain"]
            if let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: headers) {
                urlSchemeTask.didReceive(response)
            } else {
                let response = URLResponse(url: url, mimeType: "text/plain", expectedContentLength: 0, textEncodingName: "utf-8")
                urlSchemeTask.didReceive(response)
            }
            urlSchemeTask.didFinish()
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // 同步从内存读取，不需要特殊处理
    }
}
