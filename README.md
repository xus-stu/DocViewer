<img src="docs/icon.png" width="96" alt="DocViewer">

# DocViewer

**A zero-dependency offline reader for RTF, TXT and Markdown files — plus a native macOS `.app`.**

[中文文档](README.zh-CN.md) · [Screenshots](#screenshots) · [Build](#build-the-macos-app)

DocViewer is a small, dependency-free document reader. The whole front end is plain
HTML + CSS + JavaScript and runs straight from `file://`; a ~500-line Swift shell wraps it
into a real macOS application with a native file picker and the ability to write back to
the files you edit.

Nothing is ever uploaded. There is no build step, no bundler, no `node_modules`, and no
third-party runtime code.

---

## Features

### Reading
- **RTF, TXT, Markdown** and common **source / config files** (`.java`, `.kt`, `.py`, `.js`,
  `.ts`, `.go`, `.rs`, `.c`, `.cpp`, `.cs`, `.swift`, `.rb`, `.php`, `.sh`, `.sql`,
  `.html`, `.css`, `.json`, `.xml`, `.yml`, `.toml`, `.gradle`, `.properties`, …)
- Multi-file: open many files, switch instantly, **merge several into one view** and split
  them apart again (merge is display-only and never modifies the originals)
- Hand-written **RTF parser** (no library): font/color tables, bold / italic / underline /
  strike / super / sub, alignment and indents, tables, hyperlinks, `\uN` and `\'hh` escapes,
  `\ucN` skip semantics, CP1252 quotes, `{\*\…}` destination skipping
- Automatic **encoding detection** (UTF-8 / UTF-16 / GB18030 / Big5 / Shift-JIS / Latin-1)
- **Source view** for every format, word wrap, in-document search with hit navigation
- Sidebar, top title bar and every field in it can be shown, hidden or configured
- **Focus mode** (`F11`) that strips everything but the text

### Editing (opt-in, off by default)
Read-only by default: no caret, no file is ever modified.

Switch to **Editable** and the text becomes editable in place — put the caret anywhere and
type. Changes are written back to the source file about 1.5 s after you stop typing, with a
`.bak` copy on the first write.

- **RTF** — edited as rich text, then serialized back to RTF using the font and size stored
  in the file itself; the original font table and color table are preserved
- **Text / source files** — edited as plain text, written back in the file's own encoding
- **Markdown** — deliberately **not** editable: it always keeps its rendered view, so no
  formatting can be lost

### Appearance
- Six themes: **Dark, Blue, Green, Light, Sepia, Custom** — the custom theme asks for four
  base colors and derives the rest
- Fonts: CJK-oriented presets plus **8 Western fonts** (Georgia, Times New Roman, Palatino,
  Charter, Avenir Next, Helvetica Neue, Menlo, Courier New), or type your own
- Accent color, text color and reading background can be tuned with swatches
- Chinese / English UI, **all five theme palettes pass WCAG AA** (body ≥ 10:1, secondary
  ≥ 7:1, faintest ≥ 5.5:1) with regression tests
- Animation level (off / subtle / full) and speed, frame-rate cap up to 240 fps —
  the animation loop is timer-driven, so caps above the display refresh rate actually work

### Tooling
- **F3 debug panel**: frame rate, time step, encoding detection, parse stats, break-source
  analysis, DOM injection timings, environment probes
- **Diagnostics report** for a file (encoding / break source / content integrity)
- Built-in **first-run documentation** in two files: `README(EN).md` and `README(ZH).md`

## Screenshots

![DocViewer](docs/icon.png)

> Screenshots are not checked in yet. Run the app (`./run.sh`) or build the `.app` below and
> take a look — contributions of screenshots are welcome.

## Quick start

```bash
git clone https://github.com/xus-stu/DocViewer.git
cd DocViewer

# Option A — just open it in a browser (no build step at all)
open index.html          # or: ./run.sh

# Option B — build the native macOS app (WKWebView shell)
bash packaging/mac/build_native.sh ~/Desktop
open ~/Desktop/DocViewer.app
```

**Requirements**

- A browser with `IntersectionObserver` and `color-mix()` for the browser path (any recent
  Safari / Chrome / Firefox)
- macOS + Xcode **Command Line Tools** (`swiftc`) for the native app
- Python 3 with Pillow — *only* if you want to regenerate the app icon

## Build the macOS app

```bash
bash packaging/mac/build_native.sh [输出目录]     # 默认 ~/Desktop
```

This compiles `DocViewer.swift` + `AppendWriter.swift` with `swiftc`, copies the web assets
into the bundle, installs `DocViewer.icns`, writes `Info.plist` and ad-hoc signs the result
(`codesign --sign -`). No Xcode project, no `xcodebuild`.

Useful shell flags:

| Flag | Meaning |
| --- | --- |
| `--theme=<id>` | start with a given theme (`dark`/`blue`/`green`/`light`/`sepia`/`custom`) |
| `--lang=zh\|en` | start in a given UI language |
| `--edit=ro\|rw` | start read-only or editable |
| `--fps=<n>` | frame-rate cap |
| `--debug` / `--settings` | open the debug panel / settings on start |
| `--w/--h`, `--x/--y`, `--br/--bl` | window size and position (default: 75 % of the screen, centred) |
| `--wipe` | clear local data, as if launched for the first time |

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `F3` | Debug panel |
| `Ctrl/⌘ + B` | Show / hide the sidebar |
| `Ctrl/⌘ + ,` | Settings |
| `Ctrl/⌘ + F` | Search in the document |
| `Ctrl/⌘ + E` | Toggle source / rendered view |
| `Ctrl/⌘ + Shift + A` | Switch between read-only and editable |
| `Ctrl/⌘ + S` | Save now when editable, otherwise export |
| `F11` / `Ctrl + I` | Focus mode |
| `J` / `K` or `↓` / `↑` | Next / previous file |
| `Ctrl/⌘ + A`, `Ctrl/⌘ + M` | Select all, merge selection |
| `Ctrl/⌘ + Shift + D` | Diagnostics report |
| `Ctrl/⌘ + Shift + R` | Hard refresh |

## Project structure

```
index.html              single-page shell (title bar / sidebar / content / debug drawer)
css/hmcl.css            themes (6 palettes) + all component styles
js/util.js              namespace, lucide icons, DOM helpers, formatting, logger
js/i18n.js              Chinese ↔ English dictionary + DOM re-translation
js/welcome.js           the two built-in first-run documents
js/frames.js            frame scheduler (timer-driven animation + rAF display sampling)
js/settings.js          settings model, persistence, theme derivation
js/md.js                small Markdown renderer (no dependencies)
js/rtf.js               RTF parser + RTF serializer (for writing back)
js/debug.js             F3 panel: metrics, probes, diagnostics
js/ui-settings.js       settings panel, theme grid, immersive mode
js/app.js               file list, decoding, rendering, merge, editing, shortcuts
packaging/mac/          Swift shell (WKWebView + custom scheme handler) and build script
packaging/make_icon.py  generates the whole .icns from code
tests/                  Node test suites (parser + end-to-end) and the native writer test
examples/               small sample files
```

## Tests

No test framework — plain Node scripts with a hand-written mini-DOM, so the real
`app.js` / `rtf.js` / `settings.js` are exercised end to end.

```bash
node tests/parse.test.js      # RTF/Markdown parser          (81 assertions)
node tests/smoke.test.js      # whole app through a DOM shim (329 assertions)

# native file-writer test (real files on disk)
cd packaging/mac && cp ../../tests/append_test.swift /tmp/main.swift \
  && swiftc -O AppendWriter.swift /tmp/main.swift -o /tmp/write_test && /tmp/write_test
```

The suites cover parser edge cases (CP1252 quotes, `\ucN` skip semantics, multi-byte
`\'hh`, tables, soft breaks), the whole UI (file list, selection, merge/split, settings,
themes, i18n coverage, contrast ratios, editing rules) and the native writer (encoding
round-trips, backups, RTF byte preservation).

## Design notes

- **Zero dependencies, no build step.** Open `index.html` and it runs. Everything the app
  needs is in the repository.
- **The native shell serves the page over a custom scheme** (`docviewer://`) so the web
  assets can be read from the bundle, and resource responses carry
  `Cache-Control: no-store` — editing CSS/JS takes effect on the next launch instead of
  being served from a stale WebKit cache.
- **High frame rates need a timer.** `requestAnimationFrame` is vsync-locked, so the
  animation loop is driven by `setTimeout(1000/cap)` while rAF is only used to *sample* the
  display rate. Caps of 120/180/240 fps genuinely run; the display still shows ~60 images
  per second, and the benefit is a finer time step for easing and scrolling.
- **Editing writes whole files, atomically**, after keeping a `.bak`. RTF is regenerated
  from the original preamble plus a re-serialized body, so the file's own font table,
  color table and encoding survive.
- **Text contrast is a tested property**, not a hope: every theme palette is asserted
  against WCAG AA in the smoke suite.

## Known limitations

- RTF support covers the common subset produced by TextEdit / WordPad / Word; complex
  fields, footnotes, embedded objects and revision marks are ignored rather than rendered.
- Markdown rendering is intentionally small (headings, emphasis, code, lists, quotes,
  tables, links, task lists) — it is a reader, not a CommonMark implementation.
- A CP1252 escape pair can coincidentally form a valid CJK byte sequence; the declared
  code page wins (`\'93\'94` is ambiguous and is decoded as such).
- The macOS app is ad-hoc signed, so Gatekeeper will warn on first launch
  (right-click → Open, or `xattr -dr com.apple.quarantine`).

## License

[MIT](LICENSE)
