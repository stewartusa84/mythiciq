# Sample log

The shipped demo log is **`MythicIQ_Skyreach_7_anonymized.txt.gz`** (an anonymized Skyreach +7 run,
placeholder character + realm names). It is served **GZIPPED** (~2.4MB vs ~36MB raw) and decompressed
in-browser, because CloudFront won't auto-compress static files over 10MB. The **"Try a Sample Log"**
button (`App.svelte` `loadSample`) fetches it with a streaming progress bar, gunzips it, and runs it
through the normal parse flow.

To swap the demo:
- Gzip the new file here: `node -e "const z=require('zlib'),fs=require('fs');fs.writeFileSync('NAME.txt.gz',z.gzipSync(fs.readFileSync('NAME.txt'),{level:9}))"`
  then delete the raw `.txt`.
- Update `SAMPLE_LOG_NAME` in `packages/app/src/App.svelte` (the base `.txt` name; the loader appends `.gz`).
- Use placeholder character + realm names (the log is public).
- Keep it well under GitHub's 100MB limit.
- Larger sample logs for local dev/bench live elsewhere (`packages/data/sample/log/`, gitignored) —
  this one is the shipped demo and IS committed.
