/* =====================================================================
   i18n.js — 中英双语
   做法：以「中文原文」为 key 的映射表。
   - 静态界面：DV.applyI18n() 遍历 DOM 文本节点 / placeholder / title，按表替换
     （首次替换前把原文存在节点上，所以可以反复来回切换）
   - JS 动态文案：DV.t('中文原文') 或 DV.t('共 {n} 个文件', { n: 3 })
   ===================================================================== */
window.DV = window.DV || {};

DV.i18n = (function () {
  /* 中文原文 → English */
  const MAP = {
    /* ---- 标题 / 外壳 ---- */
    'DocViewer — RTF / TXT / Markdown 多文件浏览器': 'DocViewer — RTF / TXT / Markdown multi-file reader',
    'RTF / TXT / Markdown 阅读器': 'RTF / TXT / Markdown reader',
    'F3 调试': 'F3 Debug',
    'F3：打开 / 关闭调试面板': 'F3: toggle the debug panel',
    '滚动': 'Scrolled',

    /* ---- 侧栏 ---- */
    '列表': 'Files',
    '个文件': 'files',
    '个文件（只影响本阅读器）': 'files merged (this reader only)',
    '个文件已选': 'selected',
    '拼接到一起': 'Merge into one',
    '全选': 'Select all',
    '取消': 'Cancel',
    'Ctrl/⌘ 点选 · Shift 连选 · 拖动可调整顺序': 'Ctrl/⌘ click · Shift range · drag to reorder',
    '还没有文件': 'No files yet',
    '把文件拖到这里，或点下方「打开文件」': 'Drop files here, or use “Open files” below',
    '没有匹配': 'No match for',
    '筛选文件名…': 'Filter files…',
    '正在读取 {n} 个文件…': 'Reading {n} files…',
    '在文档中搜索…': 'Search in document…',
    '行': 'lines',
    '字符': 'chars',
    '自动换行': 'Word wrap',
    '清空': 'Clear',
    '打开文件': 'Open files',
    '导入文件夹': 'Import folder',

    /* ---- 文档区 ---- */
    '未打开文件': 'No file open',
    '拖拽文件到窗口任意位置即可开始': 'Drop a file anywhere in the window to begin',
    '合并文档': 'Merged document',
    '标题：开': 'Heading: on',
    '拆开': 'Split',
    '源码': 'Source',
    '复制': 'Copy',
    '导出': 'Export',
    '沉浸': 'Focus',
    '设置': 'Settings',
    '打开调试面板': 'Open the debug panel',
    '源码 / 渲染切换': 'Toggle source / rendered view',
    '文档内搜索': 'Search in document',
    '打开': 'Open',
    '文件，可同时打开多个。': 'files. Several can be open at once.',
    '松手即导入': 'Release to import',
    '支持 .rtf / .txt / .md（可多选、可拖入文件夹）': 'Supports .rtf / .txt / .md (multi-select, folders)',
    'RTF / TXT / Markdown 与常见代码、配置文件（可多选、可拖入文件夹）':
      'RTF / TXT / Markdown plus common source and config files (multi-select, folders)',
    '代码 / 数据': 'Code / data',

    /* ---- 主题 ---- */
    '主题': 'Theme',
    '深色': 'Dark',
    '蓝色系': 'Blue',
    '绿色系': 'Green',
    '浅色': 'Light',
    '羊皮纸': 'Sepia',
    '自定义': 'Custom',
    '默认': 'Default',
    '冷色': 'Cool',
    '自然': 'Natural',
    '明亮': 'Bright',
    '护眼': 'Easy on eyes',
    '自己配色': 'Your own',
    '底色': 'BG',
    '面板': 'Panel',
    '文字': 'Text',
    '强调': 'Accent',
    '强调色': 'Accent color',
    '正文颜色': 'Text color',
    '阅读底色': 'Reading background',
    '重置': 'Reset',

    /* ---- 设置：字体 / 排版 ---- */
    '字体': 'Font',
    '字体名': 'Font name',
    '系统界面字体': 'System UI font',
    '系统默认': 'System default',
    '跟随界面字体': 'Follow the interface font',
    '恢复该项目的主题默认色': 'Reset this color to the theme default',
    '已恢复默认设置': 'Defaults restored',
    '排版': 'Typography',
    '字号': 'Size',
    '行高': 'Line height',
    '行宽': 'Width',
    '上下留白': 'Padding',
    '跟随系统': 'Follow system',
    '衬线，适合长文': 'Serif, good for long text',
    '黑体界面字体': 'Sans UI font',
    '手写风': 'Handwriting',
    '等宽，偏代码': 'Monospace, code-ish',
    '圆体': 'Rounded',
    '无衬线，屏幕友好': 'Sans-serif, screen friendly',
    '代码与表格': 'Code & tables',

    /* ---- 设置：文档 ---- */
    '文档': 'Document',
    'RTF 使用阅读器字体、字号与配色': 'RTF uses the reader font, size and colors',
    '忽略文件自带的字体、字号；与背景对比过低的文字也会改用阅读器配色。不改动原文件。':
      'Ignore the font and size embedded in the file; text with too little contrast also switches to the reader palette. The original file is never modified.',
    'RTF 按源文件换行': 'RTF honors source line breaks',
    '记住会话（下次打开恢复上次的文件）': 'Remember session (reopen last files)',
    '有些编辑器（如 macOS 文本编辑）导出的 RTF 用**裸换行**分段、不写': 'Some editors (e.g. macOS TextEdit) separate paragraphs with bare line breaks and write no',
    '按 RTF 规范这算空白，会被合并成一整段；打开这个开关就把裸换行当软换行处理。':
      'The RTF spec treats those as whitespace, merging everything into one paragraph. Turn this on to treat bare line breaks as soft breaks.',
    '语言': 'Language',
    '中文': '中文',
    'English': 'English',

    /* ---- 设置：沉浸 / 标题栏 ---- */
    '沉浸式阅读': 'Focus mode',
    '开启（隐藏标题栏 / 侧栏 / 工具栏）': 'On (hide title bar / sidebar / toolbar)',
    '沉浸行宽': 'Focus width',
    '移动鼠标唤出底部控制条；': 'Move the mouse to reveal the bottom bar;',
    '或': 'or',
    '退出。': 'to exit.',
    '退出沉浸': 'Exit focus',
    '标题栏': 'Title bar',
    '显示顶部标题栏（DocViewer 名称那一行）': 'Show the top title bar',
    '选择文件名下方那行显示哪些内容。': 'Choose what the line under the file name shows.',
    '路径': 'Path',
    '文件大小': 'Size',
    '编码': 'Encoding',
    '文件类型': 'Type',
    '行数': 'Lines',
    '字符数': 'Characters',

    /* ---- 设置：工具 ---- */
    '工具': 'Tools',
    '调试面板 (F3)': 'Debug panel (F3)',
    '诊断报告': 'Diagnostics',
    '调试面板': 'Debug panel',
    '恢复初始设置': 'Reset to first run',
    '清空全部设置与会话，回到第一次打开的状态': 'Clear all settings and session, back to a first run',
    '恢复默认设置': 'Restore defaults',

    /* ---- 设置：动画与帧率 ---- */
    '动画与帧率': 'Animation & frame rate',
    '动画强度': 'Animation level',
    '动画速度': 'Animation speed',
    '帧率上限': 'Frame rate cap',
    '关闭': 'Off',
    '轻量': 'Subtle',
    '完整': 'Full',
    '快': 'Fast',
    '标准': 'Normal',
    '慢': 'Slow',
    '不限': 'Unlimited',
    '帧率越高，缓动与滚动越细腻。屏幕每秒刷新的画面数不变。':
      'Higher frame rates make easing and scrolling smoother. The screen still refreshes the same number of frames each second.',
    '当前渲染：—': 'Rendering: —',

    /* ---- 调试面板 ---- */
    '性能': 'Perf',
    '环境': 'Env',
    '日志': 'Log',
    '渲染帧率': 'Render',
    '高帧率探针：测量主线程调度吞吐': 'High-fps probe: main-thread scheduling throughput',
    '放开 CPU 预算': 'Uncap CPU budget',
    '（测真实上限，会跑满核心）': '(find the real limit; uses every core)',
    '探针只测任务调度能力，不产生画面，会占用 CPU。曲线里的帧率才是实际渲染速率。':
      'The probe measures scheduling only. It draws nothing and uses CPU. The chart is the real render rate.',
    '重置统计': 'Reset stats',
    '自动滚动': 'Auto scroll',
    '界面动效': 'UI motion',
    '当前主题': 'Theme',
    '文档文字色': 'Document text color',
    '首段文字色': 'First paragraph color',
    '文件行对齐': 'Row alignment',
    '图标/文字块高度': 'Icon / text block height',
    '图标中心偏移': 'Icon center offset',
    '高亮可见': 'Highlight visible',
    '滑动高亮过渡': 'Highlight transition',
    '滑动高亮位移': 'Highlight offset',
    '动效强度 / 速度': 'Motion level / speed',
    '侧栏宽度': 'Sidebar width',
    '侧栏过渡': 'Sidebar transition',
    '侧栏状态': 'Sidebar state',
    '已收起': 'collapsed',
    '展开': 'expanded',
    '动画帧率': 'Animation',
    '时间步进': 'Time step',
    '画面帧率(显示器)': 'Display fps',
    '平均帧间隔': 'Avg frame gap',
    '相对刷新率掉帧': 'Drops vs display',
    '采样点数': 'Samples',
    '显示器刷新上限': 'Display refresh cap',
    '说明': 'Note',
    '帧率越高缓动越细腻': 'Higher cap, smoother easing',
    '渲染与动画': 'Render & animation',
    '上一秒帧数': 'Frames last second',
    '累计帧数': 'Frames total',
    '掉帧数': 'Dropped frames',
    '最长帧': 'Longest frame',
    '调度器': 'Scheduler',
    '动画调度次数': 'Animation ticks',
    '理论时间步进': 'Target step',
    '显示器刷新率': 'Display refresh rate',
    '编码探测': 'Encoding detection',
    '换行来源': 'Break source',
    '段落': 'Paragraphs',
    '软换行': 'Soft breaks',
    '硬换行': 'Hard breaks',
    '解析耗时': 'Parse time',
    '注入耗时': 'Inject time',
    '视图模式': 'View mode',
    '词块数': 'Words',
    '已注入元素': 'Elements injected',

    /* ---- 追加内容 / 编辑模式 ---- */
    '编辑': 'Editing',
    '只读': 'Read-only',
    '可编辑': 'Editable',
    '添加内容到源文件': 'Append content to the source file',
    '输入要追加到源文件的内容…': 'Type the content to append to the source file…',
    '添加到源文件': 'Append to file',
    '将写入': 'Will write to',
    '（沿用文件自身字体与字号）': ' (keeping the file’s own font and size)',
    '只读（默认）：正文不可编辑，没有光标，不会改动任何文件。 可编辑：光标可以放到正文任意位置直接修改，停手约 1.5 秒后写回':
      'Read-only (default): no caret, nothing is ever modified. Editable: put the caret anywhere and type; about 1.5 seconds after you stop it is written back into',
    '（首次写入会生成 .bak 备份）。RTF 会按文件自身的字体与字号重新生成。':
      ' (a .bak backup is created on the first write). RTF is regenerated with the file’s own font and size.',
    '保存中…': 'Saving…',
    '未保存': 'Unsaved',
    '已保存': 'Saved',
    '可编辑：可直接在正文里修改，会写回源文件': 'Editable: type directly in the text; changes are written back to the file',
    'Markdown 不参与编辑': 'Markdown is never edited',
    '，始终保持原来的渲染显示。': ', it always keeps its rendered view.',
    'Markdown 保持只读显示（编辑仅支持 RTF / 文本 / 代码文件）':
      'Markdown stays read-only in its rendered view (editing supports RTF / text / code files only)',
    '只读：不会改动任何文件': 'Read-only: no file will be modified',
    '（首次写入会生成 .bak 备份）。 RTF 会沿用文件自己的字体与字号。':
      ' (a .bak backup is created on the first write). RTF appends using the file’s own font and size.',
    '底部会出现输入框，写回的是': 'the source file itself',
    '源文件本身': 'the source file itself',
    '（首次写入会生成 .bak 备份）。': ' (a .bak backup is created on the first write).',
    'RTF 会沿用文件自己的字体与字号。': 'RTF appends using the file’s own font and size.',
    '当前为只读模式，或该文件无法写回（请用应用内的打开按钮）':
      'Read-only mode, or this file cannot be written back (open it with the in-app button)',
    '当前为只读模式，或该文件无法写回': 'Read-only mode, or this file cannot be written back',
    '内容为空': 'Nothing to append',
    '写入失败': 'Write failed',
    '已写入源文件': 'Written to the source file',
    '可编辑：可把内容追加回源文件': 'Editable: content can be appended to the source file',

    /* ---- 文件类型（状态栏 / 标题栏） ---- */
    'RTF 富文本': 'RTF',
    '纯文本': 'Plain text',
    '未知类型': 'Unknown type',
    '拼接文档': 'Merged document',
    '图片': 'Image',
    'PDF': 'PDF',
    'Word 文档': 'Word document',
    'Pages 文稿': 'Pages document',

    /* ---- 字体名与说明 ---- */
    '宋体': 'Songti (宋体)', '西文衬线': 'Western serif', '楷体': 'Kaiti (楷体)',
    '黑体': 'Heiti (黑体)', '等宽': 'Monospace', '手写感': 'Handwriting feel',
    '英文正文衬线': 'Serif for English body text', '经典英文衬线': 'Classic English serif',
    '优雅英文衬线': 'Elegant English serif', '适合长文阅读': 'Great for long reads',
    '现代无衬线': 'Modern sans-serif', '中性无衬线': 'Neutral sans-serif',
    '等宽（代码）': 'Monospace (code)', '打字机等宽': 'Typewriter monospace',
    '手动输入字体名': 'Type a font name', '界面强调色': 'Interface accent',
    '阅读区底色': 'Reading background',

    /* ---- 补充：title / 提示 ---- */
    '字体预览 The quick brown fox 0123456789 中文字形示例': 'Font preview — The quick brown fox 0123456789 中文字形示例',
    '选择多个文件': 'Choose several files',
    '导入整个文件夹': 'Import a whole folder',
    '清空当前列表': 'Clear the current list',
    '收起侧栏 (Ctrl+B)': 'Hide the sidebar (Ctrl+B)',
    '展开侧栏 (Ctrl+B)': 'Show the sidebar (Ctrl+B)',
    '全选 (Ctrl/Cmd+A)': 'Select all (Ctrl/Cmd+A)',
    '取消选择 (Esc)': 'Clear selection (Esc)',
    '把选中的文件按列表顺序拼接成一个阅读视图（不改动原文件）':
      'Merge the selected files, in list order, into one reading view (originals untouched)',
    '还原成各自独立的文件': 'Split back into separate files',
    '上一个 (Shift+Enter)': 'Previous (Shift+Enter)',
    '下一个 (Enter)': 'Next (Enter)',
    '上一段 (Alt+←)': 'Previous section (Alt+←)',
    '下一段 (Alt+→)': 'Next section (Alt+→)',
    '显示 / 隐藏每段的分隔标题': 'Show or hide per-section headings',
    '上一个文件': 'Previous file',
    '下一个文件': 'Next file',
    '源码 / 渲染切换 (Ctrl+E)': 'Toggle source / rendered (Ctrl+E)',
    '复制全文': 'Copy the whole text',
    '导出为 HTML': 'Export as HTML',
    '沉浸式阅读 (F11 / Ctrl+I)': 'Focus mode (F11 / Ctrl+I)',
    '退出沉浸 (Esc)': 'Exit focus (Esc)',
    '设置 (Ctrl+,)': 'Settings (Ctrl+,)',
    '关闭 (Esc)': 'Close (Esc)',
    '关闭 (F3 / Esc)': 'Close (F3 / Esc)',
    '缩小字号': 'Decrease font size',
    '放大字号': 'Increase font size',
    '界面底色': 'Interface background',
    '侧栏 / 面板底色': 'Sidebar / panel background',
    '文字颜色': 'Text color',
    '例如 Source Han Serif SC': 'e.g. Source Han Serif SC',
    'ms/帧': 'ms/frame',
    '· 诊断报告': '· Diagnostics',
    '。\n            按 RTF 规范这算空白，会被合并成一整段；打开这个开关就把裸换行当软换行处理。\n            切换后当前文档会自动重新解析。':
      'The RTF spec treats those as whitespace and merges everything into one paragraph. Turn this on to treat bare line breaks as soft breaks. The current document is re-parsed immediately.',

    /* ---- 提示语 ---- */
    '已复制': 'Copied',
    '已导出': 'Exported',
    '已清空': 'Cleared',
    '没有可打开的文件': 'Nothing to open',
    /* ---- 阅读位置 / 补充界面文案 / F3 面板 ---- */
    "记住每个文件的阅读位置": "Remember the reading position of each file",
    "开启后，重新打开某个文件（或重启应用）会回到上次读到的位置，而不是文件顶部。编辑写回源文件时也不会再跳回顶部。": "When on, reopening a file (or restarting the app) returns to where you left off instead of the top, and writing edits back no longer scrolls the view to the top.",
    "记住阅读位置：{state}": "Remember reading position: {state}",
    "已导入 {n} 个文件": "Imported {n} files",
    "{n} 个文件读取失败，详见 F3 日志": "{n} files could not be read — see the F3 log",
    "已拼接 {n} 个文件（只影响本阅读器）": "Merged {n} files (this reader only)",
    "已拆开为 {n} 个文件": "Split back into {n} files",
    "已恢复上次的 {n} 个文件": "Restored {n} files from the last session",
    "已复制 {n} 个字符": "Copied {n} characters",
    "至少选择 2 个文件": "Select at least 2 files",
    "没有可读取的文件": "No readable files",
    "没有打开的文件": "No open file",
    "已导出为 HTML": "Exported as HTML",
    "已清空文件列表": "File list cleared",
    "复制失败（浏览器限制）": "Copy failed (browser restriction)",
    "已进入沉浸式阅读（Esc 退出）": "Entered immersive reading (Esc to exit)",
    "已退出沉浸式阅读": "Left immersive reading",
    "把文件拖进窗口，或点下方「打开文件」": "Drop files into the window, or use “Open files” below",
    "旧格式的拼接文档已跳过，请重新拼接（本次已修复该问题）": "Skipped a merged document saved in the old format — please merge again (this is fixed now)",
    "已恢复初始设置（清空数据，回到第一次打开）": "Settings reset (data cleared, back to first launch)",
    "已恢复初始设置": "Settings reset",
    "记住会话已关闭，跳过恢复": "Remember session is off — skipping restore",
    "会话里没有可恢复的文档": "No restorable documents in the session",
    "暂无可复制的正文": "Nothing to copy",
    "写入失败": "Write failed",
    "显示": "Shown",
    "隐藏": "Hidden",
    "合计": "Total",
    "开": "On",
    "关": "Off",
    "无": "None",
    "暂无数据": "No data",
    "已复制": "Copied",
    "名称": "Name",
    "相对路径": "Path",
    "类型": "Type",
    "大小": "Size",
    "编码": "Encoding",
    "行数": "Lines",
    "字符数": "Characters",
    "词/字块数": "Words / blocks",
    "生成 DOM 节点": "DOM nodes",
    "警告数": "Warnings",
    "解析+注入": "Parse + inject",
    "视图": "View",
    "滚动高度": "Scroll height",
    "当前文档": "Current document",
    "标题数": "Headings",
    "目录": "TOC",
    "控制字": "Control words",
    "组": "Groups",
    "表格": "Tables",
    "跳过组": "Skipped groups",
    "硬换行 (\\par)": "Hard breaks (\\par)",
    "软换行 (<br>)": "Soft breaks (<br>)",
    "软分段 (空行)": "Soft paragraphs (blank lines)",
    "按源换行": "Source line breaks",
    "字体表": "Font table",
    "颜色表": "Color table",
    "按纯文本展示": "Shown as plain text",
    "来源文件数": "Source files",
    "分段标题": "Segment headings",
    "合并顺序": "Merge order",
    "启动耗时": "Startup time",
    "就绪耗时": "Ready time",
    "版本": "Version",
    "主题 / 字体": "Theme / font",
    /* ---- 帧率说明 / 合并工具条 / 提示 ---- */
    "合计 {size} · Ctrl/⌘ 点选 · Shift 连选 · 拖动排序": "Total {size} · Ctrl/⌘ click · Shift range · drag to reorder",
    "标题：{state}": "Headings: {state}",
    "渲染": "Rendered",
    "源码": "Source",
    "记住会话：{state}": "Remember session: {state}",
    "RTF 字体：{state}": "RTF font: {state}",
    "RTF 按源换行：{state}": "RTF source line breaks: {state}",
    "跟随阅读器": "Follow the reader",
    "使用文件自带": "Use the file’s own",
    "帧率上限 {cap} · 渲染实测 {render} fps · 动画实测 {anim} fps · 平均 {ms} ms/帧{drop}": "Frame cap {cap} · render {render} fps · animation {anim} fps · avg {ms} ms/frame{drop}",
    " · 超时帧 {n}": " · {n} dropped",
    "不限": "Unlimited",
    "复制全文：": "Copy all: ",
    "已显示顶部标题栏": "Titlebar shown",
    "已隐藏顶部标题栏": "Titlebar hidden",
    "性能统计已重置": "Performance stats reset",
    "日志已复制": "Log copied",
    "复制失败": "Copy failed",
    "诊断报告已复制到剪贴板（也写进日志页）": "Diagnostic report copied to the clipboard (also written to the log page)",
    "诊断报告已写入日志页": "Diagnostic report written to the log page",
    "语言：中文": "Language: 中文",
    /* ---- 保存按钮 / 自动保存间隔 ---- */
    "保存": "Save",
    "保存改动到源文件 (Ctrl+S)": "Save changes to the source file (Ctrl+S)",
    "导出当前文件为 HTML": "Export the current file as HTML",
    "把当前文档存成一份独立的 HTML 文件，方便分享或存档。": "Save the current document as a standalone HTML file for sharing or archiving.",
    "当前不可编辑：设置里的「编辑」为只读，或这个文件不支持写回": "Not editable: Edit is set to read-only, or this file cannot be written back",
    "没有需要保存的改动": "No changes to save",
    "只读（默认）：正文不可编辑，没有光标，不会改动任何文件。 可编辑：光标可以放到正文任意位置直接修改，停手约 1.5 分钟后自动写回": "Read-only (default): the text cannot be edited, there is no caret, and no file is modified. Editable: put the caret anywhere and type; about 1.5 minutes after you stop, the change is written back to",
    "（首次写入会生成 .bak 备份）。也可以随时点工具栏的「保存」或按": " (a .bak backup is created on the first write). You can also press Save in the toolbar or",
    "立即写回。 RTF 会按文件自身的字体与字号重新生成。": "to write immediately. RTF is regenerated using the file’s own font and size.",
    /* ---- 快捷键提示清理后的文案 ---- */
    '调试面板：按 F3 键。诊断报告：点上面的按钮。': 'Debug panel: press F3. Diagnostics: use the button above.',
    "打开调试面板（唯一的快捷键）": "Open the debug panel (the only shortcut)",
    "收起侧栏": "Hide the sidebar",
    "展开侧栏": "Show the sidebar",
    "取消选择": "Clear the selection",
    "上一段": "Previous section",
    "下一段": "Next section",
    "关闭设置": "Close settings",
    "关闭调试面板 (F3)": "Close the debug panel (F3)",
    "退出沉浸式阅读": "Leave focus mode",
    "保存改动到源文件": "Save changes to the source file",
    "源码 / 渲染切换": "Toggle source / rendered",
    "沉浸式阅读": "Focus mode",
    "设置": "Settings",
    "上一段 (Alt+←)": "Previous section",
    "下一段 (Alt+→)": "Next section",
    "源码 / 渲染切换 (Ctrl+E)": "Toggle source / rendered",
    "保存改动到源文件 (Ctrl+S)": "Save changes to the source file",
    "沉浸式阅读 (F11 / Ctrl+I)": "Focus mode",
    "设置 (Ctrl+,)": "Settings",
    "收起侧栏 (Ctrl+B)": "Hide the sidebar",
    "展开侧栏 (Ctrl+B)": "Show the sidebar",
    "全选 (Ctrl/Cmd+A)": "Select all",
    "取消选择 (Esc)": "Clear the selection",
    "关闭 (Esc)": "Close",
    "关闭 (F3 / Esc)": "Close (F3)",
    "退出沉浸 (Esc)": "Leave focus mode",
    "已进入沉浸式阅读": "Entered focus mode",
    "移动鼠标唤出底部控制条，点「退出沉浸」返回。": "Move the mouse to reveal the bottom control strip; click “Leave focus mode” to return.",
    "调试面板 <kbd>F3</kbd>；诊断报告用上面的按钮。": "Debug panel: <kbd>F3</kbd>. Diagnostics: the button above.",
    "（首次写入会生成 .bak 备份）。也可以随时点工具栏的「保存」立即写回。 RTF 会按文件自身的字体与字号重新生成。": " (a .bak backup is created on the first write). You can also click Save in the toolbar at any time. RTF is regenerated using the file’s own font and size.",
    /* ---- 写回保护提示 ---- */
    "这份 RTF 含图片 / 页眉页脚 / 脚注等未支持的内容，写回会丢掉它们，已阻止保存": "This RTF contains images, headers/footers or footnotes that the reader does not model; writing back would delete them, so the save was blocked",
    "这份 RTF 含图片 / 页眉页脚 / 脚注等未支持的内容（{x}），写回会丢掉它们，已阻止保存": "This RTF contains content the reader does not model ({x}); writing back would delete it, so the save was blocked",
    "写回没有收到确认，改动仍标记为未保存": "The write was not confirmed; the change is still marked unsaved",
    /* ---- 文件在外部被改过：三选一 ---- */
    "文件已在外部被修改": "The file changed on disk",
    "这份 RTF 里有本阅读器不支持的内容": "This RTF contains content this reader does not support",
    "继续保存会丢掉这些内容：{x}。建议先备份原文件，或取消后用别的软件处理。": "Saving anyway will drop: {x}. Back up the original first, or cancel and edit it in another app.",
    "取消保存": "Cancel",
    "仍然保存（会丢内容）": "Save anyway (loses content)",
    "这个文件在磁盘上被改过了，直接写回会覆盖别人的改动。": "This file changed on disk since it was opened. Writing back now would overwrite those changes.",
    "重新加载磁盘版本": "Reload from disk",
    "仍然覆盖": "Overwrite anyway",
    "已重新载入磁盘上的版本": "Reloaded the version on disk",
    /* ---- 只读预览：图片 / PDF / Word / Pages ---- */
    "这一份预览不了": "This file could not be previewed",
    "文件本身没有被改动，可以换用其它软件打开。": "The file itself was not modified; open it in another app instead.",
    "需要重新打开这个文件才能预览": "Re-open this file to preview it",
    "浏览器里打开的文件没有可用的本地路径": "A file opened in the browser has no local path to read",
    "浏览器里打开的图片没有可用的地址": "The image opened in the browser has no usable address",
    "点图片在「适应窗口」和「原始大小」之间切换": "Click the image to switch between fit-to-window and actual size",
    "PDF 预览需要桌面版（浏览器页面拿不到 PDF 渲染能力）": "PDF preview needs the desktop app (browser pages cannot render PDFs)",
    "正在读取 PDF…": "Reading the PDF...",
    "第 {n} 页": "Page {n}",
    "正在读取文档…": "Reading the document...",
    "正在解析 Word 文档…": "Parsing the Word document...",
    "缺少文档解析模块": "The document parser is missing",
    "正在生成 Pages 预览…": "Generating a Pages preview...",
    "正在读取文稿…": "Reading the document...",
    "正在读取 Pages 文稿…": "Reading the Pages document...",
    "这是 Pages 文件里自带的预览图，只用于快速浏览，文字不可选中。": "This is the preview image embedded in the Pages file; it is for quick browsing only and its text cannot be selected.",
    "系统没有为这个文件生成预览": "The system could not generate a preview for this file",
    "这是系统 Quick Look 生成的预览图，只用于快速浏览。": "This is a preview image generated by Quick Look; it is for quick browsing only.",
    "不支持的预览类型": "Unsupported preview type",
    "图片 / PDF / Word / Pages 只提供预览": "Images, PDF, Word and Pages are preview-only",
    "这个类型没有可复制的正文": "This type has no body text to copy",
    "预览": "Preview",
    "这个类型只提供预览，没有源码视图": "This type is preview-only and has no source view",
    "这张图的格式系统解不了": "This image format cannot be decoded by the system",
    /* ---- 文档解析器抛出的说明（会显示在正文区） ---- */
    "不是有效的 ZIP / Office 文档（找不到中央目录）": "Not a valid ZIP / Office file (no central directory found)",
    "这个系统不支持解压（DecompressionStream），请用桌面版打开": "This system cannot decompress files (no DecompressionStream); use the desktop app",
    "这个文件里没有 word/document.xml（不是 .docx？）": "No word/document.xml inside this file (not a .docx?)",
    "document.xml 结构不认识": "Unrecognised document.xml structure",
    "文档里有图片，预览时不显示": "The document contains images; they are not shown in this preview",
    "脚注不显示": "Footnotes are not shown",
    "重新加载失败": "Reload failed",
    "文件超过 {mb} MB，已跳过（避免卡死）": "File is larger than {mb} MB and was skipped to avoid freezing",
    "请至少输入 2 个字符": "Type at least 2 characters",
    "拖放读取失败，请改用「打开文件」": "Could not read the dropped items; use “Open files” instead",
    "文件太大或太多，这次没能写入会话记忆（不影响打开与编辑）": "Too much content to store in the session this time (opening and editing are unaffected)",
  };

  /* 让英文模式下也能查回中文（反向表） */
  const REVERSE = {};
  Object.keys(MAP).forEach(k => { if (!REVERSE[MAP[k]]) REVERSE[MAP[k]] = k; });

  function lang() {
    try { return (DV.Settings.get().lang === 'en') ? 'en' : 'zh'; } catch (e) { return 'zh'; }
  }

  /** 动态文案：DV.t('共 {n} 个文件', {n: 3}) */
  function t(zh, vars) {
    let out = zh;
    if (lang() === 'en') out = MAP[zh] || REVERSE[zh] || zh;
    if (vars) Object.keys(vars).forEach(k => { out = out.split('{' + k + '}').join(vars[k]); });
    return out;
  }

  function translateValue(v) {
    if (lang() === 'en') return MAP[v] || v;
    return REVERSE[v] || v;
  }

  /* 跳过正文区域：文件名/正文本身不能被翻译 */
  function inDoc(el) {
    let p = el;
    while (p) {
      if (p.classList && (p.classList.contains('doc') || p.classList.contains('fname') ||
        p.classList.contains('fdim') || p.classList.contains('tree') ||
        p.classList.contains('seg-head') || p.id === 'doc')) return true;
      p = p.parentElement;
    }
    return false;
  }

  function applyI18n(root) {
    if (!root) root = document.body;
    if (!root) return;
    const which = lang();

    // 文本节点（常量用数字，避免环境里没有 NodeFilter）
    const SHOW_TEXT = 4, ACCEPT = 1, REJECT = 2;
    const nodes = [];
    if (typeof document.createTreeWalker === 'function') {
      let walker = null;
      try {
        walker = document.createTreeWalker(root, SHOW_TEXT, {
          acceptNode(n) {
            const v = n.nodeValue && n.nodeValue.trim();
            if (!v) return REJECT;
            if (inDoc(n.parentElement)) return REJECT;
            return ACCEPT;
          },
        });
      } catch (e) { walker = null; }
      if (walker) { while (walker.nextNode()) nodes.push(walker.currentNode); }
    }
    if (!nodes.length) {
      // 兜底：手写遍历
      (function walk(el) {
        if (!el || !el.childNodes) return;
        for (let i = 0; i < el.childNodes.length; i++) {
          const n = el.childNodes[i];
          if (n.nodeType === 3) {
            if (n.nodeValue && n.nodeValue.trim() && !inDoc(n.parentElement)) nodes.push(n);
          } else if (n.nodeType === 1) walk(n);
        }
      })(root);
    }
    nodes.forEach(n => {
      if (n.__i18nSrc == null) n.__i18nSrc = n.nodeValue;
      const src = n.__i18nSrc;
      const key = src.trim();
      // 多行文本节点（HTML 里的换行 + 缩进）也要能命中：先查原文，再查折叠空白的版本
      const flat = key.replace(/\s+/g, ' ');
      const out = (which === 'en')
        ? (MAP[key] || MAP[flat] || key)
        : (REVERSE[key] || REVERSE[flat] || key);
      n.nodeValue = src.replace(key, out);
    });

    // placeholder / title
    const attrs = root.querySelectorAll ? root.querySelectorAll('[placeholder],[title]') : [];
    for (let i = 0; i < attrs.length; i++) {
      const el = attrs[i];
      if (inDoc(el)) continue;
      ['placeholder', 'title'].forEach(a => {
        const cur = el.getAttribute(a);
        if (cur == null) return;
        const store = '__i18n_' + a;
        if (el[store] == null) el[store] = cur;
        const src = el[store];
        const key = src.trim();
        const out = (which === 'en') ? (MAP[key] || key) : (REVERSE[key] || key);
        el.setAttribute(a, src.replace(key, out));
      });
    }
  }

  return { MAP: MAP, t: t, lang: lang, apply: applyI18n, translateValue: translateValue };
})();

/** 简写 */
DV.t = function (zh, vars) { return DV.i18n.t(zh, vars); };
DV.applyI18n = function (root) { return DV.i18n.apply(root); };
