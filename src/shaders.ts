// 《事件视界》核心着色器
// 单位约定：史瓦西半径 Rs = 1（视界 r=1，光子球 r=1.5，ISCO r=3）
// 光线从相机出发，在史瓦西时空中沿零测地线数值积分：
//   d²x/dλ² = -1.5 · h² · x / r⁵   （h = |x × dx/dλ| 守恒）
// 命中视界 → 黑；穿越赤道面且 r 落在盘范围内 → 采样吸积盘；逃逸 → 程序星空。

export const fullscreenVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const blackholeFragment = /* glsl */ `
precision highp float;

layout(location = 0) out highp vec4 fragColor;

varying vec2 vUv;

uniform mat4 uCamWorld;
uniform mat4 uProjInv;
uniform vec3 uCamPos;
uniform float uTime;
uniform int uMaxSteps;
uniform float uDiskInner;
uniform float uDiskOuter;
uniform float uTempPeak;
uniform float uBeaming;
uniform float uExposure;
uniform float uOmega;
uniform float uFlowPeriod;
uniform float uPixelAngle;
uniform vec3 uMwNormal;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

float vnoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
    mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
    u.y);
}
float fbm2(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise2(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return s;
}
float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), u.x),
        mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), u.x),
        mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
    u.z);
}
float fbm3(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise3(p);
    p = p * 2.02 + vec3(11.5, 7.2, 3.9);
    a *= 0.5;
  }
  return s;
}

// 黑体辐射近似（Tanner Helland 拟合），输入开尔文，输出线性 RGB
vec3 blackbody(float kelvin) {
  float t = clamp(kelvin, 1000.0, 40000.0) / 100.0;
  float r;
  float g;
  float b;
  if (t <= 66.0) {
    r = 255.0;
    g = 99.4708025861 * log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * pow(t - 60.0, -0.1332047592);
    g = 288.1221695283 * pow(t - 60.0, -0.0755148492);
  }
  if (t >= 66.0) {
    b = 255.0;
  } else if (t <= 19.0) {
    b = 0.0;
  } else {
    b = 138.5177312231 * log(t - 10.0) - 305.0447927307;
  }
  vec3 c = clamp(vec3(r, g, b) / 255.0, vec3(0.0), vec3(1.0));
  return pow(c, vec3(2.2));
}

// 吸积盘着色：Novikov–Thorne 温度轮廓 + 差速旋转湍流 + 多普勒聚束/引力红移
vec4 shadeDisk(vec3 hit, vec3 marchDir) {
  float r = length(hit);
  float x = uDiskInner / r;
  // 轮廓峰值出现在 x ≈ 0.735（r ≈ 1.36 rIn），归一化因子 0.489
  float profile = pow(x, 0.75) * pow(max(1.0 - sqrt(x) * 0.98, 0.0), 0.25);
  float temp = uTempPeak * profile / 0.489;

  // 开普勒差速旋转，双相位交叉淡化避免噪声被无限剪切
  float omega = uOmega * pow(r, -1.5);
  float period = uFlowPeriod;
  float f1 = fract(uTime / period);
  float f2 = fract(uTime / period + 0.5);
  float w = abs(f1 * 2.0 - 1.0);
  float a1 = omega * (f1 - 0.5) * period;
  float a2 = omega * (f2 - 0.5) * period;
  vec2 xz = hit.xz * 3.4;
  float c1 = cos(a1);
  float s1 = sin(a1);
  float c2 = cos(a2);
  float s2 = sin(a2);
  // 采样 R(-a)x，图案随物质沿 +φ 方向旋转（与切向 t = (-z, 0, x) 一致）
  vec2 q1 = vec2(xz.x * c1 + xz.y * s1, -xz.x * s1 + xz.y * c1);
  vec2 q2 = vec2(xz.x * c2 + xz.y * s2, -xz.x * s2 + xz.y * c2);
  // 域扭曲：把团块噪声拉成流动的丝缕
  vec2 w1 = 1.6 * vec2(fbm2(q1 * 0.55 + 3.1), fbm2(q1 * 0.55 - 2.7));
  vec2 w2 = 1.6 * vec2(fbm2(q2 * 0.55 + 3.1), fbm2(q2 * 0.55 - 2.7));
  float n1 = fbm2(q1 + w1);
  float n2 = fbm2(q2 + w2);
  float n = mix(n1, n2, w);

  float band = (r - uDiskInner) / (uDiskOuter - uDiskInner);
  float fade = smoothstep(0.0, 0.06, band) * (1.0 - smoothstep(0.72, 1.0, band));

  // 圆轨道速度（相对局域静止观者）：v/c = sqrt(M/(r-2M))，Rs=1 → M=0.5
  float beta = min(sqrt(0.5 / max(r - 1.0, 0.2)), 0.985);
  vec3 tangent = normalize(vec3(-hit.z, 0.0, hit.x));
  vec3 photonDir = -normalize(marchDir);
  float doppler = sqrt(1.0 - beta * beta) / (1.0 - beta * dot(tangent, photonDir));
  doppler = mix(1.0, doppler, uBeaming);
  float grav = sqrt(max(1.0 - 1.0 / r, 0.0));
  float g = doppler * grav;

  float dens = pow(max(n, 0.0), 2.1);
  float bright = pow(profile / 0.489, 2.0);
  float boost = min(pow(g, 3.0), 5.0);
  vec3 emit = blackbody(temp * g) * (bright * boost * uExposure) * (0.12 + 1.6 * dens);
  float alpha = clamp(dens * 2.4, 0.0, 1.0) * fade;
  return vec4(emit, alpha);
}

// 程序星空：多层网格哈希恒星（按黑体色温着色）+ 银河带
vec3 starLayer(vec3 d, float scale, float density, float glowScale) {
  vec3 p = d * scale;
  vec3 id = floor(p);
  float sr = hash13(id + 7.7);
  if (sr > density) return vec3(0.0);
  vec3 h = hash33(id);
  vec3 f = fract(p);
  vec3 sp = 0.2 + 0.6 * h;
  float dist = length(f - sp);
  float px = uPixelAngle * scale;
  float size = mix(0.03, 0.13, pow(h.y, 7.0));
  float sigma = max(size, px * 0.5);
  float bright = pow(h.z, 12.0) * 3.0 + 0.02;
  float amp = exp(-dist * dist / (2.0 * sigma * sigma)) * bright;
  float tK = mix(2600.0, 11000.0, pow(h.x, 1.6));
  return blackbody(tK) * amp * glowScale;
}

vec3 starField(vec3 d) {
  vec3 c = vec3(0.0);
  c += starLayer(d, 42.0, 0.32, 0.55);
  c += starLayer(d, 90.0, 0.26, 0.38);
  c += starLayer(d, 170.0, 0.2, 0.26);
  float band = dot(d, uMwNormal);
  float mw = exp(-band * band * 26.0);
  float cl = fbm3(d * 4.5 + vec3(9.2, 1.7, 4.4));
  float dust = fbm3(d * 8.0 - vec3(5.0, 3.0, 8.0));
  vec3 mwCol = mix(vec3(0.45, 0.6, 1.0), vec3(1.0, 0.85, 0.65), cl);
  float lanes = 1.0 - 0.75 * smoothstep(0.35, 0.75, dust) * mw;
  c += mwCol * (mw * (0.035 + 0.14 * cl) * lanes);
  c += vec3(0.001, 0.0015, 0.003);
  return c;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 v = uProjInv * vec4(ndc, 0.0, 1.0);
  vec3 dView = normalize(v.xyz / v.w);
  vec3 dir = normalize(mat3(uCamWorld) * dView);
  vec3 pos = uCamPos;

  vec3 hv = cross(pos, dir);
  float h2 = dot(hv, hv);

  vec3 col = vec3(0.0);
  float trans = 1.0;
  bool escaped = false;

  for (int i = 0; i < 700; i++) {
    if (i >= uMaxSteps) break;
    float r2 = dot(pos, pos);
    float r = sqrt(r2);
    if (r < 1.0) break;
    if (r > 60.0 && dot(pos, dir) > 0.0) { escaped = true; break; }

    float dt = clamp(r * 0.11, 0.02, 1.0);
    vec3 acc = (-1.5 * h2 / (r2 * r2 * r)) * pos;
    vec3 prev = pos;
    dir += acc * dt;
    pos += dir * dt;

    if (prev.y * pos.y < 0.0) {
      float t = prev.y / (prev.y - pos.y);
      vec3 hit = mix(prev, pos, t);
      float hr = length(hit);
      if (hr > uDiskInner - 0.4 && hr < uDiskOuter + 0.2) {
        vec4 dc = shadeDisk(hit, dir);
        col += dc.rgb * dc.a * trans;
        trans *= (1.0 - dc.a);
        if (trans < 0.02) break;
      }
    }
  }

  if (escaped && trans > 0.015) {
    col += starField(normalize(dir)) * trans;
  }

  fragColor = vec4(col, 1.0);
}
`;

export const compositeFragment = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 fragColor;
varying vec2 vUv;
uniform sampler2D uTex;
void main() {
  fragColor = texture2D(uTex, vUv);
}
`;
