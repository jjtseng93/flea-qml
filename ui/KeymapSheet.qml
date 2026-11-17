import QtQuick
import Quickshell
import Quickshell.Io
import "js/HelpDocument.js" as HelpDocument

// A lazy README reader, not a second help UI. Quick Look owns the whole overlay.
Item {
    id: root
    visible: false
    property bool opened: false
    property Item focusHolder: null
    readonly property var pane: root.focusHolder ? (root.focusHolder.sheetPane || root.focusHolder) : null
    readonly property string readmePath: String(Quickshell.shellDir).replace(/[\\/]+$/, "") + "/../../README.md"
    function open(holder) {
        root.focusHolder = holder
        root.opened = true
        if (readme.path === root.readmePath) readme.reload()
        else readme.path = root.readmePath
    }
    function close() { root.opened = false }
    function failed(message) {
        if (root.pane) root.pane.message(message, true)
        root.close()
    }
    FileView {
        id: readme
        printErrors: false
        onLoaded: {
            if (!root.opened || !root.pane) return
            try {
                var source = HelpDocument.extract(readme.text())
                root.pane.quickLook().openMarkdown(root.readmePath, source)
                root.close()
            } catch (error) { root.failed(String(error)) }
        }
        onLoadFailed: if (root.opened) root.failed("Could not read README.md / 無法讀取使用方法")
    }
}
