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
mount table, for a folder's filesystem name. The one program it runs is
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
  two Omarchy QML modules the interface imports, `ui/qs/Commons` and
  `ui/qs/Ui`, from
  [`omacom/omarchy@3c7027d`](https://github.com/omacom/omarchy/commit/3c7027db2a4fa9fa6a49d7af7f87c27ac48e677d).

## Layout

| Path | What it is |
| --- | --- |
| `ui/` | The QML interface and its JS libraries |
| `ui/qs/` | Omarchy's `Commons` (theme, colours) and `Ui` (panels, dialogs) modules |
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
`meta`, `code` and `quit`, and `flea --ui-state`, which keeps
`~/.local/state/flea/ui.json` the way upstream does. Other requests and `flea`
modes are not ported yet; the interface reports them as failed, as with an
unreachable backend.
Setting `FLEA_BIN` to upstream's `flea` binary uses it instead, for what is
not ported yet.

## License

MIT, as upstream. See [LICENSE](LICENSE): GM's copyright notice for Flea is
kept, followed by Dr. John's (醫者小智) for this fork.

The tree also carries Omarchy's QML modules, Lucide icon geometry, MathJax,
Pele, and simple-icons and markdown-mark logos, each under its own licence;
see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
