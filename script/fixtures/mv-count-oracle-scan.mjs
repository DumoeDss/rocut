import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../node_modules/playwright-core/index.mjs';
const referenceRoot = process.env.ROCUT_TEST_MV_REFERENCE;
const browserPath = process.env.ROCUT_TEST_BROWSER_EXECUTABLE;
assert.ok(referenceRoot && isAbsolute(referenceRoot) && browserPath && isAbsolute(browserPath), 'explicit reference/browser paths required');
const read = async p => readFile(join(referenceRoot, p), 'utf8');
const util = await read('skills/vocaloid-style-mv/template/engine/core/util.js');
const draw = await read('skills/vocaloid-style-mv/template/engine/core/draw.js');
const night = await read('skills/vocaloid-style-mv/template/engine/scenes/night.js');
const browser = await chromium.launch({ headless: true, executablePath: browserPath, args: ['--disable-gpu-rasterization'] });
try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><meta charset=\'utf-8\'><body></body>');
    const result = await page.evaluate(async ({ util, draw, night, scans, anchors }) => {
        const doc = document;
        for (const code of [util, draw, night]) {
            const script = doc.createElement('script');
            script.textContent = code;
            doc.body.append(script);
        }
        const Z = window.Z;
        const bgCanvas = doc.createElement('canvas');
        bgCanvas.width = 1672; bgCanvas.height = 941;
        const bctx = bgCanvas.getContext('2d');
        const grad = bctx.createLinearGradient(0, 0, 1672, 941);
        grad.addColorStop(0, '#102444'); grad.addColorStop(0.55, '#0c1529'); grad.addColorStop(1, '#524054');
        bctx.fillStyle = grad; bctx.fillRect(0, 0, 1672, 941);
        for (let n = 0; n < 18; n++) {
            bctx.fillStyle = n % 3 === 0 ? '#ffb267' : '#4f789d';
            bctx.fillRect(n * 99 + 20, 310 + n % 4 * 45, 18 + n % 3 * 13, 170 + n % 5 * 61);
        }
        bctx.strokeStyle = '#85a3c2'; bctx.lineWidth = 3;
        for (let n = 0; n < 10; n++) { bctx.beginPath(); bctx.moveTo(836, 518); bctx.lineTo(n * 200 - 200, 941); bctx.stroke(); }
        const beats = [96.38, 97.09, 97.73, 98.46, 99.13, 99.91, 100.58];
        Z.FONT = { mincho: '"Shippori Mincho B1"', dot: '"DotGothic16"' };
        Z.clock = Z.makeClock(beats, 120, 0);
        Z.canvas = (w, h) => { const c = doc.createElement('canvas'); c.width = w; c.height = h; return c; };
        Z.imgSync = () => bgCanvas;
        Z.scratch = [Z.canvas(1920, 1080), Z.canvas(1920, 1080), Z.canvas(1920, 1080)];
        const scene = Z.SCENES.wetFloor;
        const t = 99.23;
        const p = Math.max(0, Math.min(1, (t - 97) / 4.5));
        const e = -(Math.cos(Math.PI * p) - 1) / 2;
        const rot = -0.03 + (0.012 - -0.03) * e;
        const zoom = (1.0 + (1.06 - 1.0) * e) * (1 + 0.006 * Math.exp(-9 * (t - 99.13)));
        const out = [];
        const glowCalls = [];
        const protoDraw = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (source, ...rest) {
            if (source && source.width === 128 && source.height === 128) {
                const m = this.getTransform();
                glowCalls.push({ m: [m.a, m.b, m.c, m.d, m.e, m.f], rest: rest.map(v => typeof v === 'number' ? Math.round(v * 100) / 100 : v) });
            }
            return protoDraw.call(this, source, ...rest);
        };
        for (const t of scans) {
            const canvas = doc.createElement('canvas');
            canvas.width = 1920; canvas.height = 1080;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            scene.draw(ctx, { args: { mode: 'count', bg: 'assets/bg/bg_wetstreet.png' }, t, p: Math.max(0, Math.min(1, (t - 97) / 4.5)), shot: { id: 'scan', t0: 97, t1: 101.5 }, clock: Z.clock });
            const rows = {};
            for (const pair of anchors) {
                const d = ctx.getImageData(pair[0], pair[1], 1, 1).data;
                rows[pair[0] + ',' + pair[1]] = [d[0], d[1], d[2], d[3]];
            }
            out.push({ t: t, rows: rows });
        }
        CanvasRenderingContext2D.prototype.drawImage = protoDraw;
        return { frames: out, glowCalls: glowCalls, camera: { rot: rot, zoom: zoom } };
    }, {
        util: util, draw: draw, night: night,
        scans: [98.9, 99.0, 99.1, 99.23, 99.4, 99.6, 99.8, 100.0, 100.2, 100.4, 100.6, 100.8, 101.0],
        anchors: [[300, 120], [1800, 900], [1700, 850], [100, 86]],
    });
    for (const row of result.frames) {
        const fmt = k => row.rows[k].slice(0, 3).join(',');
        console.log('t=' + row.t + '  (300,120)=' + fmt('300,120') + '  (1800,900)=' + fmt('1800,900') + '  (1700,850)=' + fmt('1700,850') + '  (100,86)=' + fmt('100,86'));
    }
    console.log('ORACLE camera:', JSON.stringify(result.camera));
    const near = result.glowCalls.filter(c => {
        const cx = c.rest[0] + c.rest[2] / 2, cy = c.rest[1] + c.rest[3] / 2;
        return Math.hypot(cx - 300, cy - 120) < 200 || Math.hypot(cx - 1800, cy - 900) < 200;
    });
    console.log('glow calls near anchor regions: ' + near.length + ' of ' + result.glowCalls.length);
    for (const c of near.slice(0, 24)) console.log(JSON.stringify(c));
} finally { await browser.close(); }
