import { runCompilerChild } from "../programmatic/engines/compiler-process";

// Bundled by the focused test and run in a real Electron Node parent.
await runCompilerChild(
	{ output: process.argv[2], label: "\u8d44\u6e90\u56fe", payload: "x".repeat(70000) },
	AbortSignal.timeout(10000),
	`(async()=>{let input='';for await(const chunk of process.stdin)input+=chunk;
const config=JSON.parse(input);await require('node:fs/promises').writeFile(config.output,
JSON.stringify({label:config.label,payloadLength:config.payload.length,electron:!!process.versions.electron,
nodeMode:process.env.ELECTRON_RUN_AS_NODE,secretInherited:process.env.ROCUT_COMPILER_TEST_SECRET!==undefined}),{flag:'wx'});
})().catch(error=>{console.error(error.message);process.exit(1)});`,
);
