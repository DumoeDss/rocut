self.addEventListener("message", (event) => {
	const payload = event.data?.payload;
	self.postMessage({
		kind: "pong",
		byteLength: payload instanceof ArrayBuffer ? payload.byteLength : -1,
	});
});
