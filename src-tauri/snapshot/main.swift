// sienna-snapshot: renders an artifact's page and prints a PNG of it (base64)
// so the model that made it can look at its own work and correct it.
//
// The page comes on stdin and runs in an offscreen WebKit view with its own
// strict policy, as in the panel: inline code and cdnjs only, no network
// requests, nothing stored (a non-persistent data store), no file access.
// Arguments: width height full(0/1).

import AppKit
import WebKit

let maxHeight: CGFloat = 4000
let policy = "default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; "
    + "style-src 'unsafe-inline' https://cdnjs.cloudflare.com; img-src data: blob: https://cdnjs.cloudflare.com; "
    + "font-src data: https://cdnjs.cloudflare.com; media-src data: blob:; connect-src 'none'; frame-src 'none'; "
    + "worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let arguments = CommandLine.arguments
guard arguments.count == 4,
      let width = Double(arguments[1]), let height = Double(arguments[2]),
      (200...2400).contains(width), (200...2400).contains(height) else { fail("usage: width height full") }
let full = arguments[3] == "1"
let input = FileHandle.standardInput.readDataToEndOfFile()
guard input.count <= 2_000_000, var page = String(data: input, encoding: .utf8) else { fail("page") }
// An offscreen view does not run animations: everything shows its end state.
let still = "<style>*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;"
    + "animation-iteration-count:1!important;transition:none!important}</style>"
page = "<meta http-equiv=\"Content-Security-Policy\" content=\"\(policy)\">" + still + page

final class Shooter: NSObject, WKNavigationDelegate {
    let view: WKWebView
    let window: NSWindow

    init(size: NSSize) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        view = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: config)
        // Off screen and never shown; the view needs a window to draw.
        window = NSWindow(contentRect: NSRect(x: -30000, y: -30000, width: size.width, height: size.height),
                          styleMask: .borderless, backing: .buffered, defer: false)
        super.init()
        window.contentView = view
        window.orderBack(nil)
        view.navigationDelegate = self
    }

    // Only the page itself loads; a link or redirect goes nowhere.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(action.request.url?.scheme == "about" ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Scripts and web fonts get a moment to settle.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { self.measure() }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail("load") }

    func measure() {
        guard full else { return shoot() }
        view.evaluateJavaScript("Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)") { value, _ in
            let tall = min(maxHeight, max(self.view.frame.height, CGFloat((value as? NSNumber)?.doubleValue ?? 0)))
            self.view.setFrameSize(NSSize(width: self.view.frame.width, height: tall))
            self.window.setContentSize(self.view.frame.size)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.shoot() }
        }
    }

    func shoot() {
        let config = WKSnapshotConfiguration()
        // One pixel per point keeps the image small for the model.
        let scale = window.backingScaleFactor > 0 ? window.backingScaleFactor : 1
        config.snapshotWidth = NSNumber(value: Double(view.frame.width / scale))
        view.takeSnapshot(with: config) { image, _ in
            guard let image, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                  let png = bitmap.representation(using: .png, properties: [:]) else { fail("snapshot") }
            FileHandle.standardOutput.write(Data(png.base64EncodedString().utf8))
            exit(0)
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let shooter = Shooter(size: NSSize(width: width, height: height))
shooter.view.loadHTMLString(page, baseURL: URL(string: "about:blank"))
DispatchQueue.main.asyncAfter(deadline: .now() + 20) { fail("timeout") }
app.run()
