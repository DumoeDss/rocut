import { chromium } from "./browser-probe-toolchain.mjs";

// Native codec diagnostic only; does not use the editor, GPU, user media or muxer.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route("http://localhost/opus-test", route => route.fulfill({ contentType: "text/html", body: "<!doctype html>" }));
  await page.goto("http://localhost/opus-test");
  const result = await page.evaluate(async () => {
    const results = [];
    for (const sampleRate of [44100, 48000]) for (const frames of [Math.round(sampleRate * 0.2), Math.round(sampleRate / 6)]) {
      const packets = [], configurations = [];
      const encoder = new AudioEncoder({ output: (chunk, metadata) => {
        packets.push({ timestamp: chunk.timestamp, duration: chunk.duration });
        if (metadata?.decoderConfig) configurations.push({ ...metadata.decoderConfig,
          description: [...new Uint8Array(metadata.decoderConfig.description)] });
      }, error: error => { throw error; } });
      encoder.configure({ codec: "opus", sampleRate, numberOfChannels: 2, bitrate: 128000 });
      const data = new AudioData({ format: "f32-planar", sampleRate, numberOfFrames: frames,
        numberOfChannels: 2, timestamp: 0, data: new Float32Array(frames * 2) });
      try { encoder.encode(data); await encoder.flush(); }
      finally { data.close(); encoder.close(); }
      results.push({ sampleRate, frames, packets, configurations });
    }
    return results;
  });
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
