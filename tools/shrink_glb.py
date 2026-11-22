#!/usr/bin/env python3
"""shrink_glb.py — shrink GLB files by re-encoding embedded textures.

* Opaque images  -> JPEG (quality --quality)
* Images with real alpha -> optimized PNG
* Everything is downscaled so the longest side <= --max-size
* Byte-identical images shared by several slots are stored once (dedupe)
* Geometry, materials, node names (Blocker, Cube_*, ...) are untouched.

Usage:
    python3 tools/shrink_glb.py assets/rooms -o assets/rooms_small
    python3 tools/shrink_glb.py assets/rooms/Level1_Room1.glb -o out --max-size 1024 --quality 80
"""
import argparse, hashlib, io, json, logging, struct, sys
from pathlib import Path
from PIL import Image

log = logging.getLogger("shrink_glb")
MAGIC, JSON_T, BIN_T = 0x46546C67, 0x4E4F534A, 0x004E4942


def read_glb(path):
    d = Path(path).read_bytes()
    magic, ver, _ = struct.unpack("<III", d[:12])
    if magic != MAGIC or ver != 2:
        raise ValueError(f"{path}: not a glTF 2.0 binary")
    off, js, binc = 12, None, b""
    while off < len(d):
        ln, t = struct.unpack("<II", d[off:off + 8])
        chunk = d[off + 8: off + 8 + ln]
        if t == JSON_T: js = json.loads(chunk)
        elif t == BIN_T: binc = chunk
        off += 8 + ln
    if js is None: raise ValueError(f"{path}: no JSON chunk")
    return js, binc


def pad4(b, fill=b"\0"):
    return b + fill * ((4 - len(b) % 4) % 4)


def write_glb(path, js, binc):
    jb = pad4(json.dumps(js, separators=(",", ":")).encode(), b" ")
    binc = pad4(binc)
    total = 12 + 8 + len(jb) + 8 + len(binc)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", MAGIC, 2, total))
        f.write(struct.pack("<II", len(jb), JSON_T) + jb)
        f.write(struct.pack("<II", len(binc), BIN_T) + binc)


def has_alpha(img):
    if img.mode in ("RGBA", "LA"):
        lo, _ = img.getchannel("A").getextrema()
        return lo < 255
    return img.mode == "P" and "transparency" in img.info


def recompress(raw, max_size, quality):
    img = Image.open(io.BytesIO(raw)); img.load()
    alpha = has_alpha(img)
    img = img.convert("RGBA" if alpha else "RGB")
    if max(img.size) > max_size:
        s = max_size / max(img.size)
        img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    out = io.BytesIO()
    if alpha:
        img.save(out, "PNG", optimize=True); mime = "image/png"
    else:
        img.save(out, "JPEG", quality=quality, optimize=True, progressive=True); mime = "image/jpeg"
    new = out.getvalue()
    # never make it bigger
    if len(new) >= len(raw) and max(Image.open(io.BytesIO(raw)).size) <= max_size:
        return raw, None
    return new, mime


def shrink(src, dst, max_size, quality):
    js, binc = read_glb(src)
    views = js["bufferViews"]
    images = js.get("images", [])
    img_views = {im["bufferView"] for im in images if "bufferView" in im}

    # 1. recompress + dedupe images
    new_img_bytes, mimes, by_hash, remap = [], [], {}, {}
    for i, im in enumerate(images):
        if "bufferView" not in im:
            raise ValueError(f"{src}: image {i} is external (uri); only embedded images supported")
        v = views[im["bufferView"]]
        raw = binc[v.get("byteOffset", 0): v.get("byteOffset", 0) + v["byteLength"]]
        try:
            data, mime = recompress(raw, max_size, quality)
        except Exception as e:
            log.warning("image %d left untouched (%s)", i, e); data, mime = raw, None
        mime = mime or im.get("mimeType", "image/png")
        h = hashlib.sha1(data).hexdigest()
        if h not in by_hash:
            by_hash[h] = len(new_img_bytes); new_img_bytes.append(data); mimes.append(mime)
        remap[i] = by_hash[h]
        log.debug("image %d: %d -> %d KB (%s)", i, len(raw) // 1024, len(data) // 1024, mime)

    # 2. rebuild binary: non-image views first (alignment kept), then images
    out, new_views, view_map = bytearray(), [], {}
    for vi, v in enumerate(views):
        if vi in img_views: continue
        off = v.get("byteOffset", 0)
        data = binc[off: off + v["byteLength"]]
        out += b"\0" * ((4 - len(out) % 4) % 4)
        nv = dict(v); nv["byteOffset"] = len(out); nv["buffer"] = 0
        view_map[vi] = len(new_views); new_views.append(nv); out += data
    img_view_idx = []
    for data in new_img_bytes:
        out += b"\0" * ((4 - len(out) % 4) % 4)
        new_views.append({"buffer": 0, "byteOffset": len(out), "byteLength": len(data)})
        img_view_idx.append(len(new_views) - 1); out += data

    # 3. remap references
    for acc in js.get("accessors", []):
        if "bufferView" in acc: acc["bufferView"] = view_map[acc["bufferView"]]
    for mesh in js.get("meshes", []):
        for prim in mesh["primitives"]:
            for tgt in prim.get("targets", []): pass
    for sk in js.get("skins", []): pass
    js["images"] = [{"bufferView": img_view_idx[k], "mimeType": mimes[k], **({"name": images[0].get("name")} if False else {})}
                    for k in range(len(new_img_bytes))]
    for tex in js.get("textures", []):
        if "source" in tex: tex["source"] = remap[tex["source"]]
        for ext in tex.get("extensions", {}).values():
            if "source" in ext: ext["source"] = remap[ext["source"]]
    js["bufferViews"] = new_views
    js["buffers"] = [{"byteLength": len(out)}]
    write_glb(dst, js, bytes(out))
    return Path(src).stat().st_size, Path(dst).stat().st_size


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="a .glb file or a folder of them")
    ap.add_argument("-o", "--output", required=True, help="output folder")
    ap.add_argument("--max-size", type=int, default=2048, help="max texture side in px (default 2048)")
    ap.add_argument("--quality", type=int, default=85, help="JPEG quality (default 85)")
    ap.add_argument("--limit-mb", type=float, default=25.0, help="warn if a result exceeds this (default 25)")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO, format="%(message)s")
    src = Path(a.input)
    files = sorted(src.glob("*.glb")) if src.is_dir() else [src]
    if not files: log.error("no .glb files found"); return 1
    out = Path(a.output); out.mkdir(parents=True, exist_ok=True)
    rc = 0
    for f in files:
        try:
            before, after = shrink(f, out / f.name, a.max_size, a.quality)
        except Exception as e:
            log.error("%s: FAILED: %s", f.name, e); rc = 1; continue
        flag = "  <-- STILL OVER LIMIT" if after > a.limit_mb * 1e6 else ""
        log.info("%-24s %7.2f MB -> %7.2f MB%s", f.name, before / 1e6, after / 1e6, flag)
    return rc


if __name__ == "__main__":
    sys.exit(main())
