import UIKit
import CryptoKit

// 游戏远程拉取管理器：版本对比 → 下载 → 校验 → 解密 → 解压到临时目录
// 磁盘上存加密 bin（离线缓存）+ 运行时临时目录（file:// 加载，退出时删除）
final class GameLauncher: NSObject {
    // 回调
    var onStatus: ((String, String) -> Void)?
    var onProgress: ((Double, Double, Double, Double) -> Void)?
    var onLatestVersion: ((String) -> Void)?
    var onLocalVersion: ((String) -> Void)?
    var onPackSize: ((Double) -> Void)?
    var onError: ((String) -> Void)?
    var onComplete: (() -> Void)?

    // 配置
    private let serverBase = URL(string: "https://api.xzd1314.top/release/ios/")!
    private let manifestTimeout: TimeInterval = 2
    private let downloadTimeout: TimeInterval = 120

    // 密钥（第二段倒序存储）
    private let keyHexPart1 = "0dc40b4c92fbbe21974f98f9d8c0ae01"
    private let keyHexPart2 = "b05399713f89b2e28370d8c09e22645a"

    // 本地路径（只存加密 bin + version.txt）
    private var cacheDir: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("zhulaile", isDirectory: true)
    }
    private var versionFile: URL { cacheDir.appendingPathComponent("version.txt") }

    // 运行时游戏目录（解密解压后的明文游戏文件，file:// 加载，退出时删除）
    // 用 Caches 目录而不是临时目录，权限更稳定，WKWebView 能正常加载子资源
    private var gameDir: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("zhulaile_game", isDirectory: true)
    }

    // 游戏 index.html 的 URL（供 WebView 加载）
    var gameIndexURL: URL { gameDir.appendingPathComponent("index.html") }

    // 下载进度
    private var lastProgressTime = Date()
    private var lastProgressBytes: Double = 0

    func launch() {
        let localVersionStr = (try? String(contentsOf: versionFile, encoding: .utf8)) ?? "无"
        let localVersion = Int(localVersionStr) ?? 0
        onLocalVersion?(localVersionStr)

        let localBin = findLocalBin()

        if localBin == nil {
            onStatus?("正在连接服务器…", "连接中")
            Task {
                do {
                    let manifest = try await fetchManifest()
                    onLatestVersion?("\(manifest.version)")
                    onPackSize?(Double(manifest.size) / 1024 / 1024)
                    try await downloadAndCache(manifest: manifest)
                    try loadFromCache(version: manifest.version)
                    onLocalVersion?("\(manifest.version)")
                    onStatus?("准备进入游戏…", "完成")
                    onComplete?()
                } catch {
                    onError?("首次启动需要联网下载游戏，请检查网络后重试")
                }
            }
            return
        }

        // 本地有加密 bin：先加载到内存（保证离线可玩）
        try? loadFromCache(version: localVersion)

        onStatus?("正在检查更新…", "检查中")
        Task {
            let manifest: Manifest?
            do {
                manifest = try await fetchManifest()
            } catch {
                manifest = nil
            }
            if let m = manifest {
                onLatestVersion?("\(m.version)")
                if m.version > localVersion {
                    onPackSize?(Double(m.size) / 1024 / 1024)
                    onStatus?("发现新版本，开始下载…", "下载中")
                    do {
                        try await downloadAndCache(manifest: m)
                        try loadFromCache(version: m.version)
                        onLocalVersion?("\(m.version)")
                    } catch {
                        NSLog("[GameLauncher] update failed: \(error)")
                    }
                }
            }
            onStatus?("准备进入游戏…", "完成")
            onComplete?()
        }
    }

    // MARK: - Manifest
    struct Manifest: Decodable {
        let version: Int
        let file: String
        let size: Int
        let sha256: String
    }

    private func fetchManifest() async throws -> Manifest {
        // 加时间戳参数绕 CDN 缓存，确保拿到最新版本号（兼容 iOS 15，不用 append(queryItems:)）
        var components = URLComponents(url: serverBase.appendingPathComponent("manifest.json"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "t", value: String(Int(Date().timeIntervalSince1970)))]
        let url = components.url!
        let data = try await fetchData(url: url, timeout: manifestTimeout)
        return try JSONDecoder().decode(Manifest.self, from: data)
    }

    // MARK: - 下载 + 存磁盘（只存加密 bin）

    private func downloadAndCache(manifest: Manifest) async throws {
        let binURL = serverBase.appendingPathComponent(manifest.file)
        let totalMB = Double(manifest.size) / 1024 / 1024

        lastProgressTime = Date()
        lastProgressBytes = 0
        let binData = try await downloadWithProgress(url: binURL, totalMB: totalMB)

        onStatus?("下载完成，正在校验完整性…", "校验中")
        let digest = SHA256.hash(data: binData).map { String(format: "%02x", $0) }.joined()
        guard digest == manifest.sha256 else {
            throw NSError(domain: "GameLauncher", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "文件校验失败"])
        }

        let fm = FileManager.default
        try fm.createDirectory(at: cacheDir, withIntermediateDirectories: true)
        let binFile = cacheDir.appendingPathComponent(manifest.file)
        try binData.write(to: binFile)
        try String(manifest.version).write(to: versionFile, atomically: true, encoding: .utf8)

        // 清理旧 bin
        if let bins = try? fm.contentsOfDirectory(at: cacheDir, includingPropertiesForKeys: nil) {
            for f in bins {
                if f.lastPathComponent.hasPrefix("game_") && f.lastPathComponent.hasSuffix(".bin")
                    && f.lastPathComponent != manifest.file {
                    try? fm.removeItem(at: f)
                }
            }
        }
    }

    // MARK: - 从磁盘加密 bin 解密解压到临时目录

    private func loadFromCache(version: Int) throws {
        guard let binFile = findLocalBin() else {
            throw NSError(domain: "GameLauncher", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "本地缓存不存在"])
        }

        onStatus?("正在解密游戏资源…", "解密中")
        let binData = try Data(contentsOf: binFile)

        // AES-GCM 解密（服务器格式：nonce(12)+ciphertext+tag(16) = SealedBox combined 格式）
        let sealed = try AES.GCM.SealedBox(combined: binData)
        let zipData = try AES.GCM.open(sealed, using: aesKey())

        onStatus?("正在解压到临时目录…", "加载中")
        // 先清理旧的临时目录
        let fm = FileManager.default
        try? fm.removeItem(at: gameDir)
        try fm.createDirectory(at: gameDir, withIntermediateDirectories: true)
        try ZipExtractor.extract(zipData: zipData, to: gameDir)
        guard fm.fileExists(atPath: gameIndexURL.path) else {
            throw NSError(domain: "GameLauncher", code: 3,
                          userInfo: [NSLocalizedDescriptionKey: "游戏包格式错误"])
        }
    }

    /// 退出时清理临时目录（明文游戏文件）
    func cleanup() {
        try? FileManager.default.removeItem(at: gameDir)
    }

    private func findLocalBin() -> URL? {
        let fm = FileManager.default
        guard let bins = try? fm.contentsOfDirectory(at: cacheDir, includingPropertiesForKeys: nil) else {
            return nil
        }
        let gameBins = bins.filter { $0.lastPathComponent.hasPrefix("game_") && $0.lastPathComponent.hasSuffix(".bin") }
        return gameBins.max { $0.lastPathComponent < $1.lastPathComponent }
    }

    // MARK: - 网络工具
    private func fetchData(url: URL, timeout: TimeInterval) async throws -> Data {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = timeout
        config.timeoutIntervalForResource = timeout
        let session = URLSession(configuration: config)
        let (data, response) = try await session.data(from: url)
        session.finishTasksAndInvalidate()
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw NSError(domain: "GameLauncher", code: 4,
                          userInfo: [NSLocalizedDescriptionKey: "HTTP error"])
        }
        return data
    }

    private func downloadWithProgress(url: URL, totalMB: Double) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            let config = URLSessionConfiguration.ephemeral
            config.timeoutIntervalForRequest = downloadTimeout
            config.timeoutIntervalForResource = downloadTimeout
            let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
            let task = session.downloadTask(with: url)
            task.taskDescription = "totalMB:\(totalMB)"
            objc_setAssociatedObject(self, &GameLauncher.continuationKey, continuation, .OBJC_ASSOCIATION_RETAIN)
            task.resume()
        }
    }

    private static var continuationKey: UInt8 = 0

    // MARK: - 密钥
    private func aesKey() -> SymmetricKey {
        let hex = keyHexPart1 + String(keyHexPart2.reversed())
        var bytes = [UInt8]()
        var idx = hex.startIndex
        while idx < hex.endIndex {
            let end = hex.index(idx, offsetBy: 2)
            bytes.append(UInt8(String(hex[idx..<end]), radix: 16) ?? 0)
            idx = end
        }
        return SymmetricKey(data: Data(bytes))
    }
}

// MARK: - URLSessionDownloadDelegate
extension GameLauncher: URLSessionDownloadDelegate {
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        do {
            let data = try Data(contentsOf: location)
            if let cont = objc_getAssociatedObject(self, &GameLauncher.continuationKey)
                as? CheckedContinuation<Data, Error> {
                cont.resume(returning: data)
            }
        } catch {
            if let cont = objc_getAssociatedObject(self, &GameLauncher.continuationKey)
                as? CheckedContinuation<Data, Error> {
                cont.resume(throwing: error)
            }
        }
        session.finishTasksAndInvalidate()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        let downloaded = Double(totalBytesWritten)
        let total = Double(totalBytesExpectedToWrite) > 0 ? Double(totalBytesExpectedToWrite) : downloaded
        let percent = downloaded / total * 100
        let downloadedMB = downloaded / 1024 / 1024
        let totalMB = total / 1024 / 1024
        let now = Date()
        let dt = now.timeIntervalSince(lastProgressTime)
        if dt >= 0.2 {
            let speed = (downloaded - lastProgressBytes) / dt / 1024 / 1024
            onProgress?(percent, downloadedMB, totalMB, max(speed, 0))
            lastProgressTime = now
            lastProgressBytes = downloaded
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error {
            if let cont = objc_getAssociatedObject(self, &GameLauncher.continuationKey)
                as? CheckedContinuation<Data, Error> {
                cont.resume(throwing: error)
            }
            session.finishTasksAndInvalidate()
        }
    }
}
