import AppKit
import ServiceManagement
import SwiftUI
import WebKit

// 事件视界 · 实况壁纸
// 每块屏幕一个无边框窗口，钉在桌面图标层之下（Plash 同款层级），
// 鼠标穿透，加载打包进包体的 dist 画面（eh:// → Resources/web）。
//
// Wallpaper Engine 风格：菜单栏「设置…」可调画质 / 最大帧率 / 失焦行为 / BGM；
// 失焦（被其他进程的全屏窗口遮挡、屏保开始）时按设置执行
// 暂停渲染 / 停止并释放内存 / 静音 / 继续运行，逐屏独立生效。
//
// 显示器休眠/唤醒期间，WKWebView 的 GPU 管线与 WindowServer 重配置
// 相互作用会导致宿主进程内存损坏（macOS 26 上可稳定复现），
// 因此休眠/锁屏/屏保开始前把 WebView 整体摘除，唤醒后再装回并重载。
final class AppDelegate: NSObject, NSApplicationDelegate {
  private var windows: [NSWindow] = []
  private var webviews: [WKWebView?] = [] // 每屏一路；「停止」策略释放后置 nil
  private var statusItem: NSStatusItem?
  private var loginToggle: NSMenuItem?
  private var observers: [NSObjectProtocol] = []
  private var settingsWindow: NSWindow?

  private var cineSettings = EHCineSettings.load()

  // —— 失焦监测（逐屏） ——
  private var focusTimer: Timer?
  private var occludedPerScreen: [Bool] = []
  private var appliedActionPerScreen: [String?] = [] // nil=尚未应用；"visible"/pause/stop/mute
  private var sleeping = false // 休眠/屏幕睡眠期间冻结策略，由唤醒路径统一恢复
  private var simulatedOcclusion: [Bool]? // EH_TEST_FOCUS 自动化注入

  func applicationDidFinishLaunching(_ note: Notification) {
    NSApp.activate(ignoringOtherApps: false)
    buildWindows()
    buildMenu()
    observeLifecycle()
    applyFocusPolicy(force: true)
    startFocusMonitor()
    startTestHooks()
  }

  // MARK: - WebView 构建/释放（逐屏）

  private func startURL(index: Int) -> URL {
    var s = "eh://local/index.html?cinema=1&audio=\(index == 0 ? 1 : 0)"
    // 页面加载完成前就已失焦时，把初始态随 URL 下发（避免活体命令早于页面就绪而丢失）
    if appliedActionPerScreen.indices.contains(index) {
      if appliedActionPerScreen[index] == "pause" { s += "&paused=1" }
      if appliedActionPerScreen[index] == "mute" { s += "&muted=1" }
    }
    return URL(string: s)!
  }

  private func makeWebview(index: Int) -> WKWebView {
    let cfg = WKWebViewConfiguration()
    cfg.setURLSchemeHandler(EHSchemeHandler(), forURLScheme: "eh")
    cfg.mediaTypesRequiringUserActionForPlayback = [] // 壁纸 BGM 自动播放
    let web = WKWebView(frame: .zero, configuration: cfg)
    web.underPageBackgroundColor = .black
    web.autoresizingMask = [.width, .height]
    web.load(URLRequest(url: startURL(index: index)))
    return web
  }

  /// 该屏 WebView 不存在时重建（窗口保持黑底）
  private func ensureWebview(at index: Int) {
    guard index < webviews.count, webviews[index] == nil, index < windows.count else { return }
    let web = makeWebview(index: index)
    webviews[index] = web
    windows[index].contentView = web
  }

  /// 「停止」策略：彻底释放该屏 WebView（最后强引用消失 → 内存还给系统）
  private func releaseWebview(at index: Int, reason: String) {
    guard index < webviews.count, let web = webviews[index] else { return }
    let before = Self.memoryFootprintMB()
    web.stopLoading()
    if index < windows.count { windows[index].contentView = nil }
    webviews[index] = nil
    NSLog(
      "[EH] screen\(index) 已停止并释放 WebView（\(reason)，footprint \(String(format: "%.0f", before)) → \(String(format: "%.0f", Self.memoryFootprintMB())) MB）"
    )
  }

  private func buildWindows() {
    for (i, screen) in NSScreen.screens.enumerated() {
      let web = makeWebview(index: i)
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
    occludedPerScreen = computeOcclusion()
    appliedActionPerScreen = Array(repeating: nil, count: webviews.count)
  }

  private func rebuild() {
    for w in windows { w.orderOut(nil); w.contentView = nil }
    windows.removeAll()
    webviews.removeAll()
    buildWindows()
  }

  // MARK: - 失焦策略（Wallpaper Engine 风格，逐屏）

  private func startFocusMonitor() {
    guard focusTimer == nil else { return }
    focusTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
      self?.pollFocus()
    }
  }

  private func pollFocus() {
    let occ = computeOcclusion()
    guard occ != occludedPerScreen else { return }
    occludedPerScreen = occ
    applyFocusPolicy()
  }

  /// 每块屏是否被其他进程的普通层（layer 0）窗口基本完全覆盖
  /// （全屏应用 / 系统屏保 / 锁屏窗口都满足），本进程自身窗口除外。
  private func computeOcclusion() -> [Bool] {
    let screens = NSScreen.screens
    if let sim = simulatedOcclusion { return sim }
    var result = Array(repeating: false, count: max(screens.count, 1))
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else {
      return result
    }
    let myPid = ProcessInfo.processInfo.processIdentifier
    let primaryMaxY = screens.first?.frame.maxY ?? 0
    var coverers: [CGRect] = []
    for w in list {
      guard let pid = w[kCGWindowOwnerPID as String] as? Int, pid != myPid,
            (w[kCGWindowLayer as String] as? Int) == 0,
            let bounds = w[kCGWindowBounds as String] as? NSDictionary,
            let cgRect = CGRect(dictionaryRepresentation: bounds as CFDictionary)
      else { continue }
      // CG 全局坐标（左上原点）→ NS 全局坐标（左下原点）
      coverers.append(CGRect(x: cgRect.minX, y: primaryMaxY - cgRect.maxY, width: cgRect.width, height: cgRect.height))
    }
    for (i, screen) in screens.enumerated() where i < result.count {
      let area = screen.frame.width * screen.frame.height
      result[i] = coverers.contains { c in
        let inter = c.intersection(screen.frame)
        return inter.width * inter.height >= area * 0.98
      }
    }
    return result
  }

  private func applyFocusPolicy(force: Bool = false) {
    guard !sleeping else { return }
    if occludedPerScreen.count != webviews.count { occludedPerScreen = computeOcclusion() }
    while appliedActionPerScreen.count < webviews.count { appliedActionPerScreen.append(nil) }
    for i in 0..<webviews.count {
      let action = occludedPerScreen.indices.contains(i) && occludedPerScreen[i] ? cineSettings.focusAction : "visible"
      if !force, appliedActionPerScreen[i] == action { continue }
      appliedActionPerScreen[i] = action
      switch action {
      case "pause":
        ensureWebview(at: i)
        postCommand("pause()", to: i)
      case "stop":
        releaseWebview(at: i, reason: "失焦")
      case "mute":
        ensureWebview(at: i)
        postCommand("setMuted(true)", to: i)
      default: // visible
        ensureWebview(at: i)
        postCommand("resume()", to: i)
        postCommand("setMuted(false)", to: i)
      }
      NSLog("[EH] screen\(i) 失焦策略 → \(action)")
    }
  }

  /// 下发 `window.__ehCinema.<js>`（页面未就绪时静默；初始态已随 URL 参数覆盖）
  private func postCommand(_ js: String, to index: Int) {
    guard index < webviews.count, let web = webviews[index] else { return }
    web.evaluateJavaScript("window.__ehCinema && window.__ehCinema.\(js)", completionHandler: nil)
  }

  /// 设置窗口改动后活体下发全部 WebView，并立即对齐失焦策略
  private func applySettingsLive(_ s: EHCineSettings) {
    cineSettings = s
    guard let json = s.jsonString else { return }
    for web in webviews.compactMap({ $0 }) {
      web.evaluateJavaScript("window.__ehCinema && window.__ehCinema.applySettings(\(json))", completionHandler: nil)
    }
    occludedPerScreen = computeOcclusion()
    applyFocusPolicy(force: true)
  }

  // MARK: - 休眠/唤醒/屏保/屏幕变化

  /// 睡眠/唤醒/屏保/屏幕变化：摘装 WebView + 触发窗口重建
  private func observeLifecycle() {
    let center = NSWorkspace.shared.notificationCenter
    observers.append(center.addObserver(
      forName: NSWorkspace.willSleepNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.enterSleep() })
    observers.append(center.addObserver(
      forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.wakeUp() })
    observers.append(center.addObserver(
      forName: NSWorkspace.screensDidSleepNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.enterSleep() })
    observers.append(center.addObserver(
      forName: NSWorkspace.screensDidWakeNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.wakeUp() })
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
        self.enterSleep()
        self.rebuild()
        self.sleeping = false
      }
      self.applyFocusPolicy(force: true)
    })
  }

  private func enterSleep() {
    sleeping = true
    detachWebviews()
  }

  private func wakeUp() {
    sleeping = false
    reattachWebviews()
    applyFocusPolicy(force: true)
  }

  /// 摘除 WebView（脱离窗口层级 + 停止加载），休眠期间不再有 GPU 提交。
  /// 保留引用，唤醒后原样装回（与「停止」策略的彻底释放不同）。
  private func detachWebviews() {
    for web in webviews.compactMap({ $0 }) {
      web.stopLoading()
      web.removeFromSuperview()
    }
  }

  /// 唤醒后装回并重载画面
  private func reattachWebviews() {
    for (i, win) in windows.enumerated() where i < webviews.count {
      guard let web = webviews[i] else { continue }
      if web.superview == nil {
        win.contentView = web
      }
      web.load(URLRequest(url: web.url ?? startURL(index: i)))
    }
  }

  // MARK: - 菜单栏

  private func buildMenu() {
    let menu = NSMenu()

    let settings = NSMenuItem(title: "设置…", action: #selector(openSettings), keyEquivalent: ",")
    settings.target = self
    menu.addItem(settings)
    menu.addItem(.separator())

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

  @objc private func openSettings() {
    if settingsWindow == nil {
      let tracks = EHCineSettings.scanBgms(root: Bundle.main.resourcePath)
      let model = CineSettingsModel(settings: cineSettings, tracks: tracks)
      model.onCommit = { [weak self] s in self?.applySettingsLive(s) }
      let win = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 460, height: 560),
        styleMask: [.titled, .closable],
        backing: .buffered,
        defer: false
      )
      win.title = "事件视界 · 壁纸设置"
      win.contentView = NSHostingView(rootView: CineSettingsView(model: model))
      win.center()
      win.isReleasedWhenClosed = false
      settingsWindow = win
      objc_setAssociatedObject(self, &AppDelegate.settingsModelKey, model, .OBJC_ASSOCIATION_RETAIN)
    }
    NSApp.activate(ignoringOtherApps: true)
    settingsWindow?.makeKeyAndOrderFront(nil)
  }

  private static var settingsModelKey: UInt8 = 0

  private func syncLoginState() {
    let enabled = SMAppService.mainApp.status == .enabled
    loginToggle?.state = enabled ? .on : .off
  }

  @objc private func reloadAll() {
    for i in 0..<webviews.count {
      ensureWebview(at: i)
      webviews[i]?.load(URLRequest(url: startURL(index: i)))
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

  // MARK: - 自动化验收钩子（EH_* 环境变量）

  private func startTestHooks() {
    let env = ProcessInfo.processInfo.environment
    // 每 8s 打每屏 cinemaStatus + 进程内存 footprint（uniform log，`log show` 抓取）
    if env["EH_POLL"] != nil {
      var round = 0
      Timer.scheduledTimer(withTimeInterval: 8, repeats: true) { [weak self] _ in
        round += 1
        guard let self else { return }
        let foot = String(format: "%.0f", Self.memoryFootprintMB())
        let occ = self.occludedPerScreen.map { $0 ? "1" : "0" }.joined(separator: ",")
        for (i, slot) in self.webviews.enumerated() {
          guard let web = slot else {
            NSLog("[EH] round \(round) screen\(i): released occlusion=\(occ) foot=\(foot)MB")
            continue
          }
          web.evaluateJavaScript("JSON.stringify(window.__eh && window.__eh.cinemaStatus)") { obj, err in
            NSLog("[EH] round \(round) screen\(i) occlusion=\(occ) foot=\(foot)MB: \(obj ?? "err: \(err?.localizedDescription ?? "?")")")
          }
        }
      }
    }
    // 注入"全部屏幕被遮挡"→ 6s 后遮挡、16s 后解除，走真实策略引擎
    if env["EH_TEST_FOCUS"] == "1" {
      DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self] in
        guard let self else { return }
        NSLog("[EH][TEST] 注入遮挡 → 策略应为 \(self.cineSettings.focusAction)")
        self.simulatedOcclusion = Array(repeating: true, count: max(NSScreen.screens.count, 1))
        self.occludedPerScreen = self.simulatedOcclusion!
        self.applyFocusPolicy(force: true)
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 16) { [weak self] in
        guard let self else { return }
        NSLog("[EH][TEST] 解除遮挡")
        self.simulatedOcclusion = nil
        // 测试确定性：直接视为全部可见，不依赖真实桌面窗口状态
        self.occludedPerScreen = Array(repeating: false, count: max(NSScreen.screens.count, 1))
        self.applyFocusPolicy(force: true)
      }
    }
    // 到时自动退出
    if let qs = env["EH_QUIT_AFTER"], let secs = Double(qs) {
      DispatchQueue.main.asyncAfter(deadline: .now() + secs) {
        NSLog("[EH][TEST] EH_QUIT_AFTER 到时退出")
        NSApp.terminate(nil)
      }
    }
  }

  private static func memoryFootprintMB() -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
    let kr = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
      }
    }
    guard kr == KERN_SUCCESS else { return -1 }
    return Double(info.phys_footprint) / 1_048_576
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
