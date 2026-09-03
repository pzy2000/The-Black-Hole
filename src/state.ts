import * as THREE from 'three';

// 单位约定：史瓦西半径 Rs = 1，光速 c = 1，时间单位为秒
// GM = Rs·c²/2 = 0.5；Paczyński–Wiita 伪牛顿势 a = -GM/(r-Rs)²（保留真实 ISCO 行为）
export const GM = 0.5;
export const ENGINE_ACCEL = 0.05;
export const FUEL_MAX = 400; // 满推力可持续秒数
export const HEAT_MAX = 100;

export interface ShipState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  fuel: number;
  heat: number;
  alive: boolean;
  throttle: number; // 显示用：当前引擎推力 0..1
}

export interface GameState {
  mode: 'menu' | 'flight' | 'photo';
  paused: boolean;
  simTime: number; // 地球坐标时
  shipTime: number; // 船内固有时
  warp: number;
  cameraMode: 0 | 1 | 2; // 追尾 / 座舱 / 自由
  hudVisible: boolean;
  autoBrake: boolean;
}

export interface Waypoint {
  pos: THREE.Vector3;
  label: string;
  color: number;
}

export function circularSpeed(r: number): number {
  return Math.sqrt((GM * r) / (r - 1) ** 2);
}

// 史瓦西时间膨胀（静止观者）× 速度洛伦兹
export function dilation(r: number, speed: number): number {
  const g = Math.sqrt(Math.max(1 - 1 / r, 0.02));
  const v = Math.min(speed, 0.99);
  return g * Math.sqrt(1 - v * v);
}

// Paczyński–Wiita 引力加速度
export function gravityAccel(pos: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const r = pos.length();
  const k = -GM / Math.pow(Math.max(r - 1, 0.05), 2) / r;
  return out.copy(pos).multiplyScalar(k);
}

// 时间倍率上限随距离收紧，防止曲速飞掠黑洞时一步跨过
export function maxWarpFor(r: number): number {
  if (r > 25) return 1000;
  if (r > 12) return 100;
  if (r > 6) return 10;
  return 1;
}

export const WARP_STEPS = [1, 10, 100, 1000];

export function initialShip(): ShipState {
  const r = 14;
  const pos = new THREE.Vector3(r, 1.2, 0);
  const tangent = new THREE.Vector3(-pos.z, 0, pos.x).normalize();
  const vel = tangent.multiplyScalar(circularSpeed(pos.length()));
  const quat = new THREE.Quaternion().setFromRotationMatrix(
    // eye=vel 使 +Z（船首）对准速度方向
    new THREE.Matrix4().lookAt(vel, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)),
  );
  return { pos, vel, quat, fuel: FUEL_MAX, heat: 0, alive: true, throttle: 0 };
}
