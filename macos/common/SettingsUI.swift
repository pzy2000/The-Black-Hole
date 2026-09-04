import SwiftUI

// Wallpaper Engine 风格设置面板：壁纸 App 设置窗口与屏保 configureSheet 共用。
// 任何改动即时落盘（settings.json）并回调宿主做活体下发。
final class CineSettingsModel: ObservableObject {
  @Published var quality: String { didSet { commit() } }
  @Published var maxFps: Int { didSet { commit() } }
  @Published var focusAction: String { didSet { commit() } }
  @Published var bgmEnabled: Bool { didSet { commit() } }
  @Published var bgmTrack: String { didSet { commit() } }
  @Published var bgmMode: String { didSet { commit() } }
  @Published var bgmVolume: Double { didSet { commit() } }

  let tracks: [String]
  /// 宿主回调（活体下发到 WebView）；保存已在此前完成
  var onCommit: ((EHCineSettings) -> Void)?

  private var initializing = true

  init(settings: EHCineSettings, tracks: [String]) {
    quality = settings.quality
    maxFps = settings.maxFps
    focusAction = settings.focusAction
    bgmEnabled = settings.bgm.enabled
    bgmTrack = settings.bgm.track
    bgmMode = settings.bgm.mode
    bgmVolume = settings.bgm.volume
    self.tracks = tracks
    initializing = false
  }

  var current: EHCineSettings {
    var s = EHCineSettings()
    s.quality = quality
    s.maxFps = maxFps
    s.focusAction = focusAction
    s.bgm = EHBgmSettings(enabled: bgmEnabled, track: bgmTrack, mode: bgmMode, volume: bgmVolume)
    return s
  }

  private func commit() {
    guard !initializing else { return }
    let s = current
    s.save()
    onCommit?(s)
  }
}

struct CineSettingsView: View {
  @ObservedObject var model: CineSettingsModel

  var body: some View {
    Form {
      Section {
        Picker("画质", selection: $model.quality) {
          Text("超高（默认）").tag("ultra")
          Text("高").tag("high")
          Text("中").tag("medium")
          Text("低").tag("low")
          Text("自动（卡顿时逐级降级）").tag("auto")
        }
        Picker("最大帧率", selection: $model.maxFps) {
          Text("不限（默认）").tag(0)
          Text("120 FPS").tag(120)
          Text("60 FPS").tag(60)
          Text("30 FPS").tag(30)
        }
      } header: {
        Text("性能")
      }

      Section {
        Picker("动作", selection: $model.focusAction) {
          Text("暂停渲染（保留画面，零 GPU 占用）").tag("pause")
          Text("停止并释放内存").tag("stop")
          Text("静音（继续渲染）").tag("mute")
          Text("继续运行").tag("continue")
        }
        .pickerStyle(.radioGroup)
      } header: {
        Text("失焦时（被全屏应用遮挡 / 屏保开始）")
      }

      Section {
        Toggle("启用背景音乐", isOn: $model.bgmEnabled)
        if model.tracks.isEmpty {
          Text("未找到曲目（包内 Resources/web/bgms）")
            .font(.callout)
            .foregroundStyle(.secondary)
        } else {
          Picker("曲目", selection: $model.bgmTrack) {
            Text("全部曲目（按播放模式轮播）").tag("all")
            ForEach(model.tracks, id: \.self) { Text($0).tag($0) }
          }
          Picker("播放模式", selection: $model.bgmMode) {
            Text("列表循环").tag("list")
            Text("随机播放").tag("shuffle")
            Text("单曲循环").tag("single")
          }
        }
        HStack {
          Text("音量").frame(width: 44, alignment: .leading)
          Slider(value: $model.bgmVolume, in: 0 ... 1)
          Text("\(Int(model.bgmVolume * 100))%")
            .monospacedDigit()
            .frame(width: 44, alignment: .trailing)
        }
        .opacity(model.bgmEnabled ? 1 : 0.4)
        .disabled(!model.bgmEnabled)
      } header: {
        Text("背景音乐（自动扫描 assets/bgms）")
      }

      Section {
        Text("设置保存在 ~/Library/Application Support/EventHorizon/settings.json，壁纸与屏保共用。")
          .font(.callout)
          .foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped)
    .frame(width: 460, height: 560)
  }
}
