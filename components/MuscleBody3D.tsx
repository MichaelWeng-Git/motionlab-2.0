"use client";

// TRUE 360° muscle body: renders /muscles/body.glb (AI-generated from the
// user's anatomy art) with three.js. Every angle is computed for real —
// no photo blending. The model is normalized so it stands centered on the
// origin with the spine as the Y axis; dragging yaws it in place with
// momentum, exactly like turning a globe.
//
// MUSCLE HEAT: the real /api/muscles loads (0-1 per group) are painted into
// the mesh's VERTEX COLORS — red lives on the body surface itself, so it
// wraps the limbs, rotates with them and occludes correctly behind the body.
// No load → clean porcelain.

import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { MuscleLoad } from "@/lib/muscles";

// porcelain body with a green fresnel rim — bright edge on any angle against
// the white card, no baked outline. Vertex colors hold the heat MULTIPLIER
// (white = clean); the uReveal uniform fades it in — that's the "muscles
// slowly turn red after an analysis" animation.
function bodyMaterial() {
  const uReveal = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#EDE7D6"),
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
    flatShading: false,
    vertexColors: true,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = uReveal;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 colorPrev;\nvarying vec3 vColorPrev;")
      .replace("#include <color_vertex>", "#include <color_vertex>\nvColorPrev = colorPrev;");
    shader.fragmentShader = shader.fragmentShader
      .replace("uniform vec3 diffuse;", "uniform vec3 diffuse;\nuniform float uReveal;\nvarying vec3 vColorPrev;")
      .replace(
        "#include <color_fragment>",
        `#if defined( USE_COLOR )
         diffuseColor.rgb *= mix(vColorPrev, vColor.rgb, uReveal);
         #endif`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
       float _fres = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.2);
       totalEmissiveRadiance += vec3(0.384, 0.851, 0.545) * _fres * 1.5;`
      );
  };
  mat.userData.uReveal = uReveal;
  return mat;
}

// where each muscle group lives on a standing body, in normalized coords:
// yF = height fraction (0 feet → 1 head), xF = width fraction from center
// (arms hang at the sides → big |xF|), zF = depth fraction (+ = front).
const smooth = (lo: number, hi: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const band = (v: number, lo: number, hi: number, soft = 0.05) =>
  smooth(lo - soft, lo + soft, v) * (1 - smooth(hi - soft, hi + soft, v));

// which world-x sign is the body's LEFT on this GLB (verified visually; flip
// this one constant if a future model export mirrors it)
const LEFT_X = 1;
// gate a region to one body side; midline keys pass 1 for both
const gate = (side: "l" | "r" | null, x: number) =>
  side === null ? 1 : side === "l" ? smooth(0.005, 0.05, x * LEFT_X) : smooth(0.005, 0.05, -x * LEFT_X);

type Region = { key: string; side: "l" | "r" | null; w: (yF: number, xF: number, zF: number) => number };
// base shapes (y/z bands identical for both sides), expanded into _l/_r entries
const BASE_REGIONS: { base: string; sided: boolean; w: Region["w"] }[] = [
  { base: "calves",     sided: true,  w: (y, x)    => band(y, 0.07, 0.24) * band(Math.abs(x), 0, 0.24, 0.03) },
  { base: "quads",      sided: true,  w: (y, x, z) => band(y, 0.26, 0.47) * band(Math.abs(x), 0, 0.24, 0.03) * smooth(-0.08, 0.06, z) },
  { base: "hamstrings", sided: true,  w: (y, x, z) => band(y, 0.26, 0.45) * band(Math.abs(x), 0, 0.24, 0.03) * (1 - smooth(-0.06, 0.08, z)) },
  { base: "glutes",     sided: true,  w: (y, x, z) => band(y, 0.43, 0.53) * band(Math.abs(x), 0, 0.2, 0.03) * (1 - smooth(-0.06, 0.08, z)) },
  { base: "core",       sided: false, w: (y, x, z) => band(y, 0.5, 0.63) * band(Math.abs(x), 0, 0.17, 0.03) * smooth(-0.08, 0.06, z) },
  { base: "back",       sided: false, w: (y, x, z) => band(y, 0.55, 0.75) * band(Math.abs(x), 0, 0.2, 0.03) * (1 - smooth(-0.06, 0.08, z)) },
  { base: "chest",      sided: true,  w: (y, x, z) => band(y, 0.63, 0.73) * band(Math.abs(x), 0, 0.19, 0.03) * smooth(-0.08, 0.06, z) },
  { base: "shoulders",  sided: true,  w: (y, x)    => band(y, 0.74, 0.83) * band(Math.abs(x), 0.05, 0.36, 0.04) },
  { base: "arms",       sided: true,  w: (y, x)    => band(y, 0.34, 0.76) * smooth(0.2, 0.3, Math.abs(x)) },
];
const REGIONS: Region[] = BASE_REGIONS.flatMap((r): Region[] =>
  r.sided
    ? (["l", "r"] as const).map((s): Region => ({ key: `${r.base}_${s}`, side: s, w: r.w }))
    : [{ key: r.base, side: null, w: r.w }]
);

// heat multiplier per channel: porcelain #EDE7D6 × MULT = deep trained-red #D63422
const MULT = [0.904, 0.225, 0.159];

function Body({ angle, load, prevLoad, fadeIn }: { angle: number; load: MuscleLoad; prevLoad: MuscleLoad; fadeIn: boolean }) {
  const { scene } = useGLTF("/muscles/body.glb");
  const loadKey = JSON.stringify(load ?? {}) + "|" + JSON.stringify(prevLoad ?? {});
  const reveal = useRef(fadeIn ? 0 : 1);
  const normalized = useMemo(() => {
    const s = scene.clone(true);
    const mat = bodyMaterial();
    // uReveal starts at 0 (= show the PREVIOUS state). Setting it in useFrame
    // was one frame too late: the first painted frames rendered the "before"
    // colours — a white body that then snapped to red. Seed it here, in the
    // same synchronous pass that bakes the colours.
    (mat.userData.uReveal as { value: number }).value = fadeIn ? 0 : 1;
    // auto-upright if exported lying down
    s.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(s);
    let size = box.getSize(new THREE.Vector3());
    if (size.z > size.y * 1.2) {
      s.rotation.x = -Math.PI / 2;
      s.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(s);
      size = box.getSize(new THREE.Vector3());
    }
    const center = box.getCenter(new THREE.Vector3());

    // paint BOTH heat states into vertex attributes: `color` = the new state,
    // `colorPrev` = where each muscle stood before — the shader fades between
    // them, so existing red stays put and only the delta animates
    const loads = load ?? {};
    const prev = prevLoad ?? {};
    const hasAny =
      Object.values(loads).some((v) => (v ?? 0) > 0.02) ||
      Object.values(prev).some((v) => (v ?? 0) > 0.02);
    const v = new THREE.Vector3();
    const heatOf = (ld: MuscleLoad, yF: number, xF: number, zF: number) => {
      let heat = 0;
      const rec = ld as Record<string, number>;
      for (const r of REGIONS) {
        // sided key first; legacy 9-key data lights both sides via the base name
        const l = rec[r.key] ?? (r.side ? rec[r.key.replace(/_[lr]$/, "")] : undefined) ?? 0;
        if (l > 0.02) heat = Math.max(heat, l * r.w(yF, xF, zF) * gate(r.side, xF));
      }
      // perceptual curve: linear mapping made a 0.4 load nearly invisible on
      // porcelain — gamma-lift so moderate REAL loads read clearly while the
      // ordering (light < moderate < hard) stays truthful
      return heat <= 0 ? 0 : Math.min(1, Math.pow(heat, 0.55) * 1.05);
    };
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      m.geometry.computeVertexNormals(); // smooth shading, kills the facets
      m.material = mat; // drop the dark baked texture → clean porcelain
      const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute;
      const colors = new Float32Array(pos.count * 3);
      const colorsPrev = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        let f = 0, f0 = 0;
        if (hasAny) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          const yF = (v.y - box.min.y) / (size.y || 1);
          const xF = (v.x - center.x) / (size.x || 1);
          const zF = (v.z - center.z) / (size.z || 1);
          f = heatOf(loads, yF, xF, zF);
          f0 = heatOf(prev, yF, xF, zF);
        }
        colors[i * 3] = 1 + (MULT[0] - 1) * f;
        colors[i * 3 + 1] = 1 + (MULT[1] - 1) * f;
        colors[i * 3 + 2] = 1 + (MULT[2] - 1) * f;
        colorsPrev[i * 3] = 1 + (MULT[0] - 1) * f0;
        colorsPrev[i * 3 + 1] = 1 + (MULT[1] - 1) * f0;
        colorsPrev[i * 3 + 2] = 1 + (MULT[2] - 1) * f0;
      }
      m.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      m.geometry.setAttribute("colorPrev", new THREE.BufferAttribute(colorsPrev, 3));
    });

    // center the WHOLE bbox on the origin so the full body sits in frame and
    // spins in place around its own vertical axis (feet-planted look)
    const scale = 1.8 / (size.y || 1);
    const g = new THREE.Group();
    g.add(s);
    g.scale.setScalar(scale);
    g.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    const root = new THREE.Group();
    root.add(g);
    return { root, mat };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, loadKey, fadeIn]);

  // the reveal: fresh heat fades in from the clean white body (~1.4s) — but
  // ONLY right after a new analysis. Plain visits show the heat immediately.
  useEffect(() => { reveal.current = fadeIn ? 0 : 1; }, [loadKey, fadeIn]);
  useFrame((_, dt) => {
    const u = normalized.mat.userData.uReveal as { value: number };
    if (!fadeIn) {
      if (u.value !== 1) u.value = 1;
      return;
    }
    if (reveal.current < 1) {
      reveal.current = Math.min(1, reveal.current + dt / 1.4);
      const t = reveal.current;
      u.value = t * t * (3 - 2 * t);
    }
  });

  return <primitive object={normalized.root} rotation={[0, angle, 0]} />;
}

export function MuscleBody3D({
  height = 240, load = {}, prevLoad = {}, fadeIn = false, dolly = 1,
}: {
  height?: number; load?: MuscleLoad; prevLoad?: MuscleLoad; fadeIn?: boolean;
  // < 1 pulls the camera IN, filling more of the box with the figure without
  // changing the box itself — the card keeps its size, the person gets bigger
  dolly?: number;
}) {
  const [angle, setAngle] = useState(0);
  const drag = useRef(false);
  const lastX = useRef(0);
  const vel = useRef(0);
  // last moment the user touched the body — the idle spin waits 10s past it
  const lastTouch = useRef(-Infinity);

  // one persistent loop drives both the release momentum and the idle spin:
  // untouched → slow turntable; touched → dead still until 10s of quiet
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!drag.current) {
        if (Math.abs(vel.current) > 0.001) {
          setAngle((a) => a + vel.current);
          vel.current *= 0.95;
        } else if (now - lastTouch.current > 10000) {
          // ease back in: creeps from a standstill at 10s to full showcase
          // speed (~29s/turn) by 12s — no sudden jump-start
          const ramp = Math.min(1, (now - lastTouch.current - 10000) / 2000);
          setAngle((a) => a + 0.22 * dt * ramp * ramp * (3 - 2 * ramp));
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    // a release ANYWHERE ends the drag — a pointerup lost outside the element
    // must never leave the body stuck (hover-rotating, idle spin dead)
    const endDrag = () => {
      if (drag.current) {
        drag.current = false;
        lastTouch.current = performance.now();
      }
    };
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("blur", endDrag);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      window.removeEventListener("blur", endDrag);
    };
  }, []);

  return (
    <div
      className="mx-auto cursor-grab touch-pan-y select-none active:cursor-grabbing"
      style={{ width: height * 0.66, height }}
      onPointerDown={(e) => {
        drag.current = true;
        lastX.current = e.clientX;
        vel.current = 0;
        lastTouch.current = performance.now();
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        // hover must NEVER rotate: if the mouse button is no longer down
        // (released off-window, missed pointerup), end the drag right here
        if (e.pointerType === "mouse" && (e.buttons & 1) === 0) {
          drag.current = false;
          lastTouch.current = performance.now();
          return;
        }
        const dx = (e.clientX - lastX.current) * 0.012;
        lastX.current = e.clientX;
        vel.current = Math.max(-0.18, Math.min(0.18, dx));
        lastTouch.current = performance.now();
        setAngle((p) => p + dx);
      }}
      onPointerUp={() => {
        drag.current = false;
        lastTouch.current = performance.now();
      }}
      onPointerCancel={() => {
        drag.current = false;
        lastTouch.current = performance.now();
      }}
      onLostPointerCapture={() => {
        drag.current = false;
      }}
    >
      <Canvas camera={{ position: [0, 0.28, 3.6 * dolly], fov: 32 }} gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={1.7} />
        <directionalLight position={[2, 4, 3]} intensity={1.5} />
        <directionalLight position={[-2, 2, -2]} intensity={0.6} />
        <Suspense fallback={null}>
          <Body angle={angle} load={load} prevLoad={prevLoad} fadeIn={fadeIn} />
        </Suspense>
      </Canvas>
    </div>
  );
}
