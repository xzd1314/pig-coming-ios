import UIKit
import WebKit

class ViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    var webView: WKWebView!
    let wsServer = WebSocketServer()
    let udpManager = UdpManager()
    var isHost = false
    var serverPort: UInt16 = 8765

    override func viewDidLoad() {
        super.viewDidLoad()
        setupWebView()
        setupCallbacks()
        loadGame()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        webView.frame = view.bounds
    }

    private func setupWebView() {
        let config = WKWebViewConfiguration()
        let userController = WKUserContentController()
        userController.add(self, name: "bridge")
        config.userContentController = userController
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.suppressesIncrementalRendering = false

        webView = WKWebView(frame: view.bounds, configuration: config)
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
            self?.jsCall("Bridge.onClientConnect('\(clientId)')")
        }
        wsServer.onClientDisconnect = { [weak self] clientId in
            self?.jsCall("Bridge.onClientDisconnect('\(clientId)')")
        }
        wsServer.onMessage = { [weak self] clientId, msg in
            let escaped = msg.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'").replacingOccurrences(of: "\n", with: "\\n")
            self?.jsCall("Bridge.onHostMessage('\(clientId)', '\(escaped)')")
        }
        udpManager.onRoomFound = { [weak self] msg, ip in
            let escaped = msg.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'").replacingOccurrences(of: "\n", with: "\\n")
            self?.jsCall("Bridge.onRoomFound('\(escaped)', '\(ip)')")
        }
    }

    private func loadGame() {
        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "assets") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
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
            if let p = wsServer.start(port: port) {
                serverPort = p
                isHost = true
                let ip = udpManager.getLocalIP()
                jsCall("Bridge.onServerReady('\(ip)', \(p))")
            }
        case "stopServer":
            wsServer.stop()
            udpManager.stopBroadcast()
            isHost = false
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
            jsCall("Bridge.onLocalIP('\(ip)')")
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
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            self?.clientConnected = true
            self?.jsCall("Bridge.onConnected()")
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
                    self?.jsCall("Bridge.onClientMessage('\(escaped)')")
                }
                self?.receiveClientMessage()
            case .failure:
                self?.jsCall("Bridge.onDisconnected()")
            }
        }
    }

    // MARK: - 工具
    private func jsCall(_ script: String) {
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    override var prefersStatusBarHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { [.all] }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
}
