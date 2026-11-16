import QtQuick
import QtWebEngine

// The web view WebPreview loads, and the only file that imports QtWebEngine: where the module
// is missing this file fails to load and WebPreview reports itself unavailable. The page comes
// from loadHtml, already rebuilt from an allowlist (src/markdown-html.js); this view adds no
// script, no plugin, no window and no reach from that local page to remote or file URLs.
WebEngineView {
    id: view

    // An activated link, refused here so the view keeps its page; the host decides what opens it.
    signal linkActivated(string url)

    settings.javascriptEnabled: false
    settings.javascriptCanOpenWindows: false
    settings.pluginsEnabled: false
    settings.localContentCanAccessRemoteUrls: false
    settings.localContentCanAccessFileUrls: false

    // loadHtml uses about:blank in Qt and about:srcdoc in buninu-browser.
    function isDocumentFragment(target) {
        var link = String(target)
        if (link.charAt(0) === "#") return true
        var hash = link.indexOf("#")
        if (hash < 0) return false
        var base = link.slice(0, hash)
        var current = String(view.url).split("#")[0]
        return current !== "" ? base === current
            : base === "about:srcdoc" || base === "about:blank"
    }

    onNavigationRequested: function (request) {
        if (request.navigationType !== WebEngineNavigationRequest.LinkClickedNavigation)
            return
        if (view.isDocumentFragment(request.url)) return
        request.reject()
        view.linkActivated(String(request.url))
    }
}
