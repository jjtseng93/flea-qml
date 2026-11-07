import QtQuick
import "js/Filter.js" as Filter
import "js/Focus.js" as Focus

// The filter's query line: the funnel mark, the query with its caret, and the caveat when the pane
// is not holding the whole listing. Presentation only, the way ui/SearchStrip.qml is; ui/Pane.qml
// owns every value it draws and ui/js/Filter.js owns every transition.
//
// It sits below the column header rather than covering it, which is what the search's own strip
// does: the sort mark has to stay readable, because filtering a sorted view keeps that order.
Item {
    id: root

    property var pane: null

    readonly property bool up: !root.pane.trash.opened && (root.pane.filterTyping || root.pane.filterQuery.length > 0)
    readonly property real ruleOpacity: 0.12
    // Twice the hairline, the same weight the cursor row's mark uses, so one caret rule serves both.
    readonly property int caretWidth: Theme.spacing.hairline * 2

    // A chrome strip is not a data row; see Theme.qml's chromeHeight comment. Collapsing rather than
    // only hiding is what keeps the rows starting at the top of the pane when no filter is up.
    implicitHeight: Theme.chromeHeight
    visible: root.up
    height: root.up ? implicitHeight : 0

    // SearchFilter rule 4: the funnel sits on the pane's own ground, where the magnifier sits on the
    // raised chrome, because a filter is about the listing under it and a search is not about here.
    Rectangle {
        anchors.fill: parent
        color: Glass.on ? "transparent" : Theme.color.background
    }

    Rectangle {
        anchors.bottom: parent.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        height: Theme.spacing.hairline
        color: Theme.color.foreground
        opacity: root.ruleOpacity
    }

    Glyph {
        id: mark
        anchors.left: parent.left
        anchors.leftMargin: Theme.spacing.rowPaddingX
        anchors.verticalCenter: parent.verticalCenter
        // The chrome mark token, the size the search strip's own lens is drawn at.
        width: Theme.chromeMarkSize
        height: Theme.chromeMarkSize
        name: "filter"
        color: Theme.color.accent
    }

    // flea-qml: a real text field, as Find's is: the caret moves, blinks and selects, and copy and paste
    // work as in any input. Every edit narrows through Filter.apply, the one writer of the query; the
    // keys that are not editing go to the pane's own route, so Enter still hands the keyboard to the
    // list with the filter standing, and Esc and the arrows behave as before.
    TextInput {
        id: field
        objectName: "filterInput"
        anchors.left: mark.right
        anchors.leftMargin: Theme.spacing.gap
        anchors.verticalCenter: parent.verticalCenter
        width: Math.min(Math.max(contentWidth, Theme.chromeMarkSize) + root.caretWidth * 2, Math.max(0, root.width / 2))
        clip: true
        text: root.pane.filterQuery
        color: Theme.color.foreground
        selectionColor: Theme.color.accent
        selectedTextColor: Theme.color.background
        font.family: Theme.font.family
        font.pixelSize: Theme.font.body
        selectByMouse: true
        onTextEdited: Filter.apply(root.pane, text)
        // A click into the field takes the filter back to typing.
        onActiveFocusChanged: if (activeFocus && !root.pane.filterTyping) root.pane.filterTyping = true
        Keys.onPressed: function (event) {
            switch (event.key) {
            case Qt.Key_Return: case Qt.Key_Enter: case Qt.Key_Escape:
            case Qt.Key_Up: case Qt.Key_Down: case Qt.Key_PageUp: case Qt.Key_PageDown:
                event.accepted = Focus.handleKey(event, root.pane, root.pane.sidebar, "filter")
            }
        }
    }
    // Typing gives the field the keyboard; standing or closing hands it back to the list.
    Connections {
        target: root.pane
        function onFilterTypingChanged() {
            if (root.pane.filterTyping) Qt.callLater(field.forceActiveFocus)
            else if (field.activeFocus && root.pane.listArea) root.pane.listArea.forceActiveFocus()
        }
    }

    // SearchFilter rule 1: the strip owns what it created, so the count and its scope read here and
    // no sentence is left standing in the listing, where it would be a row that is not a file.
    Text {
        id: summaryText
        anchors.left: field.right
        anchors.leftMargin: Theme.spacing.gap
        anchors.right: wayOut.left
        anchors.rightMargin: Theme.spacing.gap
        anchors.verticalCenter: parent.verticalCenter
        elide: Text.ElideRight
        text: Filter.summary(root.pane.shown, root.pane.rows.length, root.pane.total)
        color: Theme.color.muted
        font.family: Theme.font.family
        font.pixelSize: Theme.font.caption
        textFormat: Text.PlainText
    }

    Text {
        id: wayOut
        anchors.right: closeButton.left
        anchors.rightMargin: Theme.spacing.gap
        anchors.verticalCenter: parent.verticalCenter
        text: "esc clears"
        color: Theme.color.muted
        font.family: Theme.font.family
        font.pixelSize: Theme.font.caption
        textFormat: Text.PlainText
    }

    // flea-qml: ✕ clears and closes the filter, what Esc does from the list.
    ChromeButton {
        id: closeButton
        anchors.right: parent.right
        anchors.rightMargin: Theme.spacing.rowPaddingX
        anchors.verticalCenter: parent.verticalCenter
        glyph: "x"
        accessName: "Close filter"
        onActivated: Filter.close(root.pane)
    }
}
