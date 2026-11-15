#!/usr/bin/env python3
"""Pixel comparison of two screenshots (reference vs ours): how many pixels differ, where, and whether it's a shift.

  ~/.ui-clone/venv/bin/python -I <skill>/scripts/screenshot_diff.py REF.png OURS.png --out ui-clone/<name>/diff-N
        [--threshold 0.10] [--max 0.02] [--mask x,y,w,h ...] [--grid 8] [--blur 0]

  --threshold  per-pixel colour difference that counts as a mismatch (0-1, perceptual YIQ distance; 0.1 ignores
               anti-aliasing noise, 0.05 is strict)
  --max        PASS if the share of mismatched pixels is <= this (0.02 = 2%; use 0.005 for at-rest pixel-perfect work)
  --mask       regions to ignore (dynamic content: dates, avatars, ads), in reference pixels; repeatable
  --blur R     box-blur both first (texture, grain or particles placed differently but looking the same)
Reports: mismatch %, the worst cells of a grid (where to look), a global shift estimate (if ours is offset by a few
pixels everything looks wrong: fix the offset first), mean colour difference, size mismatch, and writes
diff.png (red = differs), side_by_side.png (reference | ours | diff) and report.json/report.md.
Exit 1 if over --max. Every number is MEASURED.
"""
import argparse, json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


def yiq_delta(a, b):
    # perceptual colour distance in YIQ (as used by pixelmatch), normalised to 0-1
    def yiq(x):
        r, g, b_ = x[..., 0], x[..., 1], x[..., 2]
        return 0.299 * r + 0.587 * g + 0.114 * b_, 0.596 * r - 0.274 * g - 0.322 * b_, 0.211 * r - 0.523 * g + 0.312 * b_
    y1, i1, q1 = yiq(a); y2, i2, q2 = yiq(b)
    d = 0.5053 * (y1 - y2) ** 2 + 0.299 * (i1 - i2) ** 2 + 0.1957 * (q1 - q2) ** 2
    return np.sqrt(d / 35215.0) * 255 / 255  # 0..1 (35215 = max delta for 0-255 inputs)


def shift_estimate(a, b, r=8, box=None):
    g1, g2 = a.mean(axis=2), b.mean(axis=2); best = (1e18, 0, 0)
    if box:  # local: a region plus a margin, so an element that moved inside it is found
        x, y, w0, h0 = box; H, W = g1.shape; x0, y0 = max(0, x - 2 * r), max(0, y - 2 * r); x1, y1 = min(W, x + w0 + 2 * r), min(H, y + h0 + 2 * r)
        g1, g2 = g1[y0:y1, x0:x1], g2[y0:y1, x0:x1]
    h, w = g1.shape; c = (slice(r, h - r), slice(r, w - r)); errs = []
    for dy in range(-r, r + 1, 1):
        for dx in range(-r, r + 1, 1):
            errs.append((float(np.mean(np.abs(g1[c] - g2[r + dy:h - r + dy, r + dx:w - r + dx]))), dx, dy))
    emin = min(e for e, _, _ in errs)
    # flat areas fit many shifts equally well: take the SMALLEST shift that is (almost) as good as the best
    e, dx, dy = min((x for x in errs if x[0] <= emin * 1.02 + 1e-6), key=lambda x: (abs(x[1]) + abs(x[2]), x[0]))
    base = np.mean(np.abs(g1[c] - g2[c]))
    return dx, dy, float(base), float(e)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ref"); ap.add_argument("ours"); ap.add_argument("--out", required=True)
    ap.add_argument("--threshold", type=float, default=0.10); ap.add_argument("--max", type=float, default=0.02)
    ap.add_argument("--mask", action="append", default=[]); ap.add_argument("--grid", type=int, default=8)
    ap.add_argument("--blur", type=float, default=0)
    ap.add_argument("--strict", action="store_true", help="pixel-perfect preset: --threshold 0.03 --max 0.005 and any region colour drift > 3 RGB levels fails")
    ap.add_argument("--allow-shift", action="store_true", help="don't fail on a measured whole-image or element shift (motion-faithful work)")
    a = ap.parse_args()
    if a.strict: a.threshold, a.max = min(a.threshold, 0.03), min(a.max, 0.005)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    R = Image.open(a.ref).convert("RGB"); O = Image.open(a.ours).convert("RGB")
    notes = []
    if R.size != O.size:
        notes.append(f"sizes differ: reference {R.size[0]}x{R.size[1]}, ours {O.size[0]}x{O.size[1]} (ours resized to compare; fix viewport/dpr/crop first)")
        O = O.resize(R.size, Image.LANCZOS)
    if a.blur:
        R2, O2 = R.filter(ImageFilter.BoxBlur(a.blur)), O.filter(ImageFilter.BoxBlur(a.blur))
    else:
        R2, O2 = R, O
    ra, oa = np.asarray(R2, np.float64), np.asarray(O2, np.float64)
    d = yiq_delta(ra, oa)
    m = d > a.threshold
    valid = np.ones(m.shape, bool)
    for mk in a.mask:
        x, y, w, h = map(int, mk.split(",")); valid[y:y + h, x:x + w] = False
    mis = float((m & valid).sum() / max(1, valid.sum()))
    H, W = m.shape; g = a.grid; cells = []
    for i in range(g):
        for j in range(g):
            ys, xs = slice(i * H // g, (i + 1) * H // g), slice(j * W // g, (j + 1) * W // g)
            v = valid[ys, xs]
            if v.sum() == 0: continue
            cd = (oa[ys, xs] - ra[ys, xs])[v].reshape(-1, 3)
            cells.append({"cell": [j, i], "box": [xs.start, ys.start, xs.stop - xs.start, ys.stop - ys.start], "mismatch": float((m[ys, xs] & v).sum() / v.sum()),
                          "colour_delta": [round(float(x), 1) for x in cd.mean(axis=0)], "colour_max": round(float(np.abs(cd).max()), 1)})
    cells.sort(key=lambda c: -c["mismatch"])
    RA, OA = np.asarray(R, np.float64), np.asarray(O, np.float64)
    dx, dy, base, shifted = shift_estimate(RA, OA)
    shift_note = None; shifts = []
    if (dx or dy) and shifted < base * 0.15:   # nearly everything lines up again: the whole image is offset
        shift_note = f"the whole image is shifted by {dx:+d} px x, {dy:+d} px y (difference drops {100 * (1 - shifted / max(base, 1e-9)):.0f}% when re-aligned): fix the page offset/crop first"
    else:                                      # otherwise look for elements that moved inside the worst regions
        for c in [c for c in cells if c["mismatch"] > 0.02][:4]:
            ldx, ldy, lb, ls = shift_estimate(RA, OA, box=c["box"])
            if (ldx or ldy) and ls < lb * 0.5:
                shifts.append({"region": c["box"], "dx": ldx, "dy": ldy})
        if shifts:
            groups = {}
            for sh in shifts: groups.setdefault((sh["dx"], sh["dy"]), []).append(sh["region"])
            def union(bs): x0 = min(b[0] for b in bs); y0 = min(b[1] for b in bs); x1 = max(b[0] + b[2] for b in bs); y1 = max(b[1] + b[3] for b in bs); return [x0, y0, x1 - x0, y1 - y0]
            shift_note = "elements moved: " + "; ".join(f"something in region {union(bs)} by {k[0]:+d} px x, {k[1]:+d} px y" for k, bs in groups.items()) + " (check margin/padding/position/size there)"
    col = (oa - ra)[valid].reshape(-1, 3).mean(axis=0)
    # images
    heat = np.asarray(R.convert("L").convert("RGB"), np.float64) * 0.35
    heat[m & valid] = [230, 40, 60]; heat[~valid] = heat[~valid] * 0.5 + np.array([60, 60, 200]) * 0.5
    Image.fromarray(heat.astype(np.uint8)).save(out / "diff.png")
    th = 600; sc = th / R.size[1]; tw = int(R.size[0] * sc)
    sbs = Image.new("RGB", (tw * 3, th + 30), (12, 10, 14)); dr = ImageDraw.Draw(sbs)
    for k, im in enumerate([R, O, Image.open(out / "diff.png")]):
        sbs.paste(im.resize((tw, th), Image.LANCZOS), (k * tw, 30))
    try: f = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 18)
    except OSError: f = ImageFont.load_default()
    for k, lab in enumerate(["reference", "ours", f"diff {mis * 100:.2f}%"]): dr.text((k * tw + 8, 6), lab, font=f, fill=(246, 241, 234))
    sbs.save(out / "side_by_side.png")
    # colour drift: a region whose pixels all moved the same way (a slightly different fill) even if under the threshold
    drift = [c for c in cells if max(abs(x) for x in c["colour_delta"]) > (3 if a.strict else 8) and c["mismatch"] < 0.9]
    drift.sort(key=lambda c: -max(abs(x) for x in c["colour_delta"]))
    if drift: notes.append("colour drift: " + "; ".join(f"region {c['box']} ours-ref RGB {c['colour_delta']}" for c in drift[:4]))
    ok = mis <= a.max and (a.allow_shift or not shift_note) and not (a.strict and drift)
    if shift_note and not a.allow_shift and mis <= a.max:
        notes.append("FAIL because of the measured shift, although few pixels differ (thin edges); pass --allow-shift for motion-faithful work")
    res = {"ref": a.ref, "ours": a.ours, "size": list(R.size), "mismatch": round(mis, 5), "max": a.max, "threshold": a.threshold, "pass": ok,
           "worst_cells": cells[:6], "colour_drift": drift[:6], "shift": {"dx": dx, "dy": dy, "elements": shifts, "note": shift_note}, "mean_colour_delta_rgb": [round(float(c), 1) for c in col], "notes": notes}
    (out / "report.json").write_text(json.dumps(res, indent=1))
    L = [f"# Screenshot diff ({R.size[0]}x{R.size[1]}): all numbers measured", ""] + [f"- note: {n}" for n in notes]
    if shift_note: L.append(f"- **{shift_note}**")
    L.append(f"- mismatched pixels: **{mis * 100:.2f}%** (max {a.max * 100:.1f}%, per-pixel threshold {a.threshold}) -> **{'PASS' if ok else 'FAIL'}**")
    L.append(f"- mean colour difference (ours - ref, RGB): {res['mean_colour_delta_rgb']}" + (" (ours darker)" if sum(col) < -15 else " (ours lighter)" if sum(col) > 15 else ""))
    L.append("- worst regions (x,y,w,h in reference pixels): " + "; ".join(f"{c['box']} {c['mismatch'] * 100:.0f}%" for c in cells[:6] if c["mismatch"] > 0) )
    L.append(f"- images: {out / 'side_by_side.png'}, {out / 'diff.png'}")
    (out / "report.md").write_text("\n".join(L) + "\n"); print("\n".join(L))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
