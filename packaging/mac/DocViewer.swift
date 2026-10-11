// DocViewer 原生外壳（WKWebView）
// 不依赖任何浏览器：自己开窗口、自己加载 Resources/web/index.html
// 编译： swiftc -O -framework Cocoa -framework WebKit DocViewer.swift -o DocViewer

import Cocoa
import WebKit

// MARK: - 本地文件读取（file:// 页面需要显式放行）

final class LocalSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL

    init(root: URL) { self.root = root.standardizedFileURL }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let fm = FileManager.default
        let abs = url.path

        // 页面资源：docviewer://local/... ；原生选择的外部文件：docviewer://local//abs/path
        var target: URL
        if abs.hasPrefix("/"), fm.fileExists(atPath: abs) {
            target = URL(fileURLWithPath: abs).standardizedFileURL
        } else {
            var rel = abs
            if rel.hasPrefix("/") { rel.removeFirst() }
            if rel.isEmpty { rel = "index.html" }
            target = root.appendingPathComponent(rel).standardizedFileURL
            guard target.path.hasPrefix(root.path) else {          // 防目录穿越
                task.didFailWithError(NSError(domain: "DocViewer", code: 403))
                return
            }
        }
        do {
            let data = try Data(contentsOf: target)
            let mime = LocalSchemeHandler.mime(for: target.pathExtension)
            let resp = HTTPURLResponse(url: url, statusCode: 200,
                                       httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": mime,
                                                      "Content-Length": String(data.count),
                                                      "Access-Control-Allow-Origin": "*",
                                                      // 本地文件永远从磁盘读：否则改了 CSS/JS 会被 WebKit 缓存住
                                                      "Cache-Control": "no-store, no-cache, must-revalidate",
                                                      "Pragma": "no-cache",
                                                      "Expires": "0"])!
            task.didReceive(resp)
            task.didReceive(data)
            task.didFinish()
        } catch {
            task.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    static func mime(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html"
        case "css": return "text/css"
        case "js", "mjs": return "text/javascript"
        case "json": return "application/json"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "svg": return "image/svg+xml"
        case "webp": return "image/webp"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        case "txt", "md", "rtf": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}

// MARK: - 应用

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var window: NSWindow?
    var webView: WKWebView?
    let scheme = "docviewer"
    var rootURL: URL!
    private var pendingFiles: [URL] = []      // 启动完成前收到的文件，等 webView 就绪再投递

    // 由启动参数传入，可指向 `web` 子目录之外的路径
    func resolveRoot() -> URL {
        let bundleWeb = Bundle.main.bundleURL
            .appendingPathComponent("Contents/Resources/web")
        let fm = FileManager.default
        let args = CommandLine.arguments.dropFirst()
        for a in args where !a.hasPrefix("-") {
            var isDir: ObjCBool = false
            if fm.fileExists(atPath: a, isDirectory: &isDir) {
                return isDir.boolValue ? URL(fileURLWithPath: a) : URL(fileURLWithPath: a).deletingLastPathComponent()
            }
        }
        return bundleWeb
    }

    func applicationWillFinishLaunching(_ note: Notification) {
        buildMenu()
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        rootURL = resolveRoot()

        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(LocalSchemeHandler(root: rootURL), forURLScheme: scheme)
        cfg.userContentController.add(self, name: "dv")     // 页面 → 外壳
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")   // 右键「检查元素」
        cfg.defaultWebpagePreferences.allowsContentJavaScript = true

        let web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        web.setValue(false, forKey: "drawsBackground")                      // 避免加载时白闪
        self.webView = web

        func argNum(_ name: String) -> Double? {
            guard let i = CommandLine.arguments.firstIndex(of: name), i + 1 < CommandLine.arguments.count else { return nil }
            return Double(CommandLine.arguments[i + 1])
        }
        // 默认窗口 = 屏幕的 75%（没有 --w/--h 时）
        let scr0 = (NSScreen.main ?? NSScreen.screens.first)!
        let defW = (scr0.frame.width * 0.75).rounded()
        let defH = (scr0.frame.height * 0.75).rounded()
        let w0 = CGFloat(argNum("--w") ?? Double(defW))
        let h0 = CGFloat(argNum("--h") ?? Double(defH))
        let rect = NSRect(x: 0, y: 0, width: w0, height: h0)
        // 注意：不要用 .fullSizeContentView —— 内容会顶到红绿灯下面，拖动区也会和页面按钮打架
        let win = NSWindow(contentRect: rect,
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        win.title = "DocViewer"
        win.minSize = NSSize(width: 720, height: 480)
        win.contentView = web
        // 不用 setFrameAutosaveName：它会用上次的尺寸/位置覆盖默认值，
        // 导致"默认 1080×720 居中"失效。需要记住位置时用 --w/--h/--x/--y 显式指定。
        self.window = win
        // 显式指定尺寸时，覆盖 autosave 恢复出来的旧尺寸
        if CommandLine.arguments.contains("--w") || CommandLine.arguments.contains("--h") {
            var f = win.frame
            f.size = NSSize(width: w0, height: h0)
            win.setFrame(f, display: false)
        }

        // 窗口定位（用命令行参数；open 启动不会继承 shell 环境变量，所以不能用 env）
        //   --x/--y 绝对偏移   --br 右下角   --bl 左下角
        if let dx = argNum("--x"), let dy = argNum("--y"), let scr = NSScreen.screens.first {
            var f = win.frame
            f.origin = NSPoint(x: scr.visibleFrame.minX + CGFloat(dx),
                               y: scr.visibleFrame.minY + CGFloat(dy))
            win.setFrame(f, display: false)
        } else if CommandLine.arguments.contains("--br") || CommandLine.arguments.contains("--bl") {
            let vis = (NSScreen.screens.first ?? NSScreen.main!).visibleFrame
            var f = win.frame
            if CommandLine.arguments.contains("--br") {
                f.origin = NSPoint(x: vis.maxX - f.width - 16, y: vis.minY + 16)
            } else {
                f.origin = NSPoint(x: vis.minX + 12, y: vis.minY + 12)
            }
            win.setFrame(f, display: false)
        } else {
            // 精确居中于「可用区域」（排除菜单栏/Dock）。NSWindow.center() 是按整屏算的，
            // 有菜单栏时看起来会偏上。默认：1080×720 居中。
            let vis = (NSScreen.main ?? NSScreen.screens.first)!.visibleFrame
            var f = win.frame
            f.origin = NSPoint(x: vis.minX + (vis.width - f.width) / 2,
                               y: vis.minY + (vis.height - f.height) / 2)
            win.setFrame(f, display: false)
        }
        win.makeKeyAndOrderFront(nil)

        if let icon = NSImage(contentsOf: Bundle.main.bundleURL
            .appendingPathComponent("Contents/Resources/DocViewer.icns")) {
            NSApp.applicationIconImage = icon
        }

        // 版本变化时清掉上一版遗留的界面设置，避免开发/测试残留（如主题）带到新版
        let buildVer = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0"
        let seenKey = "DocViewerSeenVersion"
        let seen = UserDefaults.standard.string(forKey: seenKey) ?? ""
        if seen != buildVer {
            let reset = WKUserScript(source: "try{localStorage.removeItem('docviewer.settings.v1')}catch(e){}",
                                     injectionTime: .atDocumentStart, forMainFrameOnly: true)
            cfg.userContentController.addUserScript(reset)
            UserDefaults.standard.set(buildVer, forKey: seenKey)
        }

        // 组装 URL：查询参数必须在 # 之前，否则会落进 fragment（theme/fps/debug 全都失效）
        var query: [String] = []
        var hash = ""
        func argValue(_ name: String) -> String? {
            guard let i = CommandLine.arguments.firstIndex(of: name), i + 1 < CommandLine.arguments.count else { return nil }
            return CommandLine.arguments[i + 1]
        }
        if let t = argValue("--theme") { query.append("theme=" + t) }
        if let l = argValue("--lang") { query.append("lang=" + l) }
        if let m = argValue("--edit") { query.append("edit=" + m) }
        if let f = argValue("--fps"), Int(f) != nil { query.append("fps=" + f) }
        if let a = argValue("--anim"), Int(a) != nil { query.append("anim=" + a) }
        if CommandLine.arguments.contains("--debug") { hash = "debug" }
        if CommandLine.arguments.contains("--settings") { hash = "settings" }
        if CommandLine.arguments.contains("--wipe") { /* 数据在加载前清空，见下 */ }
        var page = "\(scheme)://local/index.html"
        if !query.isEmpty { page += "?" + query.joined(separator: "&") }
        if !hash.isEmpty { page += "#" + hash }
        // 双保险：清掉 WebKit 的磁盘/内存缓存，避免加载到旧的前端资源
        let store = WKWebsiteDataStore.default()
        var types: Set<String> = [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache,
                                  WKWebsiteDataTypeOfflineWebApplicationCache]
        if CommandLine.arguments.contains("--wipe") {
            // 清空 localStorage / sessionStorage，回到"第一次打开"
            types.insert(WKWebsiteDataTypeLocalStorage)
            types.insert(WKWebsiteDataTypeSessionStorage)
            types.insert(WKWebsiteDataTypeIndexedDBDatabases)
            NSLog("DocViewer: --wipe 清空本地数据")
        }
        store.removeData(ofTypes: types, modifiedSince: Date(timeIntervalSince1970: 0)) {
            NSLog("DocViewer: 加载 \(page)")
        if let url = URL(string: page) {
                var req = URLRequest(url: url)
                req.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
                self.webView?.load(req)
            }
        }
        NSApp.activate(ignoringOtherApps: true)

        // 原生菜单（⌘O 由页面的 Ctrl/Cmd+O 也能触发；这里补上系统级快捷键）
        buildMenu()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    func application(_ sender: NSApplication, openFiles filenames: [String]) {
        // 注意：这个回调会在 finishLaunching 阶段就被调用（Info.plist 声明了文档类型），
        // 那时 webView 还是 nil。绝不能在这里直接访问 webView，也不能改 rootURL
        // —— rootURL 是网页资源的根目录，改了页面就加载不出来了。
        NSApp.reply(toOpenOrPrint: .success)
        let urls = filenames.map { URL(fileURLWithPath: $0) }
        guard !urls.isEmpty else { return }
        if webView == nil {
            pendingFiles.append(contentsOf: urls)
            NSLog("DocViewer: 暂存 \(urls.count) 个文件，等待界面就绪")
            return
        }
        postFiles(urls)
    }

    private func flushPendingFiles() {
        guard !pendingFiles.isEmpty else { return }
        let urls = pendingFiles
        pendingFiles.removeAll()
        postFiles(urls)
    }

    // MARK: 菜单
    private func buildMenu() {
        let main = NSMenu()
        main.title = "Main"

        // 应用菜单
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "DocViewer")
        appMenu.addItem(withTitle: "关于 DocViewer", action: #selector(about), keyEquivalent: "")
        appMenu.addItem(.separator())
        let hide = appMenu.addItem(withTitle: "隐藏 DocViewer", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        hide.target = NSApp
        let quit = appMenu.addItem(withTitle: "退出 DocViewer", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quit.target = NSApp
        appItem.submenu = appMenu
        main.addItem(appItem)

        // 文件
        let fileItem = NSMenuItem()
        let fileMenu = NSMenu(title: "文件")
        let openItem = fileMenu.addItem(withTitle: "打开文件…", action: #selector(openFilesPanel), keyEquivalent: "o")
        openItem.target = self
        let dirItem = fileMenu.addItem(withTitle: "导入文件夹…", action: #selector(openFolderPanel), keyEquivalent: "O")
        dirItem.keyEquivalentModifierMask = [.command, .shift]
        dirItem.target = self
        fileItem.submenu = fileMenu
        main.addItem(fileItem)

        // 编辑
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "编辑")
        let selAll = editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        selAll.target = nil
        let copy = editMenu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        copy.target = nil
        let find = editMenu.addItem(withTitle: "查找…", action: #selector(focusSearch), keyEquivalent: "f")
        find.target = self
        editItem.submenu = editMenu
        main.addItem(editItem)

        // 视图
        let viewItem = NSMenuItem()
        let viewMenu = NSMenu(title: "视图")
        let zi = viewMenu.addItem(withTitle: "放大", action: #selector(zoomIn), keyEquivalent: "+")
        zi.target = self
        let zo = viewMenu.addItem(withTitle: "缩小", action: #selector(zoomOut), keyEquivalent: "-")
        zo.target = self
        let zr = viewMenu.addItem(withTitle: "实际大小", action: #selector(zoomReset), keyEquivalent: "0")
        zr.target = self
        viewMenu.addItem(.separator())
        let fs = viewMenu.addItem(withTitle: "进入全屏", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fs.keyEquivalentModifierMask = [.command, .control]
        fs.target = nil
        viewItem.submenu = viewMenu
        main.addItem(viewItem)

        NSApp.mainMenu = main
        NSApp.windowsMenu = nil
    }

    // MARK: 写回源文件（整文件替换）
    /// body: { path, text, encoding }
    /// text 是新的完整文件内容（RTF 已由前端按原 preamble + 重新序列化的正文拼好）。
    /// 首次写入前生成 .bak 备份。
    private func handleWriteFile(_ body: [String: Any]) {
        guard let path = body["path"] as? String, !path.isEmpty else {
            replyWrite(false, error: "missing path", path: ""); return
        }
        let text = (body["text"] as? String) ?? ""
        let encName = (body["encoding"] as? String) ?? "utf-8"
        do {
            let out = try FileWriter.writeText(path: path, text: text, encoding: encName)
            NSLog("DocViewer: 已写回 %@（%@，%d 字节）", path, encName, out.count)
            replyWrite(true, error: nil, path: path)
        } catch {
            NSLog("DocViewer: 写入失败 %@：%@", path, String(describing: error))
            replyWrite(false, error: error.localizedDescription, path: path)
        }
    }

    private func replyWrite(_ ok: Bool, error: String?, path: String) {
        var obj: [String: Any] = ["ok": ok, "path": path]
        if let e = error { obj["error"] = e }
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let json = String(data: data, encoding: .utf8) else { return }
        let js = "window.__DV_WRITE_RESULT && window.__DV_WRITE_RESULT(" + json + ")"
        webView?.evaluateJavaScript(js) { _, err in
            if let err = err { NSLog("write reply failed: \(err)") }
        }
    }

    private func postFiles(_ urls: [URL]) {
        let paths = urls.map { $0.path }
        let esc = paths.map { p -> String in
            let q = p.replacingOccurrences(of: "\\", with: "\\\\")
                       .replacingOccurrences(of: "\"", with: "\\\"")
            return "\"" + q + "\""
        }.joined(separator: ",")
        let js = "window.__DV_NATIVE_FILES && window.__DV_NATIVE_FILES([" + esc + "])"
        webView?.evaluateJavaScript(js) { _, err in
            if let err = err { NSLog("inject files failed: \(err)") }
        }
    }

    @objc private func about() {
        NSApp.orderFrontStandardAboutPanel(options: [
            .applicationName: "DocViewer",
            .applicationVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
            .credits: NSAttributedString(string: "RTF / TXT / Markdown 多文件阅读器\nWKWebView 原生外壳"),
        ])
    }

    @objc private func openFilesPanel() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.message = "选择要阅读的 RTF / TXT / Markdown 文件（可多选）"
        panel.prompt = "打开"
        panel.begin { resp in
            guard resp == .OK else { return }
            self.postFiles(panel.urls)
        }
    }

    @objc private func openFolderPanel() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.message = "选择包含文档的文件夹（会递归读取）"
        panel.prompt = "导入"
        panel.begin { resp in
            guard resp == .OK, let dir = panel.urls.first else { return }
            var files: [URL] = []
            if let en = FileManager.default.enumerator(at: dir,
                    includingPropertiesForKeys: [.isRegularFileKey],
                    options: [.skipsHiddenFiles]) {
                for case let f as URL in en where !f.hasDirectoryPath { files.append(f) }
            }
            let allow = ["rtf", "txt", "md", "markdown", "mdown", "log", "json", "csv", "xml", "yml", "yaml"]
            self.postFiles(files.filter { allow.contains($0.pathExtension.lowercased()) })
        }
    }

    @objc private func focusSearch() {
        webView?.evaluateJavaScript("document.getElementById('docSearch') && document.getElementById('docSearch').focus()")
    }
    @objc private func zoomIn() { if let w = webView { w.pageZoom = min(3.0, w.pageZoom + 0.1) } }
    @objc private func zoomOut() { if let w = webView { w.pageZoom = max(0.4, w.pageZoom - 0.1) } }
    @objc private func zoomReset() { webView?.pageZoom = 1.0 }

    // MARK: WKScriptMessageHandler：页面请求原生面板
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "dv",
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }
        switch action {
        case "pickFiles": openFilesPanel()
        case "pickFolder": openFolderPanel()
        case "writeFile": handleWriteFile(body)
        default: break
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        flushPendingFiles()
    }

    // MARK: WKUIDelegate：让页面里的 confirm / 输入框可用
    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = "DocViewer"
        alert.informativeText = message
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = "DocViewer"
        alert.informativeText = message
        alert.addButton(withTitle: "好")
        alert.runModal()
        completionHandler()
    }

    // MARK: 快捷键：F3 调试 / F11 沉浸（页面自己也处理，这里兜底）
    func applicationDidBecomeActive(_ note: Notification) {}
}

// MARK: - 入口

@main
struct DocViewerMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}
