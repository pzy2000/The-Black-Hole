import WebKit

// eh:// 自定义协议 → 读取 App/屏保包内 Resources/web/ 下的静态文件。
// 让打包后的单体资源绕开 file:// 的 ES Module 限制。
final class EHSchemeHandler: NSObject, WKURLSchemeHandler {
  private static let mime: [String: String] = [
    "html": "text/html",
    "js": "text/javascript",
    "mjs": "text/javascript",
    "css": "text/css",
    "json": "application/json",
    "bin": "application/octet-stream",
    "png": "image/png",
    "jpg": "image/jpeg",
    "svg": "image/svg+xml",
    "ico": "image/x-icon",
  ]

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else {
      task.didFailWithError(URLError(.badURL))
      return
    }
    var rel = url.path
    if rel.hasPrefix("/") { rel.removeFirst() }
    if rel.isEmpty { rel = "index.html" }
    guard !rel.contains(".."), !rel.contains("\\") else {
      task.didFailWithError(URLError(.fileDoesNotExist))
      return
    }
    guard let root = Bundle(for: EHSchemeHandler.self).resourcePath else {
      task.didFailWithError(URLError(.fileDoesNotExist))
      return
    }
    guard let data = FileManager.default.contents(atPath: root + "/web/" + rel) else {
      task.didFailWithError(URLError(.fileDoesNotExist))
      return
    }
    let ext = (rel as NSString).pathExtension.lowercased()
    let type = Self.mime[ext] ?? "application/octet-stream"
    let isText = type.hasPrefix("text") || type == "application/json"
    let resp = URLResponse(
      url: url,
      mimeType: type,
      expectedContentLength: data.count,
      textEncodingName: isText ? "utf-8" : nil,
    )
    task.didReceive(resp)
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
