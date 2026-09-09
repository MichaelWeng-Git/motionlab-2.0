// Generate the 3D body on TRELLIS (free, authenticated via HF_TOKEN for
// ZeroGPU quota) → download GLB to public/muscles/body.glb.
// Run: HF_TOKEN=hf_xxx node scripts/gen3d.mjs
import { Client, handle_file } from "@gradio/client";
import { writeFile } from "node:fs/promises";

const token = process.env.HF_TOKEN;
if (!token) throw new Error("HF_TOKEN missing");

console.log("connecting…");
const client = await Client.connect("trellis-community/TRELLIS", { token });

// TRELLIS keeps per-session server files (preprocess output feeds generate),
// so the session must be opened on THIS client first
try {
  await client.predict("/start_session", {});
  console.log("session started");
} catch (e) {
  console.log("start_session skipped:", e.message?.slice(0, 80));
}

console.log("preprocessing…");
const pre = await client.predict("/preprocess_image", {
  image: handle_file("public/muscles/front-mannequin.png"),
});
console.log("preprocessed ok");

console.log("generating (1-3 min)…");
const result = await client.predict("/generate_and_extract_glb", {
  image: pre.data[0],
  multiimages: [],
  seed: 42,
  ss_guidance_strength: 7.5,
  ss_sampling_steps: 12,
  slat_guidance_strength: 3.0,
  slat_sampling_steps: 12,
  multiimage_algo: "stochastic",
  mesh_simplify: 0.95,
  texture_size: 1024,
});

const flat = JSON.stringify(result.data);
console.log("outputs:", flat.slice(0, 700));
const m = flat.match(/https?:\/\/[^"]+\.glb[^"]*/);
if (!m) throw new Error("no glb url");
console.log("glb url:", m[0]);
const res = await fetch(m[0], { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) throw new Error(`download ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
await writeFile("public/muscles/body.glb", buf);
console.log("SAVED public/muscles/body.glb", buf.length, "bytes");
