## Mutation re-runs (closeout, LEAD-executed 2026-08-17)

### Mutation A — cancelJob cleanup removed (job-manager.ts cancelJob's two cleanupArtifacts calls commented)
```
(fail) cancel mid-render: settles cancelled, keeps the record, deletes raw/wav/partial [16.00ms]
(fail) cancel mid-encode: the resolved cancel proves the child exited; partial and raw are gone [328.00ms]
```
Restored → green:
(pass) happy path: 60 gradient frames + WAV → one ffmpeg encode → completed mp4 with both streams [391.00ms]
(pass) cancel mid-render: settles cancelled, keeps the record, deletes raw/wav/partial [16.00ms]

### Mutation B — resumeJob returns nextNeededFrame 0 (line 702 literal)
```
(fail) interrupt + resume across manager instances completes with the exact frame count [47.00ms]
(fail) resume truncates a garbage tail (file ahead of the record) and still completes exactly [31.00ms]
```
Restored (nextNeededFrame: record.acceptedFrames) → job-manager suite 8/8 green, exit 0 (GREEN_RC:0 above); full export tree 26 tests 0 fail.
