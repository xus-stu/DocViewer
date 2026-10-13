import Foundation
import Darwin

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

        // 拒绝把有内容的文件清空（前端 bug / 消息异常时的最后一道闸）。
        // 读取失败必须报错中止：以前用 try? 吞掉，读不到就当成「空文件」，
        // 于是 wouldEmpty 这道闸形同虚设，还会拿一份 0 字节的假备份覆盖 .bak.prev。
        let old: Data
        if exists {
            do { old = try Data(contentsOf: url) }
            catch { throw Failure.cannotRead }
        } else {
            old = Data()
        }
        if data.isEmpty && !old.isEmpty { throw Failure.wouldEmpty }

        if backup && exists && !old.isEmpty {
            let bak = URL(fileURLWithPath: path + ".bak")
            var isDir: ObjCBool = false
            if FileManager.default.fileExists(atPath: bak.path, isDirectory: &isDir) {
                // .bak 被同名目录占着 → 没有可用的备份，宁可中止也不做无备份覆盖
                if isDir.boolValue { throw Failure.backupFailed }
            } else {
                try old.write(to: bak, options: .atomic)     // 失败就抛，不再 try?
            }
            let prev = URL(fileURLWithPath: path + ".bak.prev")
            var prevIsDir: ObjCBool = false
            if FileManager.default.fileExists(atPath: prev.path, isDirectory: &prevIsDir) {
                // 每次写回都会覆盖 .bak.prev；它是目录时直接中止，绝不 rm -rf 用户的东西
                if prevIsDir.boolValue { throw Failure.backupFailed }
            }
            try old.write(to: prev, options: .atomic)
        }
        try writePreserving(path: url.path, data: data, hadOriginal: exists)
        return data
    }

    /// 文件有几个硬链接名（1 表示没有别的名字指着它）
    static func linkCount(_ path: String) -> Int {
        var st = stat()
        guard stat(path, &st) == 0 else { return 1 }
        return Int(st.st_nlink)
    }

    /**
     落盘。目标是「内容换了，文件的身份尽量别换」：
     - 有硬链接的文件改成原地覆写 —— 原子替换会换掉 inode，
       别的链接名就永远看不到新内容了（评审实测：inode 变了）
     - 其余情况仍然原子写，但把扩展属性带过去
       （评审实测：原子替换会丢掉 kMDItemWhereFroms 这类 xattr）
     */
    static func writePreserving(path: String, data: Data, hadOriginal: Bool) throws {
        if hadOriginal && linkCount(path) > 1 {
            try data.write(to: URL(fileURLWithPath: path), options: [])
            return
        }
        let attrs = hadOriginal ? readXattrs(path) : []
        try data.write(to: URL(fileURLWithPath: path), options: .atomic)
        if !attrs.isEmpty { writeXattrs(path, attrs) }
    }

    /// 读出文件上的全部扩展属性（失败就当没有）
    static func readXattrs(_ path: String) -> [(String, Data)] {
        var out: [(String, Data)] = []
        let size = listxattr(path, nil, 0, 0)
        guard size > 0 else { return out }
        var names = [UInt8](repeating: 0, count: size)
        let n = listxattr(path, &names, size, 0)
        guard n > 0 else { return out }
        var i = 0
        while i < Int(n) {
            var buf: [UInt8] = []
            while i < Int(n) && names[i] != 0 { buf.append(names[i]); i += 1 }
            i += 1
            guard let name = String(bytes: buf, encoding: .utf8), !name.isEmpty else { continue }
            let vsize = getxattr(path, name, nil, 0, 0, 0)
            guard vsize > 0 else { continue }
            var value = [UInt8](repeating: 0, count: vsize)
            let got = getxattr(path, name, &value, vsize, 0, 0)
            if got > 0 { out.append((name, Data(value.prefix(got)))) }
        }
        return out
    }

    /// 把扩展属性写回新文件；个别受保护的名字写不进去（比如 com.apple.quarantine）就跳过
    static func writeXattrs(_ path: String, _ items: [(String, Data)]) {
        for (name, value) in items {
            value.withUnsafeBytes { raw in
                _ = setxattr(path, name, raw.baseAddress, value.count, 0, 0)
            }
        }
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
        guard var data = out.data(using: enc, allowLossyConversion: false) else {
            throw Failure.encodeFailed(encoding)
        }
        // P0-4：BOM 是编码语义的一部分。`.utf16LittleEndian` / `.utf8` 都不写 BOM，
        // 以前第一次保存就把文件开头的 FF FE 抹掉，再打开被当成 GBK，正文变 NUL 乱码。
        if let bom = bomPrefix(encoding) { data = bom + data }
        return try writeAll(path: path, data: data, backup: backup)
    }

    /// 该编码是否要求文件开头带 BOM（前端的显示名里带「(BOM)」时）
    static func bomPrefix(_ name: String) -> Data? {
        let n = name.lowercased()
        guard n.contains("bom") else { return nil }
        if n.contains("utf-16be") || n.contains("utf16be") { return Data([0xFE, 0xFF]) }
        if n.contains("utf-16") || n.contains("utf16") { return Data([0xFF, 0xFE]) }
        if n.contains("utf-8") || n.contains("utf8") { return Data([0xEF, 0xBB, 0xBF]) }
        return nil
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
        // B11：cp1252 里的 ’ “ ” – — 这些字形在 isoLatin1 里不存在，
        // 用 isoLatin1 编码必然 allowLossyConversion:false 失败 → cp1252 文件永远存不了。
        case let x where x.contains("1252") || x.contains("cp1252") || x.contains("windows-1252"):
            return .windowsCP1252
        case let x where x.contains("latin") || x.contains("iso-8859-1") || x.contains("88591"):
            return .isoLatin1
        default:
            return nil
        }
    }
}
