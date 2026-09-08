# -*- coding: utf-8 -*-
"""make-splash.py — 스플래시 애니메이션을 애니메이션 WebP 로 굽는다.

  python tools/make-splash.py <입력> [옵션]

입력은 셋 중 하나다:
  * .mp4 / .mov / .webm   — ffmpeg 이 있어야 한다(아래 참고)
  * .gif / .png(APNG)     — Pillow 가 직접 읽는다
  * 폴더                   — 안의 PNG/JPG 를 이름순으로 프레임으로 쓴다

왜 WebP 이고 왜 한 번만 재생하나
--------------------------------
스플래시가 떠 있는 시간은 부팅이 얼마나 걸리느냐에 달렸다 — 캐시가 있으면
0.5초, 모바일 데이터로 처음 켜면 몇 초. 영상 길이는 고정이니 맞출 수가 없다.
그래서 **한 번 재생하고 로고에서 멈추게** 굽는다(loop=1). 그 뒤로는 로고 아래
CSS 링이 계속 돌아 남은 시간을 메운다. 부팅이 빠르면 애니메이션이 잘리지만,
잘린 자리가 로고이므로 눈에 거슬리지 않는다.

MP4 는 왜 투명해질 수 없나
--------------------------
H.264 에 알파가 없다. 그리고 이 환경의 Pillow(12.1.1)는 **애니메이션 WebP 에
알파를 아예 못 쓴다** — 재 봤다: 저장된 파일에 ALPH 청크가 없고 VP8X 의 알파
플래그가 꺼진다(단일 프레임은 정상). 그래서 결과는 항상 불투명하다.

불투명이 문제가 아니게 만드는 방법: 배경색을 스플래시와 **맞추면 된다**.
라이트/다크를 다 받치려면 배경만 다른 두 벌을 굽고(--bg) HTML 의 <picture> 가
prefers-color-scheme 으로 하나만 내려받게 한다. 알파를 흉내내는 키잉보다
튼튼하고, 파일도 알파본보다 작다.
"""
import argparse
import io
import os
import shutil
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow 이 없습니다:  pip install pillow")

VID = (".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv")
IMG = (".png", ".jpg", ".jpeg", ".webp", ".bmp")


# ---------------------------------------------------------------- 프레임 읽기
def ffmpeg_bin():
    """ffmpeg 을 찾는다. PATH 를 먼저 보고, 없으면 imageio-ffmpeg 이 받아 둔
    번들 바이너리를 쓴다(pip install imageio-ffmpeg — 시스템을 건드리지 않는다)."""
    p = shutil.which("ffmpeg")
    if p:
        return p, "PATH"
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe(), "imageio-ffmpeg"
    except Exception:
        return None, None


def from_video(path, fps):
    exe, how = ffmpeg_bin()
    if not exe:
        sys.exit(
            "영상을 풀 수단이 없습니다. 셋 중 하나를 해 주세요:\n"
            "  1) winget install ffmpeg          (시스템에 설치, PATH 에 올라감)\n"
            "  2) pip install imageio-ffmpeg     (파이썬 안에만, 덜 침범적)\n"
            "  3) 편집기에서 PNG 시퀀스나 GIF 로 내보내 그 폴더/파일을 넘기기\n"
            "     (이 길은 아무것도 설치할 필요가 없습니다)"
        )
    print(f"  ffmpeg: {exe}  ({how})")
    tmp = tempfile.mkdtemp(prefix="splash_")
    # -vsync 0 을 주지 않으면 ffmpeg 이 프레임을 복제해 채운다
    cmd = [exe, "-hide_banner", "-loglevel", "error", "-i", path,
           "-vf", f"fps={fps}", "-vsync", "0",
           os.path.join(tmp, "f_%05d.png")]
    subprocess.run(cmd, check=True)
    fs = sorted(f for f in os.listdir(tmp) if f.endswith(".png"))
    if not fs:
        sys.exit("영상에서 프레임을 못 뽑았습니다.")
    return [Image.open(os.path.join(tmp, f)).convert("RGBA") for f in fs], tmp


def from_animated(path):
    im = Image.open(path)
    n = getattr(im, "n_frames", 1)
    out = []
    for i in range(n):
        im.seek(i)
        out.append(im.convert("RGBA"))
    return out, None


def from_dir(path):
    fs = sorted(f for f in os.listdir(path) if f.lower().endswith(IMG))
    if not fs:
        sys.exit(f"{path} 안에 이미지가 없습니다.")
    return [Image.open(os.path.join(path, f)).convert("RGBA") for f in fs], None


def load(src, fps):
    if os.path.isdir(src):
        return from_dir(src)
    ext = os.path.splitext(src)[1].lower()
    if ext in VID:
        return from_video(src, fps)
    if ext in (".gif", ".png", ".webp"):
        return from_animated(src)
    sys.exit(f"어떻게 읽을지 모르는 입력입니다: {src}")


# ---------------------------------------------------------------- 프레임 손질
def square(im, size, bg):
    """정사각형으로 맞춘다. 원본 비율은 지키고 남는 자리를 배경색으로 채운다.
    스플래시는 화면 가운데 정사각형 자리에 놓이므로 여기서 맞춰 두는 게 낫다."""
    w, h = im.size
    s = min(size / w, size / h)
    im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), bg)
    out.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
    return out


def flatten(im, bg):
    """알파를 배경색 위에 눕힌다. 애니메이션 WebP 가 알파를 못 쓰므로
    여기서 확실히 없애 둔다 — 인코더에 맡기면 검게 눕는다."""
    base = Image.new("RGBA", im.size, bg)
    base.alpha_composite(im)
    return base.convert("RGB")


def bake(frames, out, size, bg, fps, quality, method):
    fs = [flatten(square(f, size, bg), bg) for f in frames]
    ms = max(10, round(1000 / fps))
    fs[0].save(
        out, save_all=True, append_images=fs[1:],
        duration=ms,
        loop=1,          # 한 번만. 마지막 프레임에서 멈춘다.
        quality=quality,
        method=method,   # 0~6, 클수록 느리지만 작아진다
        minimize_size=True,
    )
    return os.path.getsize(out), len(fs), ms


def hexcolor(v):
    v = v.strip().lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    if len(v) != 6:
        raise argparse.ArgumentTypeError(f"6자리 hex 가 아닙니다: {v}")
    return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", help="mp4 / gif / apng / 프레임 폴더")
    ap.add_argument("--out", default="icons/splash", help="출력 앞자리 (기본 icons/splash)")
    ap.add_argument("--size", type=int, default=448, help="정사각 한 변 px (기본 448)")
    ap.add_argument("--fps", type=int, default=20, help="초당 프레임 (기본 20)")
    ap.add_argument("--quality", type=int, default=76, help="0~100 (기본 76)")
    ap.add_argument("--method", type=int, default=6, help="압축 노력 0~6 (기본 6)")
    ap.add_argument("--bg", default="ffffff",
                    help="배경색. 콤마로 두 개 주면 두 벌 굽는다 "
                         "(예: ffffff,17171C → splash-light/dark.webp)")
    ap.add_argument("--budget", type=int, default=400, help="한 파일 경고 기준 KB (기본 400)")
    a = ap.parse_args()

    frames, tmp = load(a.src, a.fps)
    print(f"  프레임 {len(frames)}장, 원본 {frames[0].size[0]}x{frames[0].size[1]}")

    bgs = [b for b in a.bg.split(",") if b.strip()]
    names = ["light", "dark"] if len(bgs) > 1 else [None]
    total = 0
    for bg_s, tag in zip(bgs, names):
        bg = hexcolor(bg_s)
        out = f"{a.out}-{tag}.webp" if tag else f"{a.out}.webp"
        os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
        n, cnt, ms = bake(frames, out, a.size, bg, a.fps, a.quality, a.method)
        total += n
        warn = "  ← 예산 초과" if n > a.budget * 1024 else ""
        print(f"  {out}  {n/1024:.1f} KB  ({cnt}프레임 x {ms}ms = {cnt*ms/1000:.2f}초){warn}")

    if tmp:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"  합계 {total/1024:.1f} KB")
    if total > a.budget * 1024:
        print("  줄이려면: --size 384  --fps 15  --quality 66  또는 영상을 짧게")


if __name__ == "__main__":
    main()
