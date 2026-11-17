# Startup measurements — 2026-11-17

Measured on native Android arm64 through jsgotty, not proot, with Bun
1.4.4-canary.1 (`89452d2ac13773aee8a6d632c4c30074bd1bb4fa`). Viewport:
900 × 600. These are headless measurements, excluding Casty/Kitty presentation.
No hardlinks were used for fixtures or checkouts.

## Changes retained

- Browser `00a864d`: Item visibility inherits hidden ancestors while retaining
  local visibility and descendant layout geometry. Hidden spinners stop ticking.
- Browser `6eab522`: Window frame-signal subscriptions no longer drive an endless
  requestAnimationFrame loop. Scene changes, Canvas paint and explicit update
  still request frames; observers become idle when the scene does.
- Browser `0fe13e6`: nonvisual property animations and FrameAnimation also advance
  Window frame signals, stopping again when the animation stops.
- Flea `e48cfa8`: load the backend only for `--backend`, and Markdown/Temml only
  on the first Markdown request. The `--ui-state` path avoids those imports.
- Flea `7c19c2f`: isolate the Help smoke test's saved state and give its Loader
  the same focus setting as the real boot entry.

## Controlled before/after

One empty file, three independent fresh XDG profiles per revision, browser API
startup followed by a screenshot containing the file name. Baseline browser:
`2055fce`; baseline Flea: `9898f1e`. After: first two browser fixes above.
The later nonvisual-animation correction and lazy backend change were not yet
included in this paired measurement.

| Metric | Before | After |
| --- | --- | --- |
| Complete listing screenshot, runs (ms) | 3478, 3437, 3516 | 3489, 3528, 3477 |
| Median screenshot (ms) | 3478 | 3489 |
| First 500 ms interval without observed process-tree CPU ticks | none within 20 s, all 3 runs | 5.37, 6.68, 8.93 s |
| Process-tree CPU seconds | 20.29, 19.83, 20.26 at 20 s | 11.24, 11.43, 11.85 at first quiet interval |
| Sampled peak process-tree PSS (MiB) | 1399, 1128, 1121 | 1403, 1132, 1419 |

**No first-listing latency or memory reduction is established by this comparison.**
The improvement is that startup work converges to idle. CPU totals use different
observation endpoints; do not interpret them as an equal-duration speedup.
The quiet criterion samples /proc process-tree ticks, not a promise of permanent
zero CPU. PSS was sampled about once a second and is noisy.

A separate two-second renderer probe after visibility inheritance alone observed
86 RAF callbacks and 1.68 CPU seconds. With demand-driven Window signals, after
an eight-second settling wait, it observed zero RAF callbacks and 0.142 CPU
seconds. This is supporting evidence, not a controlled total-startup comparison.

Ten native subprocess launches each: `--ui-state` median 74.2 → 26.8 ms;
backend first listing median 86.8 → 76.4 ms after lazy module loading.
These improvements must not be added directly to whole-window timings.

## Final CLI validation

Three fresh processes and fresh XDG state/config/data/cache per run, including a
cold Bun module cache, with all retained fixes. Each run waits for the three
fixture folder names and icons, then captures a PNG.

| Run | CDP endpoint (ms) | Listing detected (ms) | PNG captured (ms) |
| --- | --- | --- | --- |
| 1 | 305 | 3729 | 3754 |
| 2 | 307 | 3689 | 3707 |
| 3 | 308 | 3780 | 3797 |

Median capture: **3754 ms**. Earlier CLI runs sharing a warm XDG cache had a
3343 ms median; that is not the same cold-start condition or a before baseline.
Polling/queued CDP evaluation and PNG capture are included, so this is an upper
bound for a confirmed complete listing, not an exact display-swap timestamp.

Reproduce from the sibling browser checkout in native Termux:

```sh
bun test/manual-flea-startup.js --flea=../flea-qml --runs=3 --output="$TMPDIR/flea-startup-results"
```

The script creates independent temporary files/directories and isolated profiles,
then cleans its fixtures. Results, logs and PNGs remain in the output directory.
This does not test a million-file directory, media thumbnail throughput, GPU
presentation, or Windows/macOS startup.

## Regression checks

- Browser QML suite: 156 pass, 27 skipped, 1 failure. The Markdown soft-break
  line-height failure in `test/qml-host.test.js` reproduces on untouched
  `2055fce`; it was not introduced by these changes.
- Focused visibility/window/texture/canvas checks: 6 pass.
- Window/animation controls checks: 13 pass, including nonvisual animations.
- Flea targeted tests: 42 pass; new backend first-use/overlapping Markdown
  request integration: 1 pass.
- Actual Help smoke test: shortcut, Places entry, source view, Escape and restored
  list focus pass. Settings smoke test: lazy sections, text wrapping, refreshed
  state and reopening pass.

## Remaining costs and rejected experiment

One detailed trace attributed about 142 ms to the WindowBody dependency graph,
225 ms to compilation, and 1199 ms to initial scripts (which includes component
creation). Renderer initialization and first layout also contribute. Those are
samples, not universal budgets.

A temporary probe found four startup spawns (backend, monospace font query,
state save, mount query); each spawn call itself took about 1 ms. No startup
spawn storm was found. Probe logging was removed.

Lazy creation of synthetic `xxxChanged` getters did not improve a matched CLI
measurement (3343 vs 3349 ms median) and was removed. Avoid retaining extra
Proxy complexity without a measured benefit. Further gains likely require
profiling component construction and renderer initialization, while preserving
local-QML host capabilities separately from untrusted HTML renderers.
