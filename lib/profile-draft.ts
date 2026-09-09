// Staged (unsaved) identity changes from the Photo page. The Profile page's
// "Save changes" commits them into ml_profile; leaving without saving discards.

export type IdentityDraft = { photo?: string | null; avatar?: string };

const KEY = "ml_draft_identity";

export function readDraft(): IdentityDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as IdentityDraft) : null;
  } catch {
    return null;
  }
}

export function writeDraft(d: IdentityDraft): IdentityDraft {
  const next = { ...readDraft(), ...d };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function clearDraft() {
  localStorage.removeItem(KEY);
}
