import * as THREE from 'three';

// 星系系统配置：每个真实黑洞一套参数（尺度/盘/伴星/任务区间）
export interface StarSystem {
  id: string;
  name: string;
  realName: string;
  fact: string;
  massSolar: number;
  rsKm: number;
  disk: { inner: number; outer: number; tempPeak: number; exposure: number };
  jet: number;
  stream: number;
  companion?: {
    name: string;
    radius: number; // Rs 单位
    temp: number; // K
    orbitRadius: number; // Rs
    orbitPeriod: number; // 秒（游戏压缩）
  };
  /** 巡礼解锁所需的存档进度（MISSIONS 全局索引） */
  unlockAfter: number;
  /** 该系统在 MISSIONS 中的任务区间 */
  missionOffset: number;
  missionCount: number;
}

export const SYSTEMS: StarSystem[] = [
  {
    id: 'sgrA',
    name: '人马座 A*',
    realName: 'Sagittarius A*',
    fact: '银河系中心的超大质量黑洞，2020 年诺贝尔奖的主角。'
      + '质量 430 万倍太阳，距地球 2.6 万光年。',
    massSolar: 4.3e6,
    rsKm: 1.27e7,
    disk: { inner: 3.0, outer: 13.0, tempPeak: 5200, exposure: 1.8 },
    jet: 1.0,
    stream: 1.0,
    unlockAfter: 0,
    missionOffset: 0,
    missionCount: 8,
  },
  {
    id: 'cygX1',
    name: '天鹅座 X-1',
    realName: 'Cygnus X-1',
    fact: '人类确认的第一个黑洞（霍金与索恩曾为它打赌）。'
      + '质量 21 倍太阳，正从蓝超巨星 HDE 226868 身上撕食物质，距地球 7200 光年。',
    massSolar: 21,
    rsKm: 62,
    disk: { inner: 3.0, outer: 12.0, tempPeak: 7000, exposure: 2.6 },
    jet: 1.4,
    stream: 0,
    companion: {
      name: 'HDE 226868',
      radius: 3.0,
      temp: 25000,
      orbitRadius: 70,
      orbitPeriod: 600,
    },
    unlockAfter: 8,
    missionOffset: 8,
    missionCount: 3,
  },
  {
    id: 'm87',
    name: 'M87*',
    realName: 'Messier 87*',
    fact: '人类拍到的第一张黑洞照片（EHT, 2019）。'
      + '质量 65 亿倍太阳，喷流延伸近五千光年，距地球 5500 万光年。',
    massSolar: 6.5e9,
    rsKm: 1.92e10,
    disk: { inner: 3.0, outer: 14.0, tempPeak: 4800, exposure: 1.4 },
    jet: 2.2,
    stream: 0,
    unlockAfter: 11,
    missionOffset: 11,
    missionCount: 3,
  },
];

export function systemByMission(missionIndex: number): StarSystem {
  for (const sys of SYSTEMS) {
    if (missionIndex >= sys.missionOffset && missionIndex < sys.missionOffset + sys.missionCount) {
      return sys;
    }
  }
  return SYSTEMS[0];
}

// 伴星轨道位置（游戏压缩周期，随时间演化）
export function companionPos(sys: StarSystem, simTime: number, out: THREE.Vector3): THREE.Vector3 {
  const c = sys.companion!;
  const a = (simTime / c.orbitPeriod) * Math.PI * 2;
  const tilt = 0.18;
  return out.set(
    Math.cos(a) * c.orbitRadius,
    Math.sin(a * 2) * c.orbitRadius * tilt,
    Math.sin(a) * c.orbitRadius,
  );
}
