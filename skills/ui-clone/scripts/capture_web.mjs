#!/usr/bin/env node
/* Capture a web page (live URL or local dev server) frame by frame with a controlled clock, so every
 * capture of the same page is identical and comparable (method adapted from NiazMorshed2007/reanimate, MIT;
 * own code). Run with the skill's runner:  node <skill>/scripts/capture_web.mjs ...
 *
 *   --url URL                 page to capture (https://... or http://localhost:5173/...)
 *   --out DIR                 writes DIR/frames/0000.png..., DIR/frames.json, DIR/video.mp4 (or DIR/still.png with --still)
 *   --viewport 1440x900       CSS pixels (default 1440x900; phones e.g. 390x844)
 *   --dpr 1                   device pixel ratio (2 for retina-sharp pixel comparisons)
 *   --selector CSS            crop every frame to this element's box (default: the viewport)
 *   --trigger load|hover|click|scroll|none   what starts the motion (default load)
 *   --target CSS              element to hover/click (default: --selector)
 *   --scroll PX --scroll-ms MS  scroll trigger: scroll by PX over MS, one step per frame
 *   --duration 2 --fps 30     seconds to capture, frame rate
 *   --wait-before 800         ms of (virtual) time to let the page settle before the trigger
 *   --pre-js "code"           run in the page after load (close a cookie banner, set a state)
 *   --pad 0                   margin in px around --selector (hover/scale effects grow past the resting box)
 *   --still                   one settled screenshot (after --wait-before) instead of frames: for pixel comparison
 *   --mode seek|realtime      seek (default): virtual clock + paused/seeked CSS & Web Animations: exact, identical frames.
 *                             realtime: real time, screenshots as fast as the machine allows, resampled to --fps (for pages the
 *                             virtual clock breaks: video elements, some canvas/WebGL libraries); prints the achieved rate.
 *   --reduced-motion          emulate prefers-reduced-motion: reduce
 * Prints what it found (animations seen, fonts) and any page errors. Exit 2 on navigation failure.
 */
// Playwright lives in the skill's runner (~/.ui-clone/runner, or UICLONE_RUNNER); ES modules ignore NODE_PATH.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { homedir as _home } from 'node:os';
const _runner = process.env.UICLONE_RUNNER || `${_home()}/.ui-clone/runner`;
let chromium;
try { const _m = await import(pathToFileURL(createRequire(`${_runner}/package.json`).resolve('playwright')).href); chromium = _m.chromium || (_m.default && _m.default.chromium); if (!chromium) throw new Error('no chromium export'); }
catch (e) { console.error(`Playwright not found in ${_runner}: run "npm i playwright@1.64.1" there (see SKILL.md setup)`); process.exit(2); }
// Launch Chromium: Playwright's own build if installed, else UICLONE_CHROMIUM, else the newest Chromium/Chrome for
// Testing in Playwright's cache (any recent build works for capture and screenshots).
async function launchBrowser() {
  const { existsSync, readdirSync } = await import('node:fs'); const { join } = await import('node:path'); const { homedir, platform } = await import('node:os');
  if (process.env.UICLONE_CHROMIUM) return chromium.launch({ executablePath: process.env.UICLONE_CHROMIUM });
  try { return await chromium.launch(); } catch (e) { if (!/Executable doesn't exist|browserType.launch/.test(String(e))) throw e; }
  const cache = platform() === 'darwin' ? join(homedir(), 'Library/Caches/ms-playwright') : platform() === 'win32' ? join(process.env.LOCALAPPDATA || '', 'ms-playwright') : join(homedir(), '.cache/ms-playwright');
  const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
  const rel = ['chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-win64/chrome.exe', 'chrome-win/chrome.exe'];
  for (const dd of dirs) for (const r of rel) { const p = join(cache, dd, r); if (existsSync(p)) { console.error(`(using ${dd} from the Playwright cache)`); return chromium.launch({ executablePath: p }); } }
  throw new Error('No Chromium found: run `npx playwright@1.64.1 install chromium` in ~/.ui-clone/runner, or set UICLONE_CHROMIUM to a Chrome/Chromium binary');
}

import { mkdirSync, writeFileSync, readdirSync, unlinkSync, existsSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const A = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) { const k = argv[i]; if (!k.startsWith('--')) continue; const n = argv[i + 1]; if (n === undefined || n.startsWith('--')) A[k.slice(2)] = true; else { A[k.slice(2)] = n; i++; } }
if (!A.url || !A.out) { console.error('usage: capture_web.mjs --url URL --out DIR [options]  (see the header of this file)'); process.exit(2); }
const [vw, vh] = String(A.viewport || '1440x900').split('x').map(Number);
const dpr = Number(A.dpr || 1), fps = Number(A.fps || 30), dur = Number(A.duration || 2), waitBefore = Number(A['wait-before'] || 800);
const trigger = String(A.trigger || 'load'), mode = String(A.mode || 'seek');
const out = resolve(A.out); const fdir = join(out, 'frames'); mkdirSync(fdir, { recursive: true });
for (const f of existsSync(fdir) ? readdirSync(fdir) : []) if (f.endsWith('.png')) unlinkSync(join(fdir, f));

const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, reducedMotion: A['reduced-motion'] ? 'reduce' : 'no-preference',
});
const page = await context.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// In seek mode: JS time (Date, timers, requestAnimationFrame, performance.now) runs on Playwright's virtual clock,
// and every CSS animation / transition / Web Animation is paused and seeked to the virtual time on each frame.
if (mode === 'seek') {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));   // frozen: time only moves when we step it (identical captures)
  await page.addInitScript(() => {
    const born = new WeakMap(); const seen = []; let reset = 0;
    window.__uc = {
      step(vt) {
        for (const a of document.getAnimations()) {
          if (!born.has(a)) { born.set(a, vt); seen.push(a); }   // start each animation's clock on the VIRTUAL timeline (real time ignored: identical captures)
          try { a.pause(); a.currentTime = Math.max(0, vt - born.get(a)); } catch (e) {}
        }
      },
      rebase(vt) { for (const a of seen) born.set(a, vt - (a.currentTime || 0)); reset = vt; },
      list() {
        return document.getAnimations().map((a) => {
          const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {}; const el = a.effect && a.effect.target;
          let kfe = null; try { const k = a.effect.getKeyframes(); if (k.length && k[0].easing && k[0].easing !== 'linear') kfe = k[0].easing; } catch (e) {}
          if (t.easing === 'linear' && kfe) t.easing = kfe + ' (per keyframe)';
          return { type: a.constructor.name, name: a.animationName || a.transitionProperty || a.id || '', target: el ? (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.classList.length ? '.' + [...el.classList].join('.') : '')) : '',
                   duration: t.duration, delay: t.delay, easing: t.easing, iterations: t.iterations };
        });
      },
    };
  });
}
try { await page.goto(A.url, { waitUntil: 'load', timeout: 45000 }); } catch (e) { console.error('navigation failed: ' + e.message); await browser.close(); process.exit(2); }
await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
if (A['pre-js']) await page.evaluate(String(A['pre-js']));
const vnow = async () => page.evaluate(() => performance.now());
const step = async (ms) => { if (mode === 'seek') { await page.clock.runFor(ms); const t = await vnow(); await page.evaluate((t) => window.__uc.step(t), t); } else { await page.waitForTimeout(ms); } };

// settle
if (mode === 'seek') await page.evaluate((t) => window.__uc.step(t), await vnow());
if (trigger !== 'load') await step(waitBefore);
let clip;
if (A.selector) {
  const box = await page.locator(String(A.selector)).first().boundingBox();
  if (!box) { console.error('selector not found or not visible: ' + A.selector); await browser.close(); process.exit(2); }
  const pad = Number(A.pad || 0);   // margin around the element (hover/scale effects grow past the resting box)
  const x0 = Math.max(0, Math.floor(box.x - pad)), y0 = Math.max(0, Math.floor(box.y - pad));
  clip = { x: x0, y: y0, width: Math.min(vw - x0, Math.ceil(box.width + 2 * pad)), height: Math.min(vh - y0, Math.ceil(box.height + 2 * pad)) };
}
if (A.still) {
  if (trigger === 'load') await step(waitBefore);
  await page.screenshot({ path: join(out, 'still.png'), clip, animations: 'disabled' });
  writeFileSync(join(out, 'frames.json'), JSON.stringify({ source: A.url, kind: 'still', viewport: [vw, vh], dpr, selector: A.selector || null, clip: clip || null }, null, 1));
  console.log(`still -> ${join(out, 'still.png')}${clip ? ` (crop ${clip.width}x${clip.height} at ${clip.x},${clip.y})` : ''}`);
  if (errors.length) console.log('page errors:\n  ' + errors.slice(0, 8).join('\n  '));
  await browser.close(); process.exit(0);
}
// trigger
const tgt = String(A.target || A.selector || 'body');
if (trigger === 'hover') await page.hover(tgt);
if (trigger === 'click') await page.click(tgt);
const n = Math.round(dur * fps), dt = 1000 / fps;
const scrollPx = Number(A.scroll || 0), scrollMs = Number(A['scroll-ms'] || 600);
const shots = [];   // realtime mode: [ms since trigger, png buffer]
if (mode === 'realtime') {
  const t0 = Date.now();
  while (Date.now() - t0 < dur * 1000 + dt) {
    const el = Date.now() - t0;
    if (trigger === 'scroll' && scrollPx) await page.evaluate((y) => window.scrollTo(0, y), Math.round(scrollPx * Math.min(1, el / scrollMs)));
    const buf = await page.screenshot({ clip, animations: 'allow' }); shots.push([(el + (Date.now() - t0)) / 2, buf]);
  }
  for (let i = 0; i < n; i++) {   // nearest real screenshot for each output frame time
    const want = i * dt; let best = shots[0];
    for (const s of shots) if (Math.abs(s[0] - want) < Math.abs(best[0] - want)) best = s;
    writeFileSync(join(fdir, String(i).padStart(4, '0') + '.png'), best[1]);
  }
}
// Playwright's clock rounds each runFor() up to whole ms (33.33 -> 34 = 2% fast), so step by whole-ms differences of the
// EXACT frame times: no drift, frame i is always at round(i * 1000 / fps) ms.
let doneMs = 0;
for (let i = 0; mode === 'seek' && i < n; i++) {
  if (i > 0) { const target = Math.round((i * 1000) / fps); await step(target - doneMs); doneMs = target; } else await page.evaluate((t) => window.__uc.step(t), await vnow());
  if (trigger === 'scroll' && scrollPx) { const p = Math.min(1, (i * dt) / scrollMs); await page.evaluate((y) => window.scrollTo(0, y), Math.round(scrollPx * p)); }
  if (mode === 'seek') await page.screenshot({ path: join(fdir, String(i).padStart(4, '0') + '.png'), clip, animations: 'allow' });
}
let anims = [];
if (mode === 'seek') anims = await page.evaluate(() => window.__uc.list());
await context.close(); await browser.close();
const achieved = mode === 'realtime' && shots.length > 1 ? (shots.length - 1) / ((shots[shots.length - 1][0] - shots[0][0]) / 1000) : null;
execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-i', join(fdir, '%04d.png'), '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', join(out, 'video.mp4')]);
const first = readdirSync(fdir).filter((f) => f.endsWith('.png')).sort()[0];
const size = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', join(fdir, first)]).toString().trim().split(',').map(Number);
writeFileSync(join(out, 'frames.json'), JSON.stringify({ source: A.url, kind: 'web', mode, fps, start: 0, end: dur, frames: n, frame_size: size, width: size[0],
  viewport: [vw, vh], dpr, selector: A.selector || null, clip: clip || null, trigger, target: tgt, wait_before_ms: waitBefore,
  ...(achieved ? { realtime_capture_fps: Math.round(achieved * 10) / 10 } : {}) }, null, 1));
if (achieved) console.log(`realtime: ${shots.length} real screenshots, ~${achieved.toFixed(1)} per second${achieved < fps * 0.9 ? ` (below ${fps} fps: frames repeat; timing is only as precise as ${Math.round(1000 / achieved)} ms; prefer --mode seek, a smaller --selector crop, or a lower --fps)` : ''}`);
writeFileSync(join(out, 'animations.json'), JSON.stringify(anims, null, 1));
console.log(`${n} frames (${size[0]}x${size[1]}) at ${fps} fps, mode ${mode}, trigger ${trigger} -> ${fdir}; video.mp4`);
if (anims.length) console.log(`animations seen (${anims.length}): ` + anims.slice(0, 8).map((a) => `${a.type} ${a.name || ''} on ${a.target} ${a.duration}ms delay ${a.delay} ${a.easing}`).join('; '));
if (errors.length) console.log('page errors:\n  ' + errors.slice(0, 8).join('\n  '));
