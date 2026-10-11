"""Сверка рендера HTML с картинкой-макетом.
Usage: python3 compare_to_image.py <картинка.png> <рендер.png> <compare-out.png> [--diff diff-out.png]
Делает side-by-side (картинка слева, рендер справа, обе приведены к ширине рендера) и печатает метрики:
  edgeF1  — совпадение контуров с допуском ±2 px на ширине 960 (1.0 = контуры совпадают), ориентир ≥ 0.90;
  lumaMAE — средняя разница яркости на ширине 240 (0 = одинаково), ориентир ≤ 2.0.
Метрики — подсказка, а не приёмка: смотреть compare глазами через Read обязательно."""
import sys
from PIL import Image, ImageChops, ImageFilter, ImageStat


def fit(im, w):
    return im.resize((w, round(im.size[1] * w / im.size[0])))


def edges(im, w=960):
    return fit(im.convert("L"), w).filter(ImageFilter.FIND_EDGES).point(lambda x: 255 if x > 40 else 0)


def edge_f1(ref, ren):
    a, b = edges(ref), edges(ren)
    h = min(a.size[1], b.size[1]); a, b = a.crop((0, 0, 960, h)), b.crop((0, 0, 960, h))
    da, db = a.filter(ImageFilter.MaxFilter(5)), b.filter(ImageFilter.MaxFilter(5))
    cnt = lambda im: sum(1 for p in im.getdata() if p)
    prec = cnt(ImageChops.multiply(b, da)) / max(1, cnt(b))
    rec = cnt(ImageChops.multiply(a, db)) / max(1, cnt(a))
    return round(2 * prec * rec / max(1e-9, prec + rec), 3)


def luma_mae(ref, ren):
    a, b = fit(ref.convert("L"), 240), fit(ren.convert("L"), 240)
    h = min(a.size[1], b.size[1])
    return round(ImageStat.Stat(ImageChops.difference(a.crop((0, 0, 240, h)), b.crop((0, 0, 240, h)))).mean[0], 1)


def main():
    args = sys.argv[1:]
    diff_out = None
    if "--diff" in args:
        i = args.index("--diff"); diff_out = args[i + 1]; del args[i:i + 2]
    if len(args) != 3:
        sys.exit(__doc__)
    ref, ren = Image.open(args[0]).convert("RGB"), Image.open(args[1]).convert("RGB")
    W = ren.size[0]
    r2 = fit(ref, W)
    H = max(r2.size[1], ren.size[1])
    sbs = Image.new("RGB", (W * 2 + 16, H), (255, 0, 255))
    sbs.paste(r2, (0, 0)); sbs.paste(ren, (W + 16, 0)); sbs.save(args[2])
    if diff_out:
        h = min(r2.size[1], ren.size[1])
        ImageChops.difference(r2.crop((0, 0, W, h)), ren.crop((0, 0, W, h))).point(lambda x: min(255, x * 4)).save(diff_out)
    print(f"edgeF1={edge_f1(ref, ren)} lumaMAE={luma_mae(ref, ren)} ref={ref.size} render={ren.size} -> {args[2]}")


if __name__ == "__main__":
    main()
