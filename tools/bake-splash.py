# -*- coding: utf-8 -*-
"""bake-splash.py — 스플래시 애니메이션을 원본에서 구워 낸다.

  python tools/bake-splash.py <원본.webp> <출력앞자리> --drop 15 --bg FFFFFF --fg 4279B8

하는 일 두 가지
---------------
① **앞쪽 정지 프레임 잘라내기** — 컨테이너 수준에서 ANMF 조각을 버린다.
   이 원본은 47프레임이 모두 전체 캔버스 독립 키프레임(VP8, 부분 갱신 없음)
   이라 앞 조각을 떼고 RIFF 길이만 다시 써도 뒤가 깨지지 않는다. 손실 0.
② **두 색 맞바꾸기** — 원본은 흰 늑대 / 파란 배경이다. 사진 반전(255-v)을
   쓰면 파랑이 주황(#BD8647)이 되어 못 쓴다. 두 색을 잇는 선 위로 픽셀을
   투영해 "늑대다움" t 를 구하고 새 두 색을 t 로 섞는다. 경계의 부드러움
   (안티앨리어싱)이 그대로 살아난다.

왜 늘 원본에서 굽나
-------------------
색을 바꾸면 다시 인코딩할 수밖에 없다(손실). 이미 구운 결과물을 또 구우면
손실이 겹친다. 라이트/다크 두 벌 모두 **원본에서 한 번씩만** 굽는다.

왜 파일 이름에 버전이 붙나
--------------------------
서비스 워커가 스플래시를 버전 없는 캐시(fursuitfryday-media)에 담는다.
배포해도 안 지워지므로, 이름을 그대로 두고 내용만 고치면 옛 파일이 영원히
나온다 — 한 번 겪었다. 그림을 바꿀 때마다 앞자리의 버전을 올린다.
"""
import argparse
import os
import struct
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow 이 없습니다:  pip install pillow")


def hexcolor(v):
    v = v.strip().lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    if len(v) != 6:
        raise argparse.ArgumentTypeError(f"6자리 hex 가 아닙니다: {v}")
    return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4))


def chunks(b):
    """RIFF 청크를 (태그, 통째 바이트) 로 훑는다. 청크는 짝수로 패딩된다."""
    i = 12
    while i + 8 <= len(b):
        tag = b[i:i + 4].decode("latin1")
        sz = struct.unpack("<I", b[i + 4:i + 8])[0]
        yield tag, b[i:i + 8 + sz + (sz & 1)], b[i + 8:i + 8 + sz]
        i += 8 + sz + (sz & 1)


def trim(b, drop):
    """앞 drop 개 프레임을 컨테이너에서 떼어낸다. 재인코딩 없음."""
    head, anmf, durs = [], [], []
    for tag, whole, body in chunks(b):
        if tag == "ANMF":
            anmf.append(whole)
            durs.append(int.from_bytes(body[12:15], "little"))
        else:
            head.append(whole)
    if drop >= len(anmf):
        sys.exit(f"프레임이 {len(anmf)}개인데 {drop}개를 떼라고 하셨습니다.")
    body = b"".join(head) + b"".join(anmf[drop:])
    out = b"RIFF" + struct.pack("<I", 4 + len(body)) + b"WEBP" + body
    return out, durs[drop:]


def sample_two_colors(im, n):
    """원본의 배경색·전경색을 실제 픽셀에서 뽑는다. 값을 손으로 적으면
       영상이 바뀔 때 조용히 틀린다."""
    from collections import Counter
    bgc, fgc = Counter(), Counter()
    w, h = im.size
    for k in range(n):
        im.seek(k)
        f = im.convert("RGB")
        for x in range(8, w - 8, 4):                 # 위아래 안쪽 = 배경
            bgc[f.getpixel((x, 8))] += 1
            bgc[f.getpixel((x, h - 9))] += 1
        for y in range(h // 2 - 4, h // 2 + 4):      # 가운데 = 전경
            fgc[f.getpixel((w // 2, y))] += 1
    return bgc.most_common(1)[0][0], fgc.most_common(1)[0][0]


def recolor(im, n, src_bg, src_fg, bg, fg):
    dv = [src_fg[k] - src_bg[k] for k in range(3)]
    den = sum(c * c for c in dv) or 1
    out = []
    for k in range(n):
        im.seek(k)
        f = im.convert("RGB")
        w, h = f.size
        src, dst = f.load(), Image.new("RGB", (w, h))
        dp = dst.load()
        for y in range(h):
            for x in range(w):
                p = src[x, y]
                t = sum((p[c] - src_bg[c]) * dv[c] for c in range(3)) / den
                t = 0.0 if t < 0 else (1.0 if t > 1 else t)
                dp[x, y] = tuple(round(bg[c] + (fg[c] - bg[c]) * t) for c in range(3))
        out.append(dst)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out", help="출력 앞자리 (예: icons/splash-v4)")
    ap.add_argument("--drop", type=int, default=0, help="앞에서 떼어낼 프레임 수")
    ap.add_argument("--bg", type=hexcolor, required=True, help="새 배경색")
    ap.add_argument("--fg", type=hexcolor, required=True, help="새 늑대색")
    ap.add_argument("--quality", type=int, default=80)
    a = ap.parse_args()

    raw = open(a.src, "rb").read()
    trimmed, durs = trim(raw, a.drop)
    tmp = a.out + ".trim.tmp.webp"
    open(tmp, "wb").write(trimmed)

    im = Image.open(tmp)
    n = im.n_frames
    src_bg, src_fg = sample_two_colors(im, n)
    print(f"  원본에서 {a.drop}프레임 떼고 {n}프레임, {sum(durs)}ms")
    print(f"  원본 색  배경 #{src_bg[0]:02X}{src_bg[1]:02X}{src_bg[2]:02X}"
          f"  늑대 #{src_fg[0]:02X}{src_fg[1]:02X}{src_fg[2]:02X}")
    print(f"  새   색  배경 #{a.bg[0]:02X}{a.bg[1]:02X}{a.bg[2]:02X}"
          f"  늑대 #{a.fg[0]:02X}{a.fg[1]:02X}{a.fg[2]:02X}")

    fr = recolor(im, n, src_bg, src_fg, a.bg, a.fg)
    im.close()
    os.remove(tmp)

    anim = a.out + ".webp"
    fr[0].save(anim, save_all=True, append_images=fr[1:], duration=durs,
               loop=1,                      # 한 번만. 마지막 프레임에서 멈춘다.
               quality=a.quality, method=6, minimize_size=True)
    fr[0].save(a.out + "-first.webp", quality=88, method=6)
    fr[-1].save(a.out + "-last.webp", quality=88, method=6)

    # 되짚어 확인 — 눈으로 못 보는 값은 재서 확인한다
    chk = Image.open(anim)
    got = [d for t, _, bd in chunks(open(anim, "rb").read()) if t == "ANMF"
           for d in [int.from_bytes(bd[12:15], "little")]]
    loops = next((struct.unpack("<H", bd[4:6])[0]
                  for t, _, bd in chunks(open(anim, "rb").read()) if t == "ANIM"), None)
    chk.seek(0)
    f0 = chk.convert("RGB")
    print(f"  결과 {chk.n_frames}프레임 {sum(got)}ms loop_count={loops}")
    print(f"       모서리 {f0.getpixel((2, 2))}  가운데 {f0.getpixel((f0.width // 2, f0.height // 2))}")
    for f in (anim, a.out + "-first.webp", a.out + "-last.webp"):
        print(f"  {f:36s} {os.path.getsize(f) / 1024:6.1f} KB")


if __name__ == "__main__":
    main()
