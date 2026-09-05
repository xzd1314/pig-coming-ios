import UIKit
import WebKit

class ViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    var webView: WKWebView!
    let wsServer = WebSocketServer()
    let udpManager = UdpManager()
    var isHost = false
    var serverPort: UInt16 = 8765
    let gameLauncher = GameLauncher()
    let gameSchemeHandler = GameSchemeHandler()
    private var launcherHandled = false

    override func viewDidLoad() {
        super.viewDidLoad()
        setupWebView()
        setupCallbacks()
        loadGame()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // 用屏幕大小，忽略安全区域（iPhone 横屏左右黑边问题）
        webView.frame = UIScreen.main.bounds
    }

    private func setupWebView() {
        let config = WKWebViewConfiguration()
        let userController = WKUserContentController()
        userController.add(self, name: "bridge")
        config.userContentController = userController
        // 注册自定义 scheme：pigcoming:// 请求从内存字典读取，磁盘不留明文
        // 用独特的 scheme 名称，避免与系统保留 scheme 冲突
        config.setURLSchemeHandler(gameSchemeHandler, forURLScheme: "pigcoming")
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.suppressesIncrementalRendering = false

        // 用屏幕大小创建 WebView，忽略安全区域（iPhone 横屏左右黑边问题）
        webView = WKWebView(frame: UIScreen.main.bounds, configuration: config)
        webView.navigationDelegate = self
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.contentMode = .scaleToFill
        if #available(iOS 11.0, *) {
            webView.scrollView.contentInsetAdjustmentBehavior = .never
        }
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        view.addSubview(webView)
    }

    private func setupCallbacks() {
        wsServer.onClientConnect = { [weak self] clientId in
            self?.jsCall("NativeCallback.onClientConnected('\(clientId)')")
        }
        wsServer.onClientDisconnect = { [weak self] clientId in
            self?.jsCall("NativeCallback.onClientDisconnected('\(clientId)')")
        }
        wsServer.onMessage = { [weak self] clientId, msg in
            let escaped = msg.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'").replacingOccurrences(of: "\n", with: "\\n")
            self?.jsCall("NativeCallback.onMessage('\(clientId)', '\(escaped)')")
        }
        udpManager.onRoomFound = { [weak self] msg, ip in
            // JS端onRoomFound只接受一个JSON字符串参数，需要把ip合并进去
            var merged = msg
            if let data = msg.data(using: .utf8),
               var json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                json["ip"] = ip
                if let mergedData = try? JSONSerialization.data(withJSONObject: json),
                   let mergedStr = String(data: mergedData, encoding: .utf8) {
                    merged = mergedStr
                }
            }
            let escaped = merged.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'").replacingOccurrences(of: "\n", with: "\\n")
            self?.jsCall("NativeCallback.onRoomFound('\(escaped)')")
        }
    }

    private func loadGame() {
        // 先加载启动页（空壳内置），GameLauncher 完成后再加载本地游戏
        if let url = Bundle.main.url(forResource: "launcher", withExtension: "html", subdirectory: "assets") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
    }

    // MARK: - 启动页 → GameLauncher

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !launcherHandled, webView.url?.lastPathComponent == "launcher.html" else { return }
        launcherHandled = true
        setupGameLauncher()
        gameLauncher.launch()
    }

    private func setupGameLauncher() {
        gameSchemeHandler.gameLauncher = gameLauncher
        gameLauncher.onStatus = { [weak self] text, tag in
            self?.jsSafe("setStatus('\(self?.jsString(text) ?? "")', '\(self?.jsString(tag) ?? "")')")
        }
        gameLauncher.onProgress = { [weak self] percent, downloaded, total, speed in
            self?.jsSafe("updateProgress(\(percent), \(downloaded), \(total), \(speed))")
        }
        gameLauncher.onLatestVersion = { [weak self] v in
            self?.jsSafe("setLatestVersion('\(self?.jsString(v) ?? "")')")
        }
        gameLauncher.onLocalVersion = { [weak self] v in
            self?.jsSafe("setLocalVersion('\(self?.jsString(v) ?? "")')")
        }
        gameLauncher.onPackSize = { [weak self] mb in
            self?.jsSafe("setPackSize(\(mb))")
        }
        gameLauncher.onError = { [weak self] msg in
            self?.jsSafe("setError('\(self?.jsString(msg) ?? "")')")
        }
        gameLauncher.onComplete = { [weak self] in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                self?.loadLocalGame()
            }
        }
    }

    private func loadLocalGame() {
        // 游戏用自定义 scheme pigcoming:// 加载，从内存字典读取文件（磁盘不留明文）
        // 用 pigcoming://game/index.html 标准格式（有 host），避免无 host URL 导致子资源加载失败
        if let url = URL(string: "pigcoming://game/index.html") {
            webView.load(URLRequest(url: url))
        }
    }

    private func jsString(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
         .replacingOccurrences(of: "'", with: "\\'")
         .replacingOccurrences(of: "\n", with: "\\n")
    }

    private func jsSafe(_ script: String) {
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    // MARK: - JS调用原生
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "bridge" else { return }
        // 支持字符串(JSON)和字典两种格式
        var body: [String: Any] = [:]
        if let dict = message.body as? [String: Any] {
            body = dict
        } else if let str = message.body as? String,
                  let data = str.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            body = json
        }
        guard let method = body["method"] as? String,
              let args = body["args"] as? [String: Any] else {
            print("[Bridge] invalid message: \(message.body)")
            return
        }

        switch method {
        case "startServer":
            let port = (args["port"] as? Int).flatMap { UInt16($0) } ?? serverPort
            serverPort = port
            wsServer.start(port: port) { [weak self] p in
                guard let self = self, let p = p else {
                    print("[WS] start failed")
                    return
                }
                DispatchQueue.main.async {
                    self.serverPort = p
                    self.isHost = true
                    let ip = self.udpManager.getLocalIP()
                    print("[WS] server started: \(ip):\(p)")
                    self.jsCall("NativeCallback.onServerStarted('\(ip)', \(p))")
                }
            }
        case "stopServer":
            wsServer.stop()
            udpManager.stopBroadcast()
            isHost = false
            jsCall("NativeCallback.onServerStopped()")
        case "startBroadcast":
            if let info = args["roomInfo"] as? String {
                udpManager.startBroadcast(roomInfo: info, port: 8766)
            }
        case "stopBroadcast":
            udpManager.stopBroadcast()
        case "startScan":
            udpManager.startScan(port: 8766)
        case "stopScan":
            udpManager.stopScan()
        case "connect":
            if let ip = args["ip"] as? String,
               let port = (args["port"] as? Int).flatMap({ UInt16($0) }) {
                connectToServer(ip: ip, port: port)
            }
        case "disconnect":
            disconnectClient()
        case "send":
            if let msg = args["msg"] as? String {
                clientSend(msg)
            }
        case "sendTo":
            if let clientId = args["id"] as? String,
               let msg = args["msg"] as? String {
                wsServer.send(to: clientId, msg)
            }
        case "broadcast":
            if let msg = args["msg"] as? String {
                wsServer.broadcast(msg)
            }
        case "getLocalIP":
            let ip = udpManager.getLocalIP()
            jsCall("NativeCallback.onLocalIP('\(ip)')")
        default:
            break
        }
    }

    // MARK: - WebSocket客户端
    private var clientConnection: URLSessionWebSocketTask?
    private var clientConnected = false

    private func connectToServer(ip: String, port: UInt16) {
        disconnectClient()
        guard let url = URL(string: "ws://\(ip):\(port)") else { return }
        let session = URLSession(configuration: .default)
        clientConnection = session.webSocketTask(with: url)
        clientConnection?.resume()
        receiveClientMessage()
        // 连接成功后延迟回调，确保WebSocket握手完成
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.clientConnected = true
            self?.jsCall("NativeCallback.onConnected()")
        }
    }

    private func disconnectClient() {
        clientConnection?.cancel()
        clientConnection = nil
        clientConnected = false
    }

    private func clientSend(_ message: String) {
        guard let task = clientConnection else { return }
        task.send(.string(message)) { error in
            if let error = error { print("[WS client] send error: \(error)") }
        }
    }

    private func receiveClientMessage() {
        clientConnection?.receive { [weak self] result in
            switch result {
            case .success(let message):
                if case .string(let text) = message {
                    let escaped = text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'").replacingOccurrences(of: "\n", with: "\\n")
                    self?.jsCall("NativeCallback.onServerMessage('\(escaped)')")
                }
                self?.receiveClientMessage()
            case .failure:
                self?.jsCall("NativeCallback.onDisconnected()")
            }
        }
    }

    // MARK: - 工具
    private func jsCall(_ script: String) {
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript(script, completionHandler: { _, error in
                if let error = error {
                    print("[JS] error: \(error)")
                }
            })
        }
    }

    override var prefersStatusBarHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { [.all] }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
}
