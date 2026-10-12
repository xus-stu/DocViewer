import Foundation

/// 把编辑结果写回源文件。独立成文件是为了能单独编译做真实文件测试
/// （见 tests/append_test.swift）。
enum FileWriter {

    enum Failure: LocalizedError {
        case missingPath, notFound, encodeFailed(String), cannotRead, wouldEmpty, unknownEncoding(String),
             backupFailed, readOnly, dirNotWritable
        var errorDescription: String? {
            switch self {
            case .missingPath: return "missing path"
            case .notFound: return "file not found"
            case .encodeFailed(let e): return "encode failed: \(e)"
            case .cannotRead: return "cannot read"
            case .wouldEmpty: return "refused to truncate a non-empty file"
            case .unknownEncoding(let e): return "unknown encoding: \(e)"
            case .backupFailed: return "cannot write backup (.bak is unusable)"
            case .readOnly: return "file is read-only"
            case .dirNotWritable: return "target directory is not writable"; 
            }
        }
    }

    /// 整文件写回（原子写入）。
    ///
    /// 备份策略：
    /// - `.bak`   首次写入前的原始版本，只写一次，之后不再动（用户的"出厂版本"）
    /// - `.bak.prev` 每次写入前滚动一份上一版，连续保存也有得回退
    ///
    /// 备份写失败就直接中止，绝不"没备份也照样覆盖"；备份本身也是原子写，
    /// 避免中途掉电留下一个截断的 .bak 反过来让后续判断以为有备份。
    @discardableResult
    static func writeAll(path: String, data: Data, backup: Bool = true) throws -> Data {
        guard !path.isEmpty else { throw Failure.missingPath }
        // 软链：直接 atomic 写会把链接换成普通文件（链接目标不更新），先解析到真实路径
        let resolved = URL(fileURLWithPath: path).resolvingSymlinksInPath()
        let url = FileManager.default.fileExists(atPath: resolved.path) ? resolved : URL(fileURLWithPath: path)
        let exists = FileManager.default.fileExists(atPath: url.path)
        if exists {
            guard FileManager.default.isWritableFile(atPath: url.path) else { throw Failure.readOnly }   // B10
        } else {
            // B25：允许新建，但父目录要可写，并给出和「文件只读」不同的错误
            let dir = url.deletingLastPathComponent().path
            guard FileManager.default.isWritableFile(atPath: dir) else { throw Failure.dirNotWritable }
        }

        // 拒绝把有内容的文件清空（前端 bug / 消息异常时的最后一道闸）
        let old = exists ? ((try? Data(contentsOf: url)) ?? Data()) : Data()
        if data.isEmpty && !old.isEmpty { throw Failure.wouldEmpty }

        if backup {
            let current = old
            let bak = URL(fileURLWithPath: path + ".bak")
            var isDir: ObjCBool = false
            if FileManager.default.fileExists(atPath: bak.path, isDirectory: &isDir) {
                // .bak 被同名目录占着 → 没有可用的备份，宁可中止也不做无备份覆盖
                if isDir.boolValue { throw Failure.backupFailed }
            } else {
                try current.write(to: bak, options: .atomic)     // 失败就抛，不再 try?
            }
            let prev = URL(fileURLWithPath: path + ".bak.prev")
            try current.write(to: prev, options: .atomic)
        }
        try data.write(to: url, options: .atomic)
        return data
    }

    /// 文本按指定编码写入（plain 模式）
    @discardableResult
    static func writeText(path: String, text: String, encoding: String, backup: Bool = true) throws -> Data {
        guard let enc = stringEncoding(encoding) else { throw Failure.unknownEncoding(encoding) }
        // B11：HTML 解析会把 CRLF 规范成 LF；写回时按原文件的换行风格还原
        var out = text
        if let old = try? Data(contentsOf: URL(fileURLWithPath: path)),
           let oldText = String(data: old, encoding: enc) ?? String(data: old, encoding: .utf8) {
            let crlf = oldText.components(separatedBy: "\r\n").count - 1
            let loneLf = oldText.replacingOccurrences(of: "\r\n", with: "").components(separatedBy: "\n").count - 1
            if crlf > 0 && loneLf == 0 {
                out = text.replacingOccurrences(of: "\r\n", with: "\n")
                          .replacingOccurrences(of: "\n", with: "\r\n")
            }
        }
        guard let data = out.data(using: enc, allowLossyConversion: false) else {
            throw Failure.encodeFailed(encoding)
        }
        return try writeAll(path: path, data: data, backup: backup)
    }

    /// 编码名 → String.Encoding。**认不出来就返回 nil**，由调用方报错；
    /// 绝不静默回退 UTF-8（那会把 GBK / UTF-16 文件悄悄改写成 UTF-8）。
    static func stringEncoding(_ name: String) -> String.Encoding? {
        let n = name.lowercased().trimmingCharacters(in: .whitespaces)
        func cf(_ enc: CFStringEncodings) -> String.Encoding {
            String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(enc.rawValue)))
        }
        switch n {
        // 前端会发显示名（GB18030/GBK、UTF-16LE (BOM)、WINDOWS-1252…），这里按包含关系兜住
        case let x where x.contains("gb18030") || x.contains("gbk") || x.contains("gb2312") || x.contains("936"):
            return cf(.GB_18030_2000)
        case let x where x.contains("big5") || x.contains("950"):
            return cf(.big5)
        case let x where x.contains("shift_jis") || x.contains("sjis") || x.contains("932"):
            return cf(.shiftJIS)
        case let x where x.contains("utf-16be") || x.contains("utf16be"):
            return .utf16BigEndian
        case let x where x.contains("utf-16") || x.contains("utf16"):
            return .utf16LittleEndian
        case let x where x.contains("utf-8") || x.contains("utf8"):
            return .utf8
        case let x where x.contains("1252") || x.contains("latin") || x.contains("iso-8859-1"):
            return .isoLatin1
        default:
            return nil
        }
    }
}
