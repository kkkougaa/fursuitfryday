# -*- coding: utf-8 -*-
"""subset-font.py — TrueType 글꼴에서 쓰는 글자만 남긴다. 의존성 없음.

  python tools/subset-font.py <입력.ttf> <출력앞자리> "남길 글자들"

왜 직접 만드나
--------------
평창평화체 원본은 1.3MB 에 글리프가 12,261개인데, 제목 "#FursuitFryday" 에
쓰는 글자는 10개뿐이다. 제목 한 줄 때문에 1.3MB 를 받게 할 수는 없다.
fonttools 를 쓰면 한 줄이지만, 이 컴퓨터에는 없고 설치는 남의 컴퓨터 일이다.
남길 글리프가 모두 **단순 글리프**(합성 없음)라 재번호가 안전하므로,
필요한 표만 직접 짜는 편이 빠르다.

무엇을 하나
-----------
 * 글리프를 0..N 으로 다시 번호 붙인다(.notdef + 남길 것들)
 * cmap 을 format 4 로 새로 짠다
 * glyf 에서 **명령(instructions)을 떼어낸다** — fpgm/prep/cvt 를 안 실으므로
   명령을 남기면 참조가 끊긴다. 요즘 렌더러는 힌팅 없이도 잘 그린다.
 * loca 를 short 형식으로 (글리프가 작아 offset/2 가 uint16 에 들어간다)
 * hmtx 를 남긴 글리프 수만큼
 * post 를 3.0 으로 (원본은 이름표 118KB)
 * kern/gasp/fpgm/prep/cvt 는 버린다
 * WOFF(v1) 도 같이 낸다 — zlib 이라 표준 라이브러리로 압축된다
   (woff2 는 brotli 가 필요해서 못 만든다)
"""
import struct
import sys
import zlib

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

u16 = lambda b, o: struct.unpack(">H", b[o:o + 2])[0]
i16 = lambda b, o: struct.unpack(">h", b[o:o + 2])[0]
u32 = lambda b, o: struct.unpack(">I", b[o:o + 4])[0]
pad4 = lambda n: (4 - n % 4) % 4


def checksum(data):
    data = data + b"\0" * pad4(len(data))
    return sum(struct.unpack(f">{len(data)//4}I", data)) & 0xFFFFFFFF


# ------------------------------------------------------------------ 원본 읽기
def read_tables(b):
    n = u16(b, 4)
    T = {}
    for i in range(n):
        o = 12 + i * 16
        tag = b[o:o + 4].decode("latin1")
        off, ln = struct.unpack(">II", b[o + 8:o + 16])
        T[tag] = (off, ln)
    return T


def cmap_lookup(b, T):
    """유니코드 -> 원본 GID. format 4 서브테이블을 쓴다."""
    co = T["cmap"][0]
    so = None
    for i in range(u16(b, co + 2)):
        pid, eid, off = struct.unpack(">HHI", b[co + 4 + i * 8:co + 12 + i * 8])
        if (pid, eid) in ((3, 1), (0, 3), (0, 4)) and u16(b, co + off) == 4:
            so = co + off
            break
    if so is None:
        sys.exit("format 4 유니코드 cmap 을 못 찾았습니다.")
    segX2 = u16(b, so + 6)
    seg = segX2 // 2
    ends = struct.unpack(f">{seg}H", b[so + 14:so + 14 + segX2])
    starts = struct.unpack(f">{seg}H", b[so + 16 + segX2:so + 16 + 2 * segX2])
    deltas = struct.unpack(f">{seg}h", b[so + 16 + 2 * segX2:so + 16 + 3 * segX2])
    rbase = so + 16 + 3 * segX2
    ranges = struct.unpack(f">{seg}H", b[rbase:rbase + segX2])

    def look(cp):
        for k in range(seg):
            if starts[k] <= cp <= ends[k]:
                if ranges[k] == 0:
                    return (cp + deltas[k]) & 0xFFFF
                a = rbase + k * 2 + ranges[k] + (cp - starts[k]) * 2
                g = u16(b, a)
                return 0 if g == 0 else (g + deltas[k]) & 0xFFFF
        return 0
    return look


def strip_instructions(g):
    """단순 글리프에서 명령 바이트를 떼어낸다. 합성 글리프는 그대로 둔다."""
    if len(g) < 10:
        return g
    nc = struct.unpack(">h", g[0:2])[0]
    if nc <= 0:                       # 합성이거나 빈 글리프
        return g
    p = 10 + nc * 2                   # endPtsOfContours 뒤
    ilen = u16(g, p)
    if ilen == 0:
        return g
    return g[:p] + b"\0\0" + g[p + 2 + ilen:]


def build_cmap4(pairs):
    """pairs: [(codepoint, newGid)] 을 format 4 로. 이어지는 구간은 묶는다."""
    pairs = sorted(pairs)
    segs = []
    for cp, g in pairs:
        if segs and cp == segs[-1][1] + 1 and g == segs[-1][2] + (cp - segs[-1][0]):
            segs[-1][1] = cp
        else:
            segs.append([cp, cp, g])
    segs.append([0xFFFF, 0xFFFF, 0])          # 규격이 요구하는 마지막 구간

    n = len(segs)
    ends = b"".join(struct.pack(">H", s[1]) for s in segs)
    starts = b"".join(struct.pack(">H", s[0]) for s in segs)
    # idDelta: (cp + delta) & 0xFFFF == gid
    dl = b""
    for s in segs:
        d = 1 if s[0] == 0xFFFF else (s[2] - s[0])
        dl += struct.pack(">h", ((d + 0x8000) & 0xFFFF) - 0x8000)
    ro = b"\0\0" * n

    es = max(0, n.bit_length() - 1)
    sub = struct.pack(">HHHHHHH", 4, 16 + 8 * n, 0, n * 2, 2 * (1 << es), es,
                      n * 2 - 2 * (1 << es)) + ends + b"\0\0" + starts + dl + ro
    # 플랫폼 두 개가 같은 서브테이블을 가리키게 한다 (호환)
    head = struct.pack(">HH", 0, 2) \
        + struct.pack(">HHI", 0, 3, 4 + 16) \
        + struct.pack(">HHI", 3, 1, 4 + 16)
    return head + sub


def subset(path, chars):
    b = open(path, "rb").read()
    T = read_tables(b)
    look = cmap_lookup(b, T)

    ho = T["head"][0]
    loca_long = i16(b, ho + 50) == 1
    lo = T["loca"][0]
    go = T["glyf"][0]

    def loca(i):
        return u32(b, lo + i * 4) if loca_long else u16(b, lo + i * 2) * 2

    hho = T["hhea"][0]
    n_hm = u16(b, hho + 34)
    mo_ = T["hmtx"][0]

    def metric(g):
        if g < n_hm:
            return u16(b, mo_ + g * 4), i16(b, mo_ + g * 4 + 2)
        adv = u16(b, mo_ + (n_hm - 1) * 4)
        return adv, i16(b, mo_ + n_hm * 4 + (g - n_hm) * 2)

    # ---- 남길 글리프: .notdef + 글자들 (코드포인트 순서로 번호를 매긴다
    #      그래야 이어지는 글자가 이어지는 GID 를 받아 cmap 구간이 뭉친다) ----
    cps = sorted({ord(c) for c in chars})
    missing = [chr(c) for c in cps if look(c) == 0]
    if missing:
        print(f"  경고: 글꼴에 없는 글자 {missing}")
    keep = [0] + [look(c) for c in cps if look(c) != 0]
    pairs = [(c, i + 1) for i, c in enumerate(c for c in cps if look(c) != 0)]

    # ---- glyf / loca ----
    glyf, offs = b"", [0]
    for g in keep:
        d = strip_instructions(b[go + loca(g):go + loca(g + 1)])
        d += b"\0" * (len(d) % 2)          # short loca 는 짝수 offset 이어야 한다
        glyf += d
        offs.append(len(glyf))
    if offs[-1] > 0x1FFFE:
        sys.exit("glyf 가 커서 short loca 를 못 씁니다.")
    loca_new = b"".join(struct.pack(">H", o // 2) for o in offs)

    # ---- hmtx ----
    hmtx = b""
    for g in keep:
        a, l = metric(g)
        hmtx += struct.pack(">Hh", a, l)

    # ---- 고칠 표들 ----
    head = bytearray(b[ho:ho + T["head"][1]])
    head[8:12] = b"\0\0\0\0"                                  # checkSumAdjustment
    head[50:52] = struct.pack(">h", 0)                        # indexToLocFormat = short
    hhea = bytearray(b[hho:hho + T["hhea"][1]])
    hhea[34:36] = struct.pack(">H", len(keep))                # numberOfHMetrics
    maxp = bytearray(b[T["maxp"][0]:T["maxp"][0] + T["maxp"][1]])
    maxp[4:6] = struct.pack(">H", len(keep))                  # numGlyphs

    out = {
        "head": bytes(head), "hhea": bytes(hhea), "maxp": bytes(maxp),
        "OS/2": b[T["OS/2"][0]:T["OS/2"][0] + T["OS/2"][1]],
        "name": b[T["name"][0]:T["name"][0] + T["name"][1]],
        "cmap": build_cmap4(pairs),
        "loca": loca_new, "glyf": glyf, "hmtx": hmtx,
        "post": struct.pack(">IIhhIIIIII", 0x00030000, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    }
    return out, len(keep), len(b)


# ------------------------------------------------------------------ 쓰기
def write_sfnt(tabs):
    tags = sorted(tabs)                       # 표 목록은 태그 순이어야 한다
    n = len(tags)
    es = max(0, n.bit_length() - 1)
    hdr = struct.pack(">IHHHH", 0x00010000, n, 16 * (1 << es), es, 16 * n - 16 * (1 << es))
    off = 12 + 16 * n
    dirs, body, meta = b"", b"", {}
    for t in tags:
        d = tabs[t]
        meta[t] = (off, len(d), checksum(d))
        dirs += struct.pack(">4sIII", t.encode("latin1").ljust(4), meta[t][2], off, len(d))
        body += d + b"\0" * pad4(len(d))
        off += len(d) + pad4(len(d))
    f = bytearray(hdr + dirs + body)
    # head.checkSumAdjustment
    adj = (0xB1B0AFBA - checksum(bytes(f))) & 0xFFFFFFFF
    ho = meta["head"][0]
    f[ho + 8:ho + 12] = struct.pack(">I", adj)
    return bytes(f), meta


def write_woff(tabs, sfnt, meta):
    tags = sorted(tabs)
    n = len(tags)
    total = 12 + 16 * n + sum(len(tabs[t]) + pad4(len(tabs[t])) for t in tags)
    off = 44 + 20 * n
    dirs, body = b"", b""
    for t in tags:
        raw = tabs[t]
        if t == "head":                       # sfnt 쪽에서 고친 값을 그대로 쓴다
            raw = sfnt[meta[t][0]:meta[t][0] + meta[t][1]]
        comp = zlib.compress(raw, 9)
        if len(comp) >= len(raw):
            comp = raw                        # 규격: 안 줄면 그대로 담는다
        dirs += struct.pack(">4sIIII", t.encode("latin1").ljust(4), off,
                            len(comp), len(raw), checksum(raw))
        body += comp + b"\0" * pad4(len(comp))
        off += len(comp) + pad4(len(comp))
    hdr = struct.pack(">4sIIHHIHHIIIII", b"wOFF", 0x00010000,
                      44 + 20 * n + len(body), n, 0, total, 1, 0, 0, 0, 0, 0, 0)
    return hdr + dirs + body


def main():
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    src, out, chars = sys.argv[1], sys.argv[2], sys.argv[3]
    tabs, nkeep, orig = subset(src, chars)
    sfnt, meta = write_sfnt(tabs)
    woff = write_woff(tabs, sfnt, meta)
    open(out + ".ttf", "wb").write(sfnt)
    open(out + ".woff", "wb").write(woff)
    print(f"  원본 {orig/1024:.0f} KB -> 글리프 {nkeep}개")
    print(f"  {out}.ttf   {len(sfnt)/1024:6.1f} KB")
    print(f"  {out}.woff  {len(woff)/1024:6.1f} KB")
    print(f"  표: {', '.join(sorted(tabs))}")


if __name__ == "__main__":
    main()
