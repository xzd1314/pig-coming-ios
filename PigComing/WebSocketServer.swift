import Foundation
import Network
import CryptoKit

class WebSocketServer {
    private var listener: NWListener?
    private var connections: [String: WebSocketConnection] = [:]
    private var idCounter = 0
    var onClientConnect: ((String) -> Void)?
    var onClientDisconnect: ((String) -> Void)?
    var onMessage: ((String, String) -> Void)?

    func start(port: UInt16) -> UInt16? {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        do {
            listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)
        } catch {
            print("[WS] listener error: \(error)")
            return nil
        }
        listener?.newConnectionHandler = { [weak self] conn in
            self?.handleConnection(conn)
        }
        listener?.start(queue: .global())
        return listener?.port?.rawValue ?? port
    }

    func stop() {
        listener?.cancel()
        listener = nil
        for (_, conn) in connections { conn.close() }
        connections.removeAll()
    }

    func broadcast(_ message: String) {
        for (_, conn) in connections { conn.send(message) }
    }

    func send(to clientId: String, _ message: String) {
        connections[clientId]?.send(message)
    }

    private func handleConnection(_ conn: NWConnection) {
        let id = "c\(idCounter + 1)"
        idCounter += 1
        let wsConn = WebSocketConnection(id: id, connection: conn)
        connections[id] = wsConn
        wsConn.onHandshakeComplete = { [weak self] in
            self?.onClientConnect?(id)
        }
        wsConn.onMessage = { [weak self] msg in
            self?.onMessage?(id, msg)
        }
        wsConn.onClose = { [weak self] in
            self?.connections.removeValue(forKey: id)
            self?.onClientDisconnect?(id)
        }
        wsConn.start()
    }
}

class WebSocketConnection {
    let id: String
    private let connection: NWConnection
    private var handshaked = false
    private var receiveBuffer = Data()
    var onHandshakeComplete: (() -> Void)?
    var onMessage: ((String) -> Void)?
    var onClose: (() -> Void)?

    init(id: String, connection: NWConnection) {
        self.id = id
        self.connection = connection
    }

    func start() {
        connection.start(queue: .global())
        receive()
    }

    func close() {
        connection.cancel()
    }

    func send(_ message: String) {
        let data = message.data(using: .utf8) ?? Data()
        let frame = buildFrame(opcode: 0x01, payload: data)
        connection.send(content: frame, completion: .contentProcessed { _ in })
    }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            if let error = error {
                print("[WS conn] error: \(error)")
                self.onClose?()
                return
            }
            if isComplete {
                self.onClose?()
                return
            }
            if let data = data, !data.isEmpty {
                self.receiveBuffer.append(data)
                self.processBuffer()
            }
            self.receive()
        }
    }

    private func processBuffer() {
        if !handshaked {
            // 查找HTTP头结束
            if let range = receiveBuffer.range(of: Data("\r\n\r\n".utf8)) {
                let headerData = receiveBuffer.subdata(in: 0..<range.upperBound)
                receiveBuffer.removeSubrange(0..<range.upperBound)
                if let header = String(data: headerData, encoding: .utf8) {
                    handleHandshake(header)
                }
                handshaked = true
                onHandshakeComplete?()
            }
            return
        }
        // 解析WebSocket帧
        while receiveBuffer.count >= 2 {
            let b0 = receiveBuffer[0]
            let b1 = receiveBuffer[1]
            let masked = (b1 & 0x80) != 0
            var payloadLen = Int(b1 & 0x7F)
            var offset = 2
            if payloadLen == 126 {
                if receiveBuffer.count < 4 { return }
                payloadLen = Int(receiveBuffer[2]) << 8 | Int(receiveBuffer[3])
                offset = 4
            } else if payloadLen == 127 {
                if receiveBuffer.count < 10 { return }
                payloadLen = 0
                for i in 0..<8 {
                    payloadLen = (payloadLen << 8) | Int(receiveBuffer[2 + i])
                }
                offset = 10
            }
            var mask = [UInt8](repeating: 0, count: 4)
            if masked {
                if receiveBuffer.count < offset + 4 { return }
                for i in 0..<4 { mask[i] = receiveBuffer[offset + i] }
                offset += 4
            }
            if receiveBuffer.count < offset + payloadLen { return }
            var payload = receiveBuffer.subdata(in: offset..<(offset + payloadLen))
            if masked {
                for i in 0..<payload.count { payload[i] ^= mask[i & 3] }
            }
            receiveBuffer.removeSubrange(0..<(offset + payloadLen))
            let opcode = b0 & 0x0F
            if opcode == 0x8 { onClose?(); return }
            if opcode == 0x9 { /* ping, ignore */ continue }
            if let msg = String(data: payload, encoding: .utf8) {
                onMessage?(msg)
            }
        }
    }

    private func handleHandshake(_ header: String) {
        var key = ""
        for line in header.components(separatedBy: "\r\n") {
            if line.lowercased().hasPrefix("sec-websocket-key:") {
                key = line.components(separatedBy: ":")[1].trimmingCharacters(in: .whitespaces)
            }
        }
        let accept = computeAcceptKey(key)
        let response = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: \(accept)\r\n\r\n"
        connection.send(content: response.data(using: .utf8), completion: .contentProcessed { _ in })
    }

    private func computeAcceptKey(_ key: String) -> String {
        let s = key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        let data = Data(s.utf8)
        let hash = Insecure.SHA1.hash(data: data)
        return Data(hash).base64EncodedString()
    }

    private func buildFrame(opcode: UInt8, payload: Data) -> Data {
        var frame = Data()
        frame.append(0x80 | opcode)
        let len = payload.count
        if len < 126 {
            frame.append(UInt8(len))
        } else if len < 65536 {
            frame.append(126)
            frame.append(UInt8((len >> 8) & 0xFF))
            frame.append(UInt8(len & 0xFF))
        } else {
            frame.append(127)
            for i in (0..<8).reversed() {
                frame.append(UInt8((len >> (i * 8)) & 0xFF))
            }
        }
        frame.append(payload)
        return frame
    }
}
