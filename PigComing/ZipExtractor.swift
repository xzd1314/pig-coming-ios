import Foundation
import Compression

// 最小 ZIP 解压工具：支持 STORE 和 DEFLATE，用系统 Compression 框架
struct ZipExtractor {
    enum ZipError: Error {
        case badSignature
        case unsupportedMethod(UInt16)
        case inflateFailed
    }

    /// 解压到磁盘（保留原接口，内部调用 extractToMemory）
    static func extract(zipData: Data, to destDir: URL) throws {
        let files = try extractToMemory(zipData: zipData)
        let fm = FileManager.default
        try fm.createDirectory(at: destDir, withIntermediateDirectories: true)
        for (name, data) in files {
            let fileURL = destDir.appendingPathComponent(name)
            try fm.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: fileURL)
        }
    }

    /// 解压到内存字典（不写磁盘），返回 [文件名: 文件内容]
    static func extractToMemory(zipData: Data) throws -> [String: Data] {
        var result: [String: Data] = [:]
        var offset = 0
        while offset + 30 <= zipData.count {
            let sig = readUInt32(zipData, offset)
            guard sig == 0x04034b50 else { break }
            let flags = readUInt16(zipData, offset + 6)
            let method = readUInt16(zipData, offset + 8)
            var compSize = Int(readUInt32(zipData, offset + 18))
            let nameLen = Int(readUInt16(zipData, offset + 26))
            let extraLen = Int(readUInt16(zipData, offset + 28))
            let dataOffset = offset + 30 + nameLen + extraLen
            let nameData = zipData.subdata(in: (offset + 30)..<(offset + 30 + nameLen))
            let name = String(data: nameData, encoding: .utf8) ?? ""
            // 数据描述符（flags bit 3）
            if (flags & 0x08) != 0 && compSize == 0 {
                var scan = dataOffset
                while scan + 16 <= zipData.count {
                    if readUInt32(zipData, scan) == 0x08074b50 {
                        compSize = Int(readUInt32(zipData, scan + 8))
                        break
                    }
                    scan += 1
                }
            }
            if !name.hasSuffix("/") && !name.isEmpty {
                let compData = zipData.subdata(in: dataOffset..<(dataOffset + compSize))
                let outData: Data
                switch method {
                case 0:
                    outData = compData
                case 8:
                    outData = try inflate(data: compData)
                default:
                    throw ZipError.unsupportedMethod(method)
                }
                let key = name.hasPrefix("./") ? String(name.dropFirst(2)) : name
                result[key] = outData
            }
            offset = dataOffset + compSize
        }
        return result
    }

    private static func inflate(data: Data) throws -> Data {
        // 估算解压后大小（zip 里 DEFLATE 通常压缩比 2-3 倍，先分配 4 倍，不够再扩）
        var buffer = Data(count: data.count * 4)
        var totalDecompressed = 0
        var srcOffset = 0

        while srcOffset < data.count {
            let remaining = data.count - srcOffset
            let available = buffer.count - totalDecompressed
            if available < 4096 {
                buffer.count *= 2
                continue
            }
            let decoded = buffer.withUnsafeMutableBytes { dstPtr -> Int in
                data.withUnsafeBytes { srcPtr -> Int in
                    let srcBase = srcPtr.bindMemory(to: UInt8.self).baseAddress! + srcOffset
                    let dstBase = dstPtr.bindMemory(to: UInt8.self).baseAddress! + totalDecompressed
                    return compression_decode_buffer(
                        dstBase, available,
                        srcBase, remaining,
                        nil, COMPRESSION_ZLIB
                    )
                }
            }
            if decoded == 0 { break }
            totalDecompressed += decoded
            srcOffset += remaining // compression_decode_buffer 会消费全部输入
            break // 单次调用通常就能解压完
        }

        guard totalDecompressed > 0 else { throw ZipError.inflateFailed }
        return buffer.prefix(totalDecompressed)
    }

    private static func readUInt32(_ data: Data, _ offset: Int) -> UInt32 {
        return UInt32(data[offset])
            | (UInt32(data[offset + 1]) << 8)
            | (UInt32(data[offset + 2]) << 16)
            | (UInt32(data[offset + 3]) << 24)
    }

    private static func readUInt16(_ data: Data, _ offset: Int) -> UInt16 {
        return UInt16(data[offset]) | (UInt16(data[offset + 1]) << 8)
    }
}
