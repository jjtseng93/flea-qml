import Quickshell
import Quickshell.Io
import QtQuick

// Open files through xdg-open on PATH on every platform, including Windows.
Item {
    id: root

    signal failed(string path)
    signal terminalFailed(string path)
    // Raised where the two single-flight guards below drop a request, so a swallowed press says so.
    signal busy(string path)
    signal terminalBusy(string path)
    property string current: ""
    // The terminal launch's own path: open() and openTerminal() run on separate
    // Processes guarded only against themselves, so sharing current let whichever
    // started second rewrite the path the first one's onExited still reports.
    property string terminalCurrent: ""
    // One open at a time until xdg-open exits.
    property bool pending: false
    property int openSerial: 0

    function open(path) {
        if (child.running || root.pending) {
            root.busy(path)
            return
        }
        root.current = path
        root.pending = true
        root.openSerial++
        child.command = ["xdg-open", path]
        child.running = true
    }

    Process {
        id: child
        // xdg-open's nonzero exit codes are failures, not Flea's private statuses.
        onExited: function (exitCode, exitStatus) {
            root.pending = false
            if (exitCode !== 0 || exitStatus !== 0)
                root.failed(root.current)
        }
        // A program that never started reports no exit, only running turning false.
        onRunningChanged: {
            if (child.running || !root.pending)
                return
            // running may change before onExited. Let that signal settle first;
            // a deferred failure must not apply to a later open request.
            var serial = root.openSerial
            Qt.callLater(function () {
                if (root.pending && !child.running && root.openSerial === serial) {
                    root.pending = false
                    root.failed(root.current)
                }
            })
        }
    }

    // A terminal in the current directory, through flea --terminal so the huge page,
    // process-group and stdio guards in src/terminal.rs apply. Its own Process, so a terminal
    // launch and a file open in flight cannot take each other's exit status.
    function openTerminal(path) {
        if (terminalChild.running) {
            root.terminalBusy(path)
            return
        }
        root.terminalCurrent = path
        terminalChild.command = [Quickshell.env("FLEA_BIN") || "flea", "--terminal", path]
        terminalChild.running = true
    }

    Process {
        id: terminalChild

        onExited: function (exitCode, exitStatus) {
            if (exitCode === 0) {
                return
            }
            root.terminalFailed(root.terminalCurrent)
        }
    }

    // The system clipboard, for the listing menu's Copy Path row; flea's own copy clipboard
    // (Ops.clip) is a different thing and must stay a different thing.
    // flea-qml: Copy as is plain text, so it goes through Quickshell's own clipboard rather than wl-copy.
    function copyText(text) {
        Quickshell.clipboardText = text
    }

}
