"use client";

// Small shared pieces: icons by name, identity marks, media tiles.

import {
  Badge, BookOpen, Briefcase, Building2, Calendar, Car, Check, ClipboardList, Clock, Droplet, Flame, Folder, Gift, Globe,
  GraduationCap, Heart, House, Images, IdCard, Info, KeyRound, Landmark, Mail, NotebookPen, Package, Phone, Play, Printer, Receipt,
  Scissors, Shield, Shirt, SlidersHorizontal, Sparkles, Stethoscope, Store, Trophy, Truck, User, Users, Wallet, Wrench, Fuel,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import type { Media, ProfileNode } from "@/lib/profiles/types";

const ICONS: Record<string, LucideIcon> = {
  badge: Badge, "book-open": BookOpen, briefcase: Briefcase, "building-2": Building2, calendar: Calendar, car: Car, check: Check,
  "clipboard-list": ClipboardList, clock: Clock, droplet: Droplet, flame: Flame, folder: Folder, gift: Gift, globe: Globe,
  "graduation-cap": GraduationCap, heart: Heart, home: House, images: Images, "id-card": IdCard, info: Info, "key-round": KeyRound, landmark: Landmark,
  mail: Mail, "notebook-pen": NotebookPen, package: Package, phone: Phone, printer: Printer, receipt: Receipt, scissors: Scissors,
  shield: Shield, shirt: Shirt, "sliders-horizontal": SlidersHorizontal, sparkles: Sparkles, stethoscope: Stethoscope, store: Store,
  trophy: Trophy, truck: Truck, user: User, users: Users, wallet: Wallet, wrench: Wrench, fuel: Fuel,
};

/** The section icons the owner (or Jarvis) can pick from. */
export const ICON_NAMES = Object.keys(ICONS);

export function Ico({ name, className }: { name?: string; className?: string }) {
  const C = (name && ICONS[name]) || Folder;
  return <C className={className} strokeWidth={1.7} aria-hidden="true" />;
}

/** People are round, things are square. */
export function Mark({ node, hue, size = 52, soft = false }: { node: Pick<ProfileNode, "kind" | "icon" | "initials" | "name">; hue: number; size?: number; soft?: boolean }) {
  const style = { "--s": `${size}px`, "--h": hue } as CSSProperties;
  if (node.kind === "person")
    return (
      <span className="pf-mark person" style={style} aria-hidden="true">
        {node.icon ? <Ico name={node.icon} /> : (node.initials || node.name.slice(0, 1)).toUpperCase()}
      </span>
    );
  return (
    <span className={`pf-mark thing${soft ? " soft" : ""}`} style={style} aria-hidden="true">
      <Ico name={node.icon} />
    </span>
  );
}

/** A photo or video tile. Examples paint a soft scene; uploads show the real image. */
export function MediaTile({ m, className = "", style, caption = false, onClick }: { m: Media; className?: string; style?: CSSProperties; caption?: boolean; onClick?: () => void }) {
  const inner = (
    <>
      {m.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.src} alt={m.caption} loading="lazy" />
      ) : null}
      {m.kind === "video" ? (
        <span className="pf-dur">
          <Play aria-hidden="true" />
          {m.dur ?? "Video"}
        </span>
      ) : null}
      {caption ? <span className="pf-cap">{m.caption}</span> : null}
    </>
  );
  const cls = `pf-ph ${m.src ? "" : `sc-${m.scene ?? "sky"}`} ${className}`;
  if (onClick)
    return (
      <button type="button" className={cls} style={style} onClick={onClick} aria-label={`Open ${m.kind}: ${m.caption}`}>
        {inner}
      </button>
    );
  return (
    <div className={cls} style={style} role="img" aria-label={m.caption}>
      {inner}
    </div>
  );
}

/** Downscale an uploaded photo to a JPEG data URL small enough to sync. */
export async function fileToMedia(file: File): Promise<Media | null> {
  const isVideo = file.type.startsWith("video/");
  if (!file.type.startsWith("image/") && !isVideo) return null;
  const id = `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const caption = file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").slice(0, 60) || (isVideo ? "Video" : "Photo");
  const date = new Date(file.lastModified || Date.now()).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  try {
    const url = URL.createObjectURL(file);
    const frame = isVideo ? await videoFrame(url) : await loadImage(url);
    URL.revokeObjectURL(url);
    const max = 720;
    const w0 = "videoWidth" in frame ? frame.videoWidth : frame.naturalWidth;
    const h0 = "videoHeight" in frame ? frame.videoHeight : frame.naturalHeight;
    const k = Math.min(1, max / Math.max(w0, h0));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w0 * k));
    c.height = Math.max(1, Math.round(h0 * k));
    c.getContext("2d")?.drawImage(frame, 0, 0, c.width, c.height);
    const dur = isVideo && "duration" in frame && Number.isFinite(frame.duration) ? `${Math.floor(frame.duration / 60)}:${String(Math.round(frame.duration % 60)).padStart(2, "0")}` : undefined;
    return { id, kind: isVideo ? "video" : "photo", src: c.toDataURL("image/jpeg", 0.78), caption, date, dur };
  } catch {
    return null;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function videoFrame(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.onloadeddata = () => {
      v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
    };
    v.onseeked = () => resolve(v);
    v.onerror = reject;
    v.src = url;
  });
}

/** Pointer light + a tiny tilt on any card. Reduced motion skips the tilt. */
export function onCardPointer(e: React.PointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  el.style.setProperty("--mx", `${x * 100}%`);
  el.style.setProperty("--my", `${y * 100}%`);
  if (e.pointerType === "mouse" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    el.style.transform = `perspective(900px) rotateX(${(0.5 - y) * 4}deg) rotateY(${(x - 0.5) * 4}deg) translateY(-3px)`;
}

export function offCardPointer(e: React.PointerEvent<HTMLElement>) {
  e.currentTarget.style.transform = "";
}
