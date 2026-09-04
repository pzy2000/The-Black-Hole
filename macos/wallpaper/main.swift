import AppKit
import ServiceManagement
import WebKit

// 事件视界 · 实况壁纸
// 每块屏幕一个无边框窗口，钉在桌面图标层之下（Plash 同款层级），
// 鼠标穿透，加载打包进包体的 dist 画面（eh:// → Resources/web）。
//
// 显示器休眠/唤醒期间，WKWebView 的 GPU 管线与 WindowServer 重配置
// 相互作用会导致宿主进程内存损坏（macOS 26 上可稳定复现），
// 因此休眠/锁屏/屏保开始前把 WebView 整体摘除，唤醒后再装回并重载。
final class AppDelegate: NSObject, NSApplicationDelegate {
  private var windows: [NSWindow] = []
  private var webviews: [WKWebView] = []
  private var statusItem: NSStatusItem?
  private var loginToggle: NSMenuItem?
  private var observers: [NSObjectProtocol] = []
  private static let startURL = URL(string: "eh://local/index.html?cinema=1")!

  func applicationDidFinishLaunching(_ note: Notification) {
    NSApp.activate(ignoringOtherApps: false)
    buildWindows()
    buildMenu()
    observeLifecycle()
    if ProcessInfo.processInfo.environment["EH_POLL"] != nil {
      startDebugPolling()
    }
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

  /// 睡眠/唤醒/屏保/屏幕变化：摘装 WebView + 触发窗口重建
  private func observeLifecycle() {
    let center = NSWorkspace.shared.notificationCenter
    observers.append(center.addObserver(
      forName: NSWorkspace.willSleepNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.detachWebviews() })
    observers.append(center.addObserver(
      forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.reattachWebviews() })
    observers.append(center.addObserver(
      forName: NSWorkspace.screensDidSleepNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.detachWebviews() })
    observers.append(center.addObserver(
      forName: NSWorkspace.screensDidWakeNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.reattachWebviews() })
    observers.append(NotificationCenter.default.addObserver(
      forName: NSApplication.didChangeScreenParametersNotification,
      object: nil, queue: .main
    ) { [weak self] _ in
      guard let self else { return }
      // 屏幕（数量/位置/分辨率）没变就不折腾，避免休眠唤醒时的重复重建
      if self.windows.count == NSScreen.screens.count,
         zip(self.windows, NSScreen.screens).allSatisfy({ $0.0.frame == $0.1.frame }) {
        self.reattachWebviews()
      } else {
        self.detachWebviews()
        self.rebuild()
      }
    })
  }

  /// 摘除 WebView（脱离窗口层级 + 停止加载），休眠期间不再有 GPU 提交
  private func detachWebviews() {
    for web in webviews {
      web.stopLoading()
      web.removeFromSuperview()
    }
  }

  /// 唤醒后装回并重载画面
  private func reattachWebviews() {
    for (i, win) in windows.enumerated() where i < webviews.count {
      let web = webviews[i]
      if web.superview == nil {
        win.contentView = web
      }
      web.load(URLRequest(url: AppDelegate.startURL))
    }
  }

  private func rebuild() {
    for w in windows { w.orderOut(nil); w.contentView = nil }
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
      web.load(URLRequest(url: AppDelegate.startURL))

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
      win.isReleasedWhenClosed = false
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
