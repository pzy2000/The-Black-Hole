import ScreenSaver
import WebKit

// 事件视界 · 屏幕保护程序
// ScreenSaverView 内嵌 WKWebView，加载包内 dist 画面（?cinema=1 影院模式）。
// startAnimation 时惰性创建并加载，stopAnimation 时释放（避免常驻 GPU/内存）。
@objc(EHSaverView)
public final class EHSaverView: ScreenSaverView {
  private var web: WKWebView?
  private var lifecycleObservers: [NSObjectProtocol] = []
  private static let startURL = URL(string: "eh://local/index.html?cinema=1")!

  public override init?(frame: NSRect, isPreview: Bool) {
    super.init(frame: frame, isPreview: isPreview)
    commonInit()
  }

  public required init?(coder: NSCoder) {
    super.init(coder: coder)
    commonInit()
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
    let w = WKWebView(frame: bounds, configuration: cfg)
    w.underPageBackgroundColor = .black
    w.autoresizingMask = [.width, .height]
    addSubview(w)
    web = w
    w.load(URLRequest(url: Self.startURL))
  }

  /// 供自动化测试宿主读取页面运行状态
  @objc public var debugWebView: WKWebView? { web }
}
