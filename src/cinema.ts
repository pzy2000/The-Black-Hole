// 影院模式（?cinema=1）的宿主设置与背景音乐播放器。
// 设置由 macOS 壁纸 App / 屏保宿主写入
// ~/Library/Application Support/EventHorizon/settings.json，
// 并经 eh:// 协议以 __settings.json / bgms/index.json 动态提供；
// 浏览器直开或文件缺失时取默认 = 全最高（不限帧率 + 超高画质）。

export type QualityChoice = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
export type BgmMode = 'list' | 'shuffle' | 'single';
export type FocusAction = 'continue' | 'pause' | 'stop' | 'mute';

export interface BgmSettings {
  enabled: boolean;
  track: string; // "all" = 全部按模式播放；否则从指定曲目开始
  mode: BgmMode;
  volume: number; // 0..1
}

export interface CinemaSettings {
  version: number;
  quality: QualityChoice;
  maxFps: number; // 0 = 不限
  focusAction: FocusAction;
  bgm: BgmSettings;
}

export const DEFAULT_CINEMA_SETTINGS: CinemaSettings = {
  version: 1,
  quality: 'ultra',
  maxFps: 0,
  focusAction: 'pause',
  bgm: { enabled: true, track: 'all', mode: 'list', volume: 0.6 },
};

const QUALITIES: readonly QualityChoice[] = ['auto', 'low', 'medium', 'high', 'ultra'];
const BGMS_MODES: readonly BgmMode[] = ['list', 'shuffle', 'single'];
const FOCUS_ACTIONS: readonly FocusAction[] = ['continue', 'pause', 'stop', 'mute'];
const FPS_CHOICES = [0, 30, 60, 120];

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** 校验宿主写入的设置 JSON（可能被手改），非法字段回退默认 */
export function sanitizeCinemaSettings(raw: unknown): CinemaSettings {
  const s: CinemaSettings = JSON.parse(JSON.stringify(DEFAULT_CINEMA_SETTINGS));
  if (typeof raw !== 'object' || raw === null) return s;
  const o = raw as Record<string, unknown>;
  if (QUALITIES.includes(o.quality as QualityChoice)) s.quality = o.quality as QualityChoice;
  if (typeof o.maxFps === 'number' && FPS_CHOICES.includes(o.maxFps)) s.maxFps = o.maxFps;
  if (FOCUS_ACTIONS.includes(o.focusAction as FocusAction)) s.focusAction = o.focusAction as FocusAction;
  if (typeof o.bgm === 'object' && o.bgm !== null) {
    const b = o.bgm as Record<string, unknown>;
    if (typeof b.enabled === 'boolean') s.bgm.enabled = b.enabled;
    if (typeof b.track === 'string' && b.track) s.bgm.track = b.track;
    if (BGMS_MODES.includes(b.mode as BgmMode)) s.bgm.mode = b.mode as BgmMode;
    if (typeof b.volume === 'number' && Number.isFinite(b.volume)) s.bgm.volume = clamp01(b.volume);
  }
  return s;
}

export async function loadCinemaSettings(): Promise<CinemaSettings> {
  try {
    const res = await fetch(`__settings.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return { ...DEFAULT_CINEMA_SETTINGS, bgm: { ...DEFAULT_CINEMA_SETTINGS.bgm } };
    return sanitizeCinemaSettings(await res.json());
  } catch {
    return { ...DEFAULT_CINEMA_SETTINGS, bgm: { ...DEFAULT_CINEMA_SETTINGS.bgm } };
  }
}

export interface BgmStatus {
  ready: boolean; // 曲目列表已扫描
  master: boolean; // 本实例负责出声（多屏时只有一台出声）
  tracks: string[];
  index: number;
  track: string;
  mode: BgmMode;
  playing: boolean;
  time: number;
  duration: number;
  muted: boolean; // 失焦静音 或 未启用
  enabled: boolean;
}

export class CinemaBgm {
  private audio: HTMLAudioElement | null = null;
  private blobUrl: string | null = null;
  private blobFallbackTried = false;
  private mutedExternal = false; // 失焦静音（由宿主下发）
  private pendingStart = false; // 暂停期间被要求播放，等恢复后执行
  tracks: string[] = [];
  index = 0;
  ready = false;
  started = false;

  constructor(
    private getSettings: () => CinemaSettings,
    private readonly master: boolean,
    private readonly isPaused: () => boolean = () => false,
  ) {}

  private get enabled(): boolean {
    return this.getSettings().bgm.enabled;
  }

  get muted(): boolean {
    return this.mutedExternal || !this.enabled;
  }

  /** 扫描 eh://local/bgms/index.json（宿主动态生成 = 自动扫描包内 bgms 目录） */
  async init(): Promise<void> {
    try {
      const res = await fetch(`bgms/index.json?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const list: unknown = await res.json();
        if (Array.isArray(list)) this.tracks = list.filter((t): t is string => typeof t === 'string');
      }
    } catch {
      // 无 bgms 目录 / 非宿主环境：静默无声
    }
    this.ready = true;
    if (!this.master || !this.tracks.length || !this.enabled) return;
    const want = this.getSettings().bgm.track;
    const at = this.tracks.indexOf(want);
    this.play(at >= 0 ? at : 0);
  }

  private play(idx: number): void {
    if (!this.master) return;
    const track = this.tracks[idx];
    if (!track) return;
    if (this.isPaused()) {
      // 失焦暂停期间不启动播放；resume 时补播
      this.index = idx;
      this.started = true;
      this.pendingStart = true;
      return;
    }
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.addEventListener('ended', () => this.next());
      this.audio.addEventListener('error', () => this.playViaBlob(idx));
    }
    this.index = idx;
    this.started = true;
    this.pendingStart = false;
    const a = this.audio;
    a.src = `bgms/${encodeURIComponent(track)}`;
    a.volume = clamp01(this.getSettings().bgm.volume);
    a.muted = this.muted;
    console.log(`[BGM] 播放 ${idx + 1}/${this.tracks.length}: ${track}`);
    void a.play().catch(() => {
      // 直接 eh:// 源失败（部分 WebKit 版本媒体不走 scheme handler）→ 退回整段读入 Blob
      this.playViaBlob(idx);
    });
  }

  private playViaBlob(idx: number): void {
    const a = this.audio;
    if (!a || this.blobFallbackTried || !this.tracks[idx]) return;
    this.blobFallbackTried = true;
    const track = this.tracks[idx];
    fetch(`bgms/${encodeURIComponent(track)}`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob || a.src !== `bgms/${encodeURIComponent(track)}`) return;
        if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
        this.blobUrl = URL.createObjectURL(blob);
        console.log(`[BGM] eh:// 直连不可用，改用 Blob 播放: ${track}`);
        a.src = this.blobUrl;
        void a.play().catch(() => {});
      })
      .catch(() => {});
  }

  /** 按模式推进：single=重播当前；shuffle=随机换一首；list=顺序下一首 */
  next(mode: BgmMode = this.getSettings().bgm.mode): void {
    const n = this.tracks.length;
    if (!n) return;
    if (mode === 'single' || n === 1) {
      this.play(this.index);
      return;
    }
    if (mode === 'shuffle') {
      let nxt = this.index;
      while (nxt === this.index) nxt = Math.floor(Math.random() * n);
      this.play(nxt);
      return;
    }
    this.play((this.index + 1) % n);
  }

  /** 宿主设置变化后的活体应用 */
  refresh(): void {
    const b = this.getSettings().bgm;
    if (!this.tracks.length) return;
    if (!b.enabled) {
      this.audio?.pause();
      return;
    }
    if (!this.audio) {
      const at = this.tracks.indexOf(b.track);
      this.play(at >= 0 ? at : 0);
      return;
    }
    this.audio.volume = clamp01(b.volume);
    this.audio.muted = this.muted;
    if (b.track !== 'all') {
      const at = this.tracks.indexOf(b.track);
      if (at >= 0 && at !== this.index) {
        this.play(at);
        return;
      }
    }
    if (!this.audio.paused) return;
    void this.audio.play().catch(() => {});
  }

  setMutedExternal(m: boolean): void {
    this.mutedExternal = m;
    if (this.audio) this.audio.muted = this.muted;
  }

  pause(): void {
    this.audio?.pause();
  }

  resume(): void {
    if (this.pendingStart) {
      this.play(this.index);
      return;
    }
    if (this.enabled && this.started) void this.audio?.play().catch(() => {});
  }

  /** 测试钩子：跳到当前曲目结尾，验证三种播放模式推进逻辑 */
  seekToEnd(): void {
    const a = this.audio;
    if (a && Number.isFinite(a.duration) && a.duration > 0) {
      a.currentTime = Math.max(0, a.duration - 0.3);
    }
  }

  get status(): BgmStatus {
    return {
      ready: this.ready,
      master: this.master,
      tracks: this.tracks,
      index: this.index,
      track: this.tracks[this.index] ?? '',
      mode: this.getSettings().bgm.mode,
      playing: !!(this.audio && !this.audio.paused && !this.audio.ended && !this.audio.muted),
      time: this.audio?.currentTime ?? 0,
      duration: Number.isFinite(this.audio?.duration ?? NaN) ? (this.audio?.duration ?? 0) : 0,
      muted: this.muted,
      enabled: this.enabled,
    };
  }
}
