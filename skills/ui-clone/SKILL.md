---
name: ui-clone
description: "Use for frontend work when the user wants to clone, copy, recreate or match a UI, section, component, effect or animation from a reference: a live URL, their local dev server, a video, GIF or screen recording (web or mobile app), or a Figma design. Covers pixel-accurate UI (layout, fonts, spacing, colours), animations and interactions (load, hover, click, scroll, page transitions, loaders, marquees, springs), and effects (gradients, blurs, shaders, canvas/WebGL backgrounds), rebuilt in the user's stack (HTML/CSS, React, Next.js, Vue, Svelte, Tailwind, Framer Motion, GSAP, Web Animations, three.js, React Native, SwiftUI), then verified against the reference with screenshot diffs and frame-by-frame timing. Not for the user's documentary channel videos (documentary-animation) or video-only motion studies (motion-match)."
---

# UI clone: measure the reference, rebuild it, prove it matches

Every job follows one loop: **capture the reference → measure it (read exact values where possible, measure pixels
where not) → write the spec → build in the user's stack → capture ours the same way → compare → fix**, until the
spec passes. The deliverable is code in the user's project **plus evidence** (numbers, diff images, side-by-side
sheets), never "looks about right". Methods adapted from NiazMorshed2007/reanimate and
rossark0/rossark-motion-skill (both MIT); every script here is our own.

`<skill>` = this skill's folder. Work goes in `./ui-clone/<name>/` in the project: `ref/`, `ours/`, `figma/`,
`compare-N/`, `diff-N/`, `spec.md`. Add `ui-clone/` to `.gitignore` unless the user wants the evidence committed.

## Setup (once per machine)
- **Python** (numpy + Pillow): `~/.ui-clone/venv/bin/python` (create with `python3 -m venv ~/.ui-clone/venv && ~/.ui-clone/venv/bin/pip install numpy pillow` if missing). Run scripts with `-I`.
- **Browser capture** (Playwright + Chromium, ~250 MB, only for URL / dev-server inputs): runner in `~/.ui-clone/runner`
  (`npm i playwright@1.64.1 && npx playwright@1.64.1 install chromium` there). Run the `.mjs` scripts with
  `node <skill>/scripts/<script>.mjs` (they load Playwright from `~/.ui-clone/runner`, or `UICLONE_RUNNER`; if Playwright's own Chromium isn't installed they use any Chromium in Playwright's cache, or `UICLONE_CHROMIUM`).
- **ffmpeg/ffprobe** on PATH. **Figma** only: `FIGMA_TOKEN=...` in the environment, the project's `keys.env`, or `~/.ui-clone/keys.env`
  (read-only personal access token). Never print or commit tokens.
Ask before installing anything that isn't there.

## 0. Scope (top of `spec.md`, before any capture)
- **Target:** exactly what to clone (URL + selector, file + time range + crop, Figma node) and nothing more.
- **Fidelity** (state it in the first reply; it decides what gets verified):
  | level | when | must match | may differ |
  |---|---|---|---|
  | **motion-faithful** (default for others' work) | "make ours feel/move like theirs" | structure and proportions, order, timing ±0.08 s, easing family, overshoot, travel relative to size, stagger | copy, colours, fonts, images, brand |
  | **pixel-faithful** | the user's own design (Figma → code), their own site, client work they have rights to, or private practice | everything above + fonts, sizes, spacing, colours, radii, shadows, assets; screenshot mismatch ≤ 2% (≤ 0.5% at rest), no measured shifts | nothing they didn't ask to change |
  | **mixed** | "clone X and add Y" | the cloned part at one of the above | the additions (kept separate, shown, checked not to break the clone) |
- **Rights:** pixel-faithful copies of other companies' UIs, logos, illustrations, fonts and copy are theirs; use them only
  for learning or with permission, and never publish them as the user's own work. When the reference is a third
  party's product and the user wants to ship it, default to motion-faithful with their own design and say why.
- **Destination:** where the code goes and in which stack. Read `package.json`, existing components, the styling system
  (Tailwind config, CSS variables, design tokens) and the animation library already in use; match them rather than
  adding a new library.

## 1. Choose the input method (most precise available; say which one you use)
| Input | Capture | What you get |
|---|---|---|
| **Live URL** | `inspect_web.mjs` + `capture_web.mjs` | exact CSS values, fonts, declared durations/delays/easings, keyframes; frame-exact recording with a virtual clock |
| **Local dev server** (ours) | same scripts on `http://localhost:…` | the "ours" side of every comparison, captured exactly like the reference |
| **Video / GIF / screen recording** (web or app) | `ref_frames.py` | every frame at source fps + timing/pose sheets; values measured from pixels |
| **Figma** | `figma_fetch.py` (token) or exported PNG frames | exact sizes, spacing, auto-layout, typography, colours, effects, prototype transitions + a reference PNG |
| **Mobile app** | screen recording (reference); for ours: `xcrun simctl io booted recordVideo ours.mp4` (iOS simulator) or `adb shell screenrecord` (Android) | as video; ours captured the same way |
Combine them: URL values + a recording for interactions that are hard to trigger (logged-in flows, drags); Figma
values + the dev server to check "does my build match the design"; video reference + dev-server capture for ours.
Login-walled pages: ask for a screen recording or for the user to log in; never handle their passwords.

## 2. Capture and measure the reference
**URL:**
- `inspect_web.mjs --url URL --selector "<section>" --out ui-clone/<name>/ref [--state hover --target "<btn>"]` →
  `inspect.md`: per element box + computed styles, declared transitions, running animations with keyframes, @keyframes,
  fonts, detected libraries (GSAP, Framer Motion, Lottie, three.js, Lenis...), canvases (2d/WebGL), hover/focus diff.
  **Declared values beat measured ones: copy them.**
- `capture_web.mjs --url URL --selector "<section>" --trigger load|hover|click|scroll|none --duration 2 --fps 30 --out ui-clone/<name>/ref`
  → frames/, video.mp4, frames.json, animations.json. Default `--mode seek` (virtual clock: JS timers and
  requestAnimationFrame on Playwright's clock, CSS/Web Animations paused and seeked each frame: identical captures).
  Use `--mode realtime` for pages the virtual clock breaks (video elements, some WebGL/canvas libraries) and say so.
  `--still` gives one settled screenshot for pixel work; `--dpr 2` for retina-sharp comparisons (**`--dpr 3` for small
  elements**: a 12 px hover growth is too few pixels to fit an easing at 1x); `--pad 12` adds a margin around
  `--selector` so hover/scale effects that grow past the resting box stay in frame; `--viewport 390x844` for phones.
  Seek mode is verified frame-identical across runs. `--mode realtime` takes real screenshots as fast as the machine
  allows (~19/s on a typical laptop) and resamples; it prints the achieved rate: timing is only as precise as that.
**Video / GIF / recording:** `ref_frames.py REF.mp4 --out ui-clone/<name>/ref [--start --end --crop x:y:w:h]`.
**Figma:** `figma_fetch.py --url "<figma link with node-id>" --out ui-clone/<name>/figma --scale 2` → design.md/json + frame.png.
**Then measure motion** (any input with frames):
- Cuts and sections: `motion_compare.py <ref> <ref> --out <ref>/self --no-align`.
- Colours: `track_motion.py <ref>/frames --sample X,Y --at T`.
- Each moving element: `track_motion.py <ref>/frames --name el --colors HEX,HEX --tol 35 --region x,y,w,h` (always a region on busy references).
- Each move: `fit_easing.py <ref>/track_el.json --prop cx|cy|w|h|aspect|presence --from A --to B` → timing, easing, overshoot,
  and paste-ready CSS / WAAPI / Framer Motion / GSAP / Remotion lines. Error ≤ 0.03 = close fit; "no single ease fits" =
  split the window or it's a keyframe chain. **When the runner-up's error is within ~0.003 of the best, treat it as a tie**
  (e.g. easeOutQuad 0.58 s vs easeOutCubic 0.80 s fit the same frames): say so, and prefer declared values from
  `inspect.md`, the source code, or the sheets to break it. Tracking only sees an element by its colour, so an element
  that **fades in while it moves** looks like it starts late: for web inputs use the declared values instead.
Read every sheet (`sheets/poses.png`, `sheets/timing_NN.png`) yourself: numbers say *that*, sheets say *what*.

## 3. Write the spec (`ui-clone/<name>/spec.md`; every row becomes a check)
- **Structure & static style** (pixel-faithful): element → box, font (family/size/weight/line height/letter spacing),
  colours, radius, shadow, spacing; source (`inspect.json` / `design.json` / measured).
- **Timeline** (motion): `| # | element | property | from → to | start ms | duration ms | easing | stagger / repeat | trigger | source |`.
- Note what does **not** move. A "?" means the reference hasn't been read yet. Show the spec before a big build.

## 4. Build
In the user's stack and design system. Copy declared values exactly (pixel-faithful) or relative proportions
(motion-faithful). Easings from `inspect.json` or from `fit_easing.py`'s line for their library; springs where the
reference overshoots and settles; staggers as `base + index × step`. Respect `prefers-reduced-motion` (show the end
state). Keep additions in separate components. Give ours a route/page that renders the component at the reference
viewport with the same trigger, so it can be captured identically. WebGL effects: rebuild the shader from what the
reference shows (or its readable source when the user may use it); fixed timestep from time, seeded randomness.

## 5. Verify, fix, repeat (2-5 rounds; keep every round's folder)
1. Capture ours with the **same** command as the reference (only `--url`/input and `--out` change), or
   `ref_frames.py OURS.mp4 --out ui-clone/<name>/ours --like <ref>/frames.json` for video inputs.
2. **Pixels:** `screenshot_diff.py <ref>/still.png <ours>/still.png --out ui-clone/<name>/diff-N [--strict] [--max 0.02] [--mask x,y,w,h]`
   (**pixel-faithful: always `--strict`**: per-pixel threshold 0.03, max 0.5%, and any region whose colour drifts by more
   than 3 RGB levels fails; the default is lenient and lets small padding and colour changes through)
   → mismatch %, worst regions, whole-image or per-element **shifts** ("something in region … moved +0 px x, +6 px y"),
   colour drift, `side_by_side.png`. Fix shifts first (they make everything look wrong), then sizes, then colours.
   Pixel-faithful FAILs on any measured shift; motion-faithful uses `--allow-shift` and a looser `--max`.
3. **Motion:** `motion_compare.py <ref> <ours> --out ui-clone/<name>/compare-N` (cuts, moves, offset; PASS ±0.08 s;
   `activity.png`, `sheets/compare_NN.png`) and, per spec row, `fit_easing.py REF_TRACK --prop P --from A --to B --vs OUR_TRACK`.
4. Read the sheets every round. Change the smallest thing the evidence points at; re-capture; re-compare.
5. After 5 rounds, report every row still failing with its number and reason (font licence, a WebGL effect
   approximated, a spring tuned by eye). Never loosen a threshold silently.

| Symptom | Usual cause | Fix |
|---|---|---|
| whole image shifted N px | different scroll/offset/crop or a missing wrapper margin | match viewport, dpr, crop; fix the outer spacing |
| an element moved | margin/padding/line-height/gap differs | compare its box with `inspect.json` / `design.json` |
| text everywhere slightly off | fallback font, different weight or letter-spacing | load the same font (or the user's licensed equivalent), match size/weight/tracking |
| colours slightly off everywhere | colour space, opacity stacking, gradient stops | copy computed colours/gradients; check opacity on parents |
| motion shifted by one offset | trigger latency or missing delay | fix the first delay |
| ours front-loaded / too snappy | stronger easing (expo vs cubic) | use the fitted bezier or the declared easing |
| reference overshoots, ours doesn't | spring/back vs bezier | spring/back tuned to the measured overshoot and settle |
| scroll animation starts early/late | trigger threshold/offset | match the scroll position where motion begins |
| an extra move in ours | a stray transition (e.g. `transition: all`) | limit transitions to the properties that should animate |

## 6. Report (must stand alone)
Fidelity level and what was cloned / added; files changed and how to trigger the motion; the last round's tables
(pixel mismatch and shifts; cuts/moves timing; per-element easing), paths to `side_by_side.png`, `activity.png` and
compare sheets; every remaining difference with its number and reason; which checks were **measured** (a script
produced them) vs **eyeballed** (looked at a sheet).

## Limits
- Virtual-clock capture can't control `<video>` playback or some GPU/physics libraries: use `--mode realtime` and expect
  ±1-2 frames of jitter; say so.
- Cross-origin stylesheets and fonts may hide @keyframes/@font-face rules from inspection; computed styles and running
  animations are still read.
- From videos, 3D is matched as camera/object motion, not models or materials; busy live-action gives rhythm, not exact element values.
- Mobile: values come from recordings (no source); simulator captures of ours are compared the same way.
