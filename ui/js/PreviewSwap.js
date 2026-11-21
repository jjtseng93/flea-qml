.pragma library

.import "Swap.js" as Swap

// ui/PreviewPdf.qml opens a document only this long after its path settles (issue 117).
var DOCUMENT_SETTLE_MS = 120

function capMs(isPdf) {
    return Swap.CAP_MS
}

// Quick Look is ready when nothing loads, a PDF shows a page or is refused, or the interim or a Markdown head shows whole.
function lookReady(status, isPdf, pdfShown, pdfFailed, interimShown, headShown) {
    if (interimShown === true || headShown === true)
        return true
    if (status === "loading")
        return false
    return isPdf !== true || pdfShown === true || pdfFailed === true
}

// Sample input: interimRect(754, 471, 6000, 4000, 1) is 706.5x471 at 24,0; upright aspect-fit, never enlarged, unknown is null.
function interimRect(surfaceW, surfaceH, imageW, imageH, orient) {
    if (!(imageW > 0) || !(imageH > 0))
        return null
    var ow = orient >= 5 ? imageH : imageW
    var oh = orient >= 5 ? imageW : imageH
    var s = Math.min(1, surfaceW / ow, surfaceH / oh)
    var w = ow * s, h = oh * s
    return { x: Math.round((surfaceW - w) / 2), y: Math.round((surfaceH - h) / 2), w: w, h: h }
}
