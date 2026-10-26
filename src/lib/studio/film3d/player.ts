// ---------------------------------------------------------------------------
// FilmPlayer — draws one moment of a Film3D onto a 2D canvas.
//
// The 3D scene renders into its own WebGL canvas; the result is composited
// onto the output canvas with the title, the caption, the fades and a soft
// vignette. The OUTPUT canvas is what the live preview shows, what the
// browser encoder turns into MP4 frames, and what the PC render page reads —
// so all three are frame-for-frame the same film.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { frameAt, durationOf, speedOf, type FrameState } from "./director";
import { buildHero, Materials, poseHero, type HeroRig } from "./hero";
import { buildProp, type PropRig } from "./props";
import { buildWorld, type WorldScene } from "./world";
import type { Film3D, Move } from "./plan";

export type Quality = "preview" | "final";

interface ModelHero {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  clips: THREE.AnimationClip[];
  hand: THREE.Object3D | null;
  current?: THREE.AnimationAction;
}

const CLIP_NAMES: Record<Move, string[]> = {
  idle: ["idle", "breath", "stand"],
  walk: ["walk"],
  run: ["run", "sprint", "jog"],
  wave: ["wave", "hello", "greet"],
  jump: ["jump", "hop"],
  cheer: ["cheer", "victory", "celebrat", "yes", "dance"],
  dance: ["dance", "samba", "hip"],
  sit: ["sit"],
  point: ["point"],
  sad: ["sad", "defeat", "no"],
  reach: ["reach", "jump"],
  look: ["look", "search"],
  talk: ["talk", "speak"],
  sleep: ["sleep", "lying", "lay"],
  tumble: ["fall", "tumble", "death"],
};

function clipFor(clips: THREE.AnimationClip[], move: Move): THREE.AnimationClip | undefined {
  for (const want of CLIP_NAMES[move]) {
    const hit = clips.find((c) => c.name.toLowerCase().includes(want));
    if (hit) return hit;
  }
  return clips.find((c) => /idle/i.test(c.name)) ?? clips[0];
}

export class FilmPlayer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private glCanvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 600);
  private film: Film3D | null = null;
  private mats: Materials | null = null;
  private worlds = new Map<string, WorldScene>();
  private hero: HeroRig | null = null;
  private model: ModelHero | null = null;
  private props = new Map<string, PropRig | null>();
  private string: THREE.Line;
  private stringGeo = new THREE.BufferGeometry();
  private heroKey = "";
  private width = 0;
  private height = 0;

  constructor(opts: { canvas?: HTMLCanvasElement; width: number; height: number; quality?: Quality }) {
    this.canvas = opts.canvas ?? document.createElement("canvas");
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("This browser can't draw the film (no 2D canvas).");
    this.ctx = ctx;
    this.glCanvas = document.createElement("canvas");
    this.renderer = new THREE.WebGLRenderer({ canvas: this.glCanvas, antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(1);
    this.stringGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    this.string = new THREE.Line(this.stringGeo, new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85 }));
    this.string.frustumCulled = false;
    this.setSize(opts.width, opts.height);
  }

  setSize(width: number, height: number) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  get duration(): number {
    return this.film ? durationOf(this.film) : 0;
  }

  /** Load a film: builds every set it uses up front, so playback never hitches on a cut. */
  async setFilm(film: Film3D): Promise<void> {
    const sameLook = this.film?.look === film.look;
    this.film = film;
    if (!sameLook || !this.mats) {
      this.disposeScenes();
      this.mats?.dispose();
      this.mats = new Materials(film.look);
      this.heroKey = "";
    }
    const mats = this.mats;
    const heroKey = JSON.stringify(film.hero);
    if (heroKey !== this.heroKey) {
      this.hero?.dispose();
      this.hero?.root.removeFromParent();
      this.hero = buildHero(film.hero, mats);
      this.model?.root.removeFromParent();
      this.model = null;
      for (const p of this.props.values()) {
        p?.obj.removeFromParent();
        p?.dispose();
      }
      this.props.clear();
      this.heroKey = heroKey;
      if (film.hero.model) this.model = await this.loadModel(film.hero.model, this.hero.height).catch(() => null);
    }
    const keys = new Set(film.beats.map((b) => `${b.world}:${b.time}`));
    for (const [k, w] of this.worlds) {
      if (!keys.has(k)) {
        w.dispose();
        this.worlds.delete(k);
      }
    }
    for (const b of film.beats) {
      const k = `${b.world}:${b.time}`;
      if (!this.worlds.has(k)) this.worlds.set(k, buildWorld(b.world, b.time, film.look, mats, film.seed));
    }
    // Compile once so the first frame of every set is as fast as the rest.
    for (const w of this.worlds.values()) this.renderer.compile(w.scene, this.camera);
  }

  private async loadModel(url: string, height: number): Promise<ModelHero> {
    const [{ GLTFLoader }, SkeletonUtils] = await Promise.all([
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("three/examples/jsm/utils/SkeletonUtils.js"),
    ]);
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = SkeletonUtils.clone(gltf.scene);
    const box = new THREE.Box3().setFromObject(root);
    const h = Math.max(0.01, box.max.y - box.min.y);
    root.scale.setScalar(height / h);
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
    let hand: THREE.Object3D | null = null;
    root.traverse((o) => {
      if (!hand && /right.?hand|hand.?r\b|mixamorig:?righthand/i.test(o.name)) hand = o;
    });
    return { root, mixer: new THREE.AnimationMixer(root), clips: gltf.animations, hand };
  }

  private propRig(kind: string): PropRig | null {
    if (!this.film || !this.mats) return null;
    if (!this.props.has(kind)) this.props.set(kind, buildProp(kind as never, this.mats, this.film.hero.accent));
    return this.props.get(kind) ?? null;
  }

  /** The state at t, for overlays and the score. */
  state(t: number): FrameState | null {
    return this.film ? frameAt(this.film, t) : null;
  }

  render(t: number): FrameState | null {
    const film = this.film;
    if (!film || !this.hero || !film.beats.length) return null;
    const f = frameAt(film, t);
    const world = this.worlds.get(f.sceneKey);
    if (!world) return f;
    const scene = world.scene;
    world.update(f.t, f.hero.pos[0]);
    this.renderer.toneMappingExposure = world.exposure;

    // Hero.
    const heroObj = this.model ? this.model.root : this.hero.root;
    if (heroObj.parent !== scene) scene.add(heroObj);
    heroObj.position.set(...f.hero.pos);
    const moving = speedOf(f.hero.move) > 0;
    if (this.model) {
      heroObj.rotation.set(0, f.hero.facing, 0);
      const clip = clipFor(this.model.clips, f.hero.move);
      if (clip) {
        const action = this.model.mixer.clipAction(clip);
        if (this.model.current !== action) {
          this.model.current?.stop();
          action.play();
          this.model.current = action;
        }
        action.time = f.hero.phase % Math.max(0.01, clip.duration);
        this.model.mixer.update(0);
      }
    } else {
      poseHero(this.hero, { ...f.hero, speed: speedOf(f.hero.move) });
    }

    // Prop.
    for (const p of this.props.values()) if (p) p.obj.visible = false;
    let tethered = false;
    if (f.prop.mode !== "none") {
      const p = this.propRig(f.prop.kind);
      if (p) {
        if (p.obj.parent !== scene) scene.add(p.obj);
        p.obj.visible = true;
        p.obj.position.set(...f.prop.pos);
        // Ground props are built facing +x, the way he travels.
        if (p.grounded) p.obj.rotation.y = f.prop.mode === "with" && !moving ? 0.5 : 0;
        p.update(f.t, f.prop.mode, moving || f.prop.mode === "leaving");
        tethered = p.tethered && (f.prop.mode === "with" || f.prop.mode === "caught" || f.prop.mode === "almost");
      }
    }
    if (tethered) {
      if (this.string.parent !== scene) scene.add(this.string);
      this.string.visible = true;
      scene.updateMatrixWorld(true);
      const hand = new THREE.Vector3();
      (this.model?.hand ?? this.hero.handR).getWorldPosition(hand);
      const arr = this.stringGeo.attributes.position as THREE.BufferAttribute;
      arr.setXYZ(0, hand.x, hand.y, hand.z);
      const tip = new THREE.Vector3(...f.prop.pos);
      tip.y -= f.prop.kind === "kite" ? 0.05 : 0.36;
      arr.setXYZ(1, tip.x, tip.y, tip.z);
      arr.needsUpdate = true;
    } else {
      this.string.visible = false;
    }

    // Camera.
    const c = f.camera;
    this.camera.fov = c.fov;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(...c.pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(...c.target);
    if (c.roll) this.camera.rotateZ(c.roll);

    this.renderer.render(scene, this.camera);
    this.composite(f);
    return f;
  }

  private composite(f: FrameState) {
    const { ctx, width: w, height: h } = this;
    ctx.globalAlpha = 1;
    ctx.drawImage(this.glCanvas, 0, 0, w, h);
    const short = Math.min(w, h);

    // Vignette — softer for toys, stronger for storybook and neon.
    const look = this.film?.look ?? "toy";
    const v = look === "storybook" ? 0.32 : look === "neon" ? 0.45 : 0.22;
    const g = ctx.createRadialGradient(w / 2, h / 2, short * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(${look === "storybook" ? "60,40,30" : "0,0,0"},${v})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const font = (px: number, weight = 800) => `${weight} ${Math.round(px)}px ui-rounded, "SF Pro Rounded", "Nunito", "Segoe UI", system-ui, sans-serif`;
    const tall = h > w * 1.2;

    if (f.title.alpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = f.title.alpha;
      ctx.font = font(short * (tall ? 0.075 : 0.085), 900);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = short * 0.018;
      ctx.strokeStyle = "rgba(20,14,30,0.55)";
      const y = h * (tall ? 0.2 : 0.2);
      wrapLines(ctx, f.title.text, w * 0.86).forEach((line, i, all) => {
        const yy = y + (i - (all.length - 1) / 2) * short * 0.1;
        ctx.strokeText(line, w / 2, yy);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(line, w / 2, yy);
      });
      ctx.restore();
    }

    if (f.caption.alpha > 0.01 && f.caption.text) {
      ctx.save();
      ctx.globalAlpha = f.caption.alpha;
      const px = short * (tall ? 0.058 : 0.056);
      ctx.font = font(px);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const text = f.caption.text;
      const tw = Math.min(w * 0.88, ctx.measureText(text).width);
      const padX = px * 0.9;
      const bh = px * 1.75;
      const cy = tall ? h * 0.74 : h * 0.86;
      const bx = w / 2 - tw / 2 - padX;
      const lift = (1 - f.caption.alpha) * px * 0.5;
      ctx.fillStyle = "rgba(255,252,245,0.94)";
      roundRect(ctx, bx, cy - bh / 2 + lift, tw + padX * 2, bh, bh / 2);
      ctx.fill();
      ctx.fillStyle = this.film?.hero.accent ?? "#f2a93b";
      roundRect(ctx, bx + bh * 0.28, cy - bh * 0.12 + lift, bh * 0.24, bh * 0.24, bh * 0.12);
      ctx.fill();
      ctx.fillStyle = "#1d1626";
      ctx.fillText(text, w / 2 + px * 0.25, cy + lift + px * 0.04, w * 0.84);
      ctx.restore();
    }

    if (f.flash > 0.01) {
      ctx.fillStyle = `rgba(255,250,235,${f.flash})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (f.fade > 0.01) {
      ctx.fillStyle = `rgba(8,6,12,${f.fade})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  private disposeScenes() {
    for (const w of this.worlds.values()) w.dispose();
    this.worlds.clear();
  }

  dispose() {
    this.disposeScenes();
    this.hero?.dispose();
    for (const p of this.props.values()) p?.dispose();
    this.props.clear();
    this.mats?.dispose();
    this.stringGeo.dispose();
    (this.string.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}
