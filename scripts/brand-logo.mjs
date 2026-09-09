// One-shot: turn the AI-generated logo (white bg) into the app's brand set:
//  public/brand/logo-original.png  — untouched source
//  public/logo-mark.png            — transparent, trimmed (top bar)
//  app/icon.png                    — 512² favicon (Next serves automatically)
//  app/apple-icon.png              — 180² home-screen icon
import sharp from "sharp";
import { mkdir, rename } from "fs/promises";

const SRC = "public/icons/ea5fd8a0-eba6-4c62-a8a3-9e82e54358cb.png";
const NEAR = 238;

const img = sharp(SRC);
const { width: W, height: H } = await img.metadata();
const raw = await img.ensureAlpha().raw().toBuffer();

// flood-fill the exterior white
const isBg = (i) => raw[i] > NEAR && raw[i + 1] > NEAR && raw[i + 2] > NEAR;
const visited = new Uint8Array(W * H);
const stack = [];
const push = (x, y) => {
  const p = y * W + x;
  if (!visited[p] && isBg(p * 4)) { visited[p] = 1; stack.push(p); }
};
for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
while (stack.length) {
  const p = stack.pop();
  const x = p % W, y = (p / W) | 0;
  if (x > 0) push(x - 1, y);
  if (x < W - 1) push(x + 1, y);
  if (y > 0) push(x, y - 1);
  if (y < H - 1) push(x, y + 1);
}
for (let p = 0; p < W * H; p++) {
  if (visited[p]) raw[p * 4 + 3] = 0;
  else {
    // soft edge: near-white interior pixels adjacent to cut area get partial alpha
    const i = p * 4;
    if (raw[i] > NEAR - 8 && raw[i + 1] > NEAR - 8 && raw[i + 2] > NEAR - 8) {
      const x = p % W, y = (p / W) | 0;
      const nb = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
      if (nb.some(([a,b]) => a>=0 && a<W && b>=0 && b<H && visited[b*W+a])) raw[i+3] = 90;
    }
  }
}

// bbox of remaining opaque pixels
let minX = W, minY = H, maxX = 0, maxY = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (raw[(y * W + x) * 4 + 3] > 20) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
}
const pad = Math.round((maxX - minX) * 0.03);
minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
maxX = Math.min(W - 1, maxX + pad); maxY = Math.min(H - 1, maxY + pad);

const cut = sharp(raw, { raw: { width: W, height: H, channels: 4 } })
  .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 });

await cut.clone().resize({ width: 640 }).png().toFile("public/logo-mark.png");

// app icon: porcelain tile, mark centered at ~72% width
const markBuf = await cut.clone().resize({ width: 737 }).png().toBuffer();
const tile = (size) =>
  sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#ECEFEC" } })
    .composite([{ input: markBuf, gravity: "centre" }])
    .png().resize ? null : null;
// (compose at 1024 then resize per target)
const base = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#ECEFEC" } })
  .composite([{ input: markBuf, gravity: "centre" }])
  .png().toBuffer();
await sharp(base).resize(512, 512).png().toFile("app/icon.png");
await sharp(base).resize(180, 180).png().toFile("app/apple-icon.png");

await mkdir("public/brand", { recursive: true });
await rename(SRC, "public/brand/logo-original.png");
console.log("brand set written: logo-mark.png + app/icon.png + app/apple-icon.png");
