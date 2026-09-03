// 主菜单 / 任务简报 / 完成 / 失败弹窗
export interface UiCallbacks {
  onStartMission: (index: number) => void;
  onFreeFlight: () => void;
  onRetry: () => void;
  onMenu: () => void;
  onTourSystem: (systemIndex: number) => void;
  onJumpSystem: (systemIndex: number) => void;
}

export interface TourOption {
  label: string;
  locked: boolean;
  sysIndex: number;
}

export class Ui {
  private menu: HTMLElement;
  private modal: HTMLElement;
  private cb: UiCallbacks;

  constructor(cb: UiCallbacks) {
    this.cb = cb;
    this.menu = this.buildMenu();
    this.modal = this.buildModal();
    document.body.append(this.menu, this.modal);
    this.menu.style.display = 'none';
    this.modal.style.display = 'none';
  }

  private buildOverlay(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'eh-overlay';
    return el;
  }

  private buildMenu(): HTMLElement {
    const el = this.buildOverlay();
    el.innerHTML = `
      <div class="eh-menu">
        <h1>事件视界</h1>
        <p class="eh-sub">EVENT HORIZON — 深空科考船「视界号」</p>
        <div class="eh-menu-btns"></div>
        <div class="eh-controls">
          <span>拖拽 转向</span><span>W/S 前进/反推</span><span>A/D/R/F 平移</span>
          <span>Q/E 滚转</span><span>Z 时间加速</span><span>X 自动刹车</span><span>C 机位</span><span>T 释放探测器</span>
        </div>
        <p class="eh-credit">画面由史瓦西时空逐光线积分实时生成</p>
      </div>
    `;
    return el;
  }

  private buildModal(): HTMLElement {
    const el = this.buildOverlay();
    el.innerHTML = `
      <div class="eh-modal">
        <h2></h2>
        <div class="eh-modal-body"></div>
        <div class="eh-modal-btns"></div>
      </div>
    `;
    return el;
  }

  private button(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    if (primary) b.className = 'primary';
    b.addEventListener('click', onClick);
    return b;
  }

  showMenu(progressIndex: number, tour: TourOption[] = []) {
    this.modal.style.display = 'none';
    const btns = this.menu.querySelector('.eh-menu-btns') as HTMLElement;
    btns.innerHTML = '';
    if (progressIndex > 0 && progressIndex < 14) {
      btns.appendChild(
        this.button(`继续任务 · 第 ${progressIndex + 1} 关`, true, () => {
          this.hideAll();
          this.cb.onStartMission(progressIndex);
        }),
      );
    }
    if (progressIndex >= 14) {
      const done = document.createElement('p');
      done.className = 'eh-sub';
      done.style.marginTop = '26px';
      done.textContent = '✦ 巡礼已完成 — 三个黑洞，一次旅程';
      btns.appendChild(done);
    }
    btns.appendChild(
      this.button(progressIndex > 0 ? '从头开始' : '开始任务', progressIndex === 0, () => {
        this.hideAll();
        this.cb.onStartMission(0);
      }),
    );
    btns.appendChild(
      this.button('自由飞行', false, () => {
        this.hideAll();
        this.cb.onFreeFlight();
      }),
    );
    btns.appendChild(this.button('银心星图 · 曲率跳跃', false, () => this.showGalaxyMap()));
    btns.appendChild(this.button('黑洞图鉴', false, () => this.showDex()));
    for (const opt of tour) {
      const b = this.button(opt.label, false, () => {
        this.hideAll();
        this.cb.onTourSystem(opt.sysIndex);
      });
      if (opt.locked) {
        b.disabled = true;
        b.style.opacity = '0.35';
      }
      btns.appendChild(b);
    }
    this.menu.style.display = '';
  }

  showBrief(title: string, lines: string[], onStart: () => void) {
    this.hideAll();
    const h = this.modal.querySelector('h2') as HTMLElement;
    const body = this.modal.querySelector('.eh-modal-body') as HTMLElement;
    const btns = this.modal.querySelector('.eh-modal-btns') as HTMLElement;
    h.textContent = title;
    body.innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
    btns.innerHTML = '';
    btns.appendChild(this.button('出发', true, () => { this.hideAll(); onStart(); }));
    btns.appendChild(this.button('返回', false, () => this.showMenu(savedProgress())));
    this.modal.style.display = '';
  }

  showComplete(title: string, lines: string[], nextLabel: string | null, onNext: () => void) {
    this.hideAll();
    const h = this.modal.querySelector('h2') as HTMLElement;
    const body = this.modal.querySelector('.eh-modal-body') as HTMLElement;
    const btns = this.modal.querySelector('.eh-modal-btns') as HTMLElement;
    h.textContent = `✦ ${title} · 完成`;
    body.innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
    btns.innerHTML = '';
    if (nextLabel) btns.appendChild(this.button(nextLabel, true, onNext));
    btns.appendChild(this.button('返回主菜单', false, () => this.showMenu(savedProgress())));
    this.modal.style.display = '';
  }

  showFail(reason: string, onRetry: () => void) {
    this.hideAll();
    const h = this.modal.querySelector('h2') as HTMLElement;
    const body = this.modal.querySelector('.eh-modal-body') as HTMLElement;
    const btns = this.modal.querySelector('.eh-modal-btns') as HTMLElement;
    h.textContent = '✕ 任务失败';
    body.innerHTML = `<p class="eh-fail">${reason}</p>`;
    btns.innerHTML = '';
    btns.appendChild(this.button('重新开始本关', true, onRetry));
    btns.appendChild(this.button('返回主菜单', false, () => this.showMenu(savedProgress())));
    this.modal.style.display = '';
  }

  showChoice(title: string, lines: string[], options: { label: string; primary?: boolean; cb: () => void }[]) {
    this.hideAll();
    const h = this.modal.querySelector('h2') as HTMLElement;
    const body = this.modal.querySelector('.eh-modal-body') as HTMLElement;
    const btns = this.modal.querySelector('.eh-modal-btns') as HTMLElement;
    h.textContent = title;
    body.innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
    btns.innerHTML = '';
    for (const opt of options) {
      btns.appendChild(this.button(opt.label, !!opt.primary, opt.cb));
    }
    this.modal.style.display = '';
  }

  showEnding(title: string, lines: string[]) {
    this.hideAll();
    const h = this.modal.querySelector('h2') as HTMLElement;
    const body = this.modal.querySelector('.eh-modal-body') as HTMLElement;
    const btns = this.modal.querySelector('.eh-modal-btns') as HTMLElement;
    h.textContent = title;
    body.innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
    btns.innerHTML = '';
    btns.appendChild(this.button('返回主菜单', true, () => this.showMenu(savedProgress())));
    this.modal.style.display = '';
  }

  /** 银心星图：对数比例尺方位图 + 可点击系统标记（仅解锁系统可跳） */
  showGalaxyMap() {
    this.hideAll();
    let map = document.getElementById('eh-galaxymap');
    if (!map) {
      map = document.createElement('div');
      map.id = 'eh-galaxymap';
      map.className = 'eh-overlay';
      map.innerHTML = `
        <div class="eh-gm-panel">
          <h2>银心星图</h2>
          <p class="eh-gm-sub">对数比例尺 · 单位：光年 · 视界号曲率跳跃网络</p>
          <div class="eh-gm-canvaswrap"><canvas></canvas></div>
          <div class="eh-gm-marks"></div>
          <div class="eh-modal-btns"><button class="eh-gm-back">返回</button></div>
        </div>`;
      document.body.appendChild(map);
      map.querySelector('.eh-gm-back')!.addEventListener('click', () => {
        map!.style.display = 'none';
        this.showMenu(savedProgress());
      });
    }
    map.style.display = '';
    const marks = map.querySelector('.eh-gm-marks') as HTMLElement;
    marks.innerHTML = '';
    const canvas = map.querySelector('canvas') as HTMLCanvasElement;
    const W = 720;
    const H = 380;
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    // 背景：银河尘带
    g.fillStyle = '#04050c';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 400; i++) {
      const x = Math.random() * W;
      const y = H / 2 + Math.sin(x / W * Math.PI * 2 + 1) * (30 + Math.random() * 26) + (Math.random() - 0.5) * 22;
      g.fillStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.12})`;
      g.fillRect(x, y, 1.3, 1.3);
    }
    // 连线：太阳 → 各黑洞（虚线弧）
    const pos = (i: number): [number, number] => {
      const anchors: [number, number][] = [[W - 90, H / 2 + 6], [W - 300, H / 2 - 44], [110, H / 2 - 20]];
      return anchors[i];
    };
    g.strokeStyle = 'rgba(140,190,255,0.25)';
    g.setLineDash([4, 5]);
    for (let i = 1; i < 3; i++) {
      g.beginPath();
      g.moveTo(pos(0)[0], pos(0)[1]);
      g.quadraticCurveTo((pos(0)[0] + pos(i)[0]) / 2, Math.min(pos(0)[1], pos(i)[1]) - 40, pos(i)[0], pos(i)[1]);
      g.stroke();
    }
    g.setLineDash([]);
    // 标记点
    for (let i = 0; i < 3; i++) {
      const [x, y] = pos(i);
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fillStyle = '#ffd9a8';
      g.fill();
      g.font = '11px "PingFang SC", sans-serif';
      g.textAlign = 'center';
    }
    const labels = ['太阳', '天鹅座 X-1 · 7,200 ly', '人马座 A* · 26,000 ly', ''];
    // 太阳
    const [sx, sy] = pos(0);
    g.fillStyle = '#9fd8ff';
    g.fillText('太阳（出发点）', sx - 40, sy + 26);
    // 三个系统标记按钮（HTML，覆盖在 canvas 上）
    const saved = savedProgress();
    const sysDefs = [
      { name: '人马座 A*', dist: '26,000 光年', unlocked: true, sysIndex: 0 },
      { name: '天鹅座 X-1', dist: '7,200 光年', unlocked: saved >= 8, sysIndex: 1 },
      { name: 'M87*', dist: '5,500 万光年', unlocked: saved >= 11, sysIndex: 2 },
    ];
    // 人马座 A* 与 M87 标记错开：Sgr A* 在左侧
    const anchors = [[W - 300, H / 2 - 44], [W - 90, H / 2 + 6], [110, H / 2 - 20]];
    sysDefs.forEach((sd, i) => {
      const b = document.createElement('button');
      b.className = 'eh-gm-mark';
      b.innerHTML = `${sd.name}<br><span>${sd.dist}</span><br><em>${sd.unlocked ? '跳跃' : '未解锁'}</em>`;
      const [ax, ay] = anchors[i];
      b.style.left = `${(ax / W) * 100}%`;
      b.style.top = `${(ay / H) * 100}%`;
      if (!sd.unlocked) {
        (b as HTMLButtonElement).disabled = true;
        b.style.opacity = '0.35';
      } else {
        b.addEventListener('click', () => {
          map!.style.display = 'none';
          this.cb.onJumpSystem(sd.sysIndex);
        });
      }
      marks.appendChild(b);
    });
  }

  /** 黑洞图鉴：三张真实档案卡 */
  showDex() {
    this.hideAll();
    let dex = document.getElementById('eh-dex');
    if (!dex) {
      dex = document.createElement('div');
      dex.id = 'eh-dex';
      dex.className = 'eh-overlay';
      dex.innerHTML = `
        <div class="eh-dex-panel">
          <h2>黑洞图鉴</h2>
          <div class="eh-dex-cards"></div>
          <div class="eh-modal-btns"><button class="eh-dex-back">返回</button></div>
        </div>`;
      document.body.appendChild(dex);
      dex.querySelector('.eh-dex-back')!.addEventListener('click', () => {
        dex!.style.display = 'none';
        this.showMenu(savedProgress());
      });
    }
    dex.style.display = '';
    // 卡片内容由 main.ts 注入（保留最新解锁状态）
    const cards = dex.querySelector('.eh-dex-cards') as HTMLElement;
    cards.innerHTML = (window as unknown as { __dexCards?: string }).__dexCards ?? '';
  }

  setDexCards(html: string) {
    (window as unknown as { __dexCards?: string }).__dexCards = html;
  }

  hideAll() {
    this.menu.style.display = 'none';
    this.modal.style.display = 'none';
  }

  get anyVisible(): boolean {
    return this.menu.style.display !== 'none' || this.modal.style.display !== 'none';
  }
}

export function savedProgress(): number {
  const v = localStorage.getItem('eventhorizon-save');
  if (!v) return 0;
  try {
    return Math.max(0, parseInt(JSON.parse(v).mission ?? '0', 10) || 0);
  } catch {
    return 0;
  }
}

export function saveProgress(mission: number) {
  localStorage.setItem('eventhorizon-save', JSON.stringify({ mission }));
}

export function appendUiStyles() {
  const style = document.createElement('style');
  style.textContent = `
.eh-overlay {
  position: fixed; inset: 0; z-index: 40; display: flex;
  align-items: center; justify-content: center;
  background: radial-gradient(ellipse at center, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.78) 100%);
}
.eh-menu { text-align: center; }
.eh-menu h1 {
  font-size: 56px; font-weight: 200; letter-spacing: 0.6em; text-indent: 0.6em;
  color: #f2e7d5; text-shadow: 0 0 30px rgba(255,180,100,0.45);
}
.eh-sub { margin-top: 14px; font-size: 12px; letter-spacing: 0.4em; color: rgba(242,231,213,0.5); }
.eh-menu-btns { margin-top: 44px; display: flex; flex-direction: column; gap: 12px; align-items: center; }
.eh-menu-btns button, .eh-modal-btns button {
  appearance: none; min-width: 240px; padding: 11px 30px;
  background: rgba(20,16,12,0.6); border: 1px solid rgba(255,200,140,0.35); border-radius: 3px;
  color: rgba(255,224,185,0.9); font-size: 14px; letter-spacing: 0.3em; cursor: pointer;
  backdrop-filter: blur(8px); transition: all 0.25s ease;
}
.eh-menu-btns button:hover, .eh-modal-btns button:hover {
  border-color: rgba(255,200,140,0.9); background: rgba(60,40,22,0.6); color: #ffe9c9;
}
.eh-menu-btns button.primary, .eh-modal-btns button.primary {
  border-color: rgba(255,200,140,0.8); color: #ffdfae;
  box-shadow: 0 0 18px rgba(255,170,90,0.18);
}
.eh-controls {
  margin-top: 48px; display: flex; gap: 18px; justify-content: center; flex-wrap: wrap;
  font-size: 11px; letter-spacing: 0.2em; color: rgba(242,231,213,0.42);
}
.eh-credit { margin-top: 18px; font-size: 10px; letter-spacing: 0.3em; color: rgba(242,231,213,0.28); }
.eh-modal { max-width: 560px; text-align: center; padding: 40px; }
.eh-modal h2 { font-size: 26px; font-weight: 300; letter-spacing: 0.4em; color: #f2e7d5; }
.eh-modal-body { margin-top: 26px; }
.eh-modal-body p {
  margin: 10px 0; font-size: 14px; line-height: 1.9; letter-spacing: 0.12em;
  color: rgba(242,231,213,0.82);
}
.eh-modal-body p.eh-fail { color: #ff9d8a; }
.eh-modal-btns { margin-top: 30px; display: flex; gap: 12px; justify-content: center; }
#eh-flash {
  position: fixed; inset: 0; background: #fff; opacity: 0; pointer-events: none;
  z-index: 30; transition: opacity 0.9s ease;
}
`;
  document.head.appendChild(style);
}
