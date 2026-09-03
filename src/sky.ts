import * as THREE from 'three';
import { CONSTELLATIONS, type ConstellationDef } from './constellations';

export interface NamedStar {
  name: string;
  mag: number;
  dir: THREE.Vector3;
  temp: number;
}

export interface SkyData {
  texture: THREE.Texture;
  rt: THREE.WebGLRenderTarget;
  namedStars: NamedStar[];
  constellations: { def: ConstellationDef; stars: NamedStar[] }[];
  starCount: number;
}

// 星图模式的著名恒星中文名
const CN_NAMES: Record<string, string> = {
  Sirius: '天狼星', Vega: '织女星', Betelgeuse: '参宿四', Rigel: '参宿七',
  Procyon: '南河三', Canopus: '老人星', Arcturus: '大角星', Aldebaran: '毕宿五',
  Pollux: '北河三', Castor: '北河二', Capella: '五车二', Spica: '角宿一',
  Antares: '心宿二', Deneb: '天津四', Regulus: '轩辕十四', Altair: '牛郎星',
  Dubhe: '天枢', Merak: '天璇', Phecda: '天玑', Megrez: '天权',
  Alioth: '玉衡', Mizar: '开阳', Alkaid: '摇光', Bellatrix: '参宿五',
  Alnilam: '参宿二', Alnitak: '参宿一', Mintaka: '参宿三', Saiph: '参宿六',
  Caph: '王良一', Schedar: '王良四', Cih: '策', Ruchbah: '阁道三', Segin: '阁道二',
  Wezen: '弧矢一', Adhara: '弧矢七', Aludra: '弧矢二', Mirzam: '军市一',
  Zosma: '西上相', Sheliak: '渐台一', Sulafat: '渐台三', Alpheratz: '壁宿二',
  Achernar: '水委一', Fomalhaut: '北落师门', Hamal: '娄宿三',
};

// 与黑洞着色器完全一致的等距柱状投影
export function dirToEquirect(d: THREE.Vector3): [number, number] {
  const u = Math.atan2(d.z, d.x) / (Math.PI * 2) + 0.5;
  const v = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) / Math.PI + 0.5;
  return [u, v];
}

export async function buildSky(
  renderer: THREE.WebGLRenderer,
  rt: THREE.WebGLRenderTarget,
): Promise<SkyData> {
  const [binBuf, namedJson] = await Promise.all([
    fetch('sky/stars.bin').then((r) => r.arrayBuffer()),
    fetch('sky/named.json').then((r) => r.json()),
  ]);
  const data = new Float32Array(binBuf);
  const n = data.length / 5;

  const pos = new Float32Array(n * 3);
  const attrs = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = data[i * 5];
    pos[i * 3 + 1] = data[i * 5 + 1];
    pos[i * 3 + 2] = data[i * 5 + 2];
    attrs[i * 2] = data[i * 5 + 3];
    attrs[i * 2 + 1] = data[i * 5 + 4];
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aData', new THREE.BufferAttribute(attrs, 2));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSizeScale: { value: 1.0 },
      uMinSize: { value: 1.0 },
      uGain: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aData;
      uniform float uSizeScale;
      uniform float uMinSize;
      varying vec2 vData;
      void main() {
        vec3 d = normalize(position);
        float u = atan(d.z, d.x) / 6.28318530718 + 0.5;
        float v = asin(clamp(d.y, -1.0, 1.0)) / 3.14159265359 + 0.5;
        gl_Position = vec4(u * 2.0 - 1.0, v * 2.0 - 1.0, 0.0, 1.0);
        float size = (1.2 + 2.8 * log2(1.0 + aData.x)) * uSizeScale;
        gl_PointSize = max(size, uMinSize);
        vData = aData;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vData;
      uniform float uGain;
      vec3 blackbody(float kelvin) {
        float t = clamp(kelvin, 1000.0, 40000.0) / 100.0;
        float r; float g; float b;
        if (t <= 66.0) { r = 255.0; g = 99.4708 * log(t) - 161.1196; }
        else { r = 329.6987 * pow(t - 60.0, -0.1332); g = 288.1222 * pow(t - 60.0, -0.0755); }
        if (t >= 66.0) { b = 255.0; } else if (t <= 19.0) { b = 0.0; }
        else { b = 138.5177 * log(t - 10.0) - 305.0448; }
        vec3 c = clamp(vec3(r, g, b) / 255.0, vec3(0.0), vec3(1.0));
        return pow(c, vec3(2.2));
      }
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float a = exp(-dot(p, p) * 4.5);
        if (a < 0.004) discard;
        vec3 col = blackbody(mix(2500.0, 30000.0, vData.y));
        gl_FragColor = vec4(col * vData.x * a * uGain, 1.0);
      }
    `,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });

  const scene = new THREE.Scene();
  const points = new THREE.Points(geo, material.clone());
  const glow = new THREE.Points(geo, material);
  (points.material as THREE.ShaderMaterial).uniforms.uSizeScale.value = 1.0;
  (points.material as THREE.ShaderMaterial).uniforms.uMinSize.value = 2.0;
  (points.material as THREE.ShaderMaterial).uniforms.uGain.value = 1.0;
  (glow.material as THREE.ShaderMaterial).uniforms.uSizeScale.value = 9.0;
  (glow.material as THREE.ShaderMaterial).uniforms.uMinSize.value = 5.0;
  (glow.material as THREE.ShaderMaterial).uniforms.uGain.value = 0.0022;
  points.frustumCulled = false;
  glow.frustumCulled = false;
  scene.add(points, glow);

  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(scene, ortho); // 一次渲染同时画出锐利星点与银河辉光（加性混合）
  renderer.setRenderTarget(null);



  geo.dispose();
  (points.material as THREE.ShaderMaterial).dispose();
  (glow.material as THREE.ShaderMaterial).dispose();

  // 命名亮星与星座
  const byName = new Map<string, NamedStar>();
  const namedStars: NamedStar[] = [];
  for (const j of namedJson as Array<{ name: string; mag: number; dir: number[]; temp: number }>) {
    const st: NamedStar = {
      name: j.name,
      mag: j.mag,
      dir: new THREE.Vector3(j.dir[0], j.dir[1], j.dir[2]).normalize(),
      temp: j.temp,
    };
    byName.set(j.name, st);
    namedStars.push(st);
  }
  const constellations: { def: ConstellationDef; stars: NamedStar[] }[] = [];
  for (const def of CONSTELLATIONS) {
    const stars: NamedStar[] = [];
    for (const [a, b] of def.lines) {
      if (!byName.has(a) || !byName.has(b)) { stars.length = 0; break; }
      stars.push(byName.get(a)!, byName.get(b)!);
    }
    if (stars.length > 0) constellations.push({ def, stars });
  }

  return { texture: rt.texture, rt, namedStars, constellations, starCount: n };
}

export function starLabel(st: NamedStar): string {
  return CN_NAMES[st.name] ? `${CN_NAMES[st.name]} · ${st.name}` : st.name;
}
