import QtQuick

// A passive HTML page in a sandboxed web view, shared by the previews that can use one: a
// WebEngineView where the runtime has it (buninu-browser's iframe, or Quickshell with Qt
// WebEngine). `available` stays false where it does not, and the host keeps its own view.
Item {
    id: root

    // The whole page to show; empty shows nothing new.
    property string html: ""
    readonly property bool available: viewLoader.status === Loader.Ready
    // An http(s) or mailto link the reader activated, already refused by the view.
    signal linkActivated(string url)

    function show() {
        if (viewLoader.item !== null && root.html !== "")
            viewLoader.item.loadHtml(root.html)
    }
    onHtmlChanged: root.show()

    Loader {
        id: viewLoader
        anchors.fill: parent
        source: "WebPreviewView.qml"
        onLoaded: root.show()
    }

    Connections {
        target: viewLoader.item
        ignoreUnknownSignals: true
        function onLinkActivated(url) { root.linkActivated(url) }
    }
}
