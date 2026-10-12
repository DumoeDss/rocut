const assert = require("node:assert/strict");
const zlib = require("node:zlib");

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (~crc) >>> 0;
}
// Native encoder's strict RGBA8/sRGB/filter0 contract, inherited unchanged from graph-runner.
function decode(bytes) {
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  let offset = 8, width, height, srgb = false; const data = [];
  while (offset < bytes.length) {
    const n = bytes.readUInt32BE(offset), kind = bytes.subarray(offset + 4, offset + 8).toString(), body = bytes.subarray(offset + 8, offset + 8 + n);
    assert.equal(crc32(bytes.subarray(offset + 4, offset + 8 + n)), bytes.readUInt32BE(offset + 8 + n));
    if (kind === "IHDR") { width = body.readUInt32BE(0); height = body.readUInt32BE(4); assert.equal(body[8], 8); assert.equal(body[9], 6); }
    if (kind === "sRGB") srgb = body[0] === 0;
    if (kind === "IDAT") data.push(body);
    offset += n + 12;
  }
  assert.equal(offset, bytes.length); assert(srgb); assert.equal(width, 32); assert.equal(height, 24);
  const filtered = zlib.inflateSync(Buffer.concat(data)), rgba = Buffer.alloc(width * height * 4);
  assert.equal(filtered.length, height * (width * 4 + 1));
  for (let y = 0; y < height; y++) { assert.equal(filtered[y * (width * 4 + 1)], 0); filtered.copy(rgba, y * width * 4, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)); }
  return rgba;
}
function compare(rgba, left, right) {
  let maximum = 0, sum = 0;
  for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) for (let c = 0; c < 4; c++) {
    const delta = Math.abs(rgba[(y * 32 + x) * 4 + c] - (x < 16 ? left : right)[c]); maximum = Math.max(maximum, delta); sum += delta;
  }
  return { maximum, mean: sum / rgba.length, gateMaximum: 1, gateMean: .35, accepted: maximum <= 1 && sum / rgba.length <= .35 };
}
module.exports = { crc32, decode, compare };
