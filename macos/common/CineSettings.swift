import Foundation

// 影院模式全局设置（Wallpaper Engine 风格）。
// 单一事实源：~/Library/Application Support/EventHorizon/settings.json
// 壁纸 App 设置窗口与屏保 configureSheet 都写这里；
// 网页端经 eh://local/__settings.json（动态生成）读取；字段与 src/cinema.ts 对应。
struct EHBgmSettings: Codable, Equatable {
  var enabled = true
  var track = "all" // "all" = 全部按播放模式轮播；否则从指定曲目开始
  var mode = "list" // list | shuffle | single
  var volume = 0.6 // 0...1
}

struct EHCineSettings: Codable, Equatable {
  var version = 1
  var quality = "ultra" // auto | low | medium | high | ultra（默认最高）
  var maxFps = 0 // 0 = 不限（默认最高）
  var focusAction = "pause" // continue | pause | stop | mute（失焦时）
  var bgm = EHBgmSettings()

  static let validQualities = ["auto", "low", "medium", "high", "ultra"]
  static let validFocusActions = ["continue", "pause", "stop", "mute"]
  static let validBgmModes = ["list", "shuffle", "single"]
  static let validFpsChoices = [0, 30, 60, 120]
  static let audioExtensions: Set<String> = ["mp3", "m4a", "aac", "wav", "flac", "ogg"]

  static var fileURL: URL {
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("EventHorizon", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("settings.json")
  }

  /// 读取（文件缺失/损坏 → 全默认）
  static func load() -> EHCineSettings {
    guard let data = try? Data(contentsOf: fileURL) else { return EHCineSettings() }
    return decode(data) ?? EHCineSettings()
  }

  /// 逐字段校验合并，非法值回退默认（容忍手改文件）
  static func decode(_ data: Data) -> EHCineSettings? {
    guard let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    var s = EHCineSettings()
    if let q = raw["quality"] as? String, validQualities.contains(q) { s.quality = q }
    if let n = raw["maxFps"] as? NSNumber, validFpsChoices.contains(n.intValue) { s.maxFps = n.intValue }
    if let fa = raw["focusAction"] as? String, validFocusActions.contains(fa) { s.focusAction = fa }
    if let b = raw["bgm"] as? [String: Any] {
      if let e = b["enabled"] as? Bool { s.bgm.enabled = e }
      if let t = b["track"] as? String, !t.isEmpty { s.bgm.track = t }
      if let m = b["mode"] as? String, validBgmModes.contains(m) { s.bgm.mode = m }
      if let v = b["volume"] as? NSNumber { s.bgm.volume = min(1, max(0, v.doubleValue)) }
    }
    return s
  }

  @discardableResult
  func save() -> Bool {
    guard var obj = jsonValue as? [String: Any] else { return false }
    obj["version"] = version
    guard JSONSerialization.isValidJSONObject(obj) else { return false }
    do {
      let data = try JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys])
      try data.write(to: Self.fileURL, options: .atomic)
      return true
    } catch {
      NSLog("[事件视界] 设置写入失败: \(error)")
      return false
    }
  }

  /// 与网页端字段一一对应的字典（JSONEncoder 输出即可直接下发 JS）
  var jsonString: String? {
    guard let data = try? JSONEncoder().encode(self) else { return nil }
    return String(data: data, encoding: .utf8)
  }

  var jsonValue: Any? {
    guard let data = try? JSONEncoder().encode(self) else { return nil }
    return try? JSONSerialization.jsonObject(with: data)
  }

  /// 扫描包内 Resources/web/bgms 下的音频文件（网页端 index.json 同源同序）
  static func scanBgms(root: String?) -> [String] {
    guard let root, !root.isEmpty else { return [] }
    let dir = root + "/web/bgms"
    guard let names = try? FileManager.default.contentsOfDirectory(atPath: dir) else { return [] }
    return names
      .filter { audioExtensions.contains(($0 as NSString).pathExtension.lowercased()) }
      .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
  }
}
