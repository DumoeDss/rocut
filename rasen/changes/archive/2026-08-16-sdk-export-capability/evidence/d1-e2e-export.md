# D1 — end-to-end export proof (the spec's headline scenario)

Run: 2026-08-16T14:36:12.396Z
Worktree: E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-export (built dist + dist-main; no rebuild in this proof)
Command: node apps/electron-host/scripts/export-e2e-proof.mjs --phase all
Scratch run dir: E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-export-scratch/e2e-d1-2026-08-16T14-36-12-395Z (fresh per invocation; deleted after fingerprinting unless --keep)

## Launch environment (minimal, never `...process.env`)

```
positive phases:
  SYSTEMROOT=<windows>   (Electron hard requirement)
  OPENCUT_STORE_ROOT=E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-export-scratch/e2e-d1-2026-08-16T14-36-12-395Z/store
  OPENCUT_EXPORT_ROOT=E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-export-scratch/e2e-d1-2026-08-16T14-36-12-395Z/exports
  OPENCUT_FFMPEG_PATH=E:/Software/ffmpeg-6.0-full_build/bin/ffmpeg.exe
negative phase:
  SYSTEMROOT=<windows>
  OPENCUT_STORE_ROOT=<same store as phase 1>
  OPENCUT_EXPORT_ROOT=E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-export-scratch/e2e-d1-2026-08-16T14-36-12-395Z/negative-exports
  OPENCUT_FFMPEG_PATH=E:/nonexistent/ffmpeg.exe
  PATH=C:\Windows\system32;C:\Windows   (override: the auto-injected PATH carries ffmpeg)
```

Probed once in scratch (e2e-env-probe): `_electron.launch` env REPLACES the environment; Playwright/Electron layer the Windows essentials (COMSPEC, HOMEDRIVE, HOMEPATH, LOGONSERVER, PATH, PATHEXT, PROMPT, SYSTEMDRIVE, SYSTEMROOT, TEMP, TMP, USERDOMAIN, USERNAME, USERPROFILE, WINDIR); every explicit key above wins verbatim.

## Phase 1 — seed: project through the picker, real media placed

- project created through the picker: id `18d709ab-6536-42cf-88fa-cb587a42db19`, url records `?project=`
- onboarding dialog: dismissed "Welcome to OpenCut Beta! 🎉Welcome to OpenCut Beta! 🎉You're among the first to try OpenCut - the fully open source CapC"
- both fixtures imported through the assets panel's own input (parity driver's Electron path)
- persisted timeline extent: 600000 ticks -> 150 frames @30fps = 5s
- canvas: {"width":320,"height":180}, fps: {"numerator":30,"denominator":1}

```
[
 {
  "name": "fixture-image.png",
  "kind": "visual-main",
  "trackName": "Main Track",
  "startTime": 0,
  "duration": 600000
 },
 {
  "name": "fixture-tone-a4.wav",
  "kind": "audio",
  "trackName": "Audio track",
  "startTime": 0,
  "duration": 240000
 }
]
```
- app closed after seed; state saved for the export phase

## Phase 2 — export from the panel, observed through both phases

- export started (mp4 / high / include audio) at T+0
- render phase observed: first sample at T+1.096s
- encode phase observed: first sample at T+4.929s
- render duration (panel timestamps): 3.83s
- encode duration (panel timestamps): 4.96s
- windows: 1 before start; encode-time observations: [{"atS":4.929,"windows":2,"ffmpegCaught":false,"rows":null}]

Progress series (recorded on change):

```
T+   0.03s  Starting…  0%
T+    1.1s  Rendering frames…  0%
T+   1.43s  Rendering frames…  3% (4/150 frames)
T+    3.5s  Rendering frames…  59% (88/150 frames)
T+   3.92s  Rendering frames…  69% (104/150 frames)
T+   4.29s  Rendering frames…  85% (128/150 frames)
T+   4.57s  Rendering frames…  100% (150/150 frames)
T+   4.93s  Encoding…  100% (150/150 frames)
T+   9.89s  Export complete.
```
- panel output line: "Untitled-Project-9c8858cf.mp4" (442.0 KB)
- bridge snapshot: {"jobId":"9c8858cf-001c-47d1-ac78-a3b9cae23939","request":{"projectId":"18d709ab-6536-42cf-88fa-cb587a42db19","format":"mp4","quality":"high","includeAudio":true},"phase":"completed","progress":1,"output":{"descriptor":"file:Untitled-Project-9c8858cf.mp4","bytes":43036},"error":null,"frames":{"accepted":150,"total":150}}
- windows after settle: 1 (producer destroyed)
- ffmpeg parent-pid: not caught (encode window shorter than the CIM poll) — recorded as observation, not gated
- console errors during export: []

## Phase 3 — verify the deliverable with the real ffprobe

- output fingerprint: a2bbec7fd6338e1142a95910876b5da6de5ae0ca9f91549990f40a56751b6ff7 / 43036 bytes (Untitled-Project-9c8858cf.mp4)

ffprobe -show_streams -show_format (tail):

```
{
 "streams": [
  {
   "codec_type": "video",
   "codec_name": "h264",
   "width": 320,
   "height": 180,
   "nb_frames": "150",
   "duration": "5.000000"
  },
  {
   "codec_type": "audio",
   "codec_name": "aac",
   "nb_frames": "217",
   "duration": "5.000000"
  }
 ],
 "format": {
  "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
  "duration": "5.000000",
  "size": "43036"
 }
}
```
- exports root deleted after fingerprinting (disk discipline)

## Phase 4 — negative: no discoverable binary means unsupported

- panel state: {"status":"Export unavailable: no FFmpeg binary was found (ffmpeg-missing). Set OPENCUT_FFMPEG_PATH, place ffmpeg(.exe) under the app's bin/, or install it on PATH.","hasStart":false}
- bridge canExport: {"ffmpegAvailable":false}
- tasklist ffmpeg.exe (no leak across launches): count 0, exit 0
- negative exports root deleted

## Gates

- PASS seed/visual-clip — image element on a visual track: {"name":"fixture-image.png","kind":"visual-main","trackName":"Main Track","startTime":0,"duration":600000}
- PASS seed/audio-clip — audio element on an audio track: {"name":"fixture-tone-a4.wav","kind":"audio","trackName":"Audio track","startTime":0,"duration":240000}
- PASS export/render-phase-observed — at least one rendering-phase sample
- PASS export/encode-phase-observed — at least one encoding-phase sample
- PASS export/completed — settled view: "Export complete."
- PASS export/duration-matches — render 3.83s, encode 4.96s vs timeline 5s
- PASS export/output-descriptor-reported — panel name + bridge descriptor file:Untitled-Project-9c8858cf.mp4 bytes 43036
- PASS export/descriptor-opaque — no drive letter / backslash / second colon in "file:Untitled-Project-9c8858cf.mp4"
- PASS export/producer-window-closed — windows after settle: 1 (was 1 before, 2 during)
- PASS export/no-console-errors
- PASS verify/output-exists — Untitled-Project-9c8858cf.mp4 under the exports root
- PASS verify/ffprobe-ran — exit 0
- PASS verify/one-video-one-audio — video 1 (h264), audio 1 (aac)
- PASS verify/codecs-h264-aac-mp4 — container mov,mp4,m4a,3gp,3g2,mj2
- PASS verify/duration-matches-timeline — ffprobe 5s vs expected 5s (tolerance 0.3)
- PASS verify/decodable-packets-both-streams — nb_read_packets video 150, audio 217
- PASS verify/transients-cleaned — jobs dir: ["9c8858cf-001c-47d1-ac78-a3b9cae23939.json"]; exports root files: ["Untitled-Project-9c8858cf.mp4"]
- PASS verify/record-kept — record 9c8858cf-001c-47d1-ac78-a3b9cae23939.json kept as history
- PASS verify/record-completed — record phase completed, outputName Untitled-Project-9c8858cf.mp4
- PASS negative/canExport-false — probe verdict {"ffmpegAvailable":false}
- PASS negative/panel-reports-unsupported — status: "Export unavailable: no FFmpeg binary was found (ffmpeg-missing). Set OPENCUT_FFMPEG_PATH, place ffmpeg(.exe) under the app's bin/, or install it on PATH."
- PASS negative/no-start-affordance — the unsupported view renders no start button
