import QtQuick
import "." as Flea

// Dynamic objects preserve each iframe/PTY when tab order or selection changes.
Item {
    id: root
    property var pane: null
    property var sessions: ({})
    function open(directory) {
        var component = Qt.createComponent("TerminalTab.qml")
        if (component.status !== Component.Ready) {
            pane.message(component.errorString(), true)
            return ""
        }
        var key = Flea.TerminalService.acquire(directory)
        var item = component.createObject(root, { directory: directory, sessionId: key })
        if (!item) { Flea.TerminalService.release(key); pane.message("Could not create the terminal view.", true); return "" }
        item.selected = Qt.binding(function() { return root.pane.terminalId === key })
        sessions[key] = item
        return key
    }
    Component.onDestruction: { for (var key in sessions) Flea.TerminalService.release(key) }
    function close(key) {
        var item = sessions[key]
        if (item) { Flea.TerminalService.release(key); delete sessions[key]; item.destroy() }
    }
}
