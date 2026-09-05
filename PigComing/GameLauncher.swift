import UIKit
import CryptoKit

// 游戏远程拉取管理器：版本对比 → 下载 → 校验 → 解密 → 解压
final class GameLauncher: NSObject {

    // 回调
    var onStatus: ((String, String) -> Void)?       // (状态文字, 状态标签)
    var onProgress: ((Double, Double, Double, Double) -> Void)? // (百分比, 已下载MB, 总MB, 速度MB/s)
    var onLatestVersion: ((String) -> Void)?
    var onLocalVersion: ((String) -> Void)?
    var onPackSize: ((Double) -> Void)?
    var onError: ((String) -> Void)?
    var onComplete: (() -> Void)?

    // 配置
    private let serverBase = URL(string: "https://api.xzd1314.top/release/ios/")!
    private let manifestTimeout: TimeInterval = 2
    private let downloadTimeout: TimeInterval = 120

    // 密钥（与服务器 build_release.py 一致，第二段倒序存储）
    private let keyHexPart1 = "0dc40b4c92fbbe21974f98f9d8c0ae01"
    private let keyHexPart2 = "b05399713f89b2e28370d8c09e22645a"

    // 本地路径
    private var gameDir: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("zhulaile", isDirectory: true)
    }
    private var versionFile: URL { gameDir.appendingPathComponent("version.txt") }
    var indexPath: URL { gameDir.appendingPathComponent("index.html") }

    // 下载进度
    private var lastProgressTime = Date()
    private var lastProgressBytes: Double = 0

    func launch() {
        let fm = FileManager.default
        let hasLocal = fm.fileExists(atPath: indexPath.path)
        let localVersion = (try? String(contentsOf: versionFile, encoding: .utf8)) ?? "无"
        onLocalVersion?(localVersion)

        if !hasLocal {
            // 本地没有：必须联网拉取
            onStatus?("正在连接服务器…", "连接中")
            Task {
                do {
                    let manifest = try await fetchManifest()
                    onLatestVersion?("v\(manifest.version)")
                    onPackSize?(Double(manifest.size) / 1024 / 1024)
                    try await downloadAndInstall(manifest: manifest)
                    onLocalVersion?("v\(manifest.version)")
                    onStatus?("准备进入游戏…", "完成")
                    onComplete?()
                } catch {
                    onError?("首次启动需要联网下载游戏，请检查网络后重试")
                }
            }
            return
        }

        // 本地有：查版本
        onStatus?("正在检查更新…", "检查中")
        Task {
            let manifest: Manifest?
            do {
                manifest = try await fetchManifest()
            } catch {
                manifest = nil // 连不上服务器 → 直接用本地
            }

            if let m = manifest {
                onLatestVersion?("v\(m.version)")
                if String(m.version) != localVersion {
                    // 版本不一致：下载更新
                    onPackSize?(Double(m.size) / 1024 / 1024)
                    onStatus?("发现新版本 v\(m.version)，开始下载…", "下载中")
                    do {
                        try await downloadAndInstall(manifest: m)
                        onLocalVersion?("v\(m.version)")
                    } catch {
                        // 下载失败：保留旧版
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
        let url = serverBase.appendingPathComponent("manifest.json")
        let data = try await fetchData(url: url, timeout: manifestTimeout)
        return try JSONDecoder().decode(Manifest.self, from: data)
    }

    // MARK: - 下载 + 校验 + 解密 + 解压

    private func downloadAndInstall(manifest: Manifest) async throws {
        let binURL = serverBase.appendingPathComponent(manifest.file)
        let totalMB = Double(manifest.size) / 1024 / 1024

        // 下载（带进度）
        lastProgressTime = Date()
        lastProgressBytes = 0
        let binData = try await downloadWithProgress(url: binURL, totalMB: totalMB)

        onStatus?("下载完成，正在校验完整性…", "校验中")

        // 1. sha256 校验
        let digest = SHA256.hash(data: binData).map { String(format: "%02x", $0) }.joined()
        guard digest == manifest.sha256 else {
            throw NSError(domain: "GameLauncher", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "文件校验失败"])
        }

        onStatus?("正在解密游戏资源…", "解密中")

        // 2. AES-GCM 解密
        let combined = Data(binData.dropFirst(12))
        let sealed = try AES.GCM.SealedBox(combined: combined)
        let zipData = try AES.GCM.open(sealed, using: aesKey())

        onStatus?("正在解压文件…", "解压中")

        // 3. 解压到临时目录
        let fm = FileManager.default
        let tmp = fm.temporaryDirectory
            .appendingPathComponent("zhulaile_\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: tmp, withIntermediateDirectories: true)
        try ZipExtractor.extract(zipData: zipData, to: tmp)
        guard fm.fileExists(atPath: tmp.appendingPathComponent("index.html").path) else {
            throw NSError(domain: "GameLauncher", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "游戏包格式错误"])
        }

        // 4. 替换本地
        if fm.fileExists(atPath: gameDir.path) {
            try fm.removeItem(at: gameDir)
        }
        try fm.createDirectory(at: gameDir, withIntermediateDirectories: true)
        for item in try fm.contentsOfDirectory(at: tmp, includingPropertiesForKeys: nil) {
            try fm.moveItem(at: item, to: gameDir.appendingPathComponent(item.lastPathComponent))
        }
        try String(manifest.version).write(to: versionFile, atomically: true, encoding: .utf8)

        // 5. 清理
        try? fm.removeItem(at: tmp)
    }

    // MARK: - 网络工具

    private func fetchData(url: URL, timeout: TimeInterval) async throws -> Data {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = timeout
        config.timeoutIntervalForResource = timeout
        let session = URLSession(configuration: config)
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw NSError(domain: "GameLauncher", code: 3,
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
            // 保存 continuation
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
