"use client";

// Settings — your profile (photo, name, handle, bio, city), how the app
// behaves for you, your plan, and your data. Every switch here does something;
// nothing is a placeholder.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCook } from "../CookConnect";
import { Columns, PageHead } from "../Columns";
import { usePersonal, type CookSettings } from "@/lib/cook-connect/personal";
import { deleteMyProfile, downloadMyData } from "@/lib/cook-connect/account";
import { PLAN_LABEL, PLAN_LINE } from "@/lib/cook-connect/plan";
import { sounds } from "@/lib/cook-connect/sounds";
import { Avatar, Button, Field, Input, Panel, SectionHead, Spinner, Textarea, cx } from "../ui";
import { CheckIcon, PhotoIcon } from "../icons";

const HANDLE_RE = /^[a-z0-9_]{2,24}$/;

/** Centre-crop to a square and shrink, so a phone photo becomes a ~30 KB avatar. */
function squareAvatar(file: File, size = 320): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that photo."));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error("That file isn't a photo we can open."));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Couldn't process that photo."));
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      };
      img.src = String(reader.result ?? "");
    };
    reader.readAsDataURL(file);
  });
}

export function SettingsView() {
  const { sb, userId, profile, isLocal, notify, refreshProfile, signOut, navigate } = useCook();
  const { settings, updateSettings } = usePersonal(userId);
  const [name, setName] = useState(profile?.display_name ?? "");
  const [handle, setHandle] = useState(profile?.handle ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [city, setCity] = useState(profile?.city ?? "");
  const [avatar, setAvatar] = useState<string | null>(profile?.avatar_url ?? null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [handleError, setHandleError] = useState<string | null>(null);
  const [muted, setMuted] = useState(() => sounds.muted);
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!profile) return;
    setName(profile.display_name); setHandle(profile.handle);
    setBio(profile.bio ?? ""); setCity(profile.city ?? ""); setAvatar(profile.avatar_url);
  }, [profile]);

  if (!profile || !userId) return null;

  const dirty = name !== profile.display_name || handle !== profile.handle
    || bio !== (profile.bio ?? "") || city !== (profile.city ?? "") || avatar !== profile.avatar_url;

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    try { setAvatar(await squareAvatar(file)); } catch (e) { notify(e instanceof Error ? e.message : "Couldn't use that photo."); }
  };

  const saveProfile = async () => {
    const h = handle.trim().toLowerCase();
    if (!HANDLE_RE.test(h)) { setHandleError("2–24 letters, numbers or _ — no spaces."); return; }
    if (h !== profile.handle) {
      const { data: taken } = await sb.from("profiles").select("id").eq("handle", h).maybeSingle();
      if (taken && taken.id !== userId) { setHandleError(`@${h} is taken — try another.`); return; }
    }
    setHandleError(null);
    setSaving(true);
    const { error } = await sb.from("profiles").update({
      display_name: name.trim() || profile.display_name,
      handle: h,
      bio: bio.trim() || null,
      city: city.trim() || null,
      avatar_url: avatar,
    }).eq("id", userId);
    setSaving(false);
    if (error) { notify("Couldn't save your profile just now. Try again in a moment."); return; }
    await refreshProfile();
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  const exportData = async () => {
    setExporting(true);
    try { await downloadMyData(sb, userId, profile.handle); notify("Your data is downloading."); }
    finally { setExporting(false); }
  };

  const remove = async () => {
    setDeleting(true);
    const error = await deleteMyProfile(sb, userId, isLocal);
    setDeleting(false);
    if (error) { notify(error); return; }
    notify("Your Cook Connect profile and everything in it are gone.");
    await signOut();
  };

  return (
    <Columns>
      <PageHead title="Settings" subtitle="Your profile, how Cook Connect works for you, and your data." />

      <div className="mx-auto grid max-w-[760px] gap-4">
        <Panel>
          <SectionHead title="Profile" action={
            <Button variant="ghost" onClick={() => navigate({ page: "profile", userId })}>View profile</Button>
          } />
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="group relative rounded-full"
                aria-label="Change profile photo"
              >
                <Avatar id={userId} name={name || profile.display_name} url={avatar} size={88} />
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0
                                 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  <PhotoIcon size={22} />
                </span>
              </button>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => fileRef.current?.click()}>
                  <PhotoIcon size={14} />
                  {avatar ? "Change photo" : "Add a photo"}
                </Button>
                {avatar && <Button variant="ghost" onClick={() => setAvatar(null)}>Remove</Button>}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = ""; }}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Handle" hint={handleError ?? "How people find and mention you."}>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[var(--cc-ink-faint)]">@</span>
                  <Input
                    value={handle}
                    maxLength={24}
                    className={cx("pl-7", handleError && "!border-[var(--cc-loss)]")}
                    onChange={(e) => { setHandle(e.target.value.toLowerCase().replace(/\s/g, "")); setHandleError(null); }}
                  />
                </div>
              </Field>
              <Field label="City">
                <Input value={city} maxLength={60} placeholder="Columbus, OH" onChange={(e) => setCity(e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Bio" hint={`${bio.length}/160`}>
                  <Textarea rows={2} value={bio} maxLength={160} placeholder="What you cook, what you play." onChange={(e) => setBio(e.target.value)} />
                </Field>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              {saved && <span className="cc-rise flex items-center gap-1 text-[12px] text-[var(--cc-live)]"><CheckIcon size={14} /> Saved</span>}
              <Button variant="primary" disabled={!dirty || saving} onClick={() => void saveProfile()}>
                {saving && <Spinner size={14} />}
                Save profile
              </Button>
            </div>
          </div>
        </Panel>

        <Panel>
          <SectionHead title="How it works for you" />
          <ul className="divide-y divide-[var(--cc-line-soft)]">
            <Row title="Open the app on" body="Which half you land on when you open Cook Connect.">
              <Segmented<CookSettings["openOn"]>
                value={settings.openOn}
                onChange={(openOn) => updateSettings({ openOn })}
                options={[["last", "Last used"], ["cookbook", "Cookbook"], ["connect", "Connect"]]}
              />
            </Row>
            <Row title="Feed starts on" body="Posts from people you follow, or from everyone.">
              <Segmented<CookSettings["feedScope"]>
                value={settings.feedScope}
                onChange={(feedScope) => updateSettings({ feedScope })}
                options={[["following", "Following"], ["everyone", "Everyone"]]}
              />
            </Row>
            <Row title="Animations" body="Calm turns off the scroll and page motion.">
              <Segmented<CookSettings["motion"]>
                value={settings.motion}
                onChange={(motion) => updateSettings({ motion })}
                options={[["system", "Device"], ["full", "Full"], ["reduced", "Calm"]]}
              />
            </Row>
            <Row title="Show my ranks on recipe cards" body="Your 1–10 rank sits on the photo. Only you ever see your ranks.">
              <Switch on={settings.showRanksOnCards} onChange={(v) => updateSettings({ showRanksOnCards: v })} label="Show my ranks on recipe cards" />
            </Row>
            <Row title="Game sounds" body="Card flips, wins and someone joining your table.">
              <Switch on={!muted} onChange={(v) => { sounds.muted = !v; setMuted(!v); }} label="Game sounds" />
            </Row>
          </ul>
        </Panel>

        <Panel>
          <SectionHead title="Plan" />
          <div className="flex flex-wrap items-center gap-3 p-4">
            <span className="rounded-full bg-[var(--cc-live-wash)] px-3 py-1 text-[12px] font-bold text-[var(--cc-live)]">{PLAN_LABEL}</span>
            <p className="text-[13px] text-[var(--cc-ink-muted)]">{PLAN_LINE}</p>
          </div>
        </Panel>

        <Panel>
          <SectionHead title="Your data" />
          <ul className="divide-y divide-[var(--cc-line-soft)]">
            <Row title="Download my data" body="Your profile, cookbooks, recipes, journal, follows and ranks as one file.">
              <Button disabled={exporting} onClick={() => void exportData()}>
                {exporting && <Spinner size={14} />}
                Download
              </Button>
            </Row>
            <li className="space-y-2 px-4 py-3.5">
              <p className="text-[13px] font-semibold text-[var(--cc-loss)]">Delete my Cook Connect profile</p>
              <p className="text-[12px] leading-relaxed text-[var(--cc-ink-muted)]">
                Removes your profile, cookbooks, recipes, saves, follows, messages and journal for good. Your hub login stays.
                Type <span className="cc-num font-semibold text-[var(--cc-ink)]">{profile.handle}</span> to confirm.
              </p>
              <div className="flex flex-wrap gap-2">
                <Input value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} placeholder={profile.handle} className="max-w-[220px]" />
                <Button variant="danger" disabled={confirmDelete !== profile.handle || deleting} onClick={() => void remove()}>
                  {deleting && <Spinner size={14} />}
                  Delete forever
                </Button>
              </div>
            </li>
          </ul>
        </Panel>

        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-6 text-[12px] text-[var(--cc-ink-faint)]">
          <span className="flex gap-3">
            <a href="/legal/terms" target="_blank" rel="noreferrer" className="hover:text-[var(--cc-ink-muted)]">Terms</a>
            <a href="/legal/privacy" target="_blank" rel="noreferrer" className="hover:text-[var(--cc-ink-muted)]">Privacy</a>
          </span>
          <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </div>
    </Columns>
  );
}

function Row({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3.5">
      <div className="min-w-[200px] flex-1">
        <p className="text-[13px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[12px] text-[var(--cc-ink-muted)]">{body}</p>
      </div>
      {children}
    </li>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="cc-switch" onClick={() => onChange(!on)} />;
}

function Segmented<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex rounded-full border border-[var(--cc-line)] bg-[var(--cc-canvas)] p-0.5" role="radiogroup">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={cx(
            "rounded-full px-3 py-1 text-[12px] font-semibold transition-colors duration-150",
            value === id ? "bg-[var(--cc-ember)] text-[var(--cc-on-accent)]" : "text-[var(--cc-ink-muted)] hover:text-[var(--cc-ink)]",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
