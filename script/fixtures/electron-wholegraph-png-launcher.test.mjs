import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { privateElectronLaunch, standaloneElectronArgs } from "./electron-wholegraph-png-launcher.mjs";
import { privateWholegraphOutputRoot } from "./electron-wholegraph-png-output-root.cjs";

test("selected fixture output accepts only the scoped C temp or E artifact parent", () => {
  for (const root of ["C:/tmps/electron-wholegraph-png-root-control", "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia/.artifacts/electron-wholegraph-png-root-control"]) {
    assert.equal(privateWholegraphOutputRoot(root), path.resolve(root));
  }
  for (const root of ["relative", "C:/tmps/other-fixture", "C:/tmps/electron-wholegraph-png-test/child", "C:/tmps/electron-wholegraph-png-test/..", "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia/electron-wholegraph-png-root-control"]) {
    assert.throws(() => privateWholegraphOutputRoot(root));
  }
});

test("clones environment and removes launch overrides case insensitively", () => {
  const input = { Electron_Run_As_Node: "secret", node_options: "secret", TEMP: "private-temp", Other: "retained" };
  const launch = privateElectronLaunch("C:/tmps/electron-wholegraph-png-test", input);
  assert.deepEqual(launch.env, { TEMP: "private-temp", Other: "retained" });
  assert.equal(input.Electron_Run_As_Node, "secret");
  assert.equal(JSON.stringify(launch.facts).includes("secret"), false);
  assert.equal(launch.facts.removedKeyPresence.NODE_OPTIONS, true);
});
test("standalone arguments omit debugging switches and explicitly select mode", () => {
  assert.deepEqual(standaloneElectronArgs("main.cjs", "http://127.0.0.1:1/", "root"), ["main.cjs", "http://127.0.0.1:1/", "root", "--standalone", `--user-data-dir=${path.join("root", "profile")}`]);
});
test("private user-data-dir is selected in spawn argv before any application code", () => {
  const root = "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia/.artifacts/electron-wholegraph-png-profile-control";
  const args = standaloneElectronArgs("main.cjs", "http://127.0.0.1:1/", root);
  assert.equal(args.at(-1), `--user-data-dir=${path.join(root, "profile")}`);
  assert.deepEqual(args.slice(0, -1), ["main.cjs", "http://127.0.0.1:1/", root, "--standalone"]);
  assert.equal(args.filter(value => value.startsWith("--user-data-dir=")).length, 1);
});
test("private cwd and all configured directories remain beneath supplied root", () => {
  const root = "C:/tmps/electron-wholegraph-png-test";
  const launch = privateElectronLaunch(root, {});
  assert.equal(launch.cwd, root);
  assert.deepEqual(Object.keys(launch.paths), ["profile", "session", "logs"]);
  for (const [name, directory] of Object.entries(launch.paths)) assert.equal(path.relative(root, directory), name);
});
