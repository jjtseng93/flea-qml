import QtQuick
import qs.Commons
Item {
    id: root
    property var trash: null
    Repeater {
        model: [{label:"Restore",action:"restoreTrashSelection"},{label:"Restore all",action:"restoreAll"},{label:"Empty Trash",action:"emptyTrash"}]
        delegate: Rectangle {
            required property var modelData
            required property int index
            x: index * (width + Theme.spacing.gap)
            height: root.height
            width: Math.min(Math.max(110, Theme.font.body * 8), (root.width - 2*Theme.spacing.gap)/3)
            color: Theme.color.surface
            Text { anchors.centerIn:parent; text:modelData.label; color:Theme.color.foreground; font {family:Theme.font.family;pixelSize:Theme.font.body} }
            MouseArea { anchors.fill:parent; onClicked:if(root.trash)root.trash.action(modelData.action) }
        }
    }
}
