# flea-qml

Flea QML is a cross-platform file manager written in Bun JavaScript & QML. It's an unofficial fork of [Flea](https://github.com/thisisgm/flea), the fast GUI file manager for Omarchy

> **Preserve the experience, simplify the implementation, extend the capabilities.**

- **Preserve the experience**: Flea's QML interface, its views, keys, cards, previews and wording, carried over
- **Simplify the implementation**: replace the Rust backend with Bun JavaScript, so the build step isn't mandatory anymore
- **Extend the capabilities**: run across platforms, on Windows, Linux and
  Android, wherever a QML runtime and a JS engine do, including [buninu-browser](https://github.com/jjtseng93/buninu-browser)'s QML frontend.

> [!WARNING]
> Flea QML is still in early development. Features and APIs may be unstable and may change without notice.

## Running it

1. Install Bun first, then check that it is available on PATH:

```sh
npm i -g bun
bun --version
```

2. Enter the [Buninu userspace](https://github.com/jjtseng93/buninu)

```sh
# Run a server & open in a browser
bunx buninu

# Open in the current terminal
# Kitty graphics support is required if you want to show Flea QML inside it directly
bunx buninu --local

# Or do nothing in a @drxiaozhi/minapk Android App
```

3. Start Flea QML with npx or bunx:

```sh
npx flea-qml

# bunx flea-qml
```

Or, from the root of this repository:

```sh
bun index.js
```

- The launcher queries Kitty graphics support.
- When available it uses buninu-browser's default terminal frontend (--casty)
- If Kitty Graphics is not available after 800ms
  * Windows: `--win32`
  * Linux/Android/Other: `--wayland`

- The first argument selects frontend for buninu-browser and bypasses Kitty detection
- >= 2nd arguments go to the browser

```sh
# Frontends
npx flea-qml --casty
npx flea-qml --win32
npx flea-qml --wayland
npx flea-qml --headless

# Information
npx flea-qml --help
npx flea-qml --version
npx flea-qml --readme
npx flea-qml --dump-config
npx flea-qml --dump-config-raw
```

- Early exit flags:
  * `--dump-config`: Prints complete effective settings (defaults merged with saved overrides), always with ANSI colours, including through pipes. Exits without launching the browser or saving settings.
  * `--dump-config-raw`: Prints the same settings as plain JSON for scripts or redirection.
  * `--help`/`-h`: CLI usage
  * `--version/-V`: Shows flea-qml version & buninu-browser version pinned in `package.json`
  * `--readme` always prints coloured ANSI Markdown with links, including when its output is redirected.

---

### What the launcher starts
- Spawns [buninu-browser](https://github.com/jjtseng93/buninu-browser) to display its QML interface
  * file:///path/to/ui/boot/shell.qml
- Reads browser version pinned in `package.json` under `scripts.browser`
- Order of runner: `npx`, `bunx`, then `bun x`
- To reinstall cached packages (buninu-browser & @drxiaozhi/casty), see [Clearing package caches](#clearing-package-caches)

### Advanced usage

- Compiled QML cache defaults to `--cache=js`; see [Compiled QML cache](#compiled-qml-cache) for details.
- `FLEA_PATH=/some/folder` opens that folder first
- For example, from this checkout in the Buninu userspace:

```sh
env FLEA_PATH="$PWD/demos" bunx flea-qml
```

For development, you can also launch a browser checkout directly from this repository root:

```sh
bun ../buninu-browser/index.js --quickshell-wayland -p ui/boot/shell.qml
```

Replace wayland with your selected frontend

## How to use
## 使用方法

- The below is the **default** key preset
- 以下為 `預設` 鍵盤對應

- Letter shortcuts only apply when the file list has focus
- 字母快捷鍵只有在焦點在檔案列表時可用

- Press `?` or click `Help` to show help
- 按下 `?` 或是按下 `使用方法` 顯示幫助

### Core operations
### 核心操作

- `↑/k`: Cursor up 遊標向上
- `↓/j`: Cursor down 遊標向下
- `←/h`: Parent folder 上一層目錄
  * Also `←Backspace` 也可用 `←退格`
- `→/l`: Child folder 下一層目錄

---

- `Space/→/l`: Preview file 預覽檔案
  * Preview: In Flea 預覽：在Flea裏面
- `Enter`: Open file 開啟檔案
  * Open: Externally 開啟：外部程式

---

- `Shift-h/H`: History back 返回/上一頁
- `Shift-l/L`: History forward 前進/下一頁
- `t`: New tab 新分頁
- `[ / Ctrl-PageUp`: Prev tab 上一分頁
- `] / Ctrl-PageDown`: Next tab 下一分頁
- `Ctrl-w`: Close current tab 關閉目前分頁
- `Ctrl-t`: New Terminal tab 新終端機分頁

---

- `Ctrl-1`: List view 列表檢視
  * Places / File list
  * 位置 / 檔案列表
- `Ctrl-2`: Column view 多欄檢視
  * Places / Parent folder / Current Folder / Preview
  * 位置 / 上一層目錄 / 當前目錄 / 預覽
  * `Alt-p`: Toggle preview 顯示/隱藏預覽
- `Ctrl-3`: Grid view 格狀檢視
  * Places / File grids
  * 位置 / 檔案格子
- `Ctrl-4`: Dual view 雙欄檢視
  * Places / Folder1 / Folder2
  * 位置 / 目錄1 / 目錄2
  
---

- `Tab/Shift-Tab`: Move focus 移動焦點
- `. / Ctrl-h`
  * Toggle hidden files (. prefixed)
  * 顯示/隱藏 隱藏檔 (.開頭)

### Advanced operations
### 進階操作

- `Home`: First file/folder 第一個檔案/目錄
- `End`: Last file/folder 最後一個檔案/目錄
- `PageUp`: Scroll up 捲動向上
- `PageDown`: Scroll up 捲動向下
- `:`: Edit address 編輯地址
- `Ctrl+Enter`: Open in new tab 新分頁開啟
- `{ / Ctrl-Shft-PgUp`: Move tab ← 移動分頁
- `} / Ctrl-Shft-PgDn`: Move tab → 移動分頁
- `Ctrl-b`: Toggle PLACES 顯示/隱藏位置欄

- `s`: Change sort field 更換排序欄位
- `S`: Reverse sort 反轉排序
- `F4`: Fit columns 自動調整欄寬
- `F5 / Ctrl-r`: Reload 重新載入
- `Ctrl-+ / Ctrl-- / Ctrl-0`
  * Larger / Smaller / Reset text
  * 放大 / 縮小 / 重設文字
  * Also with Shift 也可加按 Shift
- `, / Ctrl-,`: Settings 設定

### Selection and file operations
### 選取與檔案操作

- `v`: Toggle selection 切換選取
- `Shift-↑ / Shift-↓` or `K / J`
  * Extend selection 延伸選取
- `Ctrl-a`: Select all 全選
- `V`: Invert selection 反向選取
- `y / Ctrl-c`: Copy files 複製檔案
- `x / Ctrl-x`: Cut files 剪下檔案
- `p / Ctrl-v`: Paste files 貼上檔案
  * Into this folder 貼到當前目錄
- `Y`: Copy folder path 複製目錄路徑
- `Ctrl-Shift-c`: Copy file paths
  * 複製選取檔案的路徑
- `c`: Copy as options 複製方式
- `P`: Paste as options 貼上方式
- `r / F2`: Rename 重新命名
  * Multiple files: Bulk rename
  * 多選時：批次重新命名
- `Ctrl-Shift-n`: New folder 新目錄
- `Delete / dd`: Move to Trash
  * 移到垃圾桶；`dd` 為連按兩次 d
  * In Trash: Confirm deletion
  * 在垃圾桶內：確認永久刪除
- `Shift-Delete`: Confirm deletion
  * 確認永久刪除
- `=`: Measure folder sizes
  * 計算選取或當前目錄大小
- `Alt-=`: Measure all folder sizes
  * 計算列表中所有目錄大小
- `m / Menu / Shift-F10`
  * Context menu 內容選單

### Find and Filter
### 尋找與篩選

- `/`: Filter names 依名稱篩選
- `f / Ctrl-f`: Find 尋找
- `Ctrl-g`: Find file contents
  * 搜尋檔案內容
  * In Find: Toggle name/content
  * 尋找框內：切換名稱／內容搜尋
- `Enter` in Find 在尋找框內
  * Start search 開始搜尋
- `Tab / Shift-Tab` in Find
  * Change scope 切換搜尋範圍
- `Enter` in Filter 在篩選框內
  * Apply and focus list
  * 保留篩選並回到列表
- `↑ / ↓ / PageUp / PageDown`
  * In queries: Browse results
  * 搜尋框內：瀏覽結果
- `o` in results 在結果列表內
  * Reveal in folder 開啟所在目錄
- `Esc` in Filter 在篩選框內
  * Close Filter 關閉篩選
- `Esc` in Find 在尋找框內
  * Searching: Stop 搜尋中：停止
  * Idle: Close 閒置時：關閉
- `Esc` in the list 在檔案列表內
  * Close Filter, then Find
  * 先關篩選，再按一次關尋找

- Query focus 搜尋框焦點
  * Left/Right move the caret
  * 左右鍵移動文字游標
  * Click the query to edit again
  * 點擊搜尋框即可繼續編輯
  * Esc acts on the focused query
  * Esc 優先處理有焦點的搜尋框

### Preview and Quick Look
### 預覽與快速檢視

- `Space / Esc`: Close Quick Look
  * 關閉快速檢視，不是暫停播放
- `Ctrl-Space`: Load preview
  * 載入選取項目的預覽
- `Ctrl-Tab`: Focus preview column
  * 將焦點移到預覽欄
  * In Quick Look: Close it
  * 在快速檢視內：關閉快速檢視
- `i`: Compact / Full file facts
  * 切換精簡／完整檔案資訊
- `↑ / ↓` or `k / j` in Quick Look
  * Previous / Next file
  * 快速檢視：上一個／下一個檔案
- `PageUp / PageDown` or `B / F`
  * Scroll preview by a page
  * 將預覽向上／向下捲動一頁
  * List: B/F scroll preview column
  * 列表內：B/F 捲動右側預覽欄
- `w`: Wrap text/code 文字／程式換行
- `r`: Document / Source
  * 文件預覽／原始碼切換
- `p`: Play / Pause 播放／暫停
- `m`: Mute / Unmute 靜音／恢復聲音
- `← / →` in media 在影音預覽內
  * Seek back/forward 5 seconds
  * 倒退／快轉 5 秒
- `← / →` in PDF 在 PDF 預覽內
  * Previous / Next page 上／下一頁
- `- / +`: Zoom out / in 縮小／放大
  * Images, HTML and PDF
  * 適用於圖片、HTML 與 PDF
- `0`: Fit image 圖片符合視窗
- `e`: Expand PDF 展開／收合 PDF
- `y` in Compare 在比較預覽內
  * Copy diff patch 複製差異 patch

### Extracting archives

Both Quick Look and the right preview column offer **Extract to Folder** and
**Extract here** for ZIP, TAR, TAR.GZ/TGZ and TAR.ZST/TZST archives. Extract to
Folder uses the archive name without its extension; existing destinations get
` copy`, ` copy 2`, and so on. Extract here places the contents beside the archive
and asks for confirmation when the archive contains more than five top-level items
(files and directories; nested contents count only toward their top-level folder). Cancel is the default.
Existing items are kept: colliding names get a copy suffix, and existing folders
are not merged. Work is prepared under a hidden unique name at the destination,
not in the system temporary directory, so publication stays on the same filesystem.

### Menus and dialogs

Use Up/Down (or `k`/`j`) to choose a menu row, Right/`l` to enter a submenu,
Left/`h` to return, Enter to activate, and Esc to dismiss. In Copy as, `p`, `n`,
`e`, `f`, `u`, and `s` select path, name, stem, folder path, URI, and shell-quoted
path respectively. Tab/Shift+Tab move between dialog controls; text fields keep
normal caret, selection, copy and paste editing.

## Runtime and supported features

The repository aims to be self-contained, needing only buninu-browser to run.
The backend reads no system database; the one system file it reads is Linux's
mount table, for a folder's filesystem name. For the clipboard it speaks
Wayland data-control itself, loading only libc (kernel32 on Windows) to pass
file descriptors. Without a usable Wayland data-control connection, the QML
frontend uses Quickshell's text clipboard instead (buninu-browser prefers xclip,
then its existing platform fallbacks). Paste reads it on demand, with no polling.
File paths keep their POSIX single-quoted form on every platform, including
Windows; a cut adds `""` at both ends. This is a text representation of the file
selection, not Android's native file clipboard. Syntax highlighting runs
[jsmdcui](https://github.com/jjtseng93/jsmdcui), for syntax colours in previews,
found beside this repository as `../jsmdcui` or on PATH as `jmi` or `jsmdcui`;
without it previews are plain text. Compare also runs `diff` through bunmsh or
a system provider, as described below. Some interface
code carried over from upstream and Omarchy still asks Linux tools such as
`hyprctl`, `lsblk` and `fc-match`, and does without them where they are missing.

Ported so far: the backend's `list`, `window`, `sort`, `fsinfo`, `peek`,
`meta`, `code`, `clipSet`, `clipGet`, `clipClear`, `clipWatch`, `collisions`, `mergecollisions`,
`transfer`, `transfercancel`, `trash`, `trashbrowse`, `menuaction` (selection snapshots and permanent-delete confirmation),
`mkdir`, `newfile`, `duplicate`, `bulkrename`, `permissions`, `permissionsBatch`, `formats`, `archive` and `quit`, and `flea --ui-state`, which keeps
`~/.local/state/flea/ui.json` the way upstream does. A transfer copies and moves
files, folders and links and answers keep, skip, refuse, replace and merge; it has no undo yet,
and refuses special files. Replace moves the item already there to flea's Trash first and puts it
back when the transfer fails; merge folds a folder into the folder already there, asking once
about the names both hold. Other requests and `flea`
modes are not ported yet; the interface reports them as failed, as with an
unreachable backend.
Setting `FLEA_BIN` to upstream's `flea` binary uses it instead, for what is
not ported yet.

Archive previews list ZIP, tar, tar.gz/tgz and tar.zst/tzst without loading the
whole archive into memory.

Compress writes `.zip`, `.tar`, `.tar.gz` and `.tar.zst`, and Extract reads the
same four, in JavaScript with `node:zlib`; no `bsdtar` or `7z` runs. Both stream
member data, work under a hidden `.flea-work-*` name beside the result and publish
it under the first free name (`pack.zip`, `pack copy.zip`, ...), so a failed or
cancelled run leaves nothing under a real name. Extraction refuses absolute and
`..` member names and any member that would be written through a link, applies the
umask to stored modes, and copies a tar hard-link member's bytes instead of
linking. Passwords, `.7z`, `.rar`, `.tar.xz`, `.tar.bz2`, packages and the
free-space check are not ported; those are refused with a sentence.

New folder, New file, Duplicate, Bulk rename and Permissions follow upstream's
rules: names are bare (no separator or NUL), creations are exclusive, a bulk rename
is checked whole before anything moves and swaps through temporary names, and a
permissions batch changes every item or puts back what it changed. None of these
is in an undo journal yet. File tags (`settags`, `tagstates`) are not ported. Compressed tar member data is streamed and discarded;
metadata records over 1 MiB and malformed or truncated archives are rejected.
Keyboard hints are enabled by default; an explicitly saved disabled setting is
preserved.

## Where it comes from

`ui/` started as upstream's `ui/`, exported from
[`thisisgm/flea@73f3c23`](https://github.com/thisisgm/flea/commit/73f3c23971106f6d47f78bd758f783af3e5b5c78)
(0.4.0 plus 7 commits). Upstream has since moved its window to GPUI and no
longer launches this interface; this fork keeps it as the frontend. Changes
so far:

- A row's icon is the emoji the backend sends; language logos give way to it.
- The interface runs this repository's `src/flea.js` (`ui/js/FleaBin.js`)
  instead of a `flea` on PATH.
- Upstream's links to `/usr/share/omarchy/shell` are replaced by a copy of the
  two Omarchy QML modules the interface imports, `ui/boot/Commons` and
  `ui/boot/Ui`, from
  [`omacom/omarchy@3c7027d`](https://github.com/omacom/omarchy/commit/3c7027db2a4fa9fa6a49d7af7f87c27ac48e677d).
- Markdown formulas are set as MathML by Temml (`src/mathml.js`), and Mermaid
  diagrams are drawn by the backend (`src/figure.js`: Pele in a Bun Worker, one
  diagram at a time under a deadline). The HTML preview embeds each diagram as an
  SVG picture; the block view asks the backend for the same SVG. Upstream's
  sandboxed quickjs figure helper and its figure cache are not used.

## Layout

| Path | What it is |
| --- | --- |
| `ui/` | The QML interface and its JS libraries |
| `ui/boot/Commons`, `ui/boot/Ui` | Omarchy's `Commons` (theme, colours) and `Ui` (panels, dialogs) modules, where `import qs.Commons` finds them: Quickshell's `qs` is the folder `shell.qml` sits in |
| `src/flea.js` | The `flea` the interface runs; `--backend` answers `ui/Backend.qml` |
| `src/` (rest) | The backend: listing, ordering, kinds and emoji, filesystem facts |
| `docs/protocol.md` | Upstream's description of the backend line protocol |
| `demos/` | One file for every emoji a row can show, and `math-and-diagrams.md` for formulas and Mermaid |

## Sidebar places

Sidebar places are found by looking, not read from `user-dirs.dirs` alone or
asked of `lsblk`: a standard folder (Desktop, Downloads, Documents, Pictures,
Camera, Screenshots, Music, Videos) is listed once it directly holds a file,
every system lists its temporary folder, and DEVICES adds each root that can be
listed (`/`, or the drive letters on Windows) and what is mounted under
`/Volumes`, `/media` and `/run/media`. Android, recognised by
`/system/bin/linker64`, always lists `/sdcard` and `/sdcard/Download`, and an
app whose `$TMPDIR` lies in its private folder also gets that folder and
`/sdcard/Android/media/PACKAGE`. The backend looks again every five seconds
only while a sidebar is shown; see `docs/protocol.md` "flea-qml probed places".

## Deleting files

Trash uses the ordinary file pane: Space opens Quick Look, `/` filters,
and the existing selection, sorting, copy/cut and folder navigation work on
its real files. The toolbar adds Restore, Restore all and Empty Trash; deletion
still requires confirmation. Original locations and deletion dates are shown.
Returning from a trashed folder restores the Trash collection. Moving a file
out removes its `.trashinfo`; copying leaves it intact. Renaming updates its
restoration name and refuses collisions.

Trash is a virtual collection across volumes, not a writable directory: open
a real folder before pasting, creating files or using recursive Find (`f`).
Filter works directly on the collection. This does not add backend features
that are otherwise unimplemented (for example bulk rename or undo).

`bun test/manual-trash-ui.mjs` exercises the shared pane with the sibling
buninu-browser, isolated HOME/XDG fixtures, preview, filtering, folder Back,
selected restore, and deletion review/cancellation. It never activates Empty
Trash, since mounted-volume trash can exist outside those isolated directories.

Move to Trash uses freedesktop-style `Trash/files` and `Trash/info`, without
invoking `gio`. Windows also uses this private Trash folder, not the Windows
Recycle Bin. Cross-filesystem copies are not attempted: an unusable Trash leaves
the source in place. Trash browsing, restore and confirmed permanent deletion/emptying
are supported; undo is not yet ported. Restore refuses an occupied destination.
The backend discovers home and mounted-volume Trash folders and remembers the
per-drive folders it has used. Sidebar counts use filesystem watches with a
five-second reconciliation for newly available volumes, without GIO processes.
Same-count replacements also refresh the listing. Deletion reviews reuse the
bounded, non-following tree checks below, including descendant changes and
single-use confirmation tokens; cancelling invalidates the review.

Permanent deletion requires a fresh confirmation token. Changes to the reviewed
tree invalidate it; refresh reviews only the originally selected paths. Reviews
refuse filesystem roots, cross-device subtrees, unreadable entries, and trees
exceeding 100,000 entries or the two-second walk budget. Review failures never
pretend to be complete totals. Path-based filesystem checks do not provide
atomic protection against concurrent renames by other processes.

## The clipboard

Copied files are offered the way other file managers read them
(`text/uri-list`, GNOME's and KDE's forms) and, as plain text, shell-quoted on
one line, so a paste into a shell is ready to use:

```sh
'/home/a/file a' '/home/a/it'\''s'        # copied
""'/home/a/file a' '/home/a/it'\''s'""    # cut: the same words between two empty ""
```

There is no clipboard daemon: the backend owns the selection and gives it up
when it exits. The plain text is what a compositor such as buninu-land keeps
after that, so a later Flea still reads it back as a copy or a cut, as long as
every path in it exists.

Text-only Copy as and share links use the QML runtime's clipboard. Query-field
paste accepts either synchronous Quickshell text or buninu-browser's asynchronous
host clipboard read. These operations do not require `wl-copy`.

## Compiled QML cache

Compiled local QML caching defaults to `--cache=js`.
To additionally cache Bun bytecode:

```sh
npx flea-qml --casty --cache=bytecode
npx flea-qml --wayland --cache=bytecode
```

The launcher puts cache flags after Casty's `--` separator automatically;
Wayland and headless receive them directly. This requires a pinned
buninu-browser release that includes QML caching.

## Clearing package caches

To reinstall cached packages from scratch:

```sh
# npm 11 or later: list the cache keys and their packages
npm cache npx ls

# Use the keys from your own listing for flea-qml, buninu-browser or Casty.
# The package specification (including its version) affects the key.
npm cache npx rm FLEA_KEY BROWSER_KEY CASTY_KEY

# Or clear all npx packages, including other tools
npm cache npx rm --force

# For packages launched through bunx or bun x
bun pm cache rm
```

With an older npm, delete the npx cache directory: `~/.npm/_npx`
(Windows: `%LocalAppData%\npm-cache\_npx`).

## Tests

Run `bun test test` for archive bounds, menu identity/transfer lifetime and
clipboard tests. Fixtures are generated in temporary directories and removed
afterward; no compositor is required.

## License

MIT, as upstream. See [LICENSE](LICENSE): GM's copyright notice for Flea is
kept, followed by Dr. John's (醫者小智) for this fork.

The tree also carries Omarchy's QML modules, Lucide icon geometry, Temml (with
mhchem), Pele, and simple-icons and markdown-mark logos, each under its own licence;
see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

### Preview fallback and syntax audit

Unknown file types are previewed as text. Local text previews read at most the
first 1 MiB, replace binary control bytes with visible control pictures, and split
lines longer than 4096 characters to bound text layout work. Large files and binary
content use plain text; a notice in the preview indicates truncation or line splitting.
Failed image, media, or document previews leave the content area blank.

To audit syntax colours using a jsmdcui checkout (HTML is excluded):

```sh
bun test/manual-syntax-preview.mjs ../jsmdcui
```

The script discovers `runtime/syntax/*.yaml`, uses that checkout's
`tests/syntax-parity/samples`, and runs four jobs at a time. It checks explicit
language highlighting separately from Flea's automatic file preview. The detailed
report is `flea-syntax-results.json` in the system temporary directory.

The current 158 definitions contain three HTML variants, which are skipped.
All remaining 155 produce colour with an explicit filetype; 149 have verified
automatically selected, coloured Flea text previews. Markdown normally uses a
rendered document instead of source colouring. `default`, V and Jinja2 have no
filename detector; Objective-C shares extensions with other languages; Privoxy's
config detector requires a directory although jsmdcui matches the basename.
These are detection limitations, not missing colour rules. The lexical samples
prove colour reaches the preview backend, not exhaustive syntax correctness or a
visual check of every language.

Flea additionally recognizes V function declarations in the first 64 KiB of `.v`
files and requests `-filetype v`. Comments and strings are ignored; a Verilog
`endmodule` keeps the normal detector. Ambiguous files without such evidence keep
jsmdcui's existing detection. This hint is implemented in Flea, not jsmdcui.
To explicitly request a language from jsmdcui yourself, use **one dash**:

```sh
bun ../jsmdcui/src/index.js --cat --edit -filetype v /path/to/main.v
# Or, with the installed launcher:
jmi --cat --edit -filetype v /path/to/main.v
```

The value is the YAML definition's `filetype`, not necessarily its filename or
extension. Flea's internal `highlightFile(path, signal, filetype)` forwards this
setting as separate arguments; failures still fall back to plain text.

The Trash address bar displays `trash:///`. Enter `trash:/`, `trash://`, or
`trash:///` to open the same collection as the sidebar. These root addresses are
UI aliases only: stored paths, preview readers, restore and deletion are unchanged.
Trash item URIs and remote authorities are not supported by these aliases.

The bottom status bar shows the selected item's full name after the count/size.
With multiple marked items it shows the current cursor item; Trash uses its
original name. Long names scroll horizontally instead of being elided. Notices
and errors temporarily take priority over the name.

HTML previews rebuild a passive fragment with Bun's HTMLRewriter: only fixed
structural/text tags (including nested `div`) are emitted, never source attributes.
Text's literal angle brackets are escaped; scripts, styles, embedded documents,
SVG and MathML subtrees are omitted. No source CSS, images or links are loaded.
The result uses QML RichText with the current theme and local text reflow, rather
than an external browser screenshot. Source view remains available. HTML reads
are limited to 1 MiB; larger documents keep the existing plain-text preview path.

`bun test test/html-preview.test.js` tests rebuilding and bounded reads.
With sibling buninu-browser available,
`bun test/manual-html-security.mjs` checks adversarial fragments in a live page
using a harmless script counter, and `bun test/manual-html-ui.mjs` checks the real
backend/QML preview and scrolling. These are regression checks, not a proof
against every possible parser discrepancy. Never decode the rebuilt fragment's
entities before parsing it as HTML.


Compare two marked regular files with **m → Compare**. The backend searches
for the sibling `../bunmsh/index.js` first, then `bunmsh` on PATH, invoking
`bunmsh -cc builtin diff` (with Bun before the sibling entry). Finally it tries
`Bun.which("diff")`. All providers receive `-u --label A --label B -- A B`
as separate arguments, without shell interpolation. Providers that cannot run
or lack unified support fall back to the next candidate.

Comparison retains upstream's 1 MiB per-file limit and binary screening, caps
patch output at 8 MiB, and terminates a diff after 10 seconds. A superseded
comparison is cancelled and its reply discarded. Requires a bunmsh version
with unified diff support or a compatible system diff. Test with
`bun test test/compare.test.js`; with sibling buninu-browser available,
`bun test/manual-compare-ui.mjs` checks the real backend and Compare view.
