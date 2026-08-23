import Foundation

class UdpManager {
    private var broadcastSocket: Int32 = -1
    private var broadcastThread: Thread?
    private var isBroadcasting = false
    private var scanSocket: Int32 = -1
    private var scanThread: Thread?
    private var isScanning = false
    private var broadcastPort: UInt16 = 8766
    var onRoomFound: ((String, String) -> Void)?

    func startBroadcast(roomInfo: String, port: UInt16) {
        stopBroadcast()
        broadcastPort = port
        isBroadcasting = true
        broadcastThread = Thread { [weak self] in
            self?.broadcastLoop(roomInfo: roomInfo, port: port)
        }
        broadcastThread?.start()
    }

    func stopBroadcast() {
        isBroadcasting = false
        if broadcastSocket >= 0 {
            close(broadcastSocket)
            broadcastSocket = -1
        }
        broadcastThread?.cancel()
        broadcastThread = nil
    }

    func startScan(port: UInt16) {
        stopScan()
        isScanning = true
        scanThread = Thread { [weak self] in
            self?.scanLoop(port: port)
        }
        scanThread?.start()
    }

    func stopScan() {
        isScanning = false
        if scanSocket >= 0 {
            close(scanSocket)
            scanSocket = -1
        }
        scanThread?.cancel()
        scanThread = nil
    }

    func getLocalIP() -> String {
        var address = "127.0.0.1"
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        if getifaddrs(&ifaddr) == 0 {
            var ptr = ifaddr
            // 第一遍：优先找en0（WiFi）的192.168.x地址
            while ptr != nil {
                defer { ptr = ptr?.pointee.ifa_next }
                guard let interface = ptr?.pointee else { continue }
                let name = String(cString: interface.ifa_name)
                let flags = interface.ifa_flags
                if (flags & UInt32(IFF_UP)) == 0 || (flags & UInt32(IFF_LOOPBACK)) != 0 { continue }
                if name == "en0", interface.ifa_addr.pointee.sa_family == UInt8(AF_INET) {
                    var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                    if getnameinfo(interface.ifa_addr, socklen_t(interface.ifa_addr.pointee.sa_len),
                                   &hostname, socklen_t(hostname.count), nil, 0, NI_NUMERICHOST) == 0 {
                        let ip = String(cString: hostname)
                        if ip.hasPrefix("192.168.") || ip.hasPrefix("10.") || ip.hasPrefix("172.") {
                            address = ip
                            freeifaddrs(ifaddr)
                            return address
                        }
                    }
                }
            }
            freeifaddrs(ifaddr)
            // 第二遍：找任意接口的局域网地址
            if getifaddrs(&ifaddr) == 0 {
                ptr = ifaddr
                while ptr != nil {
                    defer { ptr = ptr?.pointee.ifa_next }
                    guard let interface = ptr?.pointee else { continue }
                    let flags = interface.ifa_flags
                    if (flags & UInt32(IFF_UP)) == 0 || (flags & UInt32(IFF_LOOPBACK)) != 0 { continue }
                    if interface.ifa_addr.pointee.sa_family == UInt8(AF_INET) {
                        var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                        if getnameinfo(interface.ifa_addr, socklen_t(interface.ifa_addr.pointee.sa_len),
                                       &hostname, socklen_t(hostname.count), nil, 0, NI_NUMERICHOST) == 0 {
                            let ip = String(cString: hostname)
                            if ip.hasPrefix("192.168.") {
                                address = ip
                                break
                            }
                        }
                    }
                }
                freeifaddrs(ifaddr)
            }
        }
        return address
    }

    private func broadcastLoop(roomInfo: String, port: UInt16) {
        broadcastSocket = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        guard broadcastSocket >= 0 else { return }
        var yes: Int32 = 1
        setsockopt(broadcastSocket, SOL_SOCKET, SO_BROADCAST, &yes, socklen_t(MemoryLayout.size(ofValue: yes)))

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = INADDR_BROADCAST.bigEndian

        let data = roomInfo.data(using: .utf8) ?? Data()
        let addrSize = socklen_t(MemoryLayout.size(ofValue: addr))
        while isBroadcasting {
            withUnsafePointer(to: &addr) { ptr in
                ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
                    data.withUnsafeBytes { buf in
                        _ = sendto(broadcastSocket, buf.baseAddress, data.count, 0, saPtr, addrSize)
                    }
                }
            }
            Thread.sleep(forTimeInterval: 1.5)
        }
    }

    private func scanLoop(port: UInt16) {
        scanSocket = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        guard scanSocket >= 0 else { return }
        var yes: Int32 = 1
        setsockopt(scanSocket, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout.size(ofValue: yes)))

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = INADDR_ANY.bigEndian

        let addrSize = socklen_t(MemoryLayout.size(ofValue: addr))
        let bindResult = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
                bind(scanSocket, saPtr, addrSize)
            }
        }
        guard bindResult == 0 else { return }

        var buffer = [UInt8](repeating: 0, count: 4096)
        var senderAddr = sockaddr_in()
        var senderLen = socklen_t(MemoryLayout.size(ofValue: senderAddr))
        while isScanning {
            let bytesRead = withUnsafeMutablePointer(to: &senderAddr) { ptr in
                ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saPtr in
                    recvfrom(scanSocket, &buffer, buffer.count, 0, saPtr, &senderLen)
                }
            }
            if bytesRead > 0 {
                let msg = String(cString: buffer) // 可能有问题，用Data
                let data = Data(bytes: buffer, count: bytesRead)
                if let msg = String(data: data, encoding: .utf8) {
                    let ip = inet_ntoa(senderAddr.sin_addr).flatMap { String(cString: $0) } ?? "unknown"
                    DispatchQueue.main.async { [weak self] in
                        self?.onRoomFound?(msg, ip)
                    }
                }
            }
        }
    }
}
