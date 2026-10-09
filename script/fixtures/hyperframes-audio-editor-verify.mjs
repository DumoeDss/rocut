import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";

/** Independent source-WAV and frame-marker oracle; no Rocut timing/mix helpers. */
export function verifyHyperframesEditorExport({ file, ffmpeg, ffprobe, loopPcm, videoPcm, mixedPcm }) {
  const native = { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 };
  const metadata = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-count_frames", "-show_streams", "-of", "json", file], native));
  const video = metadata.streams.find(stream => stream.codec_type === "video");
  const audio = metadata.streams.find(stream => stream.codec_type === "audio");
  assert.equal(video?.nb_read_frames, "9"); assert.equal(video?.width, 64); assert.equal(video?.height, 64);
  assert.equal(audio?.codec_name, "opus"); assert.equal(audio?.channels, 2); assert.equal(audio?.sample_rate, "48000");
  const frames = execFileSync(ffmpeg, ["-v", "error", "-i", file, "-map", "0:v:0", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], native);
  const wanted = [[0, 0, 0], [70, 180, 30], [100, 160, 30], [130, 140, 30], [160, 120, 30],
    [60, 100, 190], [100, 120, 160], [140, 140, 130], [0, 0, 0]];
  const pictureColors = wanted.map((color, index) => {
    const offset = (index * 64 * 64 + 32 * 64 + 32) * 3;
    const actual = [...frames.subarray(offset, offset + 3)];
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(actual[c] - color[c]) <= 6,
      `HF editor frame ${index}: ${actual} instead of ${color}`);
    return actual;
  });
  const decoded = execFileSync(ffmpeg, ["-v", "error", "-i", file, "-map", "0:a:0", "-f", "f32le", "-ac", "2", "-ar", "44100", "pipe:1"], native);
  const samples = 15876;
  assert.equal(mixedPcm.length, samples * 8);
  assert.ok(decoded.length >= samples * 8 && decoded.length < (samples + 882) * 8,
    `Unexpected HF export audio length ${decoded.length / 8}`);
  const reference = (i, c) => {
    let value = 0;
    if (i >= 1764 && i < 8820) value += loopPcm.readFloatLE(((1764 + i % 3528) * 2 + c) * 4) * 0.5 * 0.5011872336272722;
    if (i >= 8820 && i < 14112) value += videoPcm.readFloatLE(((i - 7056) * 2 + c) * 4) * 0.5 * 0.251188643150958;
    if (i >= 3528 && i < 12348) value += Math.fround(Math.sin((i - 3528) * 997 * Math.PI * 2 / 44100) * (c ? 0.015 : 0.03));
    return value;
  };
  const channels = [];
  for (let channel = 0; channel < 2; channel++) {
    const sections = [[0, 1764], [1764, 8820], [8820, 14112], [14112, samples]];
    const sectionRms = sections.map(([start, end]) => {
      let error = 0;
      for (let i = start; i < end; i++) error += (decoded.readFloatLE(i * 8 + channel * 4) - reference(i, channel)) ** 2;
      return Math.sqrt(error / (end - start));
    });
    // Do not shift samples to improve this score. Separately find the strongest
    // local alignment of the independently authored multi-frequency source.
    let bestLag = 0, bestCorrelation = -1;
    for (let lag = -64; lag <= 64; lag++) {
      let cross = 0, actualEnergy = 0, expectedEnergy = 0;
      for (let i = 2100; i < 8500; i++) {
        if (i % 1764 < 96 || i % 1764 >= 1668) continue;
        const x = reference(i, channel), y = decoded.readFloatLE((i + lag) * 8 + channel * 4);
        cross += x * y; actualEnergy += y * y; expectedEnergy += x * x;
      }
      const correlation = cross / Math.sqrt(actualEnergy * expectedEnergy);
      if (correlation > bestCorrelation) { bestCorrelation = correlation; bestLag = lag; }
    }
    let earlySilencePeak = 0, lateSilencePeak = 0;
    for (let i = 0; i < decoded.length / 8; i++) {
      const value = Math.abs(decoded.readFloatLE(i * 8 + channel * 4));
      if (i < 1400) earlySilencePeak = Math.max(earlySilencePeak, value);
      if (i >= 14500) lateSilencePeak = Math.max(lateSilencePeak, value);
    }
    assert.ok(sectionRms.every(value => value < 0.006), `HF independently decoded section RMS ${sectionRms}`);
    assert.ok(Math.abs(bestLag) <= 1 && bestCorrelation > 0.99,
      `HF export source alignment ${JSON.stringify({ bestLag, bestCorrelation })}`);
    assert.ok(earlySilencePeak < 0.001 && lateSilencePeak < 0.001,
      `HF export silent boundaries ${JSON.stringify({ earlySilencePeak, lateSilencePeak })}`);
    channels.push({ sectionRms, bestLagSamples: bestLag, bestCorrelation, earlySilencePeak, lateSilencePeak });
  }
  return { pictureColors, decodedSamples: decoded.length / 8, sourceSamples: samples,
    codecPaddingSamples: decoded.length / 8 - samples, channels };
}
