import * as THREE from 'three';
import type { MissionWaypoint } from './missions';

// 任务航点的 3D 光环 + 屏幕投影标签
interface MarkerItem {
  pos: THREE.Vector3;
  label: string;
  mesh: THREE.Group;
  labelEl: HTMLElement;
}

export class Markers {
  readonly group = new THREE.Group();
  private container: HTMLElement;
  private items: MarkerItem[] = [];

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'eh-markers';
    document.body.appendChild(this.container);
    this.group.visible = false;
    const style = document.createElement('style');
    style.textContent = `
#eh-markers { position: fixed; inset: 0; pointer-events: none; z-index: 12; }
.eh-marker-label {
  position: absolute; transform: translate(-50%, -140%);
  font-size: 11px; letter-spacing: 0.2em; white-space: nowrap;
  color: rgba(255, 224, 185, 0.95); text-shadow: 0 0 6px rgba(0,0,0,0.9);
}
.eh-marker-label .dist { color: rgba(255,224,185,0.55); font-size: 10px; }
`;
    document.head.appendChild(style);
  }

  set(list: MissionWaypoint[]) {
    for (const item of this.items) {
      this.group.remove(item.mesh);
      item.labelEl.remove();
    }
    this.items = [];
    for (const wp of list) {
      const mesh = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.025, 8, 40),
        new THREE.MeshBasicMaterial({ color: wp.color ?? 0xffd9a8, transparent: true, opacity: 0.9 }),
      );
      mesh.add(ring);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: ringGlowTexture(wp.color ?? 0xffd9a8),
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          opacity: 0.5,
        }),
      );
      glow.scale.set(1.6, 1.6, 1);
      mesh.add(glow);
      mesh.position.set(wp.pos[0], wp.pos[1], wp.pos[2]);
      this.group.add(mesh);

      const labelEl = document.createElement('div');
      labelEl.className = 'eh-marker-label';
      labelEl.innerHTML = `◈ ${wp.label}<br><span class="dist"></span>`;
      this.container.appendChild(labelEl);

      this.items.push({ pos: mesh.position.clone(), label: wp.label, mesh, labelEl });
    }
    this.group.visible = list.length > 0;
  }

  setVisible(v: boolean) {
    this.group.visible = v && this.items.length > 0;
    this.container.style.display = v ? '' : 'none';
  }

  update(camera: THREE.Camera, time: number) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const item of this.items) {
      item.mesh.rotation.z = time * 0.8;
      const p = item.pos.clone().project(camera);
      const behind = p.z > 1;
      if (behind) {
        item.labelEl.style.display = 'none';
        continue;
      }
      const x = (p.x * 0.5 + 0.5) * w;
      const y = (-p.y * 0.5 + 0.5) * h;
      if (x < -50 || x > w + 50 || y < -50 || y > h + 50) {
        item.labelEl.style.display = 'none';
        continue;
      }
      item.labelEl.style.display = '';
      item.labelEl.style.left = `${x}px`;
      item.labelEl.style.top = `${y}px`;
    }
  }

  // 返回当前距离最近未完成标记的屏上标签元素（用于更新距离文本）
  labelAt(i: number): HTMLElement | null {
    return this.items[i]?.labelEl.querySelector('.dist') ?? null;
  }

  positions(): THREE.Vector3[] {
    return this.items.map((it) => it.pos);
  }
}

function ringGlowTexture(color: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = (color >> 16) & 255;
  const gg = (color >> 8) & 255;
  const b = color & 255;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${r},${gg},${b},0.9)`);
  grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
