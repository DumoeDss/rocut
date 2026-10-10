import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { installFlameWrapPresentationObserver } from "./flame-wrap-presentation-observer.mjs";
function fixture() {
	const log = [],
		scratches = [],
		document = { contains: (canvas) => canvas.contained === true };
	document.createElement = () => {
		const scratch = {
			width: 0,
			height: 0,
			getContext: () => ({
				clearRect: () => log.push("clear"),
				drawImage: (canvas) => {
					log.push("copy");
					scratch.data = canvas.data;
				},
				getImageData: () => ({ data: scratch.data }),
			}),
		};
		scratches.push(scratch);
		return scratch;
	};
	class WebGL2RenderingContext {
		constructor() {
			this.canvas = {
				width: 2,
				height: 2,
				ownerDocument: document,
				contained: true,
				data: new Uint8ClampedArray(16),
			};
			this.DRAW_FRAMEBUFFER_BINDING = 36006;
			this.binding = null;
		}
		getParameter() {
			log.push("binding");
			return this.binding;
		}
		getContextAttributes() {
			return { preserveDrawingBuffer: false, alpha: true };
		}
	}
	for (const name of ["flush", "blitFramebuffer", "drawArrays", "drawElements"])
		WebGL2RenderingContext.prototype[name] = function (...args) {
			log.push({ name, args, receiver: this });
			if (this.throwOriginal) throw this.throwOriginal;
			this.canvas.data = new Uint8ClampedArray(this.next ?? this.canvas.data);
			return "original-result";
		};
	const originals = Object.fromEntries(
		["flush", "blitFramebuffer", "drawArrays", "drawElements"].map((name) => [
			name,
			WebGL2RenderingContext.prototype[name],
		]),
	);
	const context = vm.createContext({
		document,
		WebGL2RenderingContext,
		Uint8ClampedArray,
	});
	vm.runInContext(
		`(${installFlameWrapPresentationObserver.toString()})({width:2,height:2})`,
		context,
	);
	return {
		log,
		scratches,
		gl: new WebGL2RenderingContext(),
		observer: context.__flameWrapPresentationObserver,
		originals,
		WebGL2RenderingContext,
		context,
	};
}
const opaque = new Uint8ClampedArray([
	1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255,
]);
test("delegates original receiver/arguments/result and synchronously copies afterward", () => {
	const f = fixture();
	f.gl.next = opaque;
	assert.equal(f.gl.drawArrays(4, 0, 6), "original-result");
	assert.deepEqual(f.log.slice(1), ["binding", "clear", "copy"]);
	assert.equal(f.log[0].receiver, f.gl);
	assert.deepEqual(f.log[0].args, [4, 0, 6]);
	const sample = f.observer.read(f.gl.canvas);
	assert.deepEqual(Array.from(sample.rgba), Array.from(opaque));
	assert.equal(sample.serial, 1);
	assert.equal(sample.contextAttributes.preserveDrawingBuffer, false);
	assert.equal(sample.opaque, true);
});
test("default framebuffer, project geometry, contained root document guards", () => {
	for (const mutate of [
		(gl) => (gl.binding = {}),
		(gl) => (gl.canvas.width = 3),
		(gl) => (gl.canvas.contained = false),
		(gl) => (gl.canvas.ownerDocument = {}),
	]) {
		const f = fixture();
		f.gl.next = opaque;
		mutate(f.gl);
		f.gl.blitFramebuffer();
		assert.equal(f.observer.read(f.gl.canvas), null);
		assert.equal(f.scratches.length, 0);
	}
});
test("empty buffers cannot replace retained sample; partial alpha remains actual", () => {
	const f = fixture();
	f.gl.next = opaque;
	f.gl.flush();
	f.gl.next = new Uint8ClampedArray(16);
	f.gl.flush();
	assert.equal(f.observer.read(f.gl.canvas).serial, 1);
	f.gl.next = new Uint8ClampedArray(opaque);
	f.gl.next[3] = 128;
	f.gl.drawElements();
	assert.equal(f.observer.read(f.gl.canvas).serial, 2);
	assert.equal(f.observer.read(f.gl.canvas).rgba[3], 128);
	assert.equal(f.observer.read(f.gl.canvas).opaque, false);
});
test("original errors propagate with no copy; cleanup restores only own hooks/scratch", () => {
	const f = fixture(),
		error = new Error("original failure");
	f.gl.throwOriginal = error;
	assert.throws(
		() => f.gl.flush(),
		(value) => value === error,
	);
	assert.equal(f.scratches.length, 0);
	f.gl.throwOriginal = null;
	f.gl.next = opaque;
	f.gl.flush();
	const otherWrapper = () => "another owner";
	f.WebGL2RenderingContext.prototype.drawElements = otherWrapper;
	f.observer.cleanup();
	assert.equal(f.context.__flameWrapPresentationObserver, undefined);
	assert.equal(f.WebGL2RenderingContext.prototype.flush, f.originals.flush);
	assert.equal(f.WebGL2RenderingContext.prototype.drawElements, otherWrapper);
	assert.equal(f.scratches[0].width, 0);
	assert.equal(f.gl.canvas.width, 2);
	assert.equal(f.observer.read(f.gl.canvas), null);
});
