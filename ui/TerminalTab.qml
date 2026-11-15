import QtQuick
import QtWebEngine
import Quickshell
import "." as Flea
import Quickshell.Io
import qs.Commons

// Kept alive while another tab is selected; destroyed only when this tab closes.
Item {
    id: root
    property string directory: ""
    property string sessionId: ""
    readonly property var session: Flea.TerminalService.tabs[sessionId] || ({})
    readonly property string address: session.url || ""
    readonly property string status: session.error || "Starting terminal…"
    property bool selected: false
    function focusTerminal() {
        if (selected && address.length) Qt.callLater(function() {
            if (root.selected && root.address.length) web.forceActiveFocus()
        })
    }
    onSelectedChanged: focusTerminal()
    onAddressChanged: focusTerminal()
    visible: selected
    anchors.fill: parent
    Rectangle { anchors.fill: parent; color: Theme.color.background }
    WebEngineView {
        id: web
        anchors.fill: parent
        visible: root.address.length > 0
        url: root.address
        backgroundColor: Theme.color.background
        settings.javascriptEnabled: true
        onLoadingChanged: function(info) { if(info.errorCode) console.warn("Terminal WebEngineView:", info.errorString) }
    }
    Text {
        anchors.centerIn: parent
        width: Math.max(0, parent.width - 32)
        horizontalAlignment: Text.AlignHCenter
        wrapMode: Text.Wrap
        textFormat: Text.PlainText
        color: Theme.color.foreground
        font.family: Theme.font.family
        font.pixelSize: Theme.font.body
        visible: root.address.length === 0
        text: root.status
    }
}
