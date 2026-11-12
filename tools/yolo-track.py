# WATCHMAN — real detection + tracking for the CCTV clips (YOLO + ByteTrack, runs offline, once).
#
#   tools/.yolo/bin/python tools/yolo-track.py            → all clips
#   tools/.yolo/bin/python tools/yolo-track.py 3 7        → only clips 3 and 7 (others are kept)
#
# Writes assets/video/cctv/tracks.json:
#   { "fps": 10, "fpsByClip": { "3": 12.5 }, "clips": { "3": [ frame, frame, … ] } }
#   frame = [[class, score, x, y, w, h, id], …]   (x/y/w/h = 0–1 of the video, id = the same person/car across frames)
#   fpsByClip = how many stored frames per second of video, per clip (clips differ)
# The page only reads this file — visitors never run any AI.
#
# Setup (once):  python3 -m venv tools/.yolo && tools/.yolo/bin/pip install ultralytics lap
import json, sys, os
import cv2, torch
from ultralytics import YOLO

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIPS = os.path.join(ROOT, 'assets', 'video', 'cctv')
OUT = os.path.join(CLIPS, 'tracks.json')
SKIP = {19}                        # the eye — nothing to track
KEEP = {0: 'person', 1: 'bicycle', 2: 'car', 3: 'motorcycle', 5: 'bus', 7: 'truck'}
IMGSZ = int(os.environ.get("YOLO_IMGSZ", 960))   # bigger = finds smaller people (slower) — e.g. YOLO_IMGSZ=1920 for aerial clips
CONF = float(os.environ.get("YOLO_CONF", .2))
STRIDE = 2                         # analyse every 2nd frame (the page smooths the boxes in between)
DEVICE = 'mps' if torch.backends.mps.is_available() else 'cpu'   # Apple GPU when there is one

def clip_path(n): return os.path.join(CLIPS, f'cctv-{n:02d}.mp4')
def clip_fps(n):
    cap = cv2.VideoCapture(clip_path(n)); f = cap.get(cv2.CAP_PROP_FPS) or 10; cap.release(); return f

only = {int(a) for a in sys.argv[1:]}
data = {'fps': 10, 'fpsByClip': {}, 'clips': {}}
if only and os.path.exists(OUT):
    data = json.load(open(OUT))
    data.setdefault('fpsByClip', {})
    for k in data['clips']:                    # clips analysed earlier (every frame) → their real frame rate
        data['fpsByClip'].setdefault(k, round(clip_fps(int(k)), 3))

print('device:', DEVICE, flush=True)
model = YOLO('yolo11s.pt')         # downloaded automatically the first time (~20 MB)

# TILED mode (YOLO_TILES=3): for clips shot from high up, where people are only a few pixels tall.
# Each frame is cut into TILES×TILES overlapping pieces, each piece is enlarged and searched,
# the boxes are merged back (NMS) and handed to ByteTrack ourselves.
TILES = int(os.environ.get('YOLO_TILES', 1))
MOTION = os.environ.get('YOLO_MOTION') == '1'
MOTION_MIN, MOTION_MAX = .00017, .0064  # blob size as a share of the frame (person-sized, not cars or noise)
def track_tiled(path, fps):
    import numpy as np, torchvision
    from ultralytics.trackers.byte_tracker import BYTETracker
    from ultralytics.utils import YAML, IterableSimpleNamespace
    from ultralytics.utils.checks import check_yaml
    from ultralytics.engine.results import Boxes
    cfg = YAML.load(check_yaml('bytetrack.yaml'))
    cfg.update(track_buffer=60, match_thresh=.95, new_track_thresh=.3)   # tiny people: hold on to a track longer, match more loosely
    targs = IterableSimpleNamespace(**cfg)
    tracker = BYTETracker(targs)
    cap = cv2.VideoCapture(path)
    # MOTION (YOLO_MOTION=1): for a camera that doesn't move — anything small that moves is a person.
    # Works where YOLO can't recognise people (seen from straight above). No extra download: plain OpenCV.
    bg = cv2.createBackgroundSubtractorMOG2(history=300, varThreshold=40, detectShadows=False) if MOTION else None
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)); small = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    out, k = [], 0
    while True:
        ok, img = cap.read()
        if not ok: break
        k += 1
        mask = bg.apply(cv2.GaussianBlur(img, (5, 5), 0)) if bg is not None else None   # blur first: the CCTV grain is not motion
        if (k - 1) % STRIDE: continue
        H, W = img.shape[:2]
        tw, th = W / TILES * 1.3, H / TILES * 1.3                 # 30% overlap so nobody is cut in half
        crops, offs = [], []
        for ty in range(TILES):
            for tx in range(TILES):
                x0 = int(min(W - tw, max(0, tx * W / TILES - (tw - W / TILES) / 2)))
                y0 = int(min(H - th, max(0, ty * H / TILES - (th - H / TILES) / 2)))
                crops.append(img[y0:y0 + int(th), x0:x0 + int(tw)]); offs.append((x0, y0))
        crops.append(img); offs.append((0, 0))                    # + the whole frame for big things (cars)
        dets = []
        for r, (ox, oy) in zip(model.predict(crops, imgsz=640, conf=CONF, classes=list(KEEP), device=DEVICE, verbose=False), offs):
            for (x1, y1, x2, y2), s, c in zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist(), r.boxes.cls.tolist()):
                if (x2 - x1) * (y2 - y1) > W * H * .04: continue     # building-sized "truck" = a mistake (seen from this high, cars are small)
                dets.append([x1 + ox, y1 + oy, x2 + ox, y2 + oy, s, c])
        if mask is not None and k > 30:                         # (give the background a second to settle)
            m = cv2.morphologyEx(mask, cv2.MORPH_OPEN, small)
            m = cv2.dilate(m, kernel, iterations=1)
            cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            amin, amax = W * H * MOTION_MIN, W * H * MOTION_MAX
            for ct in cnts:
                x, y, w, h = cv2.boundingRect(ct)
                if amin <= w * h <= amax and .25 < w / max(h, 1) < 2.5:
                    p = 2                                       # a little room around the person
                    dets.append([max(0, x - p), max(0, y - p), min(W, x + w + p), min(H, y + h + p), .5, 0])
        if dets:
            d = torch.tensor(dets)
            d = d[torchvision.ops.batched_nms(d[:, :4], d[:, 4], d[:, 5].long(), .45)].numpy()
        else:
            d = np.zeros((0, 6), dtype=np.float32)
        tracks = tracker.update(Boxes(d, (H, W)), img)
        f = []
        for x1, y1, x2, y2, tid, s, c, _ in tracks.tolist():
            f.append([KEEP[int(c)], round(s, 2), round(x1 / W, 4), round(y1 / H, 4), round((x2 - x1) / W, 4), round((y2 - y1) / H, 4), int(tid)])
        out.append(f)
    cap.release()
    return out
n = 1
while os.path.exists(clip_path(n)):
    if n in SKIP or (only and n not in only):
        n += 1
        continue
    fps = clip_fps(n)
    model.predictor = None         # fresh tracker for every clip (ids start again)
    frames = []
    if TILES > 1:
        frames = track_tiled(clip_path(n), fps)
    else:
      for r in model.track(source=clip_path(n), stream=True, persist=True, tracker='bytetrack.yaml', device=DEVICE,
                           imgsz=IMGSZ, conf=CONF, classes=list(KEEP), vid_stride=STRIDE, verbose=False):
        H, W = r.orig_shape
        f = []
        b = r.boxes
        if b is not None and len(b):
            ids = b.id.int().tolist() if b.id is not None else [None] * len(b)
            for (x1, y1, x2, y2), c, s, i in zip(b.xyxy.tolist(), b.cls.int().tolist(), b.conf.tolist(), ids):
                if i is None:
                    continue           # not yet a confirmed track → skip (no flicker)
                f.append([KEEP[c], round(s, 2), round(x1 / W, 4), round(y1 / H, 4), round((x2 - x1) / W, 4), round((y2 - y1) / H, 4), i])
        frames.append(f)
    # renumber the ids 1, 2, 3 … in order of first appearance (so labels read PERSON 07, not PERSON 6080)
    renum = {}
    for fr in frames:
        for d in fr:
            d[6] = renum.setdefault(d[6], len(renum) + 1)
    data['fpsByClip'][str(n)] = round(fps / STRIDE, 3)
    data['clips'][str(n)] = frames
    people = sum(1 for fr in frames for d in fr if d[0] == 'person') / max(1, len(frames))
    ids = len({d[6] for fr in frames for d in fr})
    print(f'clip {n:02d}: {len(frames)} frames, {people:.1f} people/frame, {ids} tracked objects', flush=True)
    json.dump(data, open(OUT, 'w'), separators=(',', ':'))
    n += 1
print('done →', OUT)
