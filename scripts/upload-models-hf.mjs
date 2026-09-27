#!/usr/bin/env node
// Upload the model weights to a Hugging Face model repo.
//
//   HF_TOKEN=hf_… HF_REPO=user/motionlab-models node scripts/upload-models-hf.mjs
//   node scripts/upload-models-hf.mjs --dry-run        (plan only, sends nothing)
//
// Why here rather than Vercel Blob: Blob's Hobby plan caps storage at 1 GB and
// transfer at 10 GB/month. The weights are 4.84 GB, and a first analysis pulls
// 2.2 GB — four new athletes a month would exhaust the transfer allowance. A
// public HF model repo has neither cap, serves from a CDN with CORS already
// enabled, and is the thing model weights are actually meant to live in.
//
// Uploads go to models/VERSION/<name> on the `main` revision and are never
// overwritten in place: a weight file's bytes ARE the model, so a new model
// means a new MODEL_VERSION and a matching NEXT_PUBLIC_MODEL_BASE. Nothing else
// about the app changes — modelUrl() in lib/model-url.ts already resolves
// against whatever base it is given.
//
// Uses @huggingface/hub rather than hand-rolling the protocol. The plain
// upload endpoint is retired ("use the commit endpoint instead"), and what
// replaces it is Git LFS: hash the file, negotiate a batch, push to S3 in
// parts, then commit the pointer. Every one of these files is far past the LFS
// threshold, so all ten take that path. The official client streams from disk,
// which matters — three of them are over a gigabyte and cannot sit in memory.

import { openAsBlob } from "node:fs";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { uploadFilesWithProgress } from "@huggingface/hub";

const VERSION = process.env.MODEL_VERSION || "v1";
const HERE = dirname(fileURLToPath(import.meta.url));
const LOCAL = join(HERE, "..", "public", "models");
const mb = (b) => `${(b / 1024 / 1024).toFixed(0)} MB`;

const dryRun = process.argv.includes("--dry-run");
const token = process.env.HF_TOKEN;
const repo = process.env.HF_REPO;

if (!dryRun && (!token || !repo)) {
  console.error("HF_TOKEN and HF_REPO are required.");
  console.error("  Token:  https://huggingface.co/settings/tokens  (needs WRITE access)");
  console.error("  Repo:   https://huggingface.co/new  → Model, Public");
  console.error("  Then:   HF_TOKEN=hf_… HF_REPO=<user>/<repo> node scripts/upload-models-hf.mjs");
  process.exit(2);
}

const { files } = JSON.parse(readFileSync(join(HERE, "models.manifest.json"), "utf8"));
const needed = files
  .filter((f) => !f.usedBy.includes("unused"))
  .sort((a, b) => b.bytes - a.bytes);

console.log(`${needed.length} files, ${mb(needed.reduce((s, f) => s + f.bytes, 0))} → ${repo || "(dry run)"} : models/${VERSION}/\n`);

const base = repo ? `https://huggingface.co/${repo}/resolve/main/models/${VERSION}` : null;
let done = 0, skipped = 0;

for (const f of needed) {
  const local = join(LOCAL, f.name);
  const size = statSync(local).size;
  if (size !== f.bytes) {
    console.error(`FAIL  ${f.name} — local file is ${mb(size)}, manifest says ${mb(f.bytes)}.`);
    console.error("      Run `node scripts/verify-models.mjs --write` if the file legitimately changed.");
    process.exit(1);
  }

  const path = `models/${VERSION}/${f.name}`;
  if (dryRun) {
    console.log(`would  ${f.name.padEnd(28)} ${mb(f.bytes).padStart(8)}  → ${path}`);
    done++;
    continue;
  }

  // already there at the right size? then this is a resumed run
  try {
    const head = await fetch(`${base}/${f.name}`, { method: "HEAD", redirect: "follow" });
    const len = Number(head.headers.get("content-length") ?? NaN);
    if (head.ok && len === f.bytes) {
      console.log(`skip  ${f.name.padEnd(28)} ${mb(f.bytes).padStart(8)}  already uploaded`);
      skipped++;
      continue;
    }
  } catch { /* not there yet — the normal path */ }

  const started = Date.now();
  process.stdout.write(`up    ${f.name.padEnd(28)} ${mb(f.bytes).padStart(8)}  …`);
  try {
    // openAsBlob gives a Blob backed by the file on disk — the bytes are read
    // as the upload consumes them, never all at once.
    const blob = await openAsBlob(local);
    let lastPct = -1;
    for await (const ev of uploadFilesWithProgress({
      repo: { type: "model", name: repo },
      accessToken: token,
      files: [{ path, content: blob }],
    })) {
      if (ev.event === "fileProgress" && typeof ev.progress === "number") {
        const pct = Math.floor(ev.progress * 100);
        if (pct >= lastPct + 10) {
          lastPct = pct;
          process.stdout.write(`\rup    ${f.name.padEnd(28)} ${mb(f.bytes).padStart(8)}  ${String(pct).padStart(3)}%`);
        }
      }
    }
  } catch (e) {
    console.log("");
    console.error(`FAIL  ${f.name}: ${e?.message ?? e}`);
    process.exit(1);
  }
  console.log(`\rup    ${f.name.padEnd(28)} ${mb(f.bytes).padStart(8)}  done in ${Math.round((Date.now() - started) / 1000)}s   `);
  done++;
}

console.log(`\n${done} ${dryRun ? "would upload" : "uploaded"}, ${skipped} already there.`);
if (dryRun) { console.log("Nothing was sent."); process.exit(0); }
if (base) {
  console.log(`\nSet this in Vercel (Project → Settings → Environment Variables):\n`);
  console.log(`  NEXT_PUBLIC_MODEL_BASE=${base}\n`);
  console.log(`It is read at BUILD time, so redeploy after setting it. Then check what a browser sees:\n`);
  console.log(`  node scripts/verify-models.mjs ${base}\n`);
}
