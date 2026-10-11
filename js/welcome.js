/* =====================================================================
   welcome.js — 首次打开时内置的两份说明文档
     README(EN).md  纯英文（English 段里不允许出现任何中文字符，有测试守着）
     README(ZH).md  纯中文
   ===================================================================== */
window.DV = window.DV || {};

(function () {
  const EN = [
    '# DocViewer (EN)',
    '',
    'A small offline reader for **RTF**, **TXT** and **Markdown** files.',
    'Everything runs on your own machine: no network access, no third-party libraries.',
    '',
    '## Opening files',
    '',
    '- **Open files** (bottom of the sidebar): choose one or several files at once',
    '- **Import folder**: add every supported file inside a folder',
    '- Drag files, or a whole folder, anywhere onto the window',
    '- Documents: `.rtf`, `.txt`, `.md`, `.markdown`, `.log`',
    '- Source and config files: `.java`, `.kt`, `.py`, `.js`, `.ts`, `.go`, `.rs`, `.c`, `.cpp`,',
    '  `.cs`, `.swift`, `.rb`, `.php`, `.sh`, `.sql`, `.html`, `.css`, `.json`, `.xml`, `.yml`,',
    '  `.toml`, `.gradle`, `.properties` and more',
    '',
    '## Reading',
    '',
    '- Word wrap, font, size, line height, column width and padding live in **Settings**',
    '- The sidebar, the top title bar and each field inside it can be hidden or configured',
    '- **Source** shows the raw text of the current file',
    '- Select several files to merge them into one view, then split them apart again',
    '- All of this is display only; the original files are never touched',
    '',
    '## Editing (optional)',
    '',
    'Editing is **off** by default (read-only): no caret, no file is ever modified.',
    '',
    'Switch to **Editable** in Settings, or press `Ctrl/Command + Shift + A`, and the text becomes',
    'editable in place: put the caret anywhere and type. About 1.5 minutes after you stop typing',
    'the change is written back to the source file; press `Ctrl/Command + S` to write immediately.',
    'A `.bak` copy is kept on the first write.',
    '',
    '- **RTF**: edited as rich text, then converted back to RTF using the font and size stored in',
    '  the file itself. The original font table and color table are preserved',
    '- **Text and source files**: edited as plain text and written back in the file\'s own encoding',
    '- **Markdown**: never edited. It always keeps its rendered view, so nothing can be lost',
    '',
    '## Keyboard shortcuts',
    '',
    'Only one: `F3` opens or closes the debug panel. Everything else is a button in the',
    'interface, so typing in the document can never trigger anything by accident.',
    '',
    '## Appearance',
    '',
    'Six themes: **Dark**, **Blue**, **Green**, **Light**, **Sepia** and **Custom**.',
    'The custom theme asks for four base colors and derives the rest automatically.',
    'Accent color, text color and reading background can be tuned further with the swatches.',
    'The interface is available in Chinese and English (Settings, Language).',
    '',
  ].join('\n');

  const ZH = [
    '# DocViewer（中文）',
    '',
    '一个离线的 **RTF** / **TXT** / **Markdown** 阅读器，完全在本机运行，',
    '不联网，也不依赖任何第三方库。',
    '',
    '## 打开文件',
    '',
    '- 侧栏底部的**打开文件**：一次可以选择多个文件',
    '- **导入文件夹**：把一个文件夹里所有支持的文件都加进来',
    '- 也可以把文件或整个文件夹直接拖进窗口',
    '- 文档：`.rtf`、`.txt`、`.md`、`.markdown`、`.log`',
    '- 源码与配置：`.java`、`.kt`、`.py`、`.js`、`.ts`、`.go`、`.rs`、`.c`、`.cpp`、',
    '  `.cs`、`.swift`、`.rb`、`.php`、`.sh`、`.sql`、`.html`、`.css`、`.json`、`.xml`、',
    '  `.yml`、`.toml`、`.gradle`、`.properties` 等',
    '',
    '## 阅读',
    '',
    '- 自动换行、字体、字号、行高、行宽、留白都在**设置**里',
    '- 侧栏、顶部标题栏以及标题栏里显示哪些字段，都可以单独开关或配置',
    '- **源码**显示当前文件的原始文本',
    '- 选中多个文件可以合并成一个视图，也可以再拆开',
    '- 这些操作只影响显示，不改动原文件',
    '',
    '## 编辑（可选）',
    '',
    '编辑默认是**关闭**的（只读模式）：正文没有光标，不会改动任何文件。',
    '',
    '在设置里切到**可编辑**，或按 `Ctrl/Command + Shift + A`，正文就可以就地编辑：',
    '光标放到任意位置直接打字。停手约 1.5 分钟后自动写回源文件，按 `Ctrl/Command + S` 可立即写回。',
    '首次写入会保留一份 `.bak` 备份。',
    '',
    '- **RTF**：按所见即所得编辑，再转换回 RTF 时**沿用文件自身的字体与字号**，',
    '  文件开头的字体表、颜色表原样保留',
    '- **文本与源码文件**：按纯文本编辑，写回时使用**原文件的编码**',
    '- **Markdown**：不参与编辑。它始终保持渲染后的显示，避免任何格式丢失',
    '',
    '## 快捷键',
    '',
    '只有一个：`F3` 打开或关闭调试面板。其余功能都在界面按钮上，',
    '这样在正文里打字不会误触发任何操作。',
    '',
    '## 外观',
    '',
    '六套主题：**深色**、**蓝色系**、**绿色系**、**浅色**、**羊皮纸**、**自定义**。',
    '自定义主题只需要给四个基础色，其余颜色会自动推导。',
    '强调色、正文颜色、阅读底色还可以用色块继续细调。',
    '界面支持中文与 English（设置 → 语言）。',
    '',
  ].join('\n');

  /** 首次打开时放进列表的两份文档 */
  DV.WELCOME_FILES = [
    { name: 'README(EN).md', text: EN, lang: 'en' },
    { name: 'README(ZH).md', text: ZH, lang: 'zh' },
  ];

  /* 兼容旧的单文件接口 */
  DV.WELCOME_NAME = DV.WELCOME_FILES[0].name;
  DV.WELCOME_MD = DV.WELCOME_FILES[0].text;
  DV.WELCOME_EN = EN;
  DV.WELCOME_ZH = ZH;
})();
