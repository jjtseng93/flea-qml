import QtQuick
import qs.Commons
import "." as Flea

// No elision: the spare status-strip width shows the name, horizontal scrolling
// exposes the rest. Share the existing wheel/touch scrolling implementation.
Flickable {
    id: root
    property string name: ""
    contentWidth: Math.max(width, label.implicitWidth)
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
}
