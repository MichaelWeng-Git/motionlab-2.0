// One-shot: remove the paper background from the muscle figures — but ONLY
// the exterior. Flood-fill from the image borders across near-white pixels;
// everything reached becomes transparent (with a soft edge), while whites
// ENCLOSED by the green line art (the body's interior) stay opaque so the
// figure still occludes whatever is behind it in 3D.
import sharp from "sharp";

const FILES = ["front", "back", "side-r", "side-l"];
const NEAR = 238; // r,g,b all above this = background-ish

for (const name of FILES) {
  const path = `public/muscles/${name}.png`;
  const img = sharp(path);
  const { width: W, height: H } = await img.metadata();
  const raw = await img.ensureAlpha().raw().toBuffer(); // RGBA

  const isBg = (i) => raw[i] > NEAR && raw[i + 1] > NEAR && raw[i + 2] > NEAR;
  const visited = new Uint8Array(W * H);
  const stack = [];
  const push = (x, y) => {
    const p = y * W + x;
    if (!visited[p] && isBg(p * 4)) {
      visited[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % W;
    const y = (p / W) | 0;
    if (x > 0) push(x - 1, y);
    if (x < W - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < H - 1) push(x, y + 1);
  }

  for (let p = 0; p < W * H; p++) {
    if (visited[p]) raw[p * 4 + 3] = 0; // exterior → fully transparent
  }
  // soft edge: exterior-adjacent opaque pixels get slight feather via alpha
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (visited[p]) continue;
      const n = visited[p - 1] + visited[p + 1] + visited[p - W] + visited[p + W];
      if (n > 0 && isBg(p * 4)) raw[p * 4 + 3] = 120;
    }
  }

  await sharp(raw, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toFile(`public/muscles/${name}.cut.png`);
  console.log(name, "done", W, "x", H);
}
