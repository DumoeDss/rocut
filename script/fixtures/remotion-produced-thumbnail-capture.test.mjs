import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const text = readFileSync(new URL("../../apps/cli/src/programmatic/remotion-produced-thumbnail-capture.ts", import.meta.url), "utf8");
const source = text.match(/String\.raw`([\s\S]*)`;\s*$/)[1];
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function fixture(animations = []) {
  const window = {}, messages = [], listeners = new Set(), timers = new Map(), events = [];
  const parent = {postMessage:message => {events.push("request");messages.push(JSON.parse(message.payload));}};
  const document = {
    images:[{async decode() {events.push("image");}}], fonts:{ready:Promise.resolve()},
    getAnimations:() => animations,
  };
  new Function("window", "parent", "document", "requestAnimationFrame", "checkHtmlMedia", "failures", "addEventListener", "removeEventListener", "setTimeout", "clearTimeout", source)(
    window, parent, document, callback => {events.push("paint");callback();}, () => events.push("media"), [],
    (_name, listener) => listeners.add(listener), (_name, listener) => listeners.delete(listener),
    callback => {const id = timers.size + 1;timers.set(id, callback);return id;}, id => timers.delete(id),
  );
  const reply = (payload, from = parent) => {
    for (const listener of [...listeners]) listener({source:from,data:{tag:"rocut-produced-capture-reply",reply:payload}});
  };
  return {capture:window.rocutRemotionProducedCapture, messages, listeners, timers, events, reply};
}

test("exact native frame stays pending until its host-owned PNG receipt after image/font/paint readiness", async () => {
  const f = fixture();
  let done = false;
  const job = f.capture({index:17}).then(() => {done = true;});
  await flush();
  assert.deepEqual(f.events, ["media","image","paint","paint","media","request"]);
  assert.deepEqual(f.messages, [{version:1,kind:"remotion-produced-thumbnail",requestId:1,frameIndex:17}]);
  f.reply({requestId:"foreign",ok:true});
  f.reply({requestId:1,ok:true}, {});
  await flush();
  assert.equal(done, false);
  await assert.rejects(f.capture({index:18}), /must be serial/);
  f.reply({requestId:1,ok:true});
  await job;
  assert.equal(done, true);
  assert.equal(f.listeners.size + f.timers.size, 0);
});

test("host error and timeout reject instead of admitting thumbnail success and release the transport", async () => {
  const f = fixture();
  const failed = f.capture({index:2});
  await flush();
  f.reply({requestId:f.messages[0].requestId,error:"PNG rejected"});
  await assert.rejects(failed, /PNG rejected/);
  const timed = f.capture({index:3});
  await flush();
  [...f.timers.values()][0]();
  await assert.rejects(timed, /timed out/);
  assert.equal(f.listeners.size + f.timers.size, 0);
});

test("active CSS animation does not masquerade as a canonical native thumbnail", async () => {
  const f = fixture([{playState:"running"}]);
  await assert.rejects(f.capture({index:4}), /active CSS animations/);
  assert.equal(f.messages.length, 0);
});
