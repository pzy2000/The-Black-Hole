import * as THREE from 'three';
import { ENGINE_ACCEL, gravityAccel, type ShipState } from './state';

// —— 飞船网格 ——
export interface ShipVisual {
  group: THREE.Group;
  engine: THREE.Sprite;
  setThrottle(t: number): void;
}

function engineTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,240,210,1)');
  grad.addColorStop(0.35, 'rgba(255,180,90,0.8)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createShipVisual(): ShipVisual {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x9aa4b2,
    metalness: 0.7,
    roughness: 0.35,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x2a2e36,
    metalness: 0.5,
    roughness: 0.5,
  });

  // 机身：指向 +z 的细长锥体
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.42, 8), hullMat);
  body.rotation.x = Math.PI / 2;
  body.position.z = 0.06;
  group.add(body);

  // 座舱
  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 10, 8),
    new THREE.MeshStandardMaterial({
      color: 0x86c5ff,
      emissive: 0x4a90d9,
      emissiveIntensity: 0.9,
      metalness: 0.2,
      roughness: 0.15,
    }),
  );
  cockpit.position.set(0, 0.055, 0.08);
  cockpit.scale.set(1, 0.6, 1.6);
  group.add(cockpit);

  // 机翼
  const wingGeo = new THREE.BoxGeometry(0.34, 0.015, 0.14);
  const wing = new THREE.Mesh(wingGeo, darkMat);
  wing.position.z = -0.12;
  group.add(wing);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.12, 0.12), darkMat);
  fin.position.set(0, 0.06, -0.14);
  group.add(fin);

  // 引擎喷焰
  const engine = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: engineTexture(),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  engine.position.z = -0.28;
  engine.scale.set(0.001, 0.001, 1);
  group.add(engine);

  const setThrottle = (t: number) => {
    const s = 0.08 + t * 0.5;
    engine.scale.set(s, s * (0.6 + t * 0.9), 1);
  };
  setThrottle(0);

  return { group, engine, setThrottle };
}

// —— 轨道预测：用与飞船相同的 PW 引力向前积分 ——
const PREDICT_STEPS = 900;

export class OrbitPredictor {
  readonly line: THREE.Line;
  private positions = new Float32Array(PREDICT_STEPS * 3);
  private geo: THREE.BufferGeometry;

  constructor() {
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.line = new THREE.Line(
      this.geo,
      new THREE.LineBasicMaterial({ color: 0xffc873, transparent: true, opacity: 0.45 }),
    );
    this.line.frustumCulled = false;
  }

  update(pos: THREE.Vector3, vel: THREE.Vector3): void {
    const p = pos.clone();
    const v = vel.clone();
    const a = new THREE.Vector3();
    let count = 0;
    let total = 0;
    for (let i = 0; i < PREDICT_STEPS; i++) {
      const r = p.length();
      if (r < 1.02 || r > 60) break;
      this.positions[count * 3] = p.x;
      this.positions[count * 3 + 1] = p.y;
      this.positions[count * 3 + 2] = p.z;
      count++;
      // 自适应步长：远处大步，近处细积分
      let dt = Math.min(Math.max(r * 0.02, 0.02), 1.2);
      dt = Math.min(dt, (0.3 * r) / (v.length() + 1e-4));
      gravityAccel(p, a);
      v.addScaledVector(a, dt);
      p.addScaledVector(v, dt);
      total += dt;
      if (total > 6000) break;
    }
    this.geo.setDrawRange(0, count);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.geo.computeBoundingSphere();
  }
}

// —— 飞船积分（子步进，曲速下也稳定） ——
export interface IntegrateResult {
  crashed: boolean;
  thrustUsed: number;
}

export function integrateShip(
  ship: ShipState,
  dtSim: number,
  thrustDir: THREE.Vector3, // 世界系推力方向（已含强度）
): IntegrateResult {
  const v = new THREE.Vector3();
  const a = new THREE.Vector3();
  const thrustAccel = thrustDir.clone().multiplyScalar(ENGINE_ACCEL);
  let thrustUsed = 0;
  const h = 0.02;
  let remain = dtSim;
  let crashed = false;

  while (remain > 1e-6 && !crashed) {
    const step = Math.min(h, remain);
    remain -= step;
    gravityAccel(ship.pos, a);
    a.add(thrustAccel);
    ship.vel.addScaledVector(a, step);
    ship.pos.addScaledVector(ship.vel, step);
    thrustUsed += (thrustAccel.length() / ENGINE_ACCEL) * step;
    if (ship.pos.length() < 1.05) crashed = true;
  }

  if (thrustUsed > 0) {
    ship.fuel = Math.max(0, ship.fuel - thrustUsed);
    if (ship.fuel <= 0) thrustAccel.set(0, 0, 0);
  }
  v.copy(ship.vel);
  return { crashed, thrustUsed };
}
