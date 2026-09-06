import Foundation
import Network

// 轻量级本地 HTTP 服务器，用于从 Caches 目录提供游戏文件
// 避免 WKWebView 对非 app bundle 目录 file:// 加载的子资源权限问题
class LocalHTTPServer {
    private var listener: NWListener?
    private let gameDir: URL
    private(set) var port: UInt16 = 0

    init(gameDir: URL) {
        self.gameDir = gameDir
    }

    func start() -> Bool {
        do {
            let params = NWParameters.tcp
            params.includePeerToPeer = false
            listener = try NWListener(using: params, on: .any)
            listener?.newConnectionHandler = { [weak self] connection in
                self?.handleConnection(connection)
            }
            listener?.start(queue: DispatchQueue(label: "LocalHTTPServer"))
            // 等待端口分配
            let sem = DispatchSemaphore(value: 0)
            listener?.stateDidChangeHandler = { state in
                if case .ready = state { sem.signal() }
                if case .failed = state { sem.signal() }
            }
            _ = sem.wait(timeout: .now() + 2)
            port = listener?.port?.rawValue ?? 0
            print("[LocalHTTPServer] started on port \(port)")
            return port > 0
        } catch {
            print("[LocalHTTPServer] failed: \(error)")
            return false
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    private func handleConnection(_ connection: NWConnection) {
        connection.start(queue: DispatchQueue(label: "LocalHTTPServer.conn"))
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, isComplete, error in
            guard let self = self, let data = data, !data.isEmpty else {
                connection.cancel()
                return
            }
            if let request = String(data: data, encoding: .utf8) {
                let lines = request.components(separatedBy: "\r\n")
                if let firstLine = lines.first {
                    let parts = firstLine.components(separatedBy: " ")
                    if parts.count >= 2 {
                        let path = parts[1].removingPercentEncoding ?? parts[1]
                        self.serveFile(connection, path: path)
                        return
                    }
                }
            }
            self.sendError(connection, status: 400)
        }
    }

    private func serveFile(_ connection: NWConnection, path: String) {
        var cleanPath = path
        if cleanPath.hasPrefix("/") { cleanPath = String(cleanPath.dropFirst()) }
        if cleanPath.isEmpty { cleanPath = "index.html" }

        let filePath = gameDir.appendingPathComponent(cleanPath).standardizedFileURL

        // 安全检查：确保文件在 gameDir 目录内
        guard filePath.path.hasPrefix(gameDir.path) else {
            sendError(connection, status: 403)
            return
        }

        guard FileManager.default.fileExists(atPath: filePath.path),
              let data = try? Data(contentsOf: filePath) else {
            sendError(connection, status: 404)
            return
        }

        let mime = mimeType(for: filePath.pathExtension)
        let header = "HTTP/1.1 200 OK\r\nContent-Type: \(mime)\r\nContent-Length: \(data.count)\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\n"
        var response = header.data(using: .utf8)!
        response.append(data)
        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func sendError(_ connection: NWConnection, status: Int) {
        let text = "HTTP/1.1 \(status) Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        connection.send(content: text.data(using: .utf8), completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js": return "application/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "svg": return "image/svg+xml"
        case "webp": return "image/webp"
        case "mp3": return "audio/mpeg"
        case "wav": return "audio/wav"
        case "ogg": return "audio/ogg"
        case "m4a": return "audio/mp4"
        case "mp4": return "video/mp4"
        case "webm": return "video/webm"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "ttf": return "font/ttf"
        case "otf": return "font/otf"
        case "txt": return "text/plain; charset=utf-8"
        case "xml": return "application/xml"
        default: return "application/octet-stream"
        }
    }
}
