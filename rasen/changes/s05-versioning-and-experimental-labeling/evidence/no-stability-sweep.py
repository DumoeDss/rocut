#!/usr/bin/env python3
"""
The semantic no-stability sweep (S05 P5, task 6.1).

One-shot evidence tooling for this change, not a repo checker. Enumerates the
universe the tarballs ship (every tracked file under the three packages'
src/, plus each package's README.md / surface.json / package.json — the G2/G5
pack inventories confirm no dist/ files ship) PLUS the task's named extras:
packages/README.md and BOUNDARIES.md. (The only DECISIONS doc,
packages/editor-ports/src/DECISIONS.md, is inside ports' src and counted once.)

It searches for the five terms (`1.0`, `stable`, `production-ready`, `semver`,
`GA`) and gives EVERY hit a recorded disposition — the task's own warning is
that `0.1.0` contains `1.0` as a substring, and counting without reading is
the failure mode this task exists to avoid. Classification is mechanical
where it can be and READ where it must be:

  - `1.0` embedded in a longer decimal number is classified by context:
    svg-path-coordinate (inside an SVG `d="M..."` / `points="..."` attribute),
    version-string-substring (a three-part x.y.z like 0.1.0 / 18.3.1 /
    0.2.10), or decimal-substring (a longer two-part literal like 116.03).
  - a standalone `1.0` (the whole numeric token) is a REAL candidate.
  - `stable` / `production-ready` / `semver` (case-insensitive, word-bounded)
    and `GA` (uppercase, word-bounded — lowercase `ga` is not the term) are
    REAL candidates unless the DISPOSITIONS table below records otherwise.

Fail-closed: exit 1 if any REAL candidate lacks a disposition, or any
disposition names a hit that does not exist (a stale disposition is a lie).
Run from the repo root:
  python rasen/changes/s05-versioning-and-experimental-labeling/evidence/no-stability-sweep.py
"""
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[4]

# ---------------------------------------------------------------------------
# Dispositions — one per REAL candidate, keyed "path:line" (1-based). Written
# after reading each hit in its file; the sweep refuses to pass without them.
# ---------------------------------------------------------------------------
DISPOSITIONS = {
    # --- the three policy READMEs: the negation sentence itself (this change's
    #     own policy statement — an explicit DENIAL, not a claim)
    "packages/editor-ports/README.md:23": "the policy's own negation sentence ('No `1.0`, GA or production-readiness claim') — an explicit denial, not a claim",
    "packages/editor-classic/README.md:24": "the policy's own negation sentence ('No `1.0`, GA or production-readiness claim') — an explicit denial, not a claim",
    "packages/editor-contracts/README.md:22": "the policy's own negation sentence ('No `1.0`, GA or production-readiness claim') — an explicit denial, not a claim",
    # --- BOUNDARIES.md: the ordinary English word
    "BOUNDARIES.md:172": "ordinary-English 'module-stable' (one store instance per module) — not a release-stability claim",
    "BOUNDARIES.md:231": "ordinary-English 'stable identity' (entity ids survive edits) — not a release-stability claim",
    "BOUNDARIES.md:234": "ordinary-English 'stable error code' (error codes are part of the contract) — not a release-stability claim",
    "BOUNDARIES.md:360": "ordinary-English 'stable terminal disposal' (one terminal outcome per disposal) — not a release-stability claim",
    "BOUNDARIES.md:862": "ordinary-English 'module-stable' (one store instance per module) — not a release-stability claim (key moved 859→862 when P5's section-9 audit edit added lines above)",
    # --- BOUNDARIES.md §14 (the labeling section this sweep's log is cited by):
    #     the sweep narration itself names the five terms and its own result —
    #     self-referential mentions, not claims
    "BOUNDARIES.md:1175": "§14's sweep narration naming the term list (`1.0`, `stable`, ...) — a mention, not a claim",
    "BOUNDARIES.md:1176": "§14's sweep narration naming the term list (... `production-ready`, `semver`, `GA`) — a mention, not a claim",
    "BOUNDARIES.md:1179": "§14's sweep narration quoting the ordinary-English 'stable' dispositions — a mention, not a claim",
    "BOUNDARIES.md:1180": "§14's sweep narration describing the numeric `1.0` literal dispositions — a mention, not a claim",
    "BOUNDARIES.md:1182": "§14's sweep narration (Gabon ISO-code sentence + the closing 'zero hits' denial) — mentions, not claims",
    "BOUNDARIES.md:1183": "§14's closing sentence that zero hits make a `1.0`/GA claim — the sweep's own result statement, a denial not a claim",
    # --- ports: the ordinary English word
    "packages/editor-ports/src/DECISIONS.md:23": "ordinary-English 'stable logical id' (worker identity across Hosts) — not a release-stability claim",
    "packages/editor-ports/src/conformance/index.ts:479": "ordinary-English 'stable precommit error' (a named conformance assertion) — not a release-stability claim",
    "packages/editor-ports/src/identity.ts:18": "ordinary-English 'stable across Hosts' (logical worker identity) — not a release-stability claim",
    "packages/editor-ports/src/project-store.ts:127": "ordinary-English 'Stable failure shape' (an error-shape doc comment) — not a release-stability claim",
    "packages/editor-ports/src/runtime-resources.ts:16": "ordinary-English 'stable logical id' (script identity independent of serving location) — not a release-stability claim",
    "packages/editor-ports/src/runtime-resources.ts:42": "ordinary-English 'Stable logical identity' (same) — not a release-stability claim",
    # --- contracts: the ordinary English word
    "packages/editor-contracts/src/conformance/requirements/index.ts:31": "ordinary-English 'stable vector ids' (corpus id stability) — not a release-stability claim",
    "packages/editor-contracts/src/conformance/requirements/index.ts:255": "ordinary-English 'Draft ids are stable' (a requirement's own wording about ids) — not a release-stability claim",
    "packages/editor-contracts/src/conformance/requirements/index.ts:283": "ordinary-English 'queue observation are stable' (requirement wording about ordering) — not a release-stability claim",
    "packages/editor-contracts/src/conformance/requirements/index.ts:292": "ordinary-English 'stable receipt' (requirement wording about receipt identity) — not a release-stability claim",
    "packages/editor-contracts/src/conformance/requirements/index.ts:341": "ordinary-English 'corpus's stable' ids (same as :31) — not a release-stability claim",
    "packages/editor-contracts/src/domain.ts:181": "ordinary-English 'minimal stable surface' (metadata field stability for automation clients) — not a release-stability claim",
    "packages/editor-contracts/src/draft/conformance/index.ts:280": "ordinary-English 'Draft ids are stable' (requirement wording) — not a release-stability claim",
    "packages/editor-contracts/src/draft/conformance/index.ts:599": "ordinary-English 'observation are stable' (requirement wording) — not a release-stability claim",
    "packages/editor-contracts/src/draft/conformance/index.ts:650": "ordinary-English 'stable receipt' (requirement wording) — not a release-stability claim",
    "packages/editor-contracts/src/draft/conformance/index.ts:1080": "ordinary-English 'stable affected-id order' (failure-message wording) — not a release-stability claim",
    "packages/editor-contracts/src/draft/conformance/index.ts:1097": "ordinary-English 'composition-stable' (compensation ordering) — not a release-stability claim",
    "packages/editor-contracts/src/in-memory/index.ts:294": "ordinary-English 'Stable serialization' (idempotency comparison) — not a release-stability claim",
    "packages/editor-contracts/src/transaction.ts:96": "ordinary-English 'stable `code` field' (error codes) — not a release-stability claim",
    "packages/editor-contracts/src/transaction.ts:99": "ordinary-English 'stable failure shape' (same) — not a release-stability claim",
    # --- classic: the ordinary English word
    "packages/editor-classic/src/actions/use-action-handler.ts:1": "ordinary-English 'stable ref' (hook preserves handler signatures) — not a release-stability claim",
    "packages/editor-classic/src/components/__tests__/storage-provider-operations.test.ts:8": "ordinary-English 'stable identity' (test name about diagnostics identity) — not a release-stability claim",
    "packages/editor-classic/src/core/managers/__tests__/project-persistence-rewire.test.ts:606": "ordinary-English 'stable failure identity' (test name) — not a release-stability claim",
    "packages/editor-classic/src/editor/persistence/opaque-value.ts:28": "ordinary-English 'stable `id`' (opaque values matched by id) — not a release-stability claim",
    "packages/editor-classic/src/editor/persistence/session-persistence-coordinator.ts:28": "ordinary-English 'stable ProjectStore object' (one store object per Host) — not a release-stability claim",
    "packages/editor-classic/src/editor/session/__tests__/c6-durable-reopen.test.ts:105": "ordinary-English 'module-stable store' (test name) — not a release-stability claim",
    "packages/editor-classic/src/editor/session/__tests__/session-disposal-c6.test.ts:240": "ordinary-English 'stable failed outcome' (test name) — not a release-stability claim",
    "packages/editor-classic/src/editor/session/session-types.ts:79": "ordinary-English 'stable useEditorInstance()' (hook reference) — not a release-stability claim",
    "packages/editor-classic/src/editor/transactions/opencut/__tests__/adapter-router.test.ts:109": "ordinary-English 'stable minimal dependency order' (test name) — not a release-stability claim",
    "packages/editor-classic/src/editor/use-editor.ts:65": "ordinary-English 'stable-core access' (Explicit stable-core accessor) — not a release-stability claim",
    "packages/editor-classic/src/media/__tests__/audio-resource-lifecycle.test.ts:281": "ordinary-English 'stable order' (test name about cause ordering) — not a release-stability claim",
    "packages/editor-classic/src/services/renderer/compositor/frame-descriptor.ts:567": "ordinary-English 'Stable identity key' (WeakMap identity comment) — not a release-stability claim",
    "packages/editor-classic/src/timeline/__tests__/element-with-track-selector.test.ts:7": "ordinary-English 'shallow-stable members' (test name) — not a release-stability claim",
    "packages/editor-classic/src/timeline/components/index.tsx:206": "ordinary-English 'Stable refs' (wheel-listener comment) — not a release-stability claim",
    "packages/editor-classic/src/timeline/controllers/drag-drop-controller.ts:183": "ordinary-English 'stable' handlers (bound drag handlers) — not a release-stability claim",
    "packages/editor-classic/src/timeline/controllers/element-interaction-controller.ts:110": "ordinary-English 'drag stays stable' (drop-target recompute comment) — not a release-stability claim",
    "packages/editor-classic/src/timeline/controllers/playhead-controller.ts:139": "ordinary-English 'stable references' (bound public handlers) — not a release-stability claim",
    "packages/editor-classic/src/timeline/element-with-track-selector.ts:5": "ordinary-English 'stable refs' (allocation-free wrapper comment) — not a release-stability claim",
    # --- classic: standalone numeric 1.0 literals (read in source)
    "packages/editor-classic/src/masks/__tests__/snap.test.ts:331": "arithmetic in a comment (0.2*5 = 1.0, the snapped height) — a number, not a version",
    "packages/editor-classic/src/services/storage/migrations/__tests__/fixtures/v1.ts:45": "a v1 fixture's bookmark time literal [1.0] (seconds) — a number, not a version",
    "packages/editor-classic/src/services/storage/migrations/__tests__/v1-to-v2.test.ts:83": "migration test asserts bookmark array [1.0] (seconds) — a number, not a version",
    "packages/editor-classic/src/services/storage/migrations/__tests__/v22-to-v23.test.ts:78": "migration fixture field time: 1.0 (seconds) — a number, not a version",
    "packages/editor-classic/src/services/video-cache/service.ts:231": "frame.timestamp > targetTime + 1.0 — a one-second threshold, not a version",
    "packages/editor-classic/src/timeline/components/graph-editor/session.ts:203": "doc comment: Y-axis scale falls back to 1.0 when adjacent segments are flat — a number, not a version",
    "packages/editor-classic/src/timeline/components/graph-editor/session.ts:228": "return 1.0 — the same Y-axis scale fallback value, not a version",
    # --- GA
    "packages/editor-classic/src/stickers/providers/countries-data.ts:575": "ISO 3166-1 alpha-2 country code 'GA' = Gabon, in sticker country data — not the term",
}


def git_tracked(*pathspecs):
    out = subprocess.run(
        ["git", "ls-files", "--", *pathspecs],
        cwd=REPO, capture_output=True, text=True, check=True,
    ).stdout
    return [line for line in out.splitlines() if line.strip()]


def universe():
    files = git_tracked(
        "packages/editor-ports/src",
        "packages/editor-contracts/src",
        "packages/editor-classic/src",
    )
    files += [
        "packages/editor-ports/README.md",
        "packages/editor-ports/surface.json",
        "packages/editor-ports/package.json",
        "packages/editor-contracts/README.md",
        "packages/editor-contracts/surface.json",
        "packages/editor-contracts/package.json",
        "packages/editor-classic/README.md",
        "packages/editor-classic/surface.json",
        "packages/editor-classic/package.json",
        "packages/README.md",
        "BOUNDARIES.md",
    ]
    return sorted(set(f for f in files if (REPO / f).is_file()))


NUM_CHAR = set("0123456789.")
SVG_ATTR = re.compile(r'(?:d|points)\s*=\s*"[Mm][^"]*"')
VERSION3 = re.compile(r"^\d+\.\d+\.\d+$")


def classify_one_point_zero(line, start):
    """Classify a `1.0` occurrence at `start` in `line` by its numeric token."""
    lo, hi = start, start + 3
    while lo > 0 and line[lo - 1] in NUM_CHAR:
        lo -= 1
    while hi < len(line) and line[hi] in NUM_CHAR:
        hi += 1
    token = line[lo:hi]
    if token != "1.0":
        if SVG_ATTR.search(line):
            return "noise:svg-path-coordinate"
        if VERSION3.match(token):
            return "noise:version-string-substring"
        return "noise:decimal-substring"
    return "REAL"


def sweep():
    hits = []  # (path, line_no, term, kind, line_text)
    counts = {"REAL": 0}
    for path in universe():
        text = (REPO / path).read_text(encoding="utf-8", errors="replace")
        for line_no, line in enumerate(text.splitlines(), 1):
            for m in re.finditer(r"1\.0", line):
                kind = classify_one_point_zero(line, m.start())
                key = kind if kind.startswith("noise:") else "REAL"
                counts[key] = counts.get(key, 0) + 1
                if key == "REAL":
                    hits.append((path, line_no, "1.0", "REAL", line.strip()))
            for m in re.finditer(r"(?i)\bstable\b", line):
                counts["REAL"] += 1
                hits.append((path, line_no, "stable", "REAL", line.strip()))
            for m in re.finditer(r"(?i)\bproduction-ready\b", line):
                counts["REAL"] += 1
                hits.append((path, line_no, "production-ready", "REAL", line.strip()))
            for m in re.finditer(r"(?i)\bsemver\b", line):
                counts["REAL"] += 1
                hits.append((path, line_no, "semver", "REAL", line.strip()))
            for m in re.finditer(r"\bGA\b", line):
                counts["REAL"] += 1
                hits.append((path, line_no, "GA", "REAL", line.strip()))
    return hits, counts


def main():
    files = universe()
    hits, counts = sweep()
    print(f"no-stability-sweep: {len(files)} files in the shipped universe "
          f"(three packages' src/ + per-package README/surface.json/package.json + packages/README.md + BOUNDARIES.md)")
    for key in sorted(counts):
        print(f"  census  {key}: {counts[key]}")
    print()
    missing = []
    for path, line_no, term, kind, line_text in hits:
        disposition = DISPOSITIONS.get(f"{path}:{line_no}")
        if disposition is None:
            missing.append(f"{path}:{line_no}")
            print(f"  UNDISPOSITIONED {term} at {path}:{line_no}: {line_text[:160]}")
        else:
            print(f"  ok   {term} at {path}:{line_no}: {disposition}")
    stale = [k for k in DISPOSITIONS if k not in {f"{p}:{n}" for p, n, *_ in hits}]
    for key in stale:
        print(f"  STALE-DISPOSITION {key} names a hit that does not exist")
    if missing or stale:
        print(f"no-stability-sweep: {len(missing)} undispositioned, {len(stale)} stale")
        print(f"REAL_EXIT_CODE[no-stability-sweep]:1")
        return 1
    print("no-stability-sweep: every candidate dispositioned, none makes a 1.0/GA/production-readiness claim")
    print("REAL_EXIT_CODE[no-stability-sweep]:0")
    return 0


if __name__ == "__main__":
    sys.exit(main())
