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
bunx buninu --local

# Or do nothing in a @drxiaozhi/minapk Android App
```

3. Start Flea QML with npx or bunx:

```sh
npx flea-qml
```

Or, from the root of this repository:

```sh
bun index.js
```

The launcher queries Kitty graphics support.
When available it uses buninu-browser's default terminal frontend; otherwise
Windows uses `--win32`, and Linux/Android use `--wayland`.

A first argument starting with `--` (except the information options below) bypasses detection and is forwarded unchanged
to buninu-browser, which decides how to handle it. There is no frontend allowlist:

```sh
npx flea-qml --casty
npx flea-qml --win32
npx flea-qml --wayland
npx flea-qml --headless
npx flea-qml --help
npx flea-qml --version
npx flea-qml --readme
```

`--help`/`-h`, `--version`/`-V`, and `--readme` run locally without probing Kitty
or starting the browser. `--version` also shows the browser version pinned in
`package.json`. `--readme` always prints coloured ANSI Markdown with
links, including when its output is redirected.

When launched, Flea automatically spawns
[buninu-browser](https://github.com/jjtseng93/buninu-browser) to display its QML
interface. The browser version is pinned in `package.json` under
`scripts.browser`. The launcher reads the package
specification from this field, while still choosing npx, bunx or bun x as below.
Changing this field updates the requested version for all three launch methods;
clearing a cache does not change the pinned version.

To reinstall cached packages from scratch, see [Clearing package caches](#clearing-package-caches).

The browser receives the absolute, URL-escaped `file://` address of the bundled
`ui/boot/shell.qml`, including on Windows. Remaining arguments go to the browser.
Package launch order matches buninu-browser's Casty launcher: npx when both npx
and Bun are on PATH, then bunx, then `bun x` using Bun on PATH or the running Bun.
A missing Kitty response falls back after 800 ms; explicit selection skips the
probe. Wayland requires a running compositor. Other non-Windows platforms also
fall back to Wayland; no native macOS frontend is selected automatically.

The npm package is public and includes the full project, without a `files`
allowlist or project ignore rules (npm's mandatory exclusions still apply).

`FLEA_PATH=/some/folder` opens that folder first; for example, from this
checkout on Linux/Android:

```sh
FLEA_PATH="$PWD/demos" bun index.js
```

For development, you can also launch a browser checkout directly from this
repository root, with a Wayland compositor running:

```sh
bun ../buninu-browser/index.js --quickshell-wayland -p ui/boot/shell.qml
```

## Keyboard shortcuts

These are the implemented bindings for the **default** key preset. Letters are
case-sensitive (`H` means Shift+H). Listing shortcuts apply when the file list
has focus, not while typing in a text field. Other presets can change bindings;
press `?` to view or search the current keymap. A terminal, compositor or browser
frontend may intercept a shortcut before Flea receives it.

### Navigation and views

| Keys | Action |
| --- | --- |
| Up / Down, `k` / `j` | Move through files |
| Home / End, `g` / `G` | First / last file |
| PageUp / PageDown | Move by half the visible rows |
| Left, Backspace, `h` | Parent folder |
| Right, `l` | Enter a folder or preview a file |
| Enter | Open the selected item |
| `H` / `L` | Back / forward in navigation history |
| `:` | Edit the folder address |
| Ctrl+1 / Ctrl+2 / Ctrl+3 / Ctrl+4 | List / columns / grid / dual-pane view |
| `t` | New Flea tab |
| Ctrl+Enter | Open the selected folder in a tab |
| `w`, Ctrl+W | Close the current tab |
| `[` / `]`, Ctrl+PageUp / Ctrl+PageDown | Previous / next tab |
| `{` / `}`, Ctrl+Shift+PageUp / Ctrl+Shift+PageDown | Move the current tab left / right |
| Tab / Shift+Tab | Move focus between available interface areas |
| Ctrl+B | Toggle the sidebar |
| `.`, Ctrl+Shift+. | Show / hide hidden files |
| `s` / `S` | Change sort field / reverse sort order |
| F4 | Fit list columns to their contents |
| F5, Ctrl+R | Reload the folder |
| Ctrl++ / Ctrl+- / Ctrl+0 | Increase / decrease / reset text size (Ctrl+Shift variants also work) |
| `,`, Ctrl+, | Open settings |
| `?` | Open the searchable keymap |

Enter on an ordinary file invokes `xdg-open` from PATH on every platform,
including Windows. Install or provide an `xdg-open` command there; Flea does not
substitute a platform-specific opener. Folders navigate inside Flea and archives
open the built-in preview (except AppImage). Space uses the built-in preview.

### Selection and file operations

| Keys | Action |
| --- | --- |
| `v` | Toggle the current file's selection |
| Shift+Up / Shift+Down, `K` / `J` | Extend the selection |
| Ctrl+A | Select all |
| `V` | Invert the selection |
| `y`, Ctrl+C | Copy selected files |
| `x`, Ctrl+X | Cut selected files |
| `p`, Ctrl+V | Paste files into the current folder |
| `Y` | Copy the current folder's path |
| Ctrl+Shift+C | Copy selected file paths |
| `c` / `P` | Open Copy as / Paste as options |
| `r`, F2 | Rename; multiple selected files open Bulk rename |
| Ctrl+Shift+N | Create a folder |
| Delete, `dd` (press `d` twice) | Move to Trash; in Trash, request permanent deletion |
| Shift+Delete | Request permanent deletion with confirmation |
| `=`, Alt+= | Calculate selected/current folders' sizes / all folders' sizes |
| `m`, Menu, Shift+F10 | Open the item's context menu |

### Find and Filter

| Keys | Action |
| --- | --- |
| `/` | Filter the current listing by name |
| `f`, Ctrl+F | Open Find |
| Ctrl+G | Search file contents; in Find, toggle name/content search |
| Enter in Find | Start the search |
| Tab / Shift+Tab in Find | Cycle the search scope |
| Enter in Filter | Return to the list with the filter applied |
| Up / Down, PageUp / PageDown in a query | Navigate results |
| `o` in results | Reveal the current item in its containing folder |
| Esc in Filter | Close Filter |
| Esc in Find | Stop a running search; when idle, close Find |
| Esc in the file list | Dismiss Filter first, then Find on a subsequent press |

Find and Filter keep their own text-editing focus. Left/Right move the caret;
clicking the query returns focus to its input. When either query owns focus,
Esc acts on that query rather than the other one.

### Preview and Quick Look

| Keys | Action |
| --- | --- |
| Space on a file | Open Quick Look |
| Space / Esc in Quick Look | Close it (Space does not pause media) |
| Alt+P | Toggle the preview column |
| Ctrl+Space | Load the selection's preview |
| Ctrl+Tab | Focus the preview column; from Quick Look, close Quick Look |
| `i` | Toggle file facts in the visible preview column |
| Up / Down, `k` / `j` in Quick Look | Preview the previous / next file |
| PageUp / PageDown, `B` / `F` | Scroll the preview by a page |
| `B` / `F` in the file list | Scroll the preview column by a page |
| `w` in text/code Quick Look | Toggle line wrapping |
| `r` in document Quick Look | Switch between rendered document and source |
| `p` in media Quick Look | Play / pause |
| `m` in media Quick Look | Mute / unmute |
| Left / Right in media Quick Look | Seek backward / forward by 5 seconds |
| Left / Right in PDF preview | Previous / next PDF page |
| `-` / `+` in image, HTML or PDF Quick Look | Zoom out / in |
| `0` in image Quick Look | Fit the image |
| `e` in PDF Quick Look | Toggle expanded view |
| `y` in Compare Quick Look | Copy the diff patch |

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
