import path from "node:path";

export function privateElectronLaunch(root, inherited) {
  const env = { ...inherited };
  const removed = {};
  for (const name of ["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"]) {
    removed[name] = Object.keys(env).some(key => key.toUpperCase() === name);
    for (const key of Object.keys(env)) if (key.toUpperCase() === name) delete env[key];
  }
  const paths = Object.fromEntries(["profile", "session", "logs"].map(name => [name, path.join(root, name)]));
  return { env, cwd: root, paths, facts: { cwd: root, paths, inheritedKeyPresence: Object.fromEntries(["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "TEMP", "TMP", "TMPDIR"].map(name => [name, Object.keys(inherited).some(key => key.toUpperCase() === name)])), removedKeyPresence: removed } };
}

export function standaloneElectronArgs(main, url, root) {
  return [main, url, root, "--standalone", `--user-data-dir=${path.join(root, "profile")}`];
}
