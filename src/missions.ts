import * as THREE from 'three';
import { circularSpeed, FUEL_MAX, type GameState, type ShipState } from './state';

export interface MissionWaypoint {
  pos: [number, number, number];
  label: string;
  radius: number;
  color?: number;
}

export interface MissionFx {
  flash(): void;
  spawnProbe(from: { x: number; y: number; z: number }): void;
}
export interface MissionCtx {
  ship: ShipState;
  state: GameState;
  flags: Set<string>;
  toast(msg: string): void;
  lookAlong(x: number, y: number, z: number): void;
  fx: MissionFx;
}

export interface Mission {
  title: string;
  brief: string[];
  complete: string[];
  waypoints?: MissionWaypoint[];
  setup: (ctx: MissionCtx) => void;
  objectives: { text: string; check: (ctx: MissionCtx) => boolean }[];
  onKey?: (code: string, ctx: MissionCtx) => void;
}

function circularOrbit(r: number, inclination = 0): { pos: [number, number, number]; vel: [number, number, number] } {
  const pos = new THREE.Vector3(r * Math.cos(inclination), r * Math.sin(inclination), 0);
  const tangent = new THREE.Vector3(-pos.z, 0, pos.x).normalize();
  const v = circularSpeed(pos.length());
  return {
    pos: [pos.x, pos.y, pos.z],
    vel: [tangent.x * v, tangent.y * v, tangent.z * v],
  };
}

export const MISSIONS: Mission[] = [
  {
    title: '第一关 · 远轨适应',
    brief: [
      '欢迎登上深空科考船「视界号」。',
      '你正处在一个 430 万倍太阳质量黑洞的安全轨道上。',
      '先熟悉飞船：这里的引力、时间，都不再是地球的规则。',
    ],
    complete: [
      '基础操控训练完成。',
      '提示：越靠近黑洞，你的时间越慢——留意 HUD 上的双时钟分叉。',
    ],
    setup: (ctx) => {
      const o = circularOrbit(18, 0.06);
      ctx.ship.pos.set(o.pos[0], o.pos[1], o.pos[2]);
      ctx.ship.vel.set(o.vel[0], o.vel[1], o.vel[2]);
      ctx.ship.fuel = FUEL_MAX;
      ctx.ship.heat = 0;
      ctx.ship.alive = true;
      ctx.lookAlong(o.vel[0], o.vel[1], o.vel[2]);
    },
    objectives: [
      { text: '主引擎加速至 0.25c 以上（按住 W）', check: (c) => c.ship.vel.length() >= 0.25 },
      { text: '使用时间加速（按 Z）', check: (c) => c.flags.has('warp') },
      { text: '抵近黑洞：进入 8 Rs 以内', check: (c) => c.ship.pos.length() < 8 },
      { text: '安全减速至 0.06c 以下（X 自动刹车）', check: (c) => c.ship.vel.length() < 0.06 },
    ],
  },
  {
    title: '第二关 · 光子环摄影',
    brief: [
      '摄影组要在光子球（1.5 Rs）附近拍下黑洞的剪影。',
      'ISCO（最内稳定轨道）在 3 Rs——越过它，稳定圆轨道就不复存在。',
      '深入 3.5 Rs 以内，释放探测器，然后活着回来。',
    ],
    complete: [
      '照片已传回地球。阴影边缘那一圈细细的光，是绕行黑洞后才抵达相机的光子——',
      '它们在视界旁转了半圈甚至数圈。人类从未见过这样的照片。',
    ],
    setup: (ctx) => {
      const o = circularOrbit(12, -0.04);
      ctx.ship.pos.set(o.pos[0], o.pos[1], o.pos[2]);
      ctx.ship.vel.set(o.vel[0], o.vel[1], o.vel[2]);
      ctx.ship.fuel = FUEL_MAX;
      ctx.ship.heat = 0;
      ctx.ship.alive = true;
      ctx.lookAlong(o.vel[0], o.vel[1], o.vel[2]);
    },
    objectives: [
      { text: '深入险境：进入 3.5 Rs 以内', check: (c) => c.ship.pos.length() < 3.5 },
      { text: '释放摄影探测器（3.5 Rs 以内按 T）', check: (c) => c.flags.has('photo') },
      { text: '全身而退：撤离到 10 Rs 以外', check: (c) => c.ship.pos.length() > 10 },
    ],
    onKey: (code, ctx) => {
      if (code === 'KeyT' && ctx.ship.pos.length() < 3.5 && !ctx.flags.has('photo')) {
        ctx.flags.add('photo');
        ctx.fx.spawnProbe(ctx.ship.pos);
        ctx.fx.flash();
        ctx.toast('探测器已释放 — 曝光中…');
      }
    },
  },
  {
    title: '第三关 · 盘缘采样',
    brief: [
      '吸积盘外缘的温度相对温和，但辐射足以炙烤船体。',
      '前往盘缘采样点完成采集——盯着船温，超过 100% 船体解体。',
      '采集完成后立即撤离冷却。热，是这个关卡唯一的敌人。',
    ],
    complete: ['样本已封存。', '接下来，是真正的深处。'],
    waypoints: [{ pos: [12.2, 0.55, 0], label: '盘缘采样点', radius: 1.6 }],
    setup: (ctx) => {
      const o = circularOrbit(17, 0.05);
      ctx.ship.pos.set(o.pos[0], o.pos[1], o.pos[2]);
      ctx.ship.vel.set(o.vel[0], o.vel[1], o.vel[2]);
      ctx.ship.fuel = FUEL_MAX;
      ctx.ship.heat = 0;
      ctx.ship.alive = true;
      ctx.lookAlong(o.vel[0], o.vel[1], o.vel[2]);
    },
    objectives: [
      { text: '抵达盘缘采样点（留意船温）', check: (c) => c.flags.has('wp0') },
      { text: '撤离到 17 Rs 以外', check: (c) => c.ship.pos.length() > 17 },
      { text: '冷却：船温降到 40% 以下', check: (c) => c.ship.heat < 40 },
    ],
  },
];
