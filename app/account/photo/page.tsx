"use client";

// Profile photo — Google-style flow: picking an image shows a PREVIEW dialog
// first. Confirming only STAGES the choice (a draft) and returns to the
// Profile page, where "Save changes" commits it. Nothing is saved or synced
// from this page.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AVATAR_ICON, getProfile, type Profile } from "@/lib/profile";
import { SIcon, type SIconName } from "@/components/SIcon";
import { CameraIcon } from "@/components/Icons";
import { readDraft, writeDraft, type IdentityDraft } from "@/lib/profile-draft";

const AVATARS = Object.keys(AVATAR_ICON);

const VP = 248; // crop viewport (px)

export default function ProfilePhoto() {
  const router = useRouter();
  const [p, setP] = useState<Profile>({});
  const fileRef = useRef<HTMLInputElement>(null);
  // interactive crop: the picked image + how the user has framed it
  const [raw, setRaw] = useState<{ src: string; w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1); // 1 = image short side fills the circle
  const [off, setOff] = useState({ x: 0, y: 0 }); // image-center offset from viewport center
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const baseScale = raw ? VP / Math.min(raw.w, raw.h) : 1;
  const s = baseScale * scale;
  const clampOff = (o: { x: number; y: number }) => {
    if (!raw) return o;
    const mx = Math.max(0, (raw.w * s - VP) / 2);
    const my = Math.max(0, (raw.h * s - VP) / 2);
    return { x: Math.max(-mx, Math.min(mx, o.x)), y: Math.max(-my, Math.min(my, o.y)) };
  };

  // overlay a draft on the saved profile (draft photo:null = "cleared")
  const withDraft = (base: Profile, d: IdentityDraft | null): Profile => {
    if (!d) return base;
    const out = { ...base };
    if (d.avatar !== undefined) out.avatar = d.avatar;
    if (d.photo !== undefined) out.photo = d.photo ?? undefined;
    return out;
  };

  useEffect(() => {
    // show saved profile with any staged-but-unsaved choice on top
    setP(withDraft(getProfile(), readDraft()));
  }, []);

  // stage the choice — committed only by "Save changes" on the Profile page
  function stage(d: IdentityDraft) {
    const next = writeDraft(d);
    setP((prev) => withDraft(prev, next));
  }

  // load the image into the interactive cropper (no auto-crop — the user frames it)
  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      setRaw({ src: img.src, w: img.width, h: img.height });
      setScale(1);
      setOff({ x: 0, y: 0 });
    };
    img.src = URL.createObjectURL(file);
    e.target.value = "";
  }

  // render exactly what the circle frames to a 256² square
  function confirmCrop() {
    if (!raw) return;
    const S = 256;
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const sSize = VP / s; // source square edge in original pixels
    const sx = raw.w / 2 - off.x / s - sSize / 2;
    const sy = raw.h / 2 - off.y / s - sSize / 2;
    const img = new Image();
    img.onload = () => {
      c.getContext("2d")!.drawImage(img, sx, sy, sSize, sSize, 0, 0, S, S);
      stage({ photo: c.toDataURL("image/jpeg", 0.85) });
      URL.revokeObjectURL(raw.src);
      setRaw(null);
      router.push("/account/profile");
    };
    img.src = raw.src;
  }

  return (
    <div className="px-5 pt-8 pb-8">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/account/profile")}
          className="grid h-9 w-9 place-items-center rounded-full bg-white text-ink shadow-soft"
        >
          ←
        </button>
        <h1 className="text-2xl font-extrabold tracking-tight">Profile photo</h1>
      </div>

      {/* current avatar */}
      <div className="mt-6 flex justify-center">
        <span className="grid h-24 w-24 place-items-center overflow-hidden rounded-full bg-volt-mist">
          {p.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.photo} alt="" className="h-full w-full object-cover" />
          ) : (
            <SIcon name={(AVATAR_ICON[p.avatar ?? ""] ?? "tennis") as SIconName} size={64} />
          )}
        </span>
      </div>

      {/* two panels: photo (left) · icon (right) */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="flex flex-col rounded-3xl bg-white p-4 shadow-soft">
          <p className="text-sm font-bold">Your photo</p>
          <div className="mt-3 grid flex-1 place-items-center">
            <button
              onClick={() => fileRef.current?.click()}
              className="grid h-20 w-20 place-items-center rounded-full border-2 border-dashed border-black/15 text-ink-muted transition active:scale-95"
            >
              <CameraIcon size={26} className="text-volt-deep" />
            </button>
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            className="mt-3 w-full rounded-full bg-ink py-2.5 text-xs font-bold text-white transition active:scale-[0.98]"
          >
            {p.photo ? "Change photo" : "Choose photo"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
        </div>

        <div className="flex flex-col rounded-3xl bg-white p-4 shadow-soft">
          <p className="text-sm font-bold">Sport icon</p>
          <div className="mt-3 grid flex-1 grid-cols-3 place-items-center gap-2">
            {AVATARS.map((a) => (
              <button
                key={a}
                onClick={() => stage({ avatar: a, photo: null })}
                className={`grid h-11 w-11 place-items-center rounded-full bg-volt-mist transition ${
                  p.avatar === a && !p.photo ? "ring-2 ring-ink ring-offset-2 ring-offset-white" : "opacity-55"
                }`}
              >
                <SIcon name={AVATAR_ICON[a]} size={28} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* interactive cropper — drag to move, slider to zoom; the circle is fixed */}
      {raw && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/50 px-6 backdrop-blur-[2px]">
          <div className="w-full max-w-[340px] animate-pop rounded-3xl bg-paper p-6 text-center shadow-lift">
            <h2 className="text-lg font-extrabold">Drag to position</h2>

            <div
              className="relative mx-auto mt-5 touch-none overflow-hidden rounded-full ring-4 ring-white"
              style={{ width: VP, height: VP, cursor: drag.current ? "grabbing" : "grab" }}
              onPointerDown={(e) => {
                drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
                (e.currentTarget as Element).setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!drag.current) return;
                setOff(clampOff({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) }));
              }}
              onPointerUp={() => { drag.current = null; }}
              onPointerCancel={() => { drag.current = null; }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={raw.src}
                alt=""
                draggable={false}
                className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
                style={{
                  width: raw.w * s,
                  height: raw.h * s,
                  transform: `translate(calc(-50% + ${off.x}px), calc(-50% + ${off.y}px))`,
                }}
              />
              {/* subtle center ring guide */}
              <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-white/40" />
            </div>

            {/* zoom */}
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={scale}
              onChange={(e) => {
                const ns = Number(e.target.value);
                setScale(ns);
                // re-clamp with the new scale so the image still covers the circle
                setOff((o) => {
                  const ss = baseScale * ns;
                  const mx = Math.max(0, (raw.w * ss - VP) / 2);
                  const my = Math.max(0, (raw.h * ss - VP) / 2);
                  return { x: Math.max(-mx, Math.min(mx, o.x)), y: Math.max(-my, Math.min(my, o.y)) };
                });
              }}
              className="mt-5 w-full accent-ink"
            />

            <div className="mt-4 flex gap-2.5">
              <button
                onClick={() => { URL.revokeObjectURL(raw.src); setRaw(null); }}
                className="flex-1 rounded-full bg-white py-3 text-sm font-bold text-ink transition active:scale-[0.98]"
              >
                Cancel
              </button>
              <button
                onClick={confirmCrop}
                className="btn-press flex-1 rounded-full bg-ink py-3 text-sm font-bold text-white transition"
              >
                Set as photo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
