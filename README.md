# flea-qml

A fork of [Flea](https://github.com/thisisgm/flea) by GM (thisisgm), the
fast, keyboard-first file manager for Omarchy.

> **Preserve the experience, simplify the implementation, extend the capabilities.**

- **Preserve the experience**: Flea's QML interface, its views, keys, cards,
  previews and wording, carried over as it is.
- **Simplify the implementation**: replace the Rust backend with JavaScript
  that speaks the same line protocol, so the whole program is QML and JS.
- **Extend the capabilities**: run across platforms, on Windows, Linux and
  Android, wherever a QML runtime and a JS engine do, including
  [buninu-browser](https://github.com/jjtseng93/buninu-browser)'s QML
  frontend.

The repository aims to be self-contained, needing only buninu-browser to run.
The backend reads no system database; the one system file it reads is Linux's
mount table, for a folder's filesystem name. For the clipboard it speaks
Wayland data-control itself, loading only libc (kernel32 on Windows) to pass
file descriptors. Without a usable Wayland data-control connection, the QML
frontend uses Quickshell's text clipboard instead (buninu-browser prefers xclip,
then its existing platform fallbacks). Paste reads it on demand, with no polling.
File paths keep their POSIX single-quoted form on every platform, including
Windows; a cut adds `""` at both ends. This is a text representation of the file
selection, not Android's native file clipboard. The one program it runs is
[jsmdcui](https://github.com/jjtseng93/jsmdcui), for syntax colours in previews,
found beside this repository as `../jsmdcui` or on PATH as `jmi` or `jsmdcui`;
without it previews are plain text. Some interface
code carried over from upstream and Omarchy still asks Linux tools such as
`hyprctl`, `lsblk` and `fc-match`, and does without them where they are missing.

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

## Layout

| Path | What it is |
| --- | --- |
| `ui/` | The QML interface and its JS libraries |
| `ui/boot/Commons`, `ui/boot/Ui` | Omarchy's `Commons` (theme, colours) and `Ui` (panels, dialogs) modules, where `import qs.Commons` finds them: Quickshell's `qs` is the folder `shell.qml` sits in |
| `src/flea.js` | The `flea` the interface runs; `--backend` answers `ui/Backend.qml` |
| `src/` (rest) | The backend: listing, ordering, kinds and emoji, filesystem facts |
| `docs/protocol.md` | Upstream's description of the backend line protocol |
| `demos/` | One file for every emoji a row can show |

## Running it

From the repository root, with a Wayland compositor running:

```sh
bunx buninu-browser --quickshell-wayland -p ui/boot/shell.qml
```

`FLEA_PATH=/some/folder` opens that folder first; try `FLEA_PATH="$PWD/demos"`.

This needs a buninu-browser whose QML `TapHandler` understands
`longPressThreshold`, which is newer than 0.9.2. Until that is published, run a
checkout instead: `bun /path/to/buninu-browser/index.js --quickshell-wayland -p ui/boot/shell.qml`.

Ported so far: the backend's `list`, `window`, `sort`, `fsinfo`, `peek`,
`meta`, `code`, `clipSet`, `clipGet`, `clipClear`, `clipWatch`, `collisions`,
`transfer`, `transfercancel`, `trash`, `trashbrowse`, `menuaction` (selection snapshots and permanent-delete confirmation) and `quit`, and `flea --ui-state`, which keeps
`~/.local/state/flea/ui.json` the way upstream does. A transfer copies and moves
files, folders and links and answers keep, skip and refuse; it has no undo yet,
and refuses replace (it needs the Trash), merge and special files. Other requests and `flea`
modes are not ported yet; the interface reports them as failed, as with an
unreachable backend.
Setting `FLEA_BIN` to upstream's `flea` binary uses it instead, for what is
not ported yet.

Archive previews list ZIP, tar, tar.gz/tgz and tar.zst/tzst without loading the
whole archive into memory. Compressed tar member data is streamed and discarded;
metadata records over 1 MiB and malformed or truncated archives are rejected.
Keyboard hints are enabled by default; an explicitly saved disabled setting is
preserved.

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

## Tests

Run `bun test test` for archive bounds, menu identity/transfer lifetime and
clipboard tests. Fixtures are generated in temporary directories and removed
afterward; no compositor is required.

## License

MIT, as upstream. See [LICENSE](LICENSE): GM's copyright notice for Flea is
kept, followed by Dr. John's (醫者小智) for this fork.

The tree also carries Omarchy's QML modules, Lucide icon geometry, MathJax,
Pele, and simple-icons and markdown-mark logos, each under its own licence;
see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
