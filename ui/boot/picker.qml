// Its own app id, so one Hyprland rule can give the chooser the floating treatment Omarchy already
// gives xdg-desktop-portal-gtk without touching the window; flea --picker writes that rule.
//@ pragma AppId com.thisisgm.flea.picker
//@ pragma ShellId fleapicker
//@ pragma NativeTextRendering
//@ pragma CacheDir $BASE/flea

import Quickshell
import QtQuick

// A file: URL away for the reason ui/boot/shell.qml gives, but its window stays whole: the chooser
// is not on the measured path and its size comes from the Theme. See AGENTS.md "The first window".
ShellRoot {
    id: root

    function fileUrl(path) {
        path = String(path)
        // Only Windows paths use backslashes as separators; POSIX filenames may contain them.
        var drive = /^[A-Za-z]:[\\/]/.test(path)
        var unc = /^\\\\[^\\]/.test(path)
        if (drive || unc) path = path.replace(/\\/g, "/")
        // File paths collapse repeated separators before URL dot-segment resolution.
        path = (path.indexOf("//") === 0 ? "//" : "") + path.replace(/^\/\//, "").replace(/\/+/g, "/")
        var parts = path.split("/")
        for (var i = 0; i < parts.length; i++) {
            if (!(drive && i === 0)) parts[i] = encodeURIComponent(parts[i])
        }
        return (drive ? "file:///" : path.indexOf("//") === 0 ? "file:" : "file://") + parts.join("/")
    }

    LazyLoader {
        id: chooser
        active: true
        // This directory cannot import ui/js/Format.js through qs:, so the one call is written out.
        source: root.fileUrl(Quickshell.shellDir + "/../PickerWindow.qml")
    }

    // Well past the 1.7 to 3.0 s the first launch after an update spends writing Qt's cache.
    readonly property int windowBackstopMs: 6000

    // LazyLoader carries neither a status nor a usable loading edge, so no window by this point is
    // a load that failed, and silence would leave tools/flea-portal's caller waiting out its 600 s.
    Timer {
        interval: root.windowBackstopMs
        repeat: false
        running: true
        onTriggered: {
            if (!chooser.item) {
                console.warn("flea: the chooser window did not load, so there is nothing to show")
                Quickshell.execDetached(["kill", String(Quickshell.processId)])
            }
        }
    }
}
