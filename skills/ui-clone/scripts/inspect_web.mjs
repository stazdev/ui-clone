#!/usr/bin/env node
/* Read the exact design and motion values of a web page section: what pixels can only estimate
 * (idea from NiazMorshed2007/reanimate's inspect step, MIT; own code).
 *   node <skill>/scripts/inspect_web.mjs --url URL --selector CSS --out DIR
 *        [--viewport 1440x900] [--dpr 1] [--settle 1200] [--depth 6] [--max-nodes 250] [--state hover|focus|active --target CSS] [--pre-js "code"]
 * Writes DIR/inspect.json and DIR/inspect.md:
 *   - every element under the selector (to --depth): box, text, and the computed styles that decide its look
 *     (font family/size/weight/line height/letter spacing, colours, backgrounds and gradients, borders and radii,
 *     shadows, padding/margin/gap, display/flex/grid, transform, opacity, filters, blend modes)
 *   - CSS transitions declared on each element (property, duration, delay, timing function)
 *   - running animations (document.getAnimations(): type, name, target, duration, delay, easing, iterations,
 *     fill, direction, keyframes) and @keyframes rules from readable stylesheets
 *   - fonts in use (document.fonts, @font-face sources), libraries detected (GSAP, anime, Framer Motion, Lottie,
 *     three.js, Lenis/locomotive scroll), canvases (2d / WebGL / WebGL2)
 *   - with --state: the same styles after hover/focus/active on --target, and what changed
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

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const A = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) { const k = argv[i]; if (!k.startsWith('--')) continue; const n = argv[i + 1]; if (n === undefined || n.startsWith('--')) A[k.slice(2)] = true; else { A[k.slice(2)] = n; i++; } }
if (!A.url || !A.out) { console.error('usage: inspect_web.mjs --url URL --selector CSS --out DIR [options]'); process.exit(2); }
const [vw, vh] = String(A.viewport || '1440x900').split('x').map(Number);
const out = resolve(A.out); mkdirSync(out, { recursive: true });
const browser = await launchBrowser();
const page = await (await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: Number(A.dpr || 1) })).newPage();
try { await page.goto(A.url, { waitUntil: 'load', timeout: 45000 }); } catch (e) { console.error('navigation failed: ' + e.message); await browser.close(); process.exit(2); }
await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
// let finite animations (CSS/WAAPI) finish and JS motion settle, so the base state is the resting design
await page.evaluate(async (ms) => {
  const fin = document.getAnimations().filter((a) => { const t = a.effect && a.effect.getTiming(); return t && t.iterations !== Infinity; }).map((a) => a.finished.catch(() => {}));
  await Promise.race([Promise.all(fin), new Promise((r) => setTimeout(r, 6000))]); await new Promise((r) => setTimeout(r, ms));
}, Number(A.settle || 1200));
if (A['pre-js']) await page.evaluate(String(A['pre-js']));

const collect = async () => page.evaluate(({ sel, depth, maxNodes }) => {
  const KEYS = ['display', 'position', 'width', 'height', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
    'text-transform', 'text-align', 'color', 'background-color', 'background-image', 'border-top', 'border-right', 'border-bottom', 'border-left',
    'border-radius', 'box-shadow', 'text-shadow', 'padding', 'margin', 'gap', 'flex-direction', 'justify-content', 'align-items',
    'grid-template-columns', 'transform', 'transform-origin', 'opacity', 'filter', 'backdrop-filter', 'mix-blend-mode', 'overflow', 'z-index',
    'transition-property', 'transition-duration', 'transition-delay', 'transition-timing-function',
    'animation-name', 'animation-duration', 'animation-delay', 'animation-timing-function', 'animation-iteration-count'];
  const DEFAULTS = { 'background-image': 'none', 'box-shadow': 'none', 'text-shadow': 'none', transform: 'none', filter: 'none', 'backdrop-filter': 'none',
    'mix-blend-mode': 'normal', opacity: '1', 'animation-name': 'none', 'transition-property': 'all', 'transition-duration': '0s' };
  const root = sel ? document.querySelector(sel) : document.body;
  if (!root) return { error: 'selector not found: ' + sel };
  const path = (el) => { const p = []; for (let e = el; e && e !== root.parentElement; e = e.parentElement) { let s = e.tagName.toLowerCase(); if (e.id) s += '#' + e.id; else if (e.classList.length) s += '.' + [...e.classList].slice(0, 2).join('.'); p.unshift(s); } return p.join(' > '); };
  const nodes = []; const walk = (el, d) => {
    if (nodes.length >= maxNodes || d > depth) return;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); const st = {};
    for (const k of KEYS) { const v = cs.getPropertyValue(k); if (v && DEFAULTS[k] !== v && !(k.startsWith('border-') && k !== 'border-radius' && v.startsWith('0px'))) st[k] = v; }
    const own = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent.trim()).join(' ').trim();
    nodes.push({ path: path(el), tag: el.tagName.toLowerCase(), text: own.slice(0, 80), box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, styles: st });
    for (const c of el.children) walk(c, d + 1);
  };
  walk(root, 0);
  const anims = document.getAnimations({ subtree: true }).filter((a) => !sel || (a.effect && a.effect.target && root.contains(a.effect.target))).map((a) => {
    const t = a.effect.getTiming(); let kf = []; try { kf = a.effect.getKeyframes(); } catch (e) {}
    // CSS @keyframes animations keep animation-timing-function on each keyframe; report that instead of 'linear'
    const kfe = kf.length && kf[0].easing && kf[0].easing !== 'linear' ? kf[0].easing : null;
    return { type: a.constructor.name, name: a.animationName || a.transitionProperty || a.id || '', target: path(a.effect.target), duration: t.duration, delay: t.delay,
             easing: t.easing === 'linear' && kfe ? `${kfe} (per keyframe)` : t.easing, iterations: t.iterations, direction: t.direction, fill: t.fill, keyframes: kf.slice(0, 12) };
  });
  const keyframes = [];
  for (const ss of document.styleSheets) { let rules; try { rules = ss.cssRules; } catch (e) { continue; }
    for (const rr of rules) if (rr.type === 7 /* KEYFRAMES */) keyframes.push({ name: rr.name, css: rr.cssText.slice(0, 1500) }); }
  const fonts = []; if (document.fonts) document.fonts.forEach((f) => fonts.push({ family: f.family, weight: f.weight, style: f.style, status: f.status }));
  const faces = []; for (const ss of document.styleSheets) { let rules; try { rules = ss.cssRules; } catch (e) { continue; }
    for (const rr of rules) if (rr.type === 5 /* FONT_FACE */) faces.push(rr.cssText.slice(0, 300)); }
  const libs = { gsap: !!window.gsap, ScrollTrigger: !!window.ScrollTrigger, anime: !!window.anime, lottie: !!(window.lottie || window.bodymovin || document.querySelector('lottie-player,dotlottie-player')),
    three: !!window.THREE || !!document.querySelector('canvas[data-engine*="three"]'), framerMotion: !!document.querySelector('[style*="--framer"],[data-framer-appear-id],[data-projection-id]'),
    lenis: !!document.querySelector('.lenis,html.lenis'), locomotive: !!document.querySelector('[data-scroll-container]') };
  const canvases = [...(sel ? root.querySelectorAll('canvas') : document.querySelectorAll('canvas'))].map((c) => {
    let kind = 'unknown'; try { kind = c.getContext('webgl2') ? 'webgl2' : c.getContext('webgl') ? 'webgl' : '2d'; } catch (e) {}
    const r = c.getBoundingClientRect(); return { w: c.width, h: c.height, css: [Math.round(r.width), Math.round(r.height)], context: kind };
  });
  return { url: location.href, selector: sel, viewport: [innerWidth, innerHeight], nodes, animations: anims, keyframes, fonts: fonts.slice(0, 40), font_faces: faces.slice(0, 20), libraries: libs, canvases };
}, { sel: A.selector || null, depth: Number(A.depth || 6), maxNodes: Number(A['max-nodes'] || 250) });

const base = await collect();
if (base.error) { console.error(base.error); await browser.close(); process.exit(2); }
let state = null;
if (A.state) {
  const tgt = String(A.target || A.selector);
  if (A.state === 'hover') await page.hover(tgt); else if (A.state === 'focus') await page.focus(tgt); else if (A.state === 'active') { await page.hover(tgt); await page.mouse.down(); }
  await page.waitForTimeout(1500);
  const after = await collect();
  const changes = [];
  after.nodes.forEach((nd, i) => { const b = base.nodes[i]; if (!b || b.path !== nd.path) return; const keys = new Set([...Object.keys(b.styles), ...Object.keys(nd.styles)]);
    for (const k of keys) if (!k.startsWith('transition') && b.styles[k] !== nd.styles[k]) changes.push({ path: nd.path, prop: k, from: b.styles[k] || '(default)', to: nd.styles[k] || '(default)' }); });
  state = { state: A.state, target: tgt, changes };
}
await browser.close();
const res = { ...base, state };
writeFileSync(join(out, 'inspect.json'), JSON.stringify(res, null, 1));
const L = [`# Inspect: ${res.url}`, `selector: ${res.selector || '(body)'} · viewport ${res.viewport.join('x')} · ${res.nodes.length} elements`, ''];
const libs = Object.entries(res.libraries).filter(([, v]) => v).map(([k]) => k);
L.push(`libraries: ${libs.length ? libs.join(', ') : 'none detected'} · canvases: ${res.canvases.length ? res.canvases.map((c) => c.context + ' ' + c.css.join('x')).join(', ') : 'none'}`);
const fams = [...new Set(res.fonts.filter((f) => f.status === 'loaded').map((f) => f.family))];
L.push(`fonts loaded: ${fams.join(', ') || '(system only)'}`, '', '## Elements (key styles)');
for (const nd of res.nodes.slice(0, 60)) {
  const s = nd.styles; const pick = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'background-color', 'background-image', 'border-radius', 'box-shadow', 'padding', 'gap', 'transform', 'opacity'].filter((k) => s[k]).map((k) => `${k}: ${s[k].length > 70 ? s[k].slice(0, 70) + '…' : s[k]}`);
  L.push(`- \`${nd.path}\` ${nd.box.w}x${nd.box.h} at ${nd.box.x},${nd.box.y}${nd.text ? ` "${nd.text}"` : ''}${pick.length ? '\n  ' + pick.join(' · ') : ''}`);
}
const tr = res.nodes.filter((nd) => nd.styles['transition-duration'] && nd.styles['transition-duration'] !== '0s');
L.push('', `## Declared transitions (${tr.length})`); for (const nd of tr.slice(0, 40)) L.push(`- \`${nd.path}\`: ${nd.styles['transition-property'] || 'all'} ${nd.styles['transition-duration']} ${nd.styles['transition-timing-function'] || ''} delay ${nd.styles['transition-delay'] || '0s'}`);
L.push('', `## Running animations (${res.animations.length})`); for (const a of res.animations.slice(0, 40)) L.push(`- ${a.type} \`${a.name}\` on \`${a.target}\`: ${a.duration} ms, delay ${a.delay} ms, easing ${a.easing}, iterations ${a.iterations}`);
L.push('', `## @keyframes (${res.keyframes.length})`); for (const k of res.keyframes.slice(0, 20)) L.push('```css\n' + k.css + '\n```');
if (state) { L.push('', `## ${state.state} on \`${state.target}\`: ${state.changes.length} style changes`); for (const c of state.changes.slice(0, 60)) L.push(`- \`${c.path}\` ${c.prop}: ${c.from} → ${c.to}`); }
writeFileSync(join(out, 'inspect.md'), L.join('\n') + '\n');
console.log(L.slice(0, 4).join('\n') + `\n... ${res.animations.length} animations, ${tr.length} transitions, ${res.keyframes.length} @keyframes${state ? `, ${state.changes.length} ${state.state} changes` : ''} -> ${join(out, 'inspect.md')}`);
