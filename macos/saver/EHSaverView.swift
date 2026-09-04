import ScreenSaver
import SwiftUI
import WebKit

// 事件视界 · 屏幕保护程序
// ScreenSaverView 内嵌 WKWebView，加载包内 dist 画面（?cinema=1 影院模式）。
// startAnimation 时惰性创建并加载，stopAnimation 时释放（避免常驻 GPU/内存）。
// 系统设置的「选项…」按钮 → configureSheet（Wallpaper Engine 风格设置面板，
// 与壁纸 App 共用同一份 settings.json）。
@objc(EHSaverView)
public final class EHSaverView: ScreenSaverView {
  private var web: WKWebView?
  private var lifecycleObservers: [NSObjectProtocol] = []
  private var settingsSheetWindow: NSWindow?

  /// 同一进程多屏实例时只有第一路出声；系统设置预览（isPreview）不出声
  private static var audioMasterAssigned = false
  private let isAudioMaster: Bool

  public override init?(frame: NSRect, isPreview: Bool) {
    isAudioMaster = !isPreview && !EHSaverView.audioMasterAssigned
    super.init(frame: frame, isPreview: isPreview)
    EHSaverView.audioMasterAssigned = true
    commonInit()
  }

  public required init?(coder: NSCoder) {
    isAudioMaster = !EHSaverView.audioMasterAssigned
    super.init(coder: coder)
    EHSaverView.audioMasterAssigned = true
    commonInit()
  }

  private var startURL: URL {
    URL(string: "eh://local/index.html?cinema=1&audio=\(isAudioMaster ? 1 : 0)")!
  }

  private func commonInit() {
    wantsLayer = true
    layer?.backgroundColor = NSColor.black.cgColor
    // 休眠/唤醒期间 WKWebView 的 GPU 管线与 WindowServer 重配置相互作用
    // 会损坏宿主进程（macOS 26 可稳定复现），休眠前摘除、唤醒后重载
    let center = NSWorkspace.shared.notificationCenter
    lifecycleObservers.append(center.addObserver(
      forName: NSWorkspace.screensDidSleepNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.detachWeb() })
    lifecycleObservers.append(center.addObserver(
      forName: NSWorkspace.screensDidWakeNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.ensureWebView() })
  }

  deinit {
    for token in lifecycleObservers {
      NSWorkspace.shared.notificationCenter.removeObserver(token)
    }
  }

  public override func startAnimation() {
    super.startAnimation()
    ensureWebView()
  }

  public override func stopAnimation() {
    super.stopAnimation()
    detachWeb()
  }

  private func detachWeb() {
    web?.stopLoading()
    web?.removeFromSuperview()
    web = nil
  }

  public override func layout() {
    super.layout()
    web?.frame = bounds
  }

  public override func draw(_ rect: NSRect) {
    NSColor.black.setFill()
    rect.fill()
  }

  private func ensureWebView() {
    guard web == nil else { return }
    let cfg = WKWebViewConfiguration()
    cfg.setURLSchemeHandler(EHSchemeHandler(), forURLScheme: "eh")
    cfg.mediaTypesRequiringUserActionForPlayback = [] // BGM 自动播放
    let w = WKWebView(frame: bounds, configuration: cfg)
    w.underPageBackgroundColor = .black
    w.autoresizingMask = [.width, .height]
    addSubview(w)
    web = w
    w.load(URLRequest(url: startURL))
  }

  // MARK: - 设置面板（系统设置「选项…」）

  public override var configureSheet: NSWindow? {
    get {
      if settingsSheetWindow == nil {
        let tracks = EHCineSettings.scanBgms(root: Bundle(for: EHSaverView.self).resourcePath)
        let model = CineSettingsModel(settings: EHCineSettings.load(), tracks: tracks)
        model.onCommit = { [weak self] s in self?.applySettingsLive(s) }
        let win = NSWindow(
          contentRect: NSRect(x: 0, y: 0, width: 460, height: 560),
          styleMask: [.titled, .closable],
          backing: .buffered,
          defer: false
        )
        win.title = "事件视界 · 屏保设置"
        win.contentView = NSHostingView(rootView: CineSettingsView(model: model))
        win.center()
        win.isReleasedWhenClosed = false
        settingsSheetWindow = win
        objc_setAssociatedObject(self, &EHSaverView.settingsModelKey, model, .OBJC_ASSOCIATION_RETAIN)
      }
      return settingsSheetWindow
    }
    set { settingsSheetWindow = newValue }
  }

  private static var settingsModelKey: UInt8 = 0

  /// 设置改动活体下发（画面正在跑时立即生效；下次启动经 __settings.json 自动读取）
  private func applySettingsLive(_ s: EHCineSettings) {
    guard let json = s.jsonString else { return }
    web?.evaluateJavaScript("window.__ehCinema && window.__ehCinema.applySettings(\(json))", completionHandler: nil)
  }

  /// 供自动化测试宿主读取页面运行状态
  @objc public var debugWebView: WKWebView? { web }
}
