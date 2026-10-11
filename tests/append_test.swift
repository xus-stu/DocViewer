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

print("原生写回测试（FileWriter）")

// 1) UTF-8 覆盖写 + 备份
let orig = "旧内容\n".data(using: .utf8)!
write("a.txt", orig)
try! FileWriter.writeText(path: p("a.txt"), text: "新内容\n", encoding: "utf-8")
ok(String(data: read("a.txt"), encoding: .utf8) == "新内容\n", "UTF-8 覆盖写成功")
ok(read("a.txt.bak") == orig, "首次写入生成 .bak，内容是原文件")

// 2) 二次写入不再覆盖备份
try! FileWriter.writeText(path: p("a.txt"), text: "第三次\n", encoding: "utf-8")
ok(read("a.txt.bak") == orig, "备份只保留最初那份（不会被二次写入覆盖）")
ok(String(data: read("a.txt"), encoding: .utf8) == "第三次\n", "二次写入生效")

// 3) GBK 文件按原编码写回
let gbk = "第一行\n".data(using: FileWriter.stringEncoding("gb18030"))!
write("b.txt", gbk)
try! FileWriter.writeText(path: p("b.txt"), text: "第一行\n第二行中文\n", encoding: "gb18030")
let bBack = String(data: read("b.txt"), encoding: FileWriter.stringEncoding("gb18030"))!
ok(bBack == "第一行\n第二行中文\n", "GBK 按原编码写回", "实际=\(bBack.debugDescription)")
// 用 GBK 能解出来，说明不是 UTF-8 字节
ok(String(data: read("b.txt"), encoding: .utf8) == nil, "写回的不是 UTF-8 字节（编码确实保持）")

// 4) RTF：整体替换后原有字节前缀保留
let head = "{\\rtf1\\ansi\\ansicpg936{\\fonttbl{\\f0 PingFangSC;}}\\pard\\f0\\fs36 "
let rtfOrig = head.data(using: FileWriter.stringEncoding("gb18030"))!
    + "原有中文".data(using: FileWriter.stringEncoding("gb18030"))! + Data([0x5c, 0x70, 0x61, 0x72, 0x7d])
write("c.rtf", rtfOrig)
// 模拟前端产出的新文件：前言原样 + 新正文（ASCII，中文已转 \uN?）
let newRTF = head + "\\uc1 \\u26032?\\u20869?\\u23481?\\par}"
try! FileWriter.writeText(path: p("c.rtf"), text: newRTF, encoding: "latin1")
let cOut = read("c.rtf")
ok(Array(cOut.prefix(head.utf8.count)) == Array(head.data(using: .utf8)!), "RTF 前言字节完全一致")
ok(String(data: cOut, encoding: .isoLatin1)!.hasSuffix("}"), "RTF 仍以 } 结尾")
ok(String(data: cOut, encoding: .isoLatin1)!.contains("\\fs36"), "沿用原 \\fs36")

// 5) 不存在的文件 / 无法编码
do { try FileWriter.writeText(path: p("nope.txt"), text: "x", encoding: "utf-8"); ok(false, "不存在应报错") }
catch { ok(true, "文件不存在时报错") }
// GB18030 覆盖了大部分字符；能写就要求能原样读回，不能写则必须报错且不动文件
let before = read("a.txt")
do {
    try FileWriter.writeText(path: p("a.txt"), text: "emoji 😀 中文\n", encoding: "gb18030")
    let back = String(data: read("a.txt"), encoding: FileWriter.stringEncoding("gb18030"))
    ok(back == "emoji 😀 中文\n", "能编码时必须原样读回", "实际=\(back.debugDescription)")
} catch {
    ok(read("a.txt") == before, "无法编码时报错且文件保持不变")
}

print("\n---------------------------")
print("通过 \(pass)   失败 \(fail)")
try? FileManager.default.removeItem(atPath: tmp)
exit(fail == 0 ? 0 : 1)
