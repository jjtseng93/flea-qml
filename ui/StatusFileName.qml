import QtQuick
import qs.Commons
import "." as Flea

// No elision: the spare status-strip width shows the text (a file name, or the counts zone), horizontal scrolling
// exposes the rest. Share the existing wheel/touch scrolling implementation.
Flickable {
    id: root
    property string name: ""
    // An optional tappable mark after the text, scrolling with it (the counts zone's ⚖️).
    property string tail: ""
    signal tailTapped()
    // The same facts a Text would give, so the strip's own readers (ui/Ipc.qml) treat both alike.
    readonly property string text: root.name
    readonly property bool truncated: false
    readonly property color color: label.color
    readonly property var font: label.font
    implicitWidth: label.implicitWidth + (root.tail.length > 0 ? tailLabel.implicitWidth + spaceMetrics.advanceWidth : 0)
    contentWidth: Math.max(width, root.implicitWidth)
    contentHeight: height
    clip: true
    flickableDirection: Flickable.HorizontalFlick
    boundsBehavior: Flickable.StopAtBounds
    onNameChanged: contentX = 0
    onWidthChanged: contentX = Math.max(0, Math.min(contentX, contentWidth - width))
    Flea.FastScrollHandler { flickable: root }
    Text {
        id: label
        anchors.verticalCenter: parent.verticalCenter
        text: root.name
        color: Theme.color.foreground
        font.family: Theme.font.family
        font.pixelSize: Theme.font.caption
        textFormat: Text.PlainText
    }
    TextMetrics { id: spaceMetrics; font.family: Theme.font.family; font.pixelSize: Theme.font.caption; text: " " }
    Text {
        id: tailLabel
        anchors.verticalCenter: parent.verticalCenter
        x: label.x + label.implicitWidth + spaceMetrics.advanceWidth
        visible: root.tail.length > 0
        text: root.tail
        color: Theme.color.foreground
        font.family: Theme.font.family
        font.pixelSize: Theme.font.caption
        textFormat: Text.PlainText
        HoverHandler { cursorShape: Qt.PointingHandCursor }
        TapHandler { onTapped: root.tailTapped() }
    }
}
