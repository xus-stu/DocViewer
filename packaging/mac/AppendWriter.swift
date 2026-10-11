import Foundation

/// 把编辑结果写回源文件。独立成文件是为了能单独编译做真实文件测试
/// （见 tests/append_test.swift）。
enum FileWriter {

    enum Failure: LocalizedError {
        case missingPath, notFound, encodeFailed(String), cannotRead
        var errorDescription: String? {
            switch self {
            case .missingPath: return "missing path"
            case .notFound: return "file not found"
            case .encodeFailed(let e): return "encode failed: \(e)"
            case .cannotRead: return "cannot read"
            }
        }
    }

    /// 整文件写回（原子写入）。首次写入前的原文件会留一份 .bak。
    @discardableResult
    static func writeAll(path: String, data: Data, backup: Bool = true) throws -> Data {
        guard !path.isEmpty else { throw Failure.missingPath }
        let url = URL(fileURLWithPath: path)
        guard FileManager.default.fileExists(atPath: path) else { throw Failure.notFound }

        if backup {
            let bak = URL(fileURLWithPath: path + ".bak")
            if !FileManager.default.fileExists(atPath: bak.path) {
                try? (try Data(contentsOf: url)).write(to: bak)
            }
        }
        try data.write(to: url, options: .atomic)
        return data
    }

    /// 文本按指定编码写入（plain 模式）
    @discardableResult
    static func writeText(path: String, text: String, encoding: String, backup: Bool = true) throws -> Data {
        guard let data = text.data(using: stringEncoding(encoding), allowLossyConversion: false) else {
            throw Failure.encodeFailed(encoding)
        }
        return try writeAll(path: path, data: data, backup: backup)
    }

    static func stringEncoding(_ name: String) -> String.Encoding {
        switch name.lowercased() {
        case "gbk", "gb18030", "gb2312", "gb-18030":
            let cf = CFStringEncoding(CFStringEncodings.GB_18030_2000.rawValue)
            return String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(cf))
        case "big5":
            let cf = CFStringEncoding(CFStringEncodings.big5.rawValue)
            return String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(cf))
        case "shift_jis", "sjis":
            let cf = CFStringEncoding(CFStringEncodings.shiftJIS.rawValue)
            return String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(cf))
        case "utf-16", "utf16":
            return .utf16
        default:
            return .utf8
        }
    }
}
