.pragma library

// flea-qml: the command that runs this repository's own `flea`, so the interface never looks for a
// `flea` on PATH and never relies on a script's shebang. `shellDir` is Quickshell.shellDir, ui/boot,
// so src/flea.js sits two levels up. `bun` is buninu-browser's BUNINU_BUN, the Bun it found with
// Bun.which("bun") || process.argv0. A non-empty FLEA_BIN still names another executable,
// upstream's binary included.
function command(fleaBin, bun, shellDir, args) {
    if (fleaBin)
        return [String(fleaBin)].concat(args)
    return [String(bun || "bun"), String(shellDir) + "/../../src/flea.js"].concat(args)
}
