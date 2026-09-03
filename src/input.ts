import * as THREE from 'three';

// 键盘 + 鼠标拖拽输入。W/S/A/D/R/F 推进，Q/E 滚转，Z 时间加速，X 自动刹车，C 机位
export class Input {
  readonly keys = new Set<string>();
  // 本帧累计的鼠标增量（拖拽转向），由主循环消费后清零
  yawDelta = 0;
  pitchDelta = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      this.yawDelta += (e.clientX - this.lastX) * 0.0032;
      this.pitchDelta += (e.clientY - this.lastY) * 0.0032;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    // 触屏简单支持
    el.addEventListener(
      'touchstart',
      (e) => {
        const t = e.touches[0];
        this.dragging = true;
        this.lastX = t.clientX;
        this.lastY = t.clientY;
      },
      { passive: true },
    );
    el.addEventListener(
      'touchmove',
      (e) => {
        const t = e.touches[0];
        if (!this.dragging) return;
        this.yawDelta += (t.clientX - this.lastX) * 0.0032;
        this.pitchDelta += (t.clientY - this.lastY) * 0.0032;
        this.lastX = t.clientX;
        this.lastY = t.clientY;
      },
      { passive: true },
    );
    el.addEventListener('touchend', () => (this.dragging = false));
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  consumeLook(): { yaw: number; pitch: number } {
    const r = { yaw: this.yawDelta, pitch: this.pitchDelta };
    this.yawDelta = 0;
    this.pitchDelta = 0;
    return r;
  }

  // 世界系推力方向：相对飞船姿态（W 前 S 后 A 左 D 右 R 上 F 下），写入 out
  thrustDir(quat: THREE.Quaternion, out: THREE.Vector3): boolean {
    out.set(0, 0, 0);
    if (this.down('KeyW')) out.z += 1;
    if (this.down('KeyS')) out.z -= 1;
    if (this.down('KeyA')) out.x -= 1;
    if (this.down('KeyD')) out.x += 1;
    if (this.down('KeyR')) out.y += 1;
    if (this.down('KeyF')) out.y -= 1;
    if (out.lengthSq() === 0) return false;
    out.normalize().applyQuaternion(quat);
    return true;
  }
}
