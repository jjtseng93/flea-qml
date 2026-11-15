# Third-party notices

flea-qml is MIT licensed; see [LICENSE](LICENSE). It carries the following
work by others, each under its own licence, kept beside it in this tree.

| Component | Where | Licence | Text |
| --- | --- | --- | --- |
| [Flea](https://github.com/thisisgm/flea), GM | `ui/`, `docs/protocol.md`, `src/pele-wrapper.js` wrapper and diagram test fixtures; `src/order.js` ports its name order | MIT | [LICENSE](LICENSE) |
| [Omarchy](https://github.com/omacom/omarchy) `shell/Commons` and `shell/Ui`, David Heinemeier Hansson | `ui/boot/Commons/`, `ui/boot/Ui/` | MIT | [ui/boot/LICENSE-omarchy](ui/boot/LICENSE-omarchy) |
| [Lucide](https://github.com/lucide-icons/lucide) icon geometry, some derived from Feather | `ui/js/Icons.js` | ISC; MIT for the Feather-derived icons | [ui/js/LICENSES/ISC-lucide.txt](ui/js/LICENSES/ISC-lucide.txt) |
| [Pele](https://github.com/obsidianmd/pele) 1.6.0 | `src/vendor/pele.js`, official npm `dist/pele.js`, unchanged (see [source and wrapper notes](docs/pele.md)) | MIT | [src/vendor/LICENSES/MIT-pele.txt](src/vendor/LICENSES/MIT-pele.txt) |
| [Mermaid](https://github.com/mermaid-js/mermaid) documentation examples, via Pele and Flea | `test/fixtures/pele-parity.json` | MIT | [src/vendor/LICENSES/MIT-mermaid.txt](src/vendor/LICENSES/MIT-mermaid.txt) |
| [Temml](https://github.com/ronkok/Temml) 0.14.0, Ron Kok | `src/vendor/temml.mjs`: the npm package's `dist/temml.mjs`, unchanged (SHA-256 `09e55a0c364d35b8ef66be49486b90884240a7e66c463a825e096faf27b0d59d`) | MIT | [src/vendor/LICENSES/MIT-temml.txt](src/vendor/LICENSES/MIT-temml.txt) |
| [mhchem](https://mhchem.github.io/MathJax-mhchem/) 3.3.0 (The MathJax Consortium, Martin Hensel) and Kolen Cheung's MathJax extension, as adapted inside Temml | within `src/vendor/temml.mjs` | Apache-2.0 | [src/vendor/LICENSES/Apache-2.0.txt](src/vendor/LICENSES/Apache-2.0.txt) |
| [Wayland](https://gitlab.freedesktop.org/wayland/wayland) `wayland.xml`, Kristian Høgsberg, Intel Corporation, Collabora | `src/wayland/protocols/` | MIT | inside the file |
| [wayland-protocols](https://gitlab.freedesktop.org/wayland/wayland-protocols) `ext-data-control-v1.xml` and [wlr-protocols](https://gitlab.freedesktop.org/wlroots/wlr-protocols) `wlr-data-control-unstable-v1.xml`, Simon Ser, Ivan Molodetskikh, Neal Gompa | `src/wayland/protocols/` | MIT-style | inside each file |
| [simple-icons](https://github.com/simple-icons/simple-icons) logo geometry | `ui/js/LangMarkPaths.js` | CC0 1.0 | none required |
| [markdown-mark](https://github.com/dcurtis/markdown-mark), Dustin Curtis | the Markdown mark in `ui/js/Icons.js` | CC0 1.0 | none required |

`src/wayland/` adapts buninu-browser's Wayland transport (MIT, Dr. John, as
[LICENSE](LICENSE)); the XML files are unchanged.

The language marks drawn from simple-icons remain their owners' trademarks.
