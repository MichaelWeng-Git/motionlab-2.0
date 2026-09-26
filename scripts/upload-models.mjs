#!/usr/bin/env node
// Upload the model weights to Vercel Blob.
//
//   BLOB_READ_WRITE_TOKEN=... node scripts/upload-models.mjs
//   BLOB_READ_WRITE_TOKEN=... node scripts/upload-models.mjs --all   (include unused files)
//   node scripts/upload-models.mjs --dry-run       (list the plan, touch nothing)
//
// The token comes from the Blob store in the Vercel dashboard (Storage → your
// store → .env.local tab). It is read from the environment and never written
// anywhere by this script.
//
// What it does, and why:
//   · Uploads to models/VERSION/<name> and never overwrites. A weight file's
//     bytes ARE the model, so replacing one in place would leave cached clients
//     and fresh ones running different models against the same calibration.
//     Changing a model means bumping VERSION and NEXT_PUBLIC_MODEL_BASE together.
//   · Streams each file — three of these are over a gigabyte and will not fit in
//     a Buffer — and uses multipart above 100 MB.
//   · Checks what is already there first, so an interrupted run resumes instead
//     of re-sending 4.9 GB.
//   · Skips the two pose_landmarker files nothing loads, unless --all.
//
// Afterwards, verify what the browser will actually see:
//   node scripts/verify-models.mjs <printed base url>

import { createReadStream, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { head, put } from "@vercel/blob";

const VERSION = process.env.MODEL_VERSION || "v1";
const HERE = dirname(fileURLToPath(import.meta.url));
const LOCAL = join(HERE, "..", "public", "models");
const MULTIPART_OVER = 100 * 1024 * 1024;

const dryRun = process.argv.includes("--dry-run");
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token && !dryRun) {
  console.error("BLOB_READ_WRITE_TOKEN is not set.");
  console.error("Vercel dashboard → Storage → your Blob store → .env.local tab.");
  process.exit(2);
}

const mb = (b) => `${(b / 1024 / 1024).toFixed(0)} MB`;
const { files } = JSON.parse(readFileSync(join(HERE, "models.manifest.json"), "utf8"));
const wanted = process.argv.includes("--all") ? files : files.filter((f) => !f.usedBy.includes("unused"));

console.log(`${wanted.length} files, ${mb(wanted.reduce((s, f) => s + f.bytes, 0))} → models/${VERSION}/\n`);

let base = null;
let uploaded = 0, skipped = 0;

// largest first: the ones that can fail on a flaky connection go while the
// terminal is still being watched
for (const f of [...wanted].sort((a, b) => b.bytes - a.bytes)) {
  const pathname = `models/${VERSION}/${f.name}`;
  const local = join(LOCAL, f.name);

  const size = statSync(local).size;
  if (size !== f.bytes) {
    console.error(`FAIL  ${f.name} — local file is ${mb(size)}, manifest says ${mb(f.bytes)}. Run verify-models.mjs --write if the file legitimately changed.`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`would  ${f.name.padEnd(28)} ${mb(f.bytes).padStart(8)}  → ${pathname}${f.bytes > MULTIPART_OVER ? "  (multipart)" : ""}`);
    uploaded++;
    continue;
  }

  try {
    const existing = await head(pathname, { token });
    if (existing.size === f.bytes) {
      base = base ?? existing.url.slice(0, existing.url.lastIndexOf(`/${f.name}`));
      console.log(`skip  ${f.name.padEnd(28)} ${mb(f.bytes).padStart(8)}  already uploaded`);
      skipped++;
      continue;
    }
    // present but the wrong size — a half-finished upload from an earlier run
    console.log(`redo  ${f.name.padEnd(28)} ${mb(f.bytes).padStart(8)}  partial upload found`);
  } catch {
    // not there yet — the normal path
  }

  const started = Date.now();
  process.stdout.write(`up    ${f.name.padEnd(28)} ${mb(f.bytes).padStart(8)}  …`);
  const res = await put(pathname, createReadStream(local), {
    token,
    access: "public",
    addRandomSuffix: false,      // the URL must be predictable — the app builds it
    allowOverwrite: true,        // only reached after the size check above
    multipart: f.bytes > MULTIPART_OVER,
    // A year. This is what decides whether the 2.2 GB a first analysis pulls is
    // paid once per browser or once per analysis — the difference is an order of
    // magnitude on the bill. Safe because models/VERSION/<name> is never
    // overwritten: a new model is a new path.
    cacheControlMaxAge: 31536000,
    contentType: f.name.endsWith(".onnx") ? "application/octet-stream" : "application/octet-stream",
  });
  base = base ?? res.url.slice(0, res.url.lastIndexOf(`/${f.name}`));
  console.log(`\rup    ${f.name.padEnd(28)} ${mb(f.bytes).padStart(8)}  done in ${Math.round((Date.now() - started) / 1000)}s`);
  uploaded++;
}

console.log(`\n${uploaded} ${dryRun ? "would upload" : "uploaded"}, ${skipped} already there.`);
if (dryRun) {
  console.log("Nothing was sent. Re-run with BLOB_READ_WRITE_TOKEN set and without --dry-run.");
  process.exit(0);
}
if (base) {
  console.log(`\nSet this in Vercel (Project → Settings → Environment Variables):\n`);
  console.log(`  NEXT_PUBLIC_MODEL_BASE=${base}\n`);
  console.log(`It is read at BUILD time, so redeploy after setting it. Then check what a browser sees:\n`);
  console.log(`  node scripts/verify-models.mjs ${base}\n`);
}
