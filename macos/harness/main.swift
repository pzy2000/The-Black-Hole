import AppKit
import ScreenSaver
import WebKit

// 屏保测试宿主：加载 .saver 包，实例化 ScreenSaverView，
// 轮询 __eh.cinemaStatus 验证 WebView 渲染管线端到端可用。
// 用法: EHSaverHarness <path/to/EventHorizon.saver>

let args = CommandLine.arguments
let saverPath = args.count > 1 ? args[1] : "macos/build/EventHorizon.saver"

let app = NSApplication.shared
app.setActivationPolicy(.regular)

let win = NSWindow(
  contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
  styleMask: [.titled, .closable],
  backing: .buffered,
  defer: false
)
win.title = "事件视界 · 屏保测试宿主"

guard let bundle = Bundle(url: URL(fileURLWithPath: saverPath)) else {
  print("HARNESS: 无法打开 \(saverPath)")
  exit(1)
}
guard bundle.load() else {
  print("HARNESS: bundle.load() 失败")
  exit(1)
}
guard let cls = bundle.principalClass as? ScreenSaverView.Type else {
  print("HARNESS: principalClass 不是 ScreenSaverView 子类")
  exit(1)
}
let frame = win.contentView?.bounds ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
guard let view = cls.init(frame: frame, isPreview: false) else {
  print("HARNESS: ScreenSaverView 初始化失败")
  exit(1)
}
view.autoresizingMask = [.width, .height]
win.contentView?.addSubview(view)
view.startAnimation()
win.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
print("HARNESS: 已启动 \(bundle.bundleIdentifier ?? "?")")

final class Poller: NSObject {
  static var round = 0
  static weak var web: WKWebView?

  static func poll() {
    round += 1
    guard let web else {
      print("HARNESS round \(round): 无 WebView")
      exit(2)
    }
    web.evaluateJavaScript("JSON.stringify(window.__eh && window.__eh.cinemaStatus)") { obj, err in
      print("HARNESS round \(Poller.round): \(obj ?? "err: \(err?.localizedDescription ?? "?")")")
      if Poller.round >= 3 { exit(0) }
      DispatchQueue.main.asyncAfter(deadline: .now() + 6) { Poller.poll() }
    }
  }
}

DispatchQueue.main.asyncAfter(deadline: .now() + 12) {
  let sel = Selector(("debugWebView"))
  guard view.responds(to: sel), let boxed = view.perform(sel),
        let web = boxed.takeUnretainedValue() as? WKWebView else {
    print("HARNESS: debugWebView 不可用")
    exit(2)
  }
  Poller.web = web
  Poller.poll()
}

app.run()
