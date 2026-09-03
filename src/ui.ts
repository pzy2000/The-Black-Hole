// 主菜单 / 任务简报 / 完成 / 失败弹窗
export interface UiCallbacks {
  onStartMission: (index: number) => void;
  onFreeFlight: () => void;
  onRetry: () => void;
  onMenu: () => void;
  onTourSystem: (systemIndex: number) => void;
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
    if (progressIndex > 0) {
      btns.appendChild(
        this.button(`继续任务 · 第 ${progressIndex + 1} 关`, true, () => {
          this.hideAll();
          this.cb.onStartMission(progressIndex);
        }),
      );
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
