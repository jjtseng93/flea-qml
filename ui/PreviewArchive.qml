import QtQuick
import qs.Commons
import "." as Flea
import "js/Facts.js" as Facts
import "js/Format.js" as Format
import "js/Archive.js" as Archive

// The Archive tile's frame: the entries the wire carried, as many as the frame has room for, and the
// count it could not name. One row per line box, less the "+ N more" line, which always has to be
// visible: a list that ran past the frame would hide the very number it exists to state.
Item {
    id: root

    // The meta answer for the archive row, or null before one has arrived.
    property var meta: null
    property string path: ""
    property var pane: null
    readonly property bool extractable: pane !== null && /\.(zip|tar|tar\.gz|tgz|tar\.zst|tzst)$/i.test(path) && meta !== null && !meta.archiveFailed

    Flow {
        id: actions
        width: parent.width
        spacing: Theme.spacing.gap
        visible: root.extractable
        Flea.DialogButton {
            label: "Extract to Folder"
            tabStop: true
            onActivated: {
                var base = root.path.substring(0, root.path.lastIndexOf("/") + 1)
                root.pane.backend.extract(root.path, base + Archive.extractDir(root.path.substring(base.length)), 0)
            }
        }
        Flea.DialogButton {
            label: "Extract here"
            tabStop: true
            onActivated: root.pane.extractHereRequested(root.path, root.meta && typeof root.meta.topEntries === "number" ? root.meta.topEntries : -1)
        }
    }

    readonly property real lineHeight: Math.round(Theme.font.caption * Theme.lineBoxRatio)
    readonly property int shown: Math.max(0, Math.floor((height - (actions.visible ? actions.height + Theme.spacing.gap : 0)) / lineHeight) - 1)

    Column {
        anchors.fill: parent
        anchors.topMargin: actions.visible ? actions.height + Theme.spacing.gap : 0
        clip: true
        spacing: 0

        Repeater {
            model: Facts.archiveEntries(root.meta, root.shown)

            delegate: Row {
                required property var modelData
                width: root.width
                height: root.lineHeight
                spacing: Theme.spacing.gap

                Flea.Glyph {
                    anchors.verticalCenter: parent.verticalCenter
                    width: Theme.font.caption
                    height: Theme.font.caption
                    name: modelData.d ? "folder" : "file"
                    color: Theme.color.mutedFrame
                }

                // corner: an archive holds arbitrary names, so PlainText; the row's height, centred, puts the name on the glyph's line.
                Text {
                    height: parent.height
                    verticalAlignment: Text.AlignVCenter
                    text: modelData.n
                    color: Theme.color.muted
                    font.family: Theme.font.family
                    font.pixelSize: Theme.font.caption
                    textFormat: Text.PlainText
                    elide: Text.ElideRight
                }
            }
        }

        Text {
            height: root.lineHeight
            visible: Facts.archiveMore(root.meta, root.shown) > 0
            text: "+ " + Format.count(Facts.archiveMore(root.meta, root.shown)) + " more"
            color: Theme.color.muted
            opacity: 0.6
            font.family: Theme.font.family
            font.pixelSize: Theme.font.caption
            textFormat: Text.PlainText
        }
    }
}
