import { readFileSync } from "node:fs";

const text = readFileSync("rust/wasm/pkg/opencut_wasm_bg.wasm").toString("latin1");
const count = (needle) => text.split(needle).length - 1;

console.log("/cargo/  (forward-slash form):", count("/cargo/"));
console.log("/cargo\\  (backslash form)   :", count("/cargo\\"));
const i = text.indexOf("/cargo\\");
if (i !== -1) console.log("sample:", JSON.stringify(text.slice(i - 16, i + 80)));
console.log("from_iter occurrences       :", count("from_iter"));
console.log("parking_lot_core occurrences:", count("parking_lot_core"));
console.log("parking_lot.rs occurrences  :", count("parking_lot.rs"));
