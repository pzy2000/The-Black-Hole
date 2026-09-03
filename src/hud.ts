import type * as THREE from 'three';
import { FUEL_MAX, HEAT_MAX, type GameState, type ShipState } from './state';

const RS_KM = 1.27e7; // 人马座 A* 的史瓦西半径 ≈ 1270 万公里

function fmtTime(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export class Hud {
  readonly root: HTMLElement;
  private earthClock: HTMLElement;
  private shipClock: HTMLElement;
  private dilTag: HTMLElement;
  private speed: HTMLElement;
  private alt: HTMLElement;
  private warpTag: HTMLElement;
  private fuelFill: HTMLElement;
  private fuelText: HTMLElement;
  private heatFill: HTMLElement;
  private objective: HTMLElement;
  private reticle: HTMLElement;
  private prograde: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div id="hud-objective"></div>
      <div class="hud-bl">
        <div class="hud-row"><span class="hud-label">地球时间</span><span id="clock-earth">00:00</span></div>
        <div class="hud-row"><span class="hud-label">船内时间</span><span id="clock-ship">00:00</span></div>
        <div class="hud-row"><span id="dil-tag" class="hud-dim">时间膨胀 ×1.00</span></div>
        <div class="hud-bar"><span class="hud-label">燃料</span><div class="bar"><div id="fuel-fill"></div></div><span id="fuel-text"></span></div>
        <div class="hud-bar"><span class="hud-label">船温</span><div class="bar heat"><div id="heat-fill"></div></div><span id="heat-text"></span></div>
      </div>
      <div class="hud-br">
        <div class="hud-row right"><span class="hud-label">速度</span><span id="hud-speed"></span></div>
        <div class="hud-row right"><span class="hud-label">距视界</span><span id="hud-alt"></span></div>
        <div class="hud-row right"><span class="hud-label">时间</span><span id="hud-warp">×1</span></div>
      </div>
      <div id="reticle"></div>
      <div id="prograde" title="顺行方向"><span></span></div>
      <div id="hud-toast"></div>
    `;
    document.body.appendChild(this.root);

    this.earthClock = this.q('#clock-earth');
    this.shipClock = this.q('#clock-ship');
    this.dilTag = this.q('#dil-tag');
    this.speed = this.q('#hud-speed');
    this.alt = this.q('#hud-alt');
    this.warpTag = this.q('#hud-warp');
    this.fuelFill = this.q('#fuel-fill');
    this.fuelText = this.q('#fuel-text');
    this.heatFill = this.q('#heat-fill');
    this.objective = this.q('#hud-objective');
    this.reticle = this.q('#reticle');
    this.prograde = this.q('#prograde');
    this.toastEl = this.q('#hud-toast');
  }

  private q(sel: string): HTMLElement {
    const el = this.root.querySelector(sel) as HTMLElement;
    if (!el) throw new Error(`HUD 元素缺失: ${sel}`);
    return el;
  }

  setObjective(html: string) {
    this.objective.innerHTML = html;
  }

  toast(msg: string, ms = 3200) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  setVisible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  update(state: GameState, ship: ShipState, camera: THREE.PerspectiveCamera) {
    const r = ship.pos.length();
    const spd = ship.vel.length();

    this.earthClock.textContent = 'T+' + fmtTime(state.simTime);
    this.shipClock.textContent = 'T+' + fmtTime(state.shipTime);
    const dil = state.simTime > 0.5 ? state.shipTime / state.simTime : 1;
    this.dilTag.textContent = `时间膨胀 ×${dil.toFixed(3)}`;
    this.dilTag.classList.toggle('warn', dil < 0.7);

    const cPct = (spd * 100).toFixed(1);
    this.speed.innerHTML = `${cPct}%c <span class="hud-dim">(${(spd * 299792).toFixed(0)} km/s)</span>`;
    this.alt.innerHTML = `${r.toFixed(1)} Rs <span class="hud-dim">(≈${((r * RS_KM) / 1e4).toFixed(0)} 万km)</span>`;
    this.warpTag.textContent = `×${state.warp}`;

    const fuelPct = (ship.fuel / FUEL_MAX) * 100;
    this.fuelFill.style.width = `${fuelPct}%`;
    this.fuelFill.style.background = fuelPct < 20 ? '#ff6b5a' : '#ffc873';
    this.fuelText.textContent = `${ship.fuel.toFixed(0)}s`;
    const heatPct = (ship.heat / HEAT_MAX) * 100;
    this.heatFill.style.width = `${heatPct}%`;
    this.heatFill.style.background = heatPct > 70 ? '#ff6b5a' : '#ff9d5c';
    this.q('#heat-text').textContent = `${ship.heat.toFixed(0)}%`;

    // 中心准星 & 顺行方向标记
    const dir = ship.vel.clone();
    if (dir.lengthSq() > 1e-8) {
      const pWorld = ship.pos.clone().addScaledVector(dir.normalize(), 50);
      const p = pWorld.project(camera);
      const behind = p.z > 1;
      const x = (p.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-p.y * 0.5 + 0.5) * window.innerHeight;
      const off = behind || x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight;
      this.prograde.style.display = off ? 'none' : '';
      this.prograde.style.left = `${x}px`;
      this.prograde.style.top = `${y}px`;
    }
  }
}

export function appendHudStyles() {
  const style = document.createElement('style');
  style.textContent = `
#hud {
  position: fixed; inset: 0; pointer-events: none; z-index: 10;
  font-family: "PingFang SC", "Helvetica Neue", sans-serif;
  color: rgba(240,242,248,0.92);
  text-shadow: 0 0 6px rgba(0,0,0,0.9);
}
#hud .hud-row { display: flex; gap: 10px; align-items: baseline; margin-top: 4px; font-size: 13px; letter-spacing: 0.08em; }
#hud .hud-row.right { justify-content: flex-end; }
#hud .hud-label { font-size: 10px; letter-spacing: 0.3em; color: rgba(240,242,248,0.45); }
#hud .hud-dim { color: rgba(240,242,248,0.5); font-size: 11px; }
#hud .hud-dim.warn, #dil-tag.warn { color: #ff9d5c; }
.hud-bl { position: absolute; left: 30px; bottom: 56px; }
.hud-br { position: absolute; right: 30px; bottom: 56px; }
.hud-bl .hud-row span:last-child, .hud-br .hud-row span:last-child { font-variant-numeric: tabular-nums; }
#hud .hud-bar { display: flex; gap: 8px; align-items: center; margin-top: 6px; font-size: 11px; }
#hud .bar { width: 130px; height: 4px; background: rgba(255,255,255,0.12); border-radius: 2px; overflow: hidden; }
#hud .bar div { height: 100%; background: #ffc873; border-radius: 2px; transition: width 0.2s; }
#hud-objective {
  position: absolute; top: 26px; left: 50%; transform: translateX(-50%);
  text-align: center; font-size: 13px; letter-spacing: 0.14em; line-height: 1.9;
  color: rgba(255, 214, 165, 0.92); max-width: 60vw;
}
#hud-objective .obj-done { color: rgba(240,242,248,0.4); text-decoration: line-through; }
#reticle {
  position: absolute; left: 50%; top: 50%; width: 6px; height: 6px;
  margin: -3px 0 0 -3px; border: 1px solid rgba(255,255,255,0.5); border-radius: 50%;
}
#prograde {
  position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px;
  border: 1px solid rgba(140, 255, 180, 0.9); border-radius: 50%;
}
#prograde span {
  display: block; width: 6px; height: 1px; background: rgba(140,255,180,0.9);
  margin: 8px auto 0;
}
#hud-toast {
  position: absolute; left: 50%; top: 34%; transform: translateX(-50%);
  font-size: 15px; letter-spacing: 0.3em; color: rgba(255, 224, 185, 0.95);
  opacity: 0; transition: opacity 0.5s; text-align: center;
}
#hud-toast.show { opacity: 1; }
`;
  document.head.appendChild(style);
}
