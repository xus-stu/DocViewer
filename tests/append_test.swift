// 原生写回模块的真文件测试：swiftc AppendWriter.swift <此文件复制为 main.swift> -o t && ./t
import Foundation

var pass = 0, fail = 0
func ok(_ cond: Bool, _ msg: String, _ detail: String = "") {
    if cond { pass += 1 } else { fail += 1; print("  ❌ \(msg) \(detail)") }
}

let tmp = NSTemporaryDirectory() + "dv-write-test-\(UUID().uuidString)"
try? FileManager.default.createDirectory(atPath: tmp, withIntermediateDirectories: true)
func p(_ n: String) -> String { return tmp + "/" + n }
func write(_ n: String, _ d: Data) { try? d.write(to: URL(fileURLWithPath: p(n))) }
func read(_ n: String) -> Data { return (try? Data(contentsOf: URL(fileURLWithPath: p(n)))) ?? Data() }

/// B17：写入统一走这个包装，抛错记为一次失败而不是让整套崩掉
func w(_ path: String, _ text: String, _ enc: String) {
    do { _ = try FileWriter.writeText(path: path, text: text, encoding: enc) }
    catch { fail += 1; print("  ❌ 写入抛错 \(path)：\(error)") }
}

print("原生写回测试（FileWriter）")

// 1) UTF-8 覆盖写 + 备份
let orig = "旧内容\n".data(using: .utf8)!
write("a.txt", orig)
w(p("a.txt"), "新内容\n", "utf-8")
ok(String(data: read("a.txt"), encoding: .utf8) == "新内容\n", "UTF-8 覆盖写成功")
ok(read("a.txt.bak") == orig, "首次写入生成 .bak，内容是原文件")

// 2) 二次写入不再覆盖备份
w(p("a.txt"), "第三次\n", "utf-8")
ok(read("a.txt.bak") == orig, "备份只保留最初那份（不会被二次写入覆盖）")
ok(String(data: read("a.txt"), encoding: .utf8) == "第三次\n", "二次写入生效")

// 3) GBK 文件按原编码写回
let gbk = "第一行\n".data(using: FileWriter.stringEncoding("gb18030")!)!
write("b.txt", gbk)
w(p("b.txt"), "第一行\n第二行中文\n", "gb18030")
let bBack = String(data: read("b.txt"), encoding: FileWriter.stringEncoding("gb18030")!)!
ok(bBack == "第一行\n第二行中文\n", "GBK 按原编码写回", "实际=\(bBack.debugDescription)")
// 用 GBK 能解出来，说明不是 UTF-8 字节
ok(String(data: read("b.txt"), encoding: .utf8) == nil, "写回的不是 UTF-8 字节（编码确实保持）")

// 4) RTF：整体替换后原有字节前缀保留
let head = "{\\rtf1\\ansi\\ansicpg936{\\fonttbl{\\f0 PingFangSC;}}\\pard\\f0\\fs36 "
let rtfOrig = head.data(using: FileWriter.stringEncoding("gb18030")!)!
    + "原有中文".data(using: FileWriter.stringEncoding("gb18030")!)! + Data([0x5c, 0x70, 0x61, 0x72, 0x7d])
write("c.rtf", rtfOrig)
// 模拟前端产出的新文件：前言原样 + 新正文（ASCII，中文已转 \uN?）
let newRTF = head + "\\uc1 \\u26032?\\u20869?\\u23481?\\par}"
w(p("c.rtf"), newRTF, "latin1")
let cOut = read("c.rtf")
ok(Array(cOut.prefix(head.utf8.count)) == Array(head.data(using: .utf8)!), "RTF 前言字节完全一致")
ok(String(data: cOut, encoding: .isoLatin1)!.hasSuffix("}"), "RTF 仍以 } 结尾")
ok(String(data: cOut, encoding: .isoLatin1)!.contains("\\fs36"), "沿用原 \\fs36")

// 5) B25：不存在的文件在可写目录里应当能新建；目录不可写才报错
do {
    try FileWriter.writeText(path: p("new.txt"), text: "新建", encoding: "utf-8")
    ok(String(data: read("new.txt"), encoding: .utf8) == "新建", "可写目录里能新建文件")
} catch { ok(false, "可写目录里新建文件不该失败", "\(error)") }
var dirFail = false
do { try FileWriter.writeText(path: p("no-such-dir/x.txt"), text: "x", encoding: "utf-8") } catch { dirFail = true }
ok(dirFail, "目录不存在/不可写时报错")

// 5b) B10：0444 只读文件报错且内容不变
write("ro.txt", "只读内容".data(using: .utf8)!)
try? FileManager.default.setAttributes([.posixPermissions: 0o444], ofItemAtPath: p("ro.txt"))
var roFail = false
do { try FileWriter.writeText(path: p("ro.txt"), text: "改", encoding: "utf-8") } catch { roFail = true }
ok(roFail, "只读文件拒绝写入")
try? FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: p("ro.txt"))
ok(String(data: read("ro.txt"), encoding: .utf8) == "只读内容", "只读文件内容未被改动")

// 5c) B11：CRLF 文件写回仍是 CRLF
write("crlf.txt", "第一行\r\n第二行\r\n".data(using: .utf8)!)
w(p("crlf.txt"), "第一行\n第二行\n第三行\n", "utf-8")
let crlfBack = String(data: read("crlf.txt"), encoding: .utf8)!
ok(crlfBack == "第一行\r\n第二行\r\n第三行\r\n", "CRLF 换行风格保持", crlfBack.debugDescription)
// GB18030 覆盖了大部分字符；能写就要求能原样读回，不能写则必须报错且不动文件
let before = read("a.txt")
do {
    try FileWriter.writeText(path: p("a.txt"), text: "emoji 😀 中文\n", encoding: "gb18030")
    let back = String(data: read("a.txt"), encoding: FileWriter.stringEncoding("gb18030")!)
    ok(back == "emoji 😀 中文\n", "能编码时必须原样读回", "实际=\(back.debugDescription)")
} catch {
    ok(read("a.txt") == before, "无法编码时报错且文件保持不变")
}

print("\n---------------------------")

// 9) 前端真实发送的编码名（显示名）必须认得出来，且不能静默落 UTF-8
ok(FileWriter.stringEncoding("GB18030/GBK") != nil, "识别 'GB18030/GBK'（前端实际发送的显示名）")
ok(FileWriter.stringEncoding("UTF-16LE (BOM)") != nil, "识别 'UTF-16LE (BOM)'")
ok(FileWriter.stringEncoding("WINDOWS-1252") != nil, "识别 'WINDOWS-1252'")
ok(FileWriter.stringEncoding("UTF-8 (BOM)") != nil, "识别 'UTF-8 (BOM)'")
ok(FileWriter.stringEncoding("nonsense-9000") == nil, "不认识的编码名返回 nil（不再静默回退 UTF-8）")

// 10) latin1 必须真的按 ISO-8859-1 落字节（é → E9，而不是 UTF-8 的 C3 A9）
write("l1.txt", Data([0x41]))
w(p("l1.txt"), "\u{00E9}", "latin1")
ok(read("l1.txt") == Data([0xE9]), "latin1 写 é 落 E9", read("l1.txt").map { String(format: "%02X", $0) }.joined())

// 11) 不认识的编码名：报错，不写文件
write("u.txt", "原文".data(using: .utf8)!)
var threw = false
do { try FileWriter.writeText(path: p("u.txt"), text: "新", encoding: "nonsense-9000") } catch { threw = true }
ok(threw, "不认识的编码名会抛错")
ok(String(data: read("u.txt"), encoding: .utf8) == "原文", "抛错时文件未被改写")

// 12) 拒绝把有内容的文件写空
var emptied = false
do { try FileWriter.writeText(path: p("u.txt"), text: "", encoding: "utf-8") } catch { emptied = true }
ok(emptied, "拒绝把非空文件清空")
ok(read("u.txt").count > 0, "文件仍有内容")

// 13) 备份失败即中止（把 .bak 造成目录）
write("d.txt", "原始".data(using: .utf8)!)
try? FileManager.default.createDirectory(atPath: p("d.txt.bak"), withIntermediateDirectories: true)
var aborted = false
do { try FileWriter.writeText(path: p("d.txt"), text: "新内容", encoding: "utf-8") } catch { aborted = true }
ok(aborted, "备份写入失败时中止，不做无备份覆盖")
ok(String(data: read("d.txt"), encoding: .utf8) == "原始", "中止后源文件保持原样")

// 14) 滚动备份 .bak.prev 每次刷新
write("r.txt", "第一版".data(using: .utf8)!)
w(p("r.txt"), "第二版", "utf-8")
w(p("r.txt"), "第三版", "utf-8")
ok(String(data: read("r.txt.bak"), encoding: .utf8) == "第一版", ".bak 仍是最初版本")
ok(String(data: read("r.txt.bak.prev"), encoding: .utf8) == "第二版", ".bak.prev 滚动到上一版")

// 15) 软链写入不能把链接换成普通文件
let real = p("real.txt"), link = p("link.txt")
write("real.txt", "链接目标".data(using: .utf8)!)
try? FileManager.default.removeItem(atPath: link)
try? FileManager.default.createSymbolicLink(atPath: link, withDestinationPath: real)
w(link, "改过的内容", "utf-8")
let stillLink = (try? FileManager.default.destinationOfSymbolicLink(atPath: link)) != nil
ok(stillLink, "写软链后仍是软链（未替换成普通文件）")
ok(String(data: read("real.txt"), encoding: .utf8) == "改过的内容", "内容写进了链接目标")

print("通过 \(pass)   失败 \(fail)")
try? FileManager.default.removeItem(atPath: tmp)
exit(fail == 0 ? 0 : 1)
