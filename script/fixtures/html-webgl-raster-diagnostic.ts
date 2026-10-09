import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { renderHtmlPng } from "../../apps/cli/src/programmatic/html-rasterizer";
import type { ProgrammaticSource } from "@opencut/editor-contracts";

// Regression for disabling GPU DOM rasterization without disabling native
// WebGL or alpha. Runs the actual production private-browser capture adapter.
const ffmpeg = process.env.ROCUT_TEST_FFMPEG;
if (!ffmpeg) throw Error("Set ROCUT_TEST_FFMPEG to the isolated native decoder");
const require = createRequire(new URL("../../apps/vite-example/package.json", import.meta.url));
const { chromium } = await import(pathToFileURL(require.resolve("@playwright/test")).href);
const source: ProgrammaticSource = {
  version: 1, runtime: "html-document", width: 32, height: 32,
  frameRate: { numerator: 30, denominator: 1 }, durationFrames: 3, seed: 7,
  code: `<style>html,body{margin:0;background:transparent}canvas{display:block}</style><canvas width="32" height="32"></canvas><script>
window.rocut = {renderFrame(frame) {
  const gl = document.querySelector('canvas').getContext('webgl2', {alpha:true,premultipliedAlpha:true});
  if (!gl) throw Error('Real WebGL2 context unavailable');
  const compile = (type, code) => {
    const shader = gl.createShader(type); gl.shaderSource(shader, code); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, '#version 300 es\\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}');
  const fragment = compile(gl.FRAGMENT_SHADER, '#version 300 es\\nprecision highp float;uniform float channel;out vec4 color;void main(){color=vec4(channel,0.0,1.0-channel,1.0);}');
  const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
  gl.viewport(0,0,32,32); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.SCISSOR_TEST); gl.scissor(0,0,16,32); gl.useProgram(program);
  gl.uniform1f(gl.getUniformLocation(program,'channel'),frame.index===2?1:0);
  gl.drawArrays(gl.TRIANGLES,0,3); gl.finish();
  if (gl.getError()!==gl.NO_ERROR) throw Error('WebGL render failed');
  gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
}};
</script>`,
};
const images = new Map<number, Buffer>();
for (const index of [2, 0, 2]) {
  const png = await renderHtmlPng({ executable: chromium.executablePath(), signal: AbortSignal.timeout(20000),
    request: { source, clipStart: 0, clipDuration: 12000, trimStart: 0, timelineTime: index * 4000 } });
  const rgba = execFileSync(ffmpeg, ["-v", "error", "-f", "image2pipe", "-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"],
    { input: png, windowsHide: true, timeout: 10000, maxBuffer: 65536 });
  assert.equal(rgba.length, 32 * 32 * 4);
  assert.deepEqual([...rgba.subarray((16 * 32 + 8) * 4, (16 * 32 + 8) * 4 + 4)], index === 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
  assert.deepEqual([...rgba.subarray((16 * 32 + 24) * 4, (16 * 32 + 24) * 4 + 4)], [0, 0, 0, 0]);
  if (images.has(index)) assert.deepEqual(rgba, images.get(index));
  images.set(index, rgba);
}
console.log("Production DOM raster policy preserves WebGL2 shader pixels, alpha and reverse/repeated frame capture");
