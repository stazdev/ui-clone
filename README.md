# UI Clone

A Claude skill for frontend work: **clone, recreate or match a UI, component, effect or animation** from a reference. The reference can be:
- a live URL;
- your local dev server;
- a video, GIF or screen recording (web or mobile);
- a Figma design.

The deliverable is code in your project **plus evidence** (measured values, diff images, side-by-side sheets), never "looks about right".

## The loop

Every job follows the same steps until the spec passes:
1. **Capture the reference.**
2. **Measure it.** It reads exact values where it can (styles and animations declared in the page, Figma nodes) and measures pixels where it can't.
3. **Write the spec.** Every row becomes a check.
4. **Build it** in your stack.
5. **Capture your version** the same way.
6. **Compare and fix.**

## Covers

- **Pixel-accurate UI:** layout, fonts, spacing, colours, radii, shadows.
- **Animations and interactions:** load, hover, click, scroll, page transitions, loaders, marquees, springs.
- **Effects:** gradients, blurs, shaders, canvas/WebGL backgrounds.
- **Stacks:** HTML/CSS, React, Next.js, Vue, Svelte, Tailwind, Framer Motion, GSAP, Web Animations, three.js, React Native, SwiftUI.

## What you can build with it

- **A section you admire, in your own brand:** "Make our pricing section match this site's layout and hover effects."
- **A Figma handoff that really matches:** components built from the Figma file and checked against its frames.
- **Motion from a recording:** a mobile app's onboarding transitions rebuilt in React Native or SwiftUI.
- **WebGL and shader backgrounds:** a gradient-mesh or particle hero rebuilt in three.js.
- **A regression check:** your dev server compared to the design after a refactor, with diff images.

## Installing

**Claude apps:** zip `skills/ui-clone` and upload it under *Customize → Skills* (or add this folder as a plugin).

**Claude Code:**

```bash
cp -R skills/ui-clone ~/.claude/skills/
```

## Requirements

Claude asks before installing anything:

- **Python 3** with `numpy` and `Pillow`, in `~/.ui-clone/venv`.
- **Playwright with Chromium** (about 250 MB), only for URL and dev-server inputs. It is installed in `~/.ui-clone/runner`.
- **ffmpeg/ffprobe**.
- **Figma inputs only:** a read-only `FIGMA_TOKEN`, never printed or committed.

## How to use it

```text
Clone the hero section of https://example.com into my Next.js app (src/app/page.tsx), Tailwind, our colours.
```

```text
Here's a screen recording of the card hover effect (hover.mov). Match it in Framer Motion.
```

```text
Build the Settings screen from this Figma frame: <figma link>. React + CSS modules.
```

Evidence goes into `./ui-clone/<name>/`: `ref/`, `ours/`, `figma/`, `compare-N/`, `diff-N/` and `spec.md`. Add `ui-clone/` to `.gitignore` unless you want the evidence committed.

## Repository layout

```
skills/ui-clone/
  SKILL.md          the loop, input methods, spec, verify rounds, report
  NOTICE.md         credits
  scripts/
    capture_web.mjs     capture a page with a controlled clock (seek or realtime mode)
    inspect_web.mjs     read declared styles and animations from the page
    figma_fetch.py      fetch Figma nodes and renders (read-only token)
    screenshot_diff.py  pixel diff with heatmap
    ref_frames.py, track_motion.py, fit_easing.py, motion_compare.py   motion measurement
```

## Credits

The methods are adapted from NiazMorshed2007/reanimate and rossark0/rossark-motion-skill (both MIT). All scripts are an independent implementation.
