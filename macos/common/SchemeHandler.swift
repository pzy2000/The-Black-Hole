import WebKit

// eh:// 自定义协议 → 读取 App/屏保包内 Resources/web/ 下的静态文件。
// 让打包后的单体资源绕开 file:// 的 ES Module 限制。
// 另有两个动态端点：
//   eh://local/__settings.json   → 全局设置（Application Support 缺失时给默认值）
//   eh://local/bgms/index.json   → 自动扫描包内 web/bgms 目录的曲目列表
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
    "mp3": "audio/mpeg",
    "m4a": "audio/mp4",
    "aac": "audio/aac",
    "wav": "audio/wav",
    "flac": "audio/flac",
    "ogg": "audio/ogg",
  ]

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else {
      task.didFailWithError(URLError(.badURL))
      return
    }
    var rel = url.path
    if rel.hasPrefix("/") { rel.removeFirst() }
    if rel.isEmpty { rel = "index.html" }
    rel = (rel as NSString).removingPercentEncoding ?? rel
    guard !rel.contains(".."), !rel.contains("\\") else {
      task.didFailWithError(URLError(.fileDoesNotExist))
      return
    }
    guard let root = Bundle(for: EHSchemeHandler.self).resourcePath else {
      task.didFailWithError(URLError(.fileDoesNotExist))
      return
    }

    if rel == "__settings.json" {
      respond(task: task, url: url, data: settingsData(), type: "application/json", noStore: true)
      return
    }
    if rel == "bgms/index.json" {
      respond(task: task, url: url, data: bgmIndexData(root: root), type: "application/json", noStore: true)
      return
    }

    guard let data = FileManager.default.contents(atPath: root + "/web/" + rel) else {
      task.didFailWithError(URLError(.fileDoesNotExist))
      return
    }
    let ext = (rel as NSString).pathExtension.lowercased()
    let type = Self.mime[ext] ?? "application/octet-stream"
    respond(task: task, url: url, data: data, type: type, noStore: false)
  }

  // —— 动态端点 ——

  private func settingsData() -> Data {
    let settings = EHCineSettings.load()
    return (try? JSONEncoder().encode(settings)) ?? Data("{}".utf8)
  }

  private func bgmIndexData(root: String) -> Data {
    let names = EHCineSettings.scanBgms(root: root)
    return (try? JSONEncoder().encode(names)) ?? Data("[]".utf8)
  }

  private func respond(task: WKURLSchemeTask, url: URL, data: Data, type: String, noStore: Bool) {
    let isText = type.hasPrefix("text") || type == "application/json"
    if noStore {
      let resp = HTTPURLResponse(
        url: url, statusCode: 200, httpVersion: nil,
        headerFields: ["Content-Type": type, "Cache-Control": "no-store"],
      )!
      task.didReceive(resp)
    } else {
      let resp = URLResponse(
        url: url,
        mimeType: type,
        expectedContentLength: data.count,
        textEncodingName: isText ? "utf-8" : nil,
      )
      task.didReceive(resp)
    }
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
