#!/usr/bin/env python3
"""Read exact design values (and a reference PNG) from a Figma frame through the Figma REST API.

  ~/.ui-clone/venv/bin/python -I <skill>/scripts/figma_fetch.py --url "https://www.figma.com/design/KEY/Name?node-id=12-345" --out ui-clone/<name>/figma [--scale 2]
  ~/.ui-clone/venv/bin/python -I <skill>/scripts/figma_fetch.py --file KEY --node 12:345 --out ...
  ~/.ui-clone/venv/bin/python -I <skill>/scripts/figma_fetch.py --from-json nodes.json --node 12:345 --out ...   (offline: an API response saved earlier)

Token: FIGMA_TOKEN in the environment, or a line FIGMA_TOKEN=... in keys.env (current folder or a parent) or in
~/.ui-clone/keys.env. A personal access token with read-only file access is enough (Figma: Settings > Security).
The token is only sent to api.figma.com and is never printed.
Writes: frame.png (the node rendered by Figma at --scale), design.json (every child: box relative to the frame,
fills/gradients, strokes, radii, shadows/blurs, auto-layout padding/gap, typography, text, prototype transitions
with duration and easing) and design.md (a readable summary). Use frame.png as the pixel reference for
screenshot_diff.py (capture ours at the same size: --viewport = frame size, --dpr = --scale).
"""
import argparse, json, os, re, sys, urllib.parse, urllib.request, urllib.error
from pathlib import Path

API = "https://api.figma.com/v1"


def token():
    t = os.environ.get("FIGMA_TOKEN")
    if t: return t
    p = Path.cwd().resolve()
    for d in [p, *p.parents, Path.home() / ".ui-clone"]:
        f = d / "keys.env"
        if f.exists():
            for line in f.read_text().splitlines():
                if line.strip().startswith("FIGMA_TOKEN="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("FIGMA_TOKEN not found: set it in the environment or add FIGMA_TOKEN=... to keys.env")


def get(url, raw=False):
    req = urllib.request.Request(url, headers={"X-Figma-Token": token()})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"Figma API error {e.code}: {e.read().decode(errors='replace')[:300]}")
    return data if raw else json.loads(data)


def hexcol(c, op=1.0):
    r, g, b = (round(c[k] * 255) for k in ("r", "g", "b")); a = c.get("a", 1) * op
    return f"#{r:02X}{g:02X}{b:02X}" + (f" @{a:.2f}" if a < 0.999 else "")


def paint(p):
    if not p.get("visible", True): return None
    t = p["type"]; op = p.get("opacity", 1)
    if t == "SOLID": return hexcol(p["color"], op)
    if t.startswith("GRADIENT"):
        stops = ", ".join(f"{hexcol(s['color'])} {s['position'] * 100:.0f}%" for s in p.get("gradientStops", []))
        return f"{t.lower().replace('gradient_', '')}-gradient({stops})"
    if t == "IMAGE": return f"image({p.get('scaleMode', '')})"
    return t.lower()


def walk(n, origin, depth=0, out=None, maxd=12):
    out = [] if out is None else out
    bb = n.get("absoluteBoundingBox") or {}
    e = {"name": n.get("name"), "type": n.get("type"), "depth": depth}
    if bb: e["box"] = [round(bb["x"] - origin[0], 1), round(bb["y"] - origin[1], 1), round(bb["width"], 1), round(bb["height"], 1)]
    fills = [x for x in (paint(p) for p in n.get("fills", []) or []) if x]
    if fills: e["fills"] = fills
    strokes = [x for x in (paint(p) for p in n.get("strokes", []) or []) if x]
    if strokes: e["strokes"] = strokes; e["stroke_weight"] = n.get("strokeWeight"); e["stroke_align"] = n.get("strokeAlign")
    if n.get("cornerRadius"): e["radius"] = n["cornerRadius"]
    if n.get("rectangleCornerRadii"): e["radii"] = n["rectangleCornerRadii"]
    if n.get("opacity", 1) < 1: e["opacity"] = round(n["opacity"], 3)
    fx = []
    for f in n.get("effects", []) or []:
        if not f.get("visible", True): continue
        if "SHADOW" in f["type"]:
            o = f.get("offset", {}); fx.append(f"{'inset ' if f['type'] == 'INNER_SHADOW' else ''}{o.get('x', 0)}px {o.get('y', 0)}px {f.get('radius', 0)}px {f.get('spread', 0)}px {hexcol(f['color'])}")
        else: fx.append(f"{f['type'].lower()} {f.get('radius', 0)}px")
    if fx: e["effects"] = fx
    if n.get("layoutMode") and n["layoutMode"] != "NONE":
        e["auto_layout"] = {"direction": n["layoutMode"], "gap": n.get("itemSpacing", 0), "padding": [n.get(k, 0) for k in ("paddingTop", "paddingRight", "paddingBottom", "paddingLeft")],
                            "align": [n.get("primaryAxisAlignItems"), n.get("counterAxisAlignItems")]}
    if n.get("type") == "TEXT":
        s = n.get("style", {}); e["text"] = (n.get("characters") or "")[:120]
        e["font"] = {k: s.get(k) for k in ("fontFamily", "fontWeight", "fontSize", "lineHeightPx", "letterSpacing", "textAlignHorizontal", "textCase", "italic") if s.get(k) is not None}
    rx = []
    for r in n.get("reactions", []) or []:
        a = r.get("action") or ((r.get("actions") or [None])[0]) or {}
        tr = a.get("transition") or {}
        if tr: rx.append({"trigger": (r.get("trigger") or {}).get("type"), "type": tr.get("type"), "duration_s": tr.get("duration"),
                          "easing": (tr.get("easing") or {}).get("type"), "bezier": (tr.get("easing") or {}).get("easingFunctionCubicBezier"),
                          "spring": (tr.get("easing") or {}).get("easingFunctionSpring"), "to": a.get("destinationId")})
    if rx: e["prototype"] = rx
    out.append(e)
    if depth < maxd:
        for c in n.get("children", []) or []:
            if c.get("visible", True): walk(c, origin, depth + 1, out, maxd)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url"); ap.add_argument("--file"); ap.add_argument("--node"); ap.add_argument("--from-json")
    ap.add_argument("--out", required=True); ap.add_argument("--scale", type=float, default=2); ap.add_argument("--depth", type=int, default=12)
    a = ap.parse_args()
    if a.url:
        m = re.search(r"figma\.com/(?:file|design|proto)/([A-Za-z0-9]+)", a.url); q = urllib.parse.parse_qs(urllib.parse.urlparse(a.url).query)
        a.file = a.file or (m.group(1) if m else None); a.node = a.node or (q.get("node-id", [None])[0] or "").replace("-", ":") or None
    if not a.node or not (a.file or a.from_json): sys.exit("need --url with ?node-id=..., or --file KEY --node ID, or --from-json FILE --node ID")
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    if a.from_json:
        data = json.loads(Path(a.from_json).read_text())
    else:
        data = get(f"{API}/files/{a.file}/nodes?ids={urllib.parse.quote(a.node)}")
        (out / "nodes_raw.json").write_text(json.dumps(data))
    doc = (data.get("nodes", {}).get(a.node) or {}).get("document")
    if not doc: sys.exit(f"node {a.node} not found in the response")
    bb = doc.get("absoluteBoundingBox", {"x": 0, "y": 0, "width": 0, "height": 0})
    items = walk(doc, (bb["x"], bb["y"]), maxd=a.depth)
    if not a.from_json:
        img = get(f"{API}/images/{a.file}?ids={urllib.parse.quote(a.node)}&format=png&scale={a.scale}")
        src = (img.get("images") or {}).get(a.node)
        if src:
            (out / "frame.png").write_bytes(get(src, raw=True))
    design = {"file": a.file, "node": a.node, "name": doc.get("name"), "size": [bb["width"], bb["height"]], "scale": a.scale, "items": items}
    (out / "design.json").write_text(json.dumps(design, indent=1))
    L = [f"# Figma: {doc.get('name')} ({bb['width']:.0f}x{bb['height']:.0f}) · node {a.node}", f"{len(items)} layers · reference image: {'frame.png at ' + str(a.scale) + 'x' if (out / 'frame.png').exists() else 'not fetched'}", ""]
    for e in items[:120]:
        bits = []
        if "box" in e: bits.append("box " + ",".join(f"{v:g}" for v in e["box"]))
        for k in ("fills", "strokes", "effects"):
            if k in e: bits.append(f"{k} " + "; ".join(e[k]))
        if "radius" in e: bits.append(f"radius {e['radius']}")
        if "auto_layout" in e: al = e["auto_layout"]; bits.append(f"{al['direction'].lower()} gap {al['gap']} pad {al['padding']}")
        if "font" in e: f = e["font"]; bits.append(f"{f.get('fontFamily')} {f.get('fontWeight')} {f.get('fontSize')}px/{f.get('lineHeightPx')}px ls {f.get('letterSpacing')}")
        if "text" in e: bits.append(f'"{e["text"][:50]}"')
        if "prototype" in e: bits += [f"prototype {p['trigger']} → {p['type']} {p['duration_s']}s {p['easing']}{' ' + str(p['bezier']) if p['bezier'] else ''}" for p in e["prototype"]]
        L.append(f"{'  ' * min(e['depth'], 6)}- **{e['name']}** ({e['type'].lower()}) " + " · ".join(bits))
    (out / "design.md").write_text("\n".join(L) + "\n"); print("\n".join(L[:12])); print(f"... -> {out / 'design.md'}")


if __name__ == "__main__":
    main()
