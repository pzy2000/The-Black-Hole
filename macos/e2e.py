#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""事件视界 macOS 壁纸/屏保 · 设置功能端到端测试

覆盖：默认设置（全最高）/ 最大帧率上限 / 显式画质（不降级）/ BGM 三种播放模式
与曲目选择 / BGM 关闭 / 壁纸失焦四种行为（暂停·停止释放内存·静音·继续）。

用法：
  ./macos/build.sh               # 先构建
  python3 macos/e2e.py           # 跑全部场景（需要 GUI 会话，会短暂显示壁纸/屏保并出声）
  python3 macos/e2e.py fps bgm_single focus_stop   # 只跑指定场景
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HARNESS = ROOT / "macos/build/harness/EHSaverHarness"
SAVER = ROOT / "macos/build/EventHorizon.saver"
APP_BIN = ROOT / "macos/build/事件视界壁纸.app/Contents/MacOS/EventHorizonWallpaper"
SETTINGS = Path.home() / "Library/Application Support/EventHorizon/settings.json"

DEFAULTS = {
    "version": 1,
    "quality": "ultra",
    "maxFps": 0,
    "focusAction": "pause",
    "bgm": {"enabled": True, "track": "all", "mode": "list", "volume": 0.6},
}

RESULTS = []


def write_settings(cfg: dict) -> None:
    SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS.write_text(json.dumps(cfg), encoding="utf-8")


def clear_settings() -> None:
    SETTINGS.unlink(missing_ok=True)


def run_harness(cfg, *, eval_js=None, rounds=2, warmup=14):
    """跑屏保宿主，返回 (rounds 列表, eval 结果, 原始输出)；cfg=None 表示删除设置文件用默认"""
    if cfg is None:
        clear_settings()
    else:
        write_settings(cfg)
    env = dict(os.environ, EH_ROUNDS=str(rounds), EH_WARMUP=str(warmup))
    if eval_js:
        env["EH_EVAL"] = eval_js
    p = subprocess.run(
        [str(HARNESS), str(SAVER)], env=env, capture_output=True, text=True,
        timeout=warmup + rounds * 6 + 90,
    )
    out = p.stdout + p.stderr
    data = []
    for line in out.splitlines():
        m = re.match(r"HARNESS round (\d+): (.*)", line)
        if m and m.group(2).startswith("{"):
            try:
                data.append(json.loads(m.group(2)))
            except json.JSONDecodeError:
                pass
    ev = None
    for line in out.splitlines():
        if line.startswith("HARNESS-EVAL: "):
            ev = line[len("HARNESS-EVAL: "):]
    return data, ev, out


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


def expect(cond_fn, name, data, out):
    """data 为空或条件不满足时打印诊断"""
    ok = bool(data) and cond_fn(data)
    check(name, ok, "" if ok else f"rounds={json.dumps(data, ensure_ascii=False)[:800]}\n--- out ---\n{out[-1200:]}")


# —— 屏保/网页端场景 ——

def t_defaults():
    data, ev, out = run_harness(None, rounds=2, warmup=14)
    expect(lambda ds: ds[0]["quality"] == "ultra" and ds[0]["settings"]["quality"] == "ultra",
           "默认画质 = 超高", data, out)
    expect(lambda ds: ds[0]["fpsCap"] == 0 and ds[0]["settings"]["maxFps"] == 0,
           "默认帧率 = 不限", data, out)
    expect(lambda ds: ds[0]["settings"] == DEFAULTS, "无设置文件时 = 全默认", data, out)
    expect(lambda ds: ds[0]["bgm"]["ready"] and len(ds[0]["bgm"]["tracks"]) == 3,
           "BGM 自动扫描到 3 首曲目", data, out)
    expect(lambda ds: ds[0]["bgm"]["master"] and ds[0]["bgm"]["playing"],
           "BGM 自动播放（eh:// 音频可用）", data, out)
    expect(lambda ds: len(ds) >= 2 and ds[1]["frames"] > ds[0]["frames"],
           "画面帧持续推进", data, out)
    expect(lambda ds: ds[0]["paused"] is False, "默认不暂停", data, out)


def t_fps_cap():
    data, ev, out = run_harness({"maxFps": 30}, rounds=3, warmup=16)
    expect(lambda ds: all(d["settings"]["maxFps"] == 30 for d in ds),
           "设置 maxFps=30 已下发", data, out)
    fps = data[-1]["fps"] if data else -1
    check("实测帧率 ≈30（不超上限、不明显掉帧）", 18 < fps <= 33, f"实测 fps={fps:.1f}")
    expect(lambda ds: all(d["quality"] == "ultra" for d in ds),
           "限帧下画质不降级", data, out)


def t_quality_explicit():
    data, ev, out = run_harness({"quality": "medium"}, rounds=3, warmup=16)
    expect(lambda ds: all(d["quality"] == "medium" for d in ds),
           "显式画质=中 且不被自动降级", data, out)


def t_bgm_list():
    data, ev, out = run_harness(None, rounds=2, warmup=14,
                                eval_js="window.__ehCinema.bgmSeekToEnd(); 'seeked'")
    expect(lambda ds: ds and ev == "seeked", "seekToEnd 测试钩子可用", data, out)
    expect(lambda ds: len(ds) == 2 and ds[0]["bgm"]["time"] >= ds[0]["bgm"]["duration"] - 1.5,
           "seek 后位于曲尾", data, out)
    n = 3
    expect(lambda ds: ds[1]["bgm"]["index"] == (ds[0]["bgm"]["index"] + 1) % n
           and ds[1]["bgm"]["playing"],
           "列表循环：曲尾后切下一首", data, out)


def t_bgm_single():
    data, ev, out = run_harness({"bgm": {"mode": "single"}}, rounds=2, warmup=14,
                                eval_js="window.__ehCinema.bgmSeekToEnd(); 'seeked'")
    expect(lambda ds: ds[1]["bgm"]["index"] == ds[0]["bgm"]["index"]
           and ds[1]["bgm"]["time"] < 60 and ds[1]["bgm"]["playing"],
           "单曲循环：曲尾后重播同一首", data, out)


def t_bgm_shuffle():
    data, ev, out = run_harness({"bgm": {"mode": "shuffle"}}, rounds=2, warmup=14,
                                eval_js="window.__ehCinema.bgmSeekToEnd(); 'seeked'")
    expect(lambda ds: ds[1]["bgm"]["index"] != ds[0]["bgm"]["index"]
           and ds[1]["bgm"]["playing"],
           "随机播放：曲尾后换随机另一首", data, out)


def t_bgm_disabled():
    data, ev, out = run_harness({"bgm": {"enabled": False}}, rounds=2, warmup=14)
    expect(lambda ds: ds[0]["bgm"]["enabled"] is False and ds[0]["bgm"]["playing"] is False,
           "关闭 BGM 后不播放", data, out)
    expect(lambda ds: ds[0]["bgm"]["muted"] is True, "关闭 BGM 时 muted=true", data, out)
    expect(lambda ds: len(ds[0]["bgm"]["tracks"]) == 3, "关闭后仍扫描曲目", data, out)


def t_bgm_track():
    data, ev, out = run_harness({"bgm": {"track": "bgm_02.mp3"}}, rounds=2, warmup=14)
    expect(lambda ds: ds[0]["bgm"]["track"] == "bgm_02.mp3" and ds[0]["bgm"]["index"] == 1
           and ds[0]["bgm"]["playing"],
           "指定曲目从 bgm_02 开始播放", data, out)


# —— 壁纸失焦场景 ——

def webcontent_pids() -> set:
    out = subprocess.run(["pgrep", "-f", "com.apple.WebKit.WebContent"],
                         capture_output=True, text=True).stdout
    return {int(x) for x in out.split()}


def run_wallpaper(cfg: dict) -> tuple:
    """EH_TEST_FOCUS：6s 注入遮挡、16s 解除；EH_POLL 每 8s 一轮；26s 后自动退出。
    返回 (输出, t≈4s 时属于本应用的 WebContent pid 集, 遮挡后 t≈10s 的该集合)。
    WebContent 经 XPC 启动、非本应用子进程，用「应用启动前后快照差集」归因。"""
    write_settings(cfg)
    baseline = webcontent_pids()
    env = dict(os.environ, EH_POLL="1", EH_TEST_FOCUS="1", EH_QUIT_AFTER="26")
    p = subprocess.Popen([str(APP_BIN)], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    time.sleep(4)
    mine = webcontent_pids() - baseline  # 本应用拉起的 WebContent
    time.sleep(6)
    kids_occluded = webcontent_pids() & mine
    for _ in range(3):  # stop 场景 WebContent 异步退出，最多多等 6s
        if not kids_occluded:
            break
        time.sleep(2)
        kids_occluded = webcontent_pids() & mine
    out_lines = []
    deadline = time.time() + 30
    while time.time() < deadline:
        line = p.stdout.readline() if p.stdout else ""
        if line:
            out_lines.append(line.rstrip())
        if p.poll() is not None:
            break
    try:
        p.wait(timeout=15)
    except subprocess.TimeoutExpired:
        p.kill()
    out = "\n".join(out_lines) + (p.stdout.read() if p.stdout else "")
    return out, sorted(mine), sorted(kids_occluded)


def parse_wall_rounds(out: str) -> list[dict]:
    """从 EH_POLL 日志提取 screen0 的 cinemaStatus JSON"""
    data = []
    for line in out.splitlines():
        m = re.search(r"screen0.*: (\{.*\})\s*$", line)
        if m and '"frames"' in m.group(1):
            try:
                data.append(json.loads(m.group(1)))
            except json.JSONDecodeError:
                pass
    return data


def t_focus_pause():
    out, before, occl = run_wallpaper({"focusAction": "pause"})
    data = parse_wall_rounds(out)
    check("焦点暂停：遮挡时 WebContent 仍存活（保留画面）", len(before) >= 1 and len(occl) >= 1,
          f"before={before} occluded={occl}")
    expect(lambda ds: any(d["paused"] is True for d in ds[:2]),
           "焦点暂停：遮挡时页面冻结 (paused=true)", data, out)
    check("焦点暂停：日志有 pause 动作", "screen0 失焦策略 → pause" in out, out[-800:])
    check("焦点暂停：日志有恢复 visible", "screen0 失焦策略 → visible" in out, out[-800:])
    expect(lambda ds: ds[-1]["paused"] is False and ds[-1]["frames"] > ds[0]["frames"],
           "焦点暂停：解除后恢复推进", data, out)
    expect(lambda ds: ds[-1]["bgm"]["playing"] is True,
           "焦点暂停：解除后 BGM 恢复", data, out)


def t_focus_stop():
    out, before, occl = run_wallpaper({"focusAction": "stop"})
    data = parse_wall_rounds(out)
    check("焦点停止：遮挡时 WebContent 子进程被回收（释放内存）",
          len(before) >= 1 and len(occl) == 0, f"before={before} occluded={occl}")
    check("焦点停止：日志有释放记录", "已停止并释放 WebView" in out, out[-800:])
    check("焦点停止：轮询期间 screen0 曾被释放", "screen0: released" in out, out[-800:])
    expect(lambda ds: ds and ds[-1]["frames"] > 0 and ds[-1]["paused"] is False,
           "焦点停止：解除后自动重建并恢复渲染", data, out)


def t_focus_mute():
    out, before, occl = run_wallpaper({"focusAction": "mute"})
    data = parse_wall_rounds(out)
    check("焦点静音：日志有 mute 动作", "screen0 失焦策略 → mute" in out, out[-800:])
    expect(lambda ds: any(d["paused"] is False and d["frames"] > 0 for d in ds),
           "焦点静音：渲染不停止", data, out)
    expect(lambda ds: any(d["muted"] is True and d["bgm"]["playing"] is False for d in ds[:2]),
           "焦点静音：遮挡时静音生效（muted=true 且无出声）", data, out)
    expect(lambda ds: ds[-1]["muted"] is False and ds[-1]["bgm"]["playing"] is True,
           "焦点静音：解除后恢复出声", data, out)


def t_focus_continue():
    out, before, occl = run_wallpaper({"focusAction": "continue"})
    data = parse_wall_rounds(out)
    check("焦点继续：无 pause/stop/mute 策略动作",
          re.search(r"失焦策略 → (pause|stop|mute)", out) is None, out[-800:])
    expect(lambda ds: len(ds) >= 2 and all(d["paused"] is False for d in ds)
           and ds[-1]["frames"] > ds[0]["frames"],
           "焦点继续：全程持续渲染", data, out)
    expect(lambda ds: all(d["bgm"]["playing"] for d in ds),
           "焦点继续：BGM 全程播放", data, out)


ALL = {
    "defaults": t_defaults,
    "fps": t_fps_cap,
    "quality": t_quality_explicit,
    "bgm_list": t_bgm_list,
    "bgm_single": t_bgm_single,
    "bgm_shuffle": t_bgm_shuffle,
    "bgm_off": t_bgm_disabled,
    "bgm_track": t_bgm_track,
    "focus_pause": t_focus_pause,
    "focus_stop": t_focus_stop,
    "focus_mute": t_focus_mute,
    "focus_continue": t_focus_continue,
}


def main():
    names = sys.argv[1:] or list(ALL)
    for n in names:
        if n not in ALL:
            print(f"未知场景: {n}（可选: {', '.join(ALL)}）")
            return 2
    for n in names:
        print(f"\n—— 场景 {n} ——")
        try:
            ALL[n]()
        except Exception as e:  # noqa: BLE001
            check(n + "（异常）", False, repr(e))
    clear_settings()  # 测试完清掉，恢复默认
    fails = [r for r in RESULTS if not r[1]]
    print(f"\n===== 结果：{len(RESULTS) - len(fails)}/{len(RESULTS)} 通过 =====")
    for name, ok, detail in fails:
        print(f"FAIL {name}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
