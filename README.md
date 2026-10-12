<img src="docs/icon.png" width="96" alt="DocViewer">

# DocViewer

An offline multi-file reader for RTF, TXT and Markdown, plus a native macOS app.

The front end is plain HTML, CSS and JavaScript and runs straight from `index.html`.
A small Swift shell wraps it into an ordinary `.app` with a native window, a native file
picker and the ability to write edits back to the source files.

There is no build step, no bundler, no `node_modules` and no third-party runtime code.
Nothing is uploaded anywhere.

## Quick start

```bash
git clone https://github.com/xus-stu/DocViewer.git
cd DocViewer

open index.html                      # browser path, no build step
# or
./run.sh

# native macOS app
./packaging/mac/build_native.sh ~/Desktop
open ~/Desktop/DocViewer.app
```

Requirements: any recent browser for the browser path; macOS with Xcode Command Line Tools
(`swiftc`) for the native app; Python 3 with Pillow only if you want to regenerate the icon.

---

## Features

### Files and browsing

- `.rtf`, `.txt`, `.md`, and common source or config files (`.java`, `.kt`, `.py`, `.js`,
  `.ts`, `.go`, `.rs`, `.c`, `.cpp`, `.cs`, `.swift`, `.rb`, `.php`, `.sh`, `.sql`,
  `.html`, `.css`, `.json`, `.xml`, `.yml`, `.toml`, `.gradle`, `.properties`, …).
  Source files are shown as plain text.
- Open several files at once, import a folder recursively, or drag files and folders onto
  the window.
- The sidebar lists files with a type icon, size, type label, a delete button on hover and a
  name filter. Selecting and switching only rewrites class names in place, so the list is
  not rebuilt and no entry animation replays.
- The sidebar can be collapsed on its own (`⌘B`, the `‹` button, or the settings panel) and
  leaves a handle to bring it back. The state is remembered.
- Session memory: reopening restores the previous file list and text. Each file can also
  remember its own reading position.

### Merging files

Several files can be combined into one reading view for cross-reading or comparison.
The original files are never touched.

1. Select two or more files in the sidebar (`Ctrl/⌘` click, `Shift` click, drag rows to reorder).
2. Click "Merge into one" on the selection bar, or press `⌘M`.
3. A merged entry appears and the source entries fold away. Nothing on disk changes.

The merged view supports segment headings, jumping between segments (`Alt+←` / `Alt+→`),
copying the combined text, exporting HTML, and splitting back into the original entries.
Merges can be nested and can mix Markdown, text and RTF.

A merged entry holds references to the original entries and builds its HTML at render time.
It does not copy the text and does not write to disk. The session stores the sources as well,
so after reopening the merged view still has its segments and can still be split.

### Formats and encoding

| Format | Handling |
|--------|----------|
| `.md` | Built-in renderer: headings, lists and task lists, tables, quotes, code blocks with language highlighting, links, images, rules, table of contents |
| `.rtf` | Built-in parser: font and color tables, bold / italic / underline / strike, super and subscript, font sizes, foreground and background colors, alignment and indents, `\par` `\line` `\tab`, lists, simple tables, `\'hh` and `\uN` escapes |
| others | Monospaced plain-text view |

Encoding is detected by trying, in order: BOM, strict UTF-8, GB18030/GBK, Big5, Windows-1252.
If everything fails the file is opened as non-fatal UTF-8, so a file always shows something
instead of an error.

RTF `\'hh` bytes follow the code page declared by the file:

- `\ansicpg936` is decoded as GBK, 950 as Big5, 932 as Shift-JIS, 1252 as CP1252.
- Without `\ansicpg`, the font table's `\fcharset` decides: 134 is treated as GBK,
  136 as Big5, 0/1/2 as 1252.
- If neither is present, 936 is assumed.
- Under a multi-byte code page, bytes that do not form a valid sequence are dropped. They are
  never reinterpreted as CP1252, which would turn a stray `\'97` in a cp936 file into an
  em dash inside Chinese prose.

Consecutive `\'hh` escapes are collected into a byte sequence and decoded as a whole, because
GBK and Big5 are multi-byte encodings and per-byte decoding only produces U+FFFD.

### Editing (off by default)

The default mode is read-only: no caret, and no file is ever modified. Switching to
**Editable** makes the text editable in place; about 1.5 minutes after you stop typing the
change is written back to the source file. You can also click **Save** in the toolbar to write
immediately. A `.bak` copy is created on the first write. Writing back never re-renders the
document, so the scroll position and the caret stay where they are.

- RTF is edited as rich text and serialized back on save. The font table, color table and
  stylesheet at the top of the file are preserved, the body reuses the file's own `\fN` /
  `\fsN`, and Chinese is written as `\uN?`.
- Text and source files are edited as plain text and written back in the file's own encoding.
- Markdown is not editable and always keeps its rendered view.

### Appearance and settings (`⌘,`)

| Group | Contents |
|-------|----------|
| Language | Chinese / English. Interface text, status bar and debug panel labels all follow. |
| Theme | Dark, Blue, Green, Light, Sepia and Custom, applied as a whole set |
|  | Custom takes four base colors (background, panel, text, accent) and derives the rest with `color-mix()` |
|  | Accent color, text color and reading background can each be picked from eight swatches; the reading background only affects the reading area |
|  | Body, secondary and faintest text of all five palettes pass WCAG AA, with regression tests |
| Fonts | System, Songti, Kaiti, Heiti, Yuanti, monospace, custom, plus eight Western fonts |
| Typography | Font size 11–30px, line height 1.3–2.6, column width 520–1200px, padding 0–80px, all live |
| Documents | Remember session, remember the reading position of each file, use the reader's font and size for RTF, follow the source line breaks in RTF |
| Editing | Read-only / editable; the switch and the Save button live in the settings panel and toolbar |
| Title bar | Whether to show the top title bar, and which fields appear under the file name (path, size, encoding, type, lines, characters) |
| Focus mode | Toggle and column width |
| Animation and frame rate | Animation level, speed, frame-rate cap, plus live readings |
| Tools | Debug panel, diagnostics report, export the current file as HTML, reset to defaults |

Settings live in `localStorage` and the panel has a **Reset**. Visual settings are written as
CSS custom properties and `body[data-*]` attributes, so theme, font and colors combine freely
and switching them never rebuilds the document.

**Remember the reading position of each file** is on by default: reopening a file, or
restarting the app, returns to where you left off, in read-only mode as well. Writing back
never re-renders the document, so the position and the caret are left alone. Turning the
setting off always starts at the top.

### Focus mode

Hides the title bar, sidebar, toolbar and status bar and leaves only the text with extra
vertical padding. Moving the mouse reveals a floating control strip (progress, previous and
next file, font size, exit) that fades after 2.2 seconds. Use its exit button, or the Focus
button in the toolbar, to return.

### F3 debug panel

Press `F3` (or `⌘D`, `F12`) to open the right-hand drawer. Four tabs:

| Tab | Contents |
|-----|----------|
| Performance | Frame-rate graph, display refresh rate, average frame interval, worst frame, dropped frames, scheduler probe, render time, DOM node count, JS heap usage, page uptime |
| Document | Name, path, type, bytes, encoding, lines, characters, parse and injection timings, view mode, font size and wrap state, parser warnings |
| Environment | User agent, language, platform, CPU threads, window and screen size, DPR, color depth, Web API support, GBK decoding, startup and ready timings |
| Log | Timestamped, leveled log with auto-scroll, copy and clear |

On frame rates: `requestAnimationFrame` is tied to the display refresh rate, so a 60Hz screen
only produces 60fps. The animation loop is therefore driven by `setTimeout(1000/cap)` while
`requestAnimationFrame` only samples the delivered rate. The 120, 180 and 240 caps really do
run at those intervals; the screen still shows about 60 images per second and the benefit is
a finer time step for easing and scrolling. Measured CPU use was 7.9% at 60fps and 8.1% at
240fps.

---

## Keyboard shortcuts

One shortcut:

| Key | Action |
|-----|--------|
| `F3` | Open or close the debug panel |

Everything else is a button in the interface (toolbar, top of the sidebar, settings panel), so
typing in the document can never trigger an action by accident. The old unmodified keys were
removed for that reason: a single `n` used to jump to the next file.

## Command line

| Flag | Meaning |
|------|---------|
| `--theme=<id>` | Start with `dark`, `blue`, `green`, `light`, `sepia` or `custom` |
| `--lang=zh\|en` | Interface language |
| `--edit=ro\|rw` | Start read-only or editable |
| `--fps=<n>` | Frame-rate cap |
| `--w/--h`, `--x/--y`, `--br/--bl` | Window size and position; the default is 75% of the screen, centered |
| `--debug` / `--settings` | Open the debug panel or settings on start |
| `--wipe` | Clear local data, as if launched for the first time |

A document path can be given directly, and `open -a DocViewer <file>` works too. The native
shell only treats a positional argument as the web root when that directory actually contains
`index.html`; otherwise it always uses the bundled `web/`.

---

## Project structure

```
index.html              single-page shell (title bar / sidebar / content / debug drawer)
css/hmcl.css            theme variables and all component styles
js/util.js              namespace, inline icons, formatting, toasts, leveled log
js/i18n.js              Chinese/English dictionary and DOM re-translation
js/welcome.js           the two built-in first-run documents
js/frames.js            frame scheduler (timer-driven animation, rAF sampling)
js/settings.js          settings model, persistence, theme derivation
js/md.js                Markdown renderer
js/rtf.js               RTF parser and the serializer used for write-back
js/debug.js             F3 panel
js/ui-settings.js       settings panel and focus mode
js/app.js               file list, decoding, rendering, merging, editing, shortcuts
examples/               sample files
packaging/mac/          Swift shell and build script
packaging/make_icon.py  generates the whole icon set
tests/                  Node test suites and the native writer test
```

## Tests

```bash
node tests/parse.test.js      # parser            (81 assertions)
node tests/smoke.test.js      # whole app         (407 assertions)

# everything at once (parser + app + native writer)
bash tests/run-all.sh
```

No test framework: plain Node scripts. `smoke.test.js` contains a hand-written mini-DOM, so
the real `app.js` runs inside Node and the suite covers startup, import, switching, search,
merge and split, session persistence, encoding detection, editing rules, theme contrast and
translation coverage. The native test covers encoding round-trips, backups and RTF byte
preservation.

## Implementation notes

- The window takes 75% of the screen and is centered. `setFrameAutosaveName` is not used, so
  an old frame cannot override the default.
- On first run, with no local data, two built-in documents are loaded: `README(EN).md` and
  `README(ZH).md`.
- The native shell registers the `docviewer://` scheme and serves the bundled assets through
  a `WKURLSchemeHandler`. Responses carry `Cache-Control: no-store` and the WebKit caches are
  cleared on launch, so edited CSS or JavaScript is not served from a stale cache.
- A merged entry only holds references and builds its HTML at render time. Selecting or
  checking files rewrites class names instead of rebuilding the list.
- The RTF parser splits text runs whenever the style signature changes or a group closes.
  `\pntext` only writes an internal marker; the `<ul><li>` structure is created when the text
  is flushed.
- RTF line breaks: real files often contain no `\par` at all, only the editor's hard wrapping
  and bare newlines. Every source line break is emitted as `<br>` by default, and the setting
  "follow the source line breaks in RTF" switches back to the strict behavior.
- The first color table entry in RTF is empty and means automatic. The parser stores it as
  `null` and emits no color, so the text follows the reader palette. Colors with less than
  3:1 contrast against the reading background also fall back to the reader palette.
- Markdown lists are parsed into a tree before rendering, which avoids invalid nesting from
  string post-processing.

## Known limitations

- RTF covers the common subset produced by TextEdit, WordPad and Word. Fields, footnotes,
  headers and footers, embedded images and revision marks are skipped.
- RTF tables only restore basic rows and columns; border styles and merged cells are ignored.
- The Markdown renderer is deliberately small and does not resolve reference-style link
  definitions or math.
- Persistence keeps up to 400 KB per file and 4 MB per session; anything beyond that stays in
  memory only.
- The macOS app is ad-hoc signed, so Gatekeeper warns on first launch. Right-click and choose
  Open, or run `xattr -dr com.apple.quarantine`.

## License

[MIT](LICENSE)
