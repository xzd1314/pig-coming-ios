import Foundation
import WebKit

final class GameSchemeHandler: NSObject, WKURLSchemeHandler {

    weak var gameLauncher: GameLauncher?

    // 串行队列，保证 gameFiles 字典访问线程安全
    private let queue = DispatchQueue(label: "com.xzd.pigcoming.schemehandler")

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

    private static let textExts: Set<String> = ["html", "htm", "js", "css", "json", "txt", "xml", "svg"]

    // 分块大小：256KB，大文件分块返回避免内存问题
    private let chunkSize = 256 * 1024

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let url = urlSchemeTask.request.url!
        var path = url.path
        if path.hasPrefix("/") { path.removeFirst() }
        if path.isEmpty { path = "index.html" }

        NSLog("[Scheme] start: \(url.absoluteString) -> \(path)")

        // 在串行队列中读取数据，保证线程安全
        queue.async { [weak self] in
            guard let self = self else { return }

            guard let data = self.gameLauncher?.getFile(path) else {
                NSLog("[Scheme] MISS: \(path) (launcher=\(self.gameLauncher != nil), files=\(self.gameLauncher?.gameFiles.count ?? 0))")
                // 回到主线程回调 WKURLSchemeTask
                DispatchQueue.main.async {
                    let response = URLResponse(url: url, mimeType: "text/plain",
                                                expectedContentLength: 0, textEncodingName: "utf-8")
                    urlSchemeTask.didReceive(response)
                    urlSchemeTask.didFinish()
                }
                return
            }

            let ext = (path as NSString).pathExtension.lowercased()
            let mime = Self.mimeMap[ext] ?? "application/octet-stream"
            let encoding = Self.textExts.contains(ext) ? "utf-8" : nil
            NSLog("[Scheme] HIT: \(path) (\(data.count) bytes, \(mime))")

            DispatchQueue.main.async {
                let response = URLResponse(url: url, mimeType: mime,
                                            expectedContentLength: data.count, textEncodingName: encoding)
                urlSchemeTask.didReceive(response)

                // 大文件分块返回
                if data.count > self.chunkSize {
                    var offset = 0
                    while offset < data.count {
                        let end = min(offset + self.chunkSize, data.count)
                        let chunk = data.subdata(in: offset..<end)
                        urlSchemeTask.didReceive(chunk)
                        offset = end
                    }
                } else {
                    urlSchemeTask.didReceive(data)
                }
                urlSchemeTask.didFinish()
                NSLog("[Scheme] done: \(path)")
            }
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        NSLog("[Scheme] stop: \(urlSchemeTask.request.url?.absoluteString ?? "unknown")")
    }
}
