import Foundation
import Compression

// 最小 ZIP 解压工具：支持 STORE 和 DEFLATE，用系统 Compression 框架
struct ZipExtractor {

    enum ZipError: Error {
        case badSignature
        case unsupportedMethod(UInt16)
        case inflateFailed
    }

    static func extract(zipData: Data, to destDir: URL) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: destDir, withIntermediateDirectories: true)

        var offset = 0
        while offset + 30 <= zipData.count {
            let sig = readUInt32(zipData, offset)
            guard sig == 0x04034b50 else { break } // 本地文件头结束

            let flags = readUInt16(zipData, offset + 6)
            let method = readUInt16(zipData, offset + 8)
            var compSize = Int(readUInt32(zipData, offset + 18))
            let uncompSize = Int(readUInt32(zipData, offset + 22))
            let nameLen = Int(readUInt16(zipData, offset + 26))
            let extraLen = Int(readUInt16(zipData, offset + 28))

            let dataOffset = offset + 30 + nameLen + extraLen
            let nameData = zipData.subdata(in: (offset + 30)..<(offset + 30 + nameLen))
            let name = String(data: nameData, encoding: .utf8) ?? ""

            // 数据描述符（flags bit 3）：大小在数据后
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

            let fileURL = destDir.appendingPathComponent(name)

            if name.hasSuffix("/") || name.isEmpty {
                try fm.createDirectory(at: fileURL, withIntermediateDirectories: true)
            } else {
                try fm.createDirectory(at: fileURL.deletingLastPathComponent(),
                                        withIntermediateDirectories: true)
                let compData = zipData.subdata(in: dataOffset..<(dataOffset + compSize))

                let outData: Data
                switch method {
                case 0:
                    outData = compData
                case 8:
                    outData = try inflate(data: compData, uncompressedSize: uncompSize)
                default:
                    throw ZipError.unsupportedMethod(method)
                }
                try outData.write(to: fileURL)
            }

            offset = dataOffset + compSize
        }
    }

    private static func inflate(data: Data, uncompressedSize: Int) throws -> Data {
        let destBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: max(uncompressedSize, 1))
        defer { destBuffer.deallocate() }

        let result = data.withUnsafeBytes { srcPtr -> Int in
            compression_decode_buffer(
                destBuffer, max(uncompressedSize, 1),
                srcPtr.bindMemory(to: UInt8.self).baseAddress!, data.count,
                nil, COMPRESSION_ZLIB
            )
        }

        guard result > 0 else { throw ZipError.inflateFailed }
        return Data(bytes: destBuffer, count: result)
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
