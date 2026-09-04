import AppKit
import ScreenSaver
import WebKit

// 屏保测试宿主：加载 .saver 包，实例化 ScreenSaverView，
// 轮询 __eh.cinemaStatus 验证 WebView 渲染管线端到端可用。
// 用法: EHSaverHarness <path/to/EventHorizon.saver>
// 环境变量:
//   EH_ROUNDS=<n>      轮询轮数（默认 3）
//   EH_EVAL=<js>       第 2 轮前执行一次任意 JS，结果打印为 HARNESS-EVAL
//   EH_WARMUP=<sec>    首轮等待秒数（默认 12）

let args = CommandLine.arguments
let saverPath = args.count > 1 ? args[1] : "macos/build/EventHorizon.saver"
let env = ProcessInfo.processInfo.environment
let warmup = Double(env["EH_WARMUP"] ?? "") ?? 12
let rounds = Int(env["EH_ROUNDS"] ?? "") ?? 3
let evalJS = env["EH_EVAL"]

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
  static var evalDone = false

  static func poll() {
    round += 1
    guard let web else {
      print("HARNESS round \(round): 无 WebView")
      exit(2)
    }
    if !evalDone, let js = evalJS {
      evalDone = true
      web.evaluateJavaScript(js) { obj, err in
        print("HARNESS-EVAL: \(obj ?? "err: \(err?.localizedDescription ?? "?")")")
        Poller.proceed()
      }
      return
    }
    proceed()
  }

  static func proceed() {
    guard let web else { exit(2) }
    web.evaluateJavaScript("JSON.stringify(window.__eh && window.__eh.cinemaStatus)") { obj, err in
      print("HARNESS round \(Poller.round): \(obj ?? "err: \(err?.localizedDescription ?? "?")")")
      fflush(stdout)
      if Poller.round >= rounds { exit(0) }
      DispatchQueue.main.asyncAfter(deadline: .now() + 6) { Poller.poll() }
    }
  }
}

DispatchQueue.main.asyncAfter(deadline: .now() + warmup) {
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
