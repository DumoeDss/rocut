export const API_GATE = "script/check-wasm-api-surface.mjs";
export const BASELINE_DTS_SHA =
	"07e195eb8e750a6980aaad9c6d9c1c1376e9e0b282dfc387d8c1ecbf8c89278a";

export const EXPECTED = {
	files: [
		".gitignore",
		"LICENSE",
		"README.md",
		"opencut_wasm.d.ts",
		"opencut_wasm.js",
		"opencut_wasm_bg.js",
		"opencut_wasm_bg.wasm",
		"opencut_wasm_bg.wasm.d.ts",
		"package.json",
	].sort(),
	unchangedHashes: {
		".gitignore":
			"684888c0ebb17f374298b65ee2807526c066094c701bcc7ebbe1c1095f494fc1",
		LICENSE: "8117f9bb64534f7530fc6139b014fd1c1465f7981f93d1871789150fa3f59d3d",
		"README.md":
			"a09d79579ac121a05ab38ca5c4cba505d91f2ee4359d336cc2cc1fd36b4d3191",
		"package.json":
			"6eab1bdbf8f6d3a71181bc4f20eb05d35685f48e32c4913bd178671f56876e96",
	},
	changedBaselineHashes: {
		"opencut_wasm.d.ts": BASELINE_DTS_SHA,
		"opencut_wasm.js":
			"81bbfdfed6c0e121a8791c0c356e71301cc3614dd8341cbd3b7b6a613f339d3b",
		"opencut_wasm_bg.js":
			"b0b80cb36443bf768be6cfcb2ad77a7f3b4cdc68b4a89b1f6fc519f2b39e6b2a",
		"opencut_wasm_bg.wasm":
			"56cb9ab6ac1fc8df955a716c01f9ed47d836aba3b1f5ccc6372a155c239c3eee",
		"opencut_wasm_bg.wasm.d.ts":
			"d19c1b3dc87f095040c7eb1e56eb8c965d587cf7927ca21cc513327cf78ed7c1",
	},
	dtsSha: "e7d942d396f17ebca7fed8ccfe3f9e671103ad733c5ce183ef00d3519720596a",
	wrapperSha:
		"19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1",
	wasmDtsSha:
		"df9ee7494a229fc8762fd332066a98bf32a8cdbe2e42ca7201f9af60076cbca7",
	wrapperExportSignature:
		"a9a91d9ad6a8b1a13185e8892a2820752c9be4a2885a18edc71c24ee53769cc9",
	bgExportSignature:
		"5cb5e6fff95cfcfd2fb70dab7a89628eb087ae9797ada39db9fcf336b649364f",
	wasmExportSignature:
		"8034146edac940cb2bcc8469d746fb196f26cdfc0fa8c9643aaafce487945f26",
	wasmImportSignature:
		"2da5921beca72832c11efe8a93e3228649ab22ec41d78313f0f4c74fcdd44001",
};

export const CONTROLS = {
	"missing-export": "wrapper-exports",
	"extra-export": "wrapper-exports",
	"changed-binary-import": "wasm-imports",
	"invalid-backend": "graphics-provider",
	"boolean-count": "graphics-provider",
	"boolean-handles": "gpu-provider",
	"provider-any": "gpu-provider",
	"unkeyed-release": "gpu-provider",
	"truncated-files": "generated-files",
	"check-wasm-missing-registration": "gate-registration",
	"check-wasm-decoy-registration": "gate-registration",
	"ci-missing-registration": "gate-registration",
	"ci-before-install-registration": "gate-registration",
	"gated-missing-registration": "gate-registration",
};
