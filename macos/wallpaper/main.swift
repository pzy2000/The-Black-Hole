import AppKit
import ServiceManagement
import WebKit

// 事件视界 · 实况壁纸
// 每块屏幕一个无边框窗口，钉在桌面图标层之下（Plash 同款层级），
// 鼠标穿透，加载打包进包体的 dist 画面（eh:// → Resources/web）。
final class AppDelegate: NSObject, NSApplicationDelegate {
  private var windows: [NSWindow] = []
  private var webviews: [WKWebView] = []
  private var statusItem: NSStatusItem?
  private var loginToggle: NSMenuItem?
  private static let startURL = URL(string: "eh://local/index.html?cinema=1")!

  func applicationDidFinishLaunching(_ note: Notification) {
    NSApp.activate(ignoringOtherApps: false)
    buildWindows()
    buildMenu()
    if ProcessInfo.processInfo.environment["EH_POLL"] != nil {
      startDebugPolling()
    }
    NotificationCenter.default.addObserver(
      forName: NSApplication.didChangeScreenParametersNotification,
      object: nil, queue: .main
    ) { [weak self] _ in self?.rebuild() }
  }

  /// EH_POLL=1 时每 8s 把每块屏的 cinemaStatus 打到统一日志（自动化验收用）
  private func startDebugPolling() {
    var round = 0
    Timer.scheduledTimer(withTimeInterval: 8, repeats: true) { [weak self] _ in
      round += 1
      guard let self else { return }
      for (i, web) in self.webviews.enumerated() {
        web.evaluateJavaScript("JSON.stringify(window.__eh && window.__eh.cinemaStatus)") { obj, err in
          NSLog("[EH] round \(round) screen\(i): \(obj ?? "err: \(err?.localizedDescription ?? "?")")")
        }
      }
    }
  }

  private func rebuild() {
    for w in windows { w.close() }
    windows.removeAll()
    webviews.removeAll()
    buildWindows()
  }

  private func buildWindows() {
    for screen in NSScreen.screens {
      let cfg = WKWebViewConfiguration()
      cfg.setURLSchemeHandler(EHSchemeHandler(), forURLScheme: "eh")
      let web = WKWebView(frame: .zero, configuration: cfg)
      web.underPageBackgroundColor = .black
      web.autoresizingMask = [.width, .height]
      web.load(URLRequest(url: Self.startURL))

      let win = NSWindow(
        contentRect: screen.frame,
        styleMask: [.borderless],
        backing: .buffered,
        defer: false,
        screen: screen
      )
      // 桌面图标层再往下一级：盖住系统壁纸，但不挡图标
      win.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) - 1)
      win.backgroundColor = .black
      win.isOpaque = true
      win.hasShadow = false
      win.ignoresMouseEvents = true
      win.collectionBehavior = [.canJoinAllSpaces, .ignoresCycle, .fullScreenAuxiliary]
      win.contentView = web
      win.orderFrontRegardless()
      windows.append(win)
      webviews.append(web)
    }
  }

  private func buildMenu() {
    let menu = NSMenu()

    let reload = NSMenuItem(title: "重新加载画面", action: #selector(reloadAll), keyEquivalent: "r")
    reload.target = self
    menu.addItem(reload)
    menu.addItem(.separator())

    let login = NSMenuItem(title: "开机自启动", action: #selector(toggleLogin(_:)), keyEquivalent: "")
    login.target = self
    menu.addItem(login)
    loginToggle = login
    syncLoginState()
    menu.addItem(.separator())

    let quit = NSMenuItem(title: "退出事件视界壁纸", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    menu.addItem(quit)

    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    statusItem?.menu = menu
    statusItem?.button?.title = "黑洞"
  }

  private func syncLoginState() {
    let enabled = SMAppService.mainApp.status == .enabled
    loginToggle?.state = enabled ? .on : .off
  }

  @objc private func reloadAll() {
    for web in webviews {
      web.load(URLRequest(url: AppDelegate.startURL))
    }
  }

  @objc private func toggleLogin(_ sender: NSMenuItem) {
    do {
      if sender.state == .on {
        try SMAppService.mainApp.unregister()
      } else {
        try SMAppService.mainApp.register()
      }
    } catch {
      NSLog("[事件视界壁纸] 登录项切换失败: \(error)")
    }
    syncLoginState()
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
