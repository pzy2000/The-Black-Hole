import ScreenSaver
import WebKit

// 事件视界 · 屏幕保护程序
// ScreenSaverView 内嵌 WKWebView，加载包内 dist 画面（?cinema=1 影院模式）。
// startAnimation 时惰性创建并加载，stopAnimation 时释放（避免常驻 GPU/内存）。
@objc(EHSaverView)
public final class EHSaverView: ScreenSaverView {
  private var web: WKWebView?
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
  }

  public override func startAnimation() {
    super.startAnimation()
    ensureWebView()
  }

  public override func stopAnimation() {
    super.stopAnimation()
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
