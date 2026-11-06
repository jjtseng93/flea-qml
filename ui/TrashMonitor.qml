import QtQuick

// flea-qml: the shared Trash count, as the pane's backend reports it with a `trashcount` line at
// start and on every change. The backend reads the FreeDesktop.org Trash that src/trash.js writes;
// upstream ran `gio monitor` and `gio info` under setpriv and sh here. Nothing extra runs: the
// backend already lives as long as the interface.
Item {
    id: root
    // Not named enabled, which would shadow Item's own input switch.
    property bool watching: true
    property var backend: null
    readonly property int reported: root.backend ? root.backend.trashCount : -1
    readonly property int revision: root.backend ? root.backend.trashRevision : 0
    property int count: 0
    property bool ready: false
    signal changed()
    signal failed(string message)

    // The backend reports every change itself, so there is nothing to ask for again.
    function refresh() {}

    onRevisionChanged: if (root.watching && root.ready) root.changed()
    onReportedChanged: {
        if (!root.watching || root.reported < 0) return
        root.count = root.reported
        root.ready = true
    }
    onWatchingChanged: if (root.watching && root.reported >= 0) { root.count = root.reported; root.ready = true }
    Component.onCompleted: if (root.reported >= 0) { root.count = root.reported; root.ready = true }
}
