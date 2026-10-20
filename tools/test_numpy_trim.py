"""验证：删掉 numpy.libs 的 OpenBLAS 后，numpy 与项目功能是否仍正常。

## 为什么这么做

`numpy.libs` 里只有一个 36.4 MB 的 `libopenblas64__*.dll`。
numpy 的 `linalg` / `dot` / `matmul` 才需要它。

实测项目**完全没用**这些：
  np.abs / array / ceil / clip / convolve / diff / fft / geomspace /
  hanning / log10 / maximum / median / ones / pad / percentile / sqrt /
  where / zeros

这些都在 `_multiarray_umath` 里，不依赖 BLAS。

## 风险

删错了会在**运行时**才暴露（某个冷门路径调 linalg）。
故验证要覆盖真实工作流：导入工程 → 分析音频 → 渲染。

## 做法

1. 把 numpy.libs 临时改名（不删，可回滚）
2. 跑真实工作流
3. 成功则保留删除，失败则恢复
"""
import json
import pathlib
import shutil
import subprocess
import sys
import time
import urllib.request

根 = pathlib.Path(r"D:\FL_VISUAL_TEST")
dist = 根 / "dist" / "FLVisualizer"
np_libs = dist / "numpy.libs"
备份 = dist / "numpy.libs.bak"

print("=" * 70)
print("验证：能否删掉 numpy.libs（36.4 MB 的 OpenBLAS）")
print("=" * 70)
print()

if not np_libs.is_dir():
    print("numpy.libs 不存在，可能已删。检查是否仍在工作：")
else:
    大小 = sum(f.stat().st_size for f in np_libs.rglob("*") if f.is_file())
    print("numpy.libs 存在，%.1f MB" % (大小 / 1e6))

    # 备份（改名而不是删）
    if 备份.exists():
        shutil.rmtree(备份)
    np_libs.rename(备份)
    print("已临时移除（改名为 numpy.libs.bak）")
print()

# ---- 直接测 numpy 能否导入 + 用项目实际用到的函数 ----
print("【1】numpy 导入与关键函数")
测试代码 = r"""
import sys
import numpy as np
print('  numpy', np.__version__)

# 项目实际用到的函数
a = np.array([1.0, 2.0, 3.0, 4.0])
print('  abs     ', float(np.abs(np.array([-1.0]))[0]))
print('  clip    ', float(np.clip(a, 1.5, 3.5)[0]))
print('  diff    ', np.diff(a).tolist())
print('  convolve', np.convolve(a, np.ones(2), mode='same').tolist()[:3])
print('  fft     ', len(np.fft.rfft(a)))
print('  geomspace', len(np.geomspace(20, 20000, 8)))
print('  hanning ', len(np.hanning(16)))
print('  log10   ', round(float(np.log10(np.array([100.0]))[0]), 3))
print('  maximum ', np.maximum(a, 2.5).tolist())
print('  median  ', float(np.median(a)))
print('  pad     ', np.pad(a, 1).tolist())
print('  percentile', float(np.percentile(a, 50)))
print('  sqrt    ', round(float(np.sqrt(np.array([16.0]))[0]), 3))
print('  where   ', np.where(a > 2, 1, 0).tolist())
print('  zeros_like', np.zeros_like(a).tolist())
print('  array_split', len(np.array_split(a, 2)))
print('  ceil    ', np.ceil(np.array([1.2])).tolist())
print('  full    ', np.full(3, 7).tolist())
print('  ones    ', np.ones(3).tolist())
print('  int16   ', np.array([1], dtype=np.int16).dtype)
print('  float32 ', np.array([1], dtype=np.float32).dtype)
print('  uint8   ', np.array([1], dtype=np.uint8).dtype)
print('  np.lib  ', hasattr(np, 'lib'))

# 项目依赖的第三方
import soundfile
print('  soundfile OK')
import imageio_ffmpeg
print('  imageio_ffmpeg OK')
print('ALL_OK')
"""
r = subprocess.run([sys.executable, "-c", 测试代码],
                   capture_output=True, text=True, encoding="utf-8",
                   errors="replace", cwd=str(dist), timeout=120)
out = (r.stdout or "") + (r.stderr or "")
print(out)
成功1 = "ALL_OK" in out
print("  结果:", "✓ 通过" if 成功1 else "✗ 失败")
print()

# ---- 用打包版跑真实工作流 ----
print("【2】打包版真实工作流（导入 + 渲染）")
if not 成功1:
    print("  跳过（上一步已失败）")
    成功2 = False
else:
    # 启动 exe
    Get = subprocess.run
    subprocess.run(["powershell", "-NoProfile", "-Command",
                    "Get-CimInstance Win32_Process -Filter "
                    "\"Name='FLVisualizer.exe'\" | "
                    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force "
                    "-ErrorAction SilentlyContinue }"],
                   capture_output=True, timeout=60)
    time.sleep(2)

    端口 = 11200
    p = subprocess.Popen([str(dist / "FLVisualizer.exe"),
                          "--port", str(端口)],
                         cwd=str(dist),
                         stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL)

    def 请求(路径, 数据=None, 超时=600):
        url = "http://127.0.0.1:%d%s" % (端口, 路径)
        b = json.dumps(数据).encode() if 数据 is not None else None
        req = urllib.request.Request(
            url, data=b, method="POST" if b else "GET",
            headers={"Content-Type": "application/json"} if b else {})
        with urllib.request.urlopen(req, timeout=超时) as rr:
            return json.loads(rr.read())

    成功2 = False
    try:
        # 等服务就绪
        会话 = None
        for _ in range(40):
            time.sleep(1)
            try:
                会话 = 请求("/api/session", 超时=5)
                break
            except Exception:
                pass

        if 会话 is None:
            print("  ✗ 服务未就绪")
        else:
            print("  服务就绪")
            # 导入（走完整的音频分析，会用到 fft/percentile 等）
            工程 = pathlib.Path(r"E:\FL_Project\amapiano")
            rr = 请求("/api/import", {"flp": str(工程 / "amapiano.flp"),
                                    "audio": str(工程 / "amapiano.mp3")})
            t = {}
            for _ in range(400):
                time.sleep(1.5)
                t = 请求("/api/job?id=" + rr["id"])
                if t.get("状态") != "运行中":
                    break
            print("  导入:", t.get("状态"))

            if t.get("状态") == "完成":
                会话 = 请求("/api/session")
                ts = json.loads((根 / "preview" / "templates.json")
                                .read_text(encoding="utf-8"))
                组件 = [x for x in ts if x.get("name") == "基础"][0]["land"]
                out = dist / "out" / "numpy_test.mp4"
                out.parent.mkdir(exist_ok=True)
                if out.exists():
                    out.unlink()
                rr = 请求("/api/render", {
                    "flp": 会话.get("flp"), "audio": 会话.get("audio"),
                    "主题": "sumi", "画布": {"w": 1920, "h": 1080},
                    "帧率": 6, "时长": 2, "起点": 20,
                    "输出": str(out), "预设": "ultrafast", "并行度": 2,
                    "组件": 组件,
                })
                for _ in range(400):
                    time.sleep(2)
                    t = 请求("/api/job?id=" + str(rr["id"]))
                    if t.get("状态") != "运行中":
                        break
                print("  渲染:", t.get("状态"))
                if t.get("状态") == "完成" and out.is_file():
                    print("  输出: %.1f MB" % (out.stat().st_size / 1e6))
                    成功2 = True
                else:
                    print("  错误:", (t.get("错误") or "")[:200])
    finally:
        subprocess.run(["powershell", "-NoProfile", "-Command",
                        "Get-CimInstance Win32_Process -Filter "
                        "\"Name='FLVisualizer.exe'\" | "
                        "ForEach-Object { Stop-Process -Id $_.ProcessId "
                        "-Force -ErrorAction SilentlyContinue }"],
                       capture_output=True, timeout=60)
        time.sleep(2)

print()
print("=" * 70)
if 成功1 and 成功2:
    print("结论：可以删。numpy 与真实工作流都正常。")
    print("建议：保留删除（省 36.4 MB）。备份在 numpy.libs.bak，确认后可删。")
    print()
    print("若确认无误，执行：")
    print("  Remove-Item dist\\FLVisualizer\\numpy.libs.bak -Recurse -Force")
    print("并在 spec 里加排除规则，避免下次打包又带进来。")
else:
    print("结论：**不能删**。")
    if 备份.is_dir():
        if np_libs.is_dir():
            shutil.rmtree(np_libs)
        备份.rename(np_libs)
        print("已恢复 numpy.libs。")
print("=" * 70)
