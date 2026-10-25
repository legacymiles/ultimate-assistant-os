// ---------------------------------------------------------------------------
// The worlds: eleven sets built from primitives, each with its own light for
// four times of day, and background life that moves (clouds, birds, waves,
// snow, stars) so no frame is a still. Seeded, so a set is the same set in
// every shot, every render, every machine.
//
// Layout: the hero's path runs along x at z ≈ 0. The camera sits on +z, so
// the set is dressed behind the path (z < -1.5) and kept low and sparse in
// front of it.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import type { Look, TimeOfDay, World } from "./plan";
import { Materials, shade } from "./hero";
import { rand } from "./director";

export interface WorldScene {
  key: string;
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  exposure: number;
  update: (t: number, focusX: number) => void;
  dispose: () => void;
}

interface Light {
  top: string;
  horizon: string;
  bottom: string;
  sun: string;
  sunI: number;
  sunPos: [number, number, number];
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  fogNear: number;
  fogFar: number;
  exposure: number;
  lampsOn: boolean;
}

const LIGHT: Record<TimeOfDay, Light> = {
  morning: { top: "#7fb8f5", horizon: "#ffd9bd", bottom: "#ffe8d2", sun: "#ffe0b3", sunI: 2.4, sunPos: [-9, 6, 7], hemiSky: "#d4e7ff", hemiGround: "#9f8a6e", hemiI: 1.1, fogNear: 22, fogFar: 85, exposure: 1.0, lampsOn: false },
  day: { top: "#4a9ff5", horizon: "#cfe8ff", bottom: "#e6f3ff", sun: "#fff4e0", sunI: 3.0, sunPos: [6, 13, 8], hemiSky: "#d9ecff", hemiGround: "#8f8a70", hemiI: 1.25, fogNear: 30, fogFar: 110, exposure: 1.0, lampsOn: false },
  sunset: { top: "#3a3c8c", horizon: "#ff9558", bottom: "#ffb27a", sun: "#ff9a52", sunI: 2.6, sunPos: [12, 3.2, -4], hemiSky: "#ffb08f", hemiGround: "#4b3d5e", hemiI: 0.95, fogNear: 18, fogFar: 80, exposure: 1.05, lampsOn: true },
  night: { top: "#050a20", horizon: "#1b2a58", bottom: "#24335f", sun: "#9db4ff", sunI: 1.1, sunPos: [-6, 10, 6], hemiSky: "#3a4775", hemiGround: "#0d0f1c", hemiI: 0.6, fogNear: 14, fogFar: 70, exposure: 1.15, lampsOn: true },
};

/** Ground, path and accent colours for each world. */
const PALETTE: Record<World, { ground: string; path: string; pathW: number }> = {
  home: { ground: "#7cc66d", path: "#eadab6", pathW: 1.6 },
  town: { ground: "#8a8f9c", path: "#d7d2c8", pathW: 2.2 },
  park: { ground: "#82c96e", path: "#eadbbd", pathW: 1.5 },
  forest: { ground: "#4f8a4d", path: "#b38c5d", pathW: 1.3 },
  hill: { ground: "#86c76a", path: "#c9b98a", pathW: 0.9 },
  beach: { ground: "#f2dca4", path: "#ead096", pathW: 0 },
  snow: { ground: "#f2f6fb", path: "#dbe5ef", pathW: 1.6 },
  space: { ground: "#9c9aa8", path: "#8a8896", pathW: 0 },
  city: { ground: "#5d6270", path: "#b9b6b0", pathW: 2.4 },
  desert: { ground: "#e8c27e", path: "#dcb06a", pathW: 0 },
  bedroom: { ground: "#c79a6b", path: "#d6ab7c", pathW: 0 },
};

function skyMaterial(top: string, horizon: string, bottom: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(top) },
      horizon: { value: new THREE.Color(horizon) },
      bottom: { value: new THREE.Color(bottom) },
    },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader:
      "uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(min(1.0, h * 1.6), 0.7)) : mix(horizon, bottom, min(1.0, -h * 4.0)); gl_FragColor = vec4(c, 1.0); }",
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

export function buildWorld(world: World, time: TimeOfDay, look: Look, mats: Materials, seed: number): WorldScene {
  const L0: Light = world === "space" ? { ...LIGHT.night, sun: "#f4f2ff", sunI: 2.4, hemiI: 0.9, hemiGround: "#2a2840" } : LIGHT[time];
  const L: Light = look === "neon" ? { ...L0, top: "#0b0626", horizon: "#3b1a6b", bottom: "#2a1250", lampsOn: true, exposure: 1.1 } : look === "storybook" ? { ...L0, fogNear: L0.fogNear * 0.6, fogFar: L0.fogFar * 0.7 } : L0;
  const P = PALETTE[world];
  const night = L.lampsOn && (time === "night" || look === "neon" || world === "space");
  const scene = new THREE.Scene();
  const geos = new Map<string, THREE.BufferGeometry>();
  const extra: { dispose(): void }[] = [];
  const geo = <T extends THREE.BufferGeometry>(key: string, make: () => T): T => {
    let g = geos.get(key) as T | undefined;
    if (!g) {
      g = make();
      geos.set(key, g);
    }
    return g;
  };
  const r = (n: number) => rand(seed ^ 0x51ed, n);
  let rn = 1;
  const R = () => r(rn++);
  const put = (o: THREE.Object3D, x: number, y: number, z: number, s = 1, ry = 0) => {
    o.position.set(x, y, z);
    o.scale.setScalar(s);
    o.rotation.y = ry;
    scene.add(o);
    return o;
  };
  const M = (g: THREE.BufferGeometry, color: string, opts: { emissive?: number; shadow?: boolean; receive?: boolean; side?: THREE.Side } = {}) => {
    const m = new THREE.Mesh(g, mats.get(color, { emissive: opts.emissive, side: opts.side }));
    m.castShadow = opts.shadow ?? true;
    m.receiveShadow = opts.receive ?? false;
    return m;
  };
  const updaters: ((t: number) => void)[] = [];

  // --- sky, fog, light ------------------------------------------------------
  if (world === "bedroom") {
    scene.background = new THREE.Color(shade("#bcd5ee", time === "night" ? -0.55 : 0).getHex());
  } else {
    const sky = new THREE.Mesh(geo("sky", () => new THREE.SphereGeometry(300, 32, 16)), skyMaterial(L.top, L.horizon, L.bottom));
    extra.push(sky.material as THREE.Material);
    sky.renderOrder = -10;
    scene.add(sky);
  }
  scene.fog = new THREE.Fog(new THREE.Color(world === "bedroom" ? "#000000" : L.horizon), world === "bedroom" ? 200 : L.fogNear, world === "bedroom" ? 400 : L.fogFar);

  const hemi = new THREE.HemisphereLight(L.hemiSky, L.hemiGround, world === "bedroom" ? L.hemiI * 0.9 + 0.3 : L.hemiI);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(L.sun, L.sunI);
  sun.position.set(...L.sunPos);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -11;
  sun.shadow.camera.right = 11;
  sun.shadow.camera.top = 11;
  sun.shadow.camera.bottom = -11;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);
  // A cool fill from the camera side keeps faces readable in every light.
  const fill = new THREE.DirectionalLight(time === "sunset" ? "#a9b6ff" : "#dfe8ff", world === "bedroom" ? 0.9 : 0.55);
  fill.position.set(2, 3, 10);
  scene.add(fill);

  // Sun or moon disc in the sky.
  if (world !== "bedroom") {
    const discColor = time === "night" || world === "space" ? "#f4f1de" : time === "sunset" ? "#ffb36b" : "#fff3cf";
    const disc = new THREE.Mesh(geo("disc", () => new THREE.SphereGeometry(6, 20, 14)), new THREE.MeshBasicMaterial({ color: discColor, fog: false }));
    extra.push(disc.material as THREE.Material);
    const dir = new THREE.Vector3(...L.sunPos).normalize();
    if (time === "day" || time === "morning") dir.set(dir.x, Math.max(0.35, dir.y), -Math.abs(dir.z) - 0.6).normalize();
    else dir.set(dir.x, Math.max(0.12, dir.y), -1).normalize();
    disc.position.copy(dir.multiplyScalar(240));
    scene.add(disc);
  }

  // --- ground and path ------------------------------------------------------
  const ground = M(geo("ground", () => new THREE.CircleGeometry(160, 48)), P.ground, { shadow: false, receive: true });
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  if (P.pathW > 0) {
    const path = M(geo(`path-${P.pathW}`, () => new THREE.PlaneGeometry(200, P.pathW)), P.path, { shadow: false, receive: true });
    path.rotation.x = -Math.PI / 2;
    path.position.y = 0.006;
    scene.add(path);
  }

  // --- shared builders -----------------------------------------------------
  const roundTree = (x: number, z: number, s = 1) => {
    const g = new THREE.Group();
    const trunk = M(geo("trunk", () => new THREE.CylinderGeometry(0.12, 0.18, 1.4, 8)), "#7a5232");
    trunk.position.y = 0.7;
    const top = M(geo("canopy", () => new THREE.IcosahedronGeometry(1.0, 1)), ["#4caf50", "#5cb85c", "#6cc04a"][Math.floor(R() * 3)]);
    top.position.y = 1.9;
    top.scale.set(1, 0.9, 1);
    const top2 = M(geo("canopy", () => new THREE.IcosahedronGeometry(1.0, 1)), "#5fbf55");
    top2.position.set(0.5, 1.55, 0.2);
    top2.scale.setScalar(0.62);
    g.add(trunk, top, top2);
    return put(g, x, 0, z, s, R() * 6);
  };
  const pine = (x: number, z: number, s = 1, snowy = false) => {
    const g = new THREE.Group();
    const trunk = M(geo("ptrunk", () => new THREE.CylinderGeometry(0.1, 0.14, 0.8, 6)), "#6b4426");
    trunk.position.y = 0.4;
    g.add(trunk);
    for (let i = 0; i < 3; i++) {
      const c = M(geo(`pine${i}`, () => new THREE.ConeGeometry(1.05 - i * 0.25, 1.3, 8)), snowy ? (i === 2 ? "#f6fafe" : "#2f6e4a") : ["#2e7d4f", "#3a8f5a", "#46a065"][i]);
      c.position.y = 1.0 + i * 0.75;
      g.add(c);
    }
    if (snowy) {
      const cap = M(geo("pinecap", () => new THREE.ConeGeometry(0.62, 0.55, 8)), "#ffffff");
      cap.position.y = 2.75;
      g.add(cap);
    }
    return put(g, x, 0, z, s, R() * 6);
  };
  const bush = (x: number, z: number, s = 1, color = "#5aa84e") => put(M(geo("bush", () => new THREE.IcosahedronGeometry(0.45, 1)), color), x, 0.25 * s, z, s, R() * 6);
  const rock = (x: number, z: number, s = 1, color = "#9a9aa0") => {
    const m = put(M(geo("rock", () => new THREE.DodecahedronGeometry(0.4, 0)), color), x, 0.15 * s, z, s, R() * 6);
    m.scale.set(s, s * 0.65, s * 0.9);
    return m;
  };
  const flowers = (x: number, z: number, n = 6) => {
    const cols = ["#ff6b8b", "#ffd34d", "#ffffff", "#b38cff", "#ff9f43"];
    for (let i = 0; i < n; i++) {
      const f = M(geo("flower", () => new THREE.SphereGeometry(0.07, 6, 5)), cols[Math.floor(R() * cols.length)], { shadow: false });
      put(f, x + (R() - 0.5) * 1.2, 0.12, z + (R() - 0.5) * 0.6);
    }
  };
  const house = (x: number, z: number, wall: string, roof: string, w = 3.2, h = 2.4, d = 2.6) => {
    const g = new THREE.Group();
    const body = M(geo(`hbody-${w}-${h}-${d}`, () => new THREE.BoxGeometry(w, h, d)), wall, { receive: true });
    body.position.y = h / 2;
    const roofM = M(geo(`hroof-${w}-${d}`, () => {
      const r = new THREE.CylinderGeometry(0.01, d * 0.78, 1.3, 4, 1);
      r.rotateY(Math.PI / 4);
      return r;
    }), roof);
    roofM.position.y = h + 0.62;
    roofM.scale.set(w / d, 1, 1);
    const door = M(geo("door", () => new THREE.BoxGeometry(0.62, 1.15, 0.06)), shade(wall, -0.45).getStyle());
    door.position.set(0, 0.58, d / 2 + 0.02);
    g.add(body, roofM, door);
    for (const s of [-1, 1]) {
      const win = M(geo("win", () => new THREE.BoxGeometry(0.62, 0.55, 0.05)), night ? "#ffd98a" : "#9fd3ff", { emissive: night ? 1.1 : 0.05, shadow: false });
      win.position.set(s * w * 0.28, h * 0.62, d / 2 + 0.02);
      g.add(win);
    }
    return put(g, x, 0, z);
  };
  const lamp = (x: number, z: number) => {
    const g = new THREE.Group();
    const pole = M(geo("pole", () => new THREE.CylinderGeometry(0.05, 0.07, 3, 8)), "#3b4252");
    pole.position.y = 1.5;
    const bulb = M(geo("bulb", () => new THREE.SphereGeometry(0.18, 12, 10)), night ? "#ffe2a0" : "#f4f1e8", { emissive: night ? 2.2 : 0.1, shadow: false });
    bulb.position.y = 3.05;
    g.add(pole, bulb);
    if (night) {
      const pl = new THREE.PointLight("#ffcf80", 2.2, 7, 1.6);
      pl.position.y = 2.9;
      g.add(pl);
    }
    return put(g, x, 0, z);
  };
  const cloud = (x: number, y: number, z: number, s: number) => {
    const g = new THREE.Group();
    const c = time === "sunset" ? "#ffd2b8" : time === "night" ? "#4a5784" : "#ffffff";
    for (let i = 0; i < 5; i++) {
      const b = M(geo("puff", () => new THREE.IcosahedronGeometry(1, 1)), c, { shadow: false, emissive: time === "night" ? 0 : 0.25 });
      b.position.set((i - 2) * 0.9, Math.sin(i * 1.7) * 0.25, (R() - 0.5) * 0.6);
      b.scale.setScalar(0.9 + R() * 0.6);
      g.add(b);
    }
    put(g, x, y, z, s);
    const base = x;
    const speed = 0.25 + R() * 0.3;
    updaters.push((t) => {
      g.position.x = ((base + t * speed + 60) % 120) - 60;
    });
  };
  const birds = (n: number) => {
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const wingGeo = geo("wing", () => new THREE.ConeGeometry(0.08, 0.5, 3));
      const l = M(wingGeo, time === "night" ? "#c8d2ff" : "#2d2a32", { shadow: false });
      const rr = M(wingGeo, time === "night" ? "#c8d2ff" : "#2d2a32", { shadow: false });
      l.rotation.z = Math.PI / 2;
      rr.rotation.z = -Math.PI / 2;
      l.position.x = 0.22;
      rr.position.x = -0.22;
      g.add(l, rr);
      const y0 = 6 + R() * 5;
      const z0 = -12 - R() * 12;
      const x0 = (R() - 0.5) * 50;
      const sp = 1.2 + R();
      scene.add(g);
      updaters.push((t) => {
        g.position.set(((x0 + t * sp + 40) % 80) - 40, y0 + Math.sin(t * 0.8 + i) * 0.4, z0);
        const f = Math.sin(t * 9 + i * 2) * 0.6;
        l.rotation.x = f;
        rr.rotation.x = f;
      });
    }
  };
  const hills = (color: string, z = -45) => {
    for (let i = 0; i < 9; i++) {
      const h = M(geo("hill", () => new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2)), shade(color, -0.05 - R() * 0.12).getStyle(), { shadow: false });
      h.scale.set(14 + R() * 12, 4 + R() * 5, 10);
      put(h, -70 + i * 18 + R() * 6, 0, z - R() * 15);
      h.scale.set(14 + R() * 12, 4 + R() * 5, 10);
    }
  };
  const stars = (n: number) => {
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2;
      const e = 0.08 + R() * 1.3;
      pos.set([Math.cos(a) * Math.cos(e) * 250, Math.sin(e) * 250, Math.sin(a) * Math.cos(e) * 250], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geos.set("stars", g);
    const m = new THREE.PointsMaterial({ color: "#ffffff", size: 1.6, sizeAttenuation: false, fog: false, transparent: true });
    extra.push(m);
    scene.add(new THREE.Points(g, m));
    updaters.push((t) => {
      m.opacity = 0.75 + Math.sin(t * 2.3) * 0.2;
    });
  };
  const fence = (x0: number, x1: number, z: number, color = "#ffffff") => {
    for (let x = x0; x <= x1; x += 0.55) {
      const p = M(geo("picket", () => new THREE.BoxGeometry(0.12, 0.85, 0.06)), color);
      put(p, x, 0.42, z);
    }
    const rail = M(geo(`rail-${(x1 - x0).toFixed(1)}`, () => new THREE.BoxGeometry(x1 - x0 + 0.2, 0.08, 0.05)), color);
    put(rail, (x0 + x1) / 2, 0.55, z - 0.04);
  };
  const bench = (x: number, z: number) => {
    const g = new THREE.Group();
    const seat = M(geo("seat", () => new THREE.BoxGeometry(1.5, 0.08, 0.45)), "#b5793f");
    seat.position.y = 0.45;
    const back = M(geo("back", () => new THREE.BoxGeometry(1.5, 0.4, 0.06)), "#b5793f");
    back.position.set(0, 0.75, -0.2);
    g.add(seat, back);
    for (const s of [-1, 1]) {
      const leg = M(geo("bleg", () => new THREE.BoxGeometry(0.08, 0.45, 0.4)), "#3b4252");
      leg.position.set(s * 0.65, 0.22, 0);
      g.add(leg);
    }
    return put(g, x, 0, z);
  };

  // --- the sets -------------------------------------------------------------
  const pastel = ["#f6d7a7", "#f7b7a3", "#b8e0d2", "#d6c6f5", "#ffe08a", "#a7d3f5", "#f5c2d8"];
  switch (world) {
    case "home": {
      house(0, -6, "#f6d7a7", "#d9534f", 4.2, 2.8, 3.2);
      house(-10, -7.5, pastel[1], "#5b6c9b");
      house(10, -7.5, pastel[2], "#c0663a");
      fence(-5.5, 5.5, -3.2);
      roundTree(5.5, -3.8, 1.1);
      roundTree(-6.5, -4.2, 0.9);
      bush(-2.8, -3.6);
      bush(2.6, -3.6, 0.8);
      flowers(-1.5, -2.6, 10);
      flowers(1.8, -2.6, 8);
      {
        const box = M(geo("mail", () => new THREE.BoxGeometry(0.3, 0.25, 0.45)), "#3b6fd6");
        put(box, -2.2, 1.0, -1.6);
        const post = M(geo("mpost", () => new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6)), "#6b4a2b");
        put(post, -2.2, 0.45, -1.6);
      }
      {
        // A cat on the fence, tail swishing.
        const cat = new THREE.Group();
        const b = M(geo("catb", () => new THREE.CapsuleGeometry(0.09, 0.18, 3, 8)), "#3a3a3a");
        b.rotation.z = Math.PI / 2;
        const h = M(geo("cath", () => new THREE.SphereGeometry(0.09, 10, 8)), "#3a3a3a");
        h.position.set(0.17, 0.08, 0);
        const tail = M(geo("catt", () => new THREE.CapsuleGeometry(0.02, 0.22, 3, 6)), "#3a3a3a");
        tail.position.set(-0.2, 0.1, 0);
        cat.add(b, h, tail);
        put(cat, 3.4, 0.95, -3.2);
        updaters.push((t) => (tail.rotation.z = 0.6 + Math.sin(t * 2.4) * 0.4));
      }
      hills("#7cc66d");
      for (let i = 0; i < 6; i++) cloud(-40 + i * 16, 12 + R() * 6, -40 - R() * 20, 2 + R() * 1.5);
      birds(4);
      break;
    }
    case "town": {
      for (let x = -30; x <= 30; x += 4.4) {
        const w = 3.6;
        const h = 2.6 + R() * 2.2;
        const g = house(x, -5, pastel[Math.floor(R() * pastel.length)], ["#5b6c9b", "#c0663a", "#3f8f6b", "#8a4f8f"][Math.floor(R() * 4)], w, h, 2.6);
        if (R() > 0.4) {
          const aw = M(geo("awning", () => new THREE.BoxGeometry(2.6, 0.08, 0.9)), ["#e94f37", "#3b8ed6", "#f2a93b"][Math.floor(R() * 3)]);
          aw.position.set(0, 1.55, 1.6);
          aw.rotation.x = 0.35;
          g.add(aw);
        }
      }
      for (let x = -27; x <= 27; x += 7) lamp(x, -2.2);
      // Bunting between the lamps.
      for (let x = -27; x < 27; x += 7) {
        for (let k = 1; k < 7; k++) {
          const flag = M(geo("flag", () => new THREE.ConeGeometry(0.13, 0.3, 3)), ["#e94f37", "#ffd34d", "#3b8ed6", "#4caf50"][k % 4], { shadow: false });
          flag.rotation.x = Math.PI;
          const sag = Math.sin((k / 7) * Math.PI) * 0.5;
          put(flag, x + k, 2.75 - sag, -2.2);
        }
      }
      bench(-4, -3);
      bench(9, -3);
      for (let x = -32; x <= 32; x += 6) {
        const b = M(geo("tower", () => new THREE.BoxGeometry(4, 1, 4)), shade(pastel[Math.floor(R() * pastel.length)], -0.15).getStyle(), { shadow: false });
        const hh = 6 + R() * 6;
        b.scale.y = hh;
        put(b, x, hh / 2, -16 - R() * 4);
        b.scale.y = hh;
      }
      for (let i = 0; i < 5; i++) cloud(-40 + i * 18, 14 + R() * 5, -45, 2.2);
      birds(5);
      break;
    }
    case "park": {
      for (let i = 0; i < 26; i++) roundTree(-30 + i * 2.4 + R() * 1.5, -3.5 - R() * 14, 0.8 + R() * 0.6);
      const pond = M(geo("pond", () => new THREE.CircleGeometry(3.2, 32)), "#4aa7d8", { shadow: false, receive: true });
      pond.rotation.x = -Math.PI / 2;
      pond.scale.set(1.4, 1, 1);
      put(pond, 7, 0.012, -5.5);
      for (let i = 0; i < 2; i++) {
        const duck = M(geo("duck", () => new THREE.SphereGeometry(0.16, 10, 8)), "#fff4c2");
        put(duck, 6 + i, 0.1, -5 - i * 0.6);
        updaters.push((t) => (duck.position.x = 6 + i + Math.sin(t * 0.5 + i) * 1.2));
      }
      bench(-3, -2.4);
      lamp(-8, -2.2);
      lamp(12, -2.2);
      flowers(-6, -2.2, 12);
      flowers(3, -2.3, 9);
      bush(1, -2.8, 0.9);
      hills("#82c96e");
      for (let i = 0; i < 6; i++) cloud(-40 + i * 15, 12 + R() * 6, -40, 2);
      birds(4);
      // Butterflies.
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Group();
        const wgeo = geo("bwing", () => new THREE.CircleGeometry(0.07, 8));
        const l = M(wgeo, ["#ffb3d9", "#ffe066", "#a0e7ff"][i], { shadow: false, side: THREE.DoubleSide });
        const rr = M(wgeo, ["#ffb3d9", "#ffe066", "#a0e7ff"][i], { shadow: false, side: THREE.DoubleSide });
        l.position.x = 0.06;
        rr.position.x = -0.06;
        b.add(l, rr);
        scene.add(b);
        updaters.push((t) => {
          b.position.set(Math.sin(t * 0.4 + i * 2) * 4 + i * 3 - 3, 0.9 + Math.sin(t * 1.3 + i) * 0.3, -1.6 - i * 0.4);
          l.rotation.y = Math.sin(t * 18 + i) * 1.1;
          rr.rotation.y = -Math.sin(t * 18 + i) * 1.1;
        });
      }
      break;
    }
    case "forest": {
      for (let i = 0; i < 70; i++) pine(-34 + R() * 68, -2.6 - R() * 22, 0.9 + R() * 0.9);
      for (let i = 0; i < 10; i++) pine(-30 + R() * 60, 4 + R() * 6, 1.1 + R() * 0.5);
      for (let i = 0; i < 8; i++) {
        const g = new THREE.Group();
        const stem = M(geo("mstem", () => new THREE.CylinderGeometry(0.05, 0.06, 0.2, 6)), "#f3ead6");
        stem.position.y = 0.1;
        const cap = M(geo("mcap", () => new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), "#e2453b");
        cap.position.y = 0.2;
        g.add(stem, cap);
        put(g, -12 + R() * 24, 0, -1.4 - R() * 1.2, 0.8 + R() * 0.6);
      }
      for (let i = 0; i < 6; i++) rock(-16 + R() * 32, -2 - R() * 3, 0.6 + R() * 0.6, "#7d8086");
      {
        const log = M(geo("log", () => new THREE.CylinderGeometry(0.22, 0.22, 2.2, 10)), "#7a5232");
        log.rotation.z = Math.PI / 2;
        put(log, -4, 0.22, -2.4, 1, 0.4);
      }
      for (let i = 0; i < 5; i++) cloud(-40 + i * 18, 16, -50, 2);
      birds(3);
      break;
    }
    case "hill": {
      const crest = M(geo("crest", () => new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2)), "#86c76a", { shadow: false, receive: true });
      crest.scale.set(40, 1.2, 14);
      put(crest, 0, -1.19, -6);
      crest.scale.set(40, 1.2, 14);
      roundTree(3.2, -1.8, 1.25);
      for (let i = 0; i < 40; i++) {
        const tuft = M(geo("tuft", () => new THREE.ConeGeometry(0.05, 0.3, 4)), "#5ea84a", { shadow: false });
        put(tuft, -15 + R() * 30, 0.12, -0.8 - R() * 2.5);
      }
      flowers(-3, -1.6, 10);
      // The far-away town they came from.
      for (let i = 0; i < 14; i++) {
        const h = M(geo("tiny", () => new THREE.BoxGeometry(1.2, 1, 1.2)), pastel[i % pastel.length], { shadow: false });
        put(h, -24 + i * 3.6, 0.5, -38 - R() * 6);
      }
      hills("#79bd60", -30);
      // A windmill turning on the next hill.
      {
        const g = new THREE.Group();
        const tower = M(geo("mill", () => new THREE.CylinderGeometry(0.5, 0.8, 5, 8)), "#f3ead6");
        tower.position.y = 2.5;
        const hub = new THREE.Group();
        hub.position.set(0, 4.8, 0.7);
        for (let k = 0; k < 4; k++) {
          const blade = M(geo("blade", () => new THREE.BoxGeometry(0.4, 2.6, 0.05)), "#ffffff");
          blade.position.y = 1.3;
          const arm = new THREE.Group();
          arm.rotation.z = (k / 4) * Math.PI * 2;
          arm.add(blade);
          hub.add(arm);
        }
        g.add(tower, hub);
        put(g, -14, 0, -26);
        updaters.push((t) => (hub.rotation.z = t * 0.7));
      }
      for (let i = 0; i < 8; i++) cloud(-50 + i * 14, 10 + R() * 8, -35 - R() * 20, 2.2 + R());
      birds(6);
      break;
    }
    case "beach": {
      const sea = M(geo("sea", () => new THREE.PlaneGeometry(400, 200)), time === "night" ? "#1d3f6b" : "#3aa3d4", { shadow: false, receive: true });
      sea.rotation.x = -Math.PI / 2;
      put(sea, 0, 0.02, -104);
      const foam = M(geo("foam", () => new THREE.PlaneGeometry(400, 0.5)), "#f4fbff", { shadow: false, emissive: 0.1 });
      foam.rotation.x = -Math.PI / 2;
      put(foam, 0, 0.03, -4.1);
      const wet = M(geo("wet", () => new THREE.PlaneGeometry(400, 1.6)), "#d8bf86", { shadow: false, receive: true });
      wet.rotation.x = -Math.PI / 2;
      put(wet, 0, 0.012, -3.2);
      updaters.push((t) => {
        foam.position.z = -4.1 + Math.sin(t * 0.9) * 0.35;
        sea.position.y = 0.02 + Math.sin(t * 0.7) * 0.01;
      });
      for (let i = 0; i < 6; i++) {
        const g = new THREE.Group();
        const n = 6;
        for (let k = 0; k < n; k++) {
          const seg = M(geo("palmseg", () => new THREE.CylinderGeometry(0.12, 0.15, 0.6, 7)), "#9c7444");
          seg.position.set(k * 0.06, 0.3 + k * 0.55, 0);
          seg.rotation.z = -k * 0.04;
          g.add(seg);
        }
        for (let k = 0; k < 6; k++) {
          const leaf = M(geo("leaf", () => new THREE.ConeGeometry(0.25, 1.8, 4)), "#3f9a4a");
          leaf.position.set(0.4, n * 0.55 + 0.1, 0);
          const arm = new THREE.Group();
          arm.position.set(0.3, n * 0.55, 0);
          leaf.position.set(0, 0, 0.8);
          leaf.rotation.x = Math.PI / 2 + 0.5;
          arm.rotation.y = (k / 6) * Math.PI * 2;
          arm.add(leaf);
          g.add(arm);
        }
        put(g, -26 + i * 9 + R() * 3, 0, -1.8 - R() * 1.5, 0.9 + R() * 0.3, R() * 6);
      }
      {
        const umb = new THREE.Group();
        const pole = M(geo("upole", () => new THREE.CylinderGeometry(0.03, 0.03, 2, 6)), "#ffffff");
        pole.position.y = 1;
        const top = M(geo("utop", () => new THREE.ConeGeometry(1.1, 0.5, 10)), "#e94f37");
        top.position.y = 2;
        umb.add(pole, top);
        put(umb, 4, 0, -1.6);
        const towel = M(geo("towel", () => new THREE.PlaneGeometry(0.8, 1.6)), "#ffd34d", { shadow: false, receive: true });
        towel.rotation.x = -Math.PI / 2;
        put(towel, 4.6, 0.015, -1.3);
        const castle = M(geo("castle", () => new THREE.CylinderGeometry(0.25, 0.32, 0.4, 8)), "#e2c48a");
        put(castle, -3, 0.2, -1.8);
      }
      {
        const boat = new THREE.Group();
        const hull = M(geo("hull", () => new THREE.BoxGeometry(2.5, 0.5, 0.9)), "#ffffff");
        const sail = M(geo("sail", () => new THREE.ConeGeometry(0.9, 2.4, 3)), "#e94f37");
        sail.position.y = 1.5;
        boat.add(hull, sail);
        put(boat, 10, 0.25, -30);
        updaters.push((t) => {
          boat.position.x = 10 + Math.sin(t * 0.1) * 6;
          boat.rotation.z = Math.sin(t * 1.1) * 0.05;
        });
      }
      for (let i = 0; i < 6; i++) cloud(-40 + i * 16, 12 + R() * 6, -60, 2.4);
      birds(5);
      break;
    }
    case "snow": {
      for (let i = 0; i < 40; i++) pine(-34 + R() * 68, -3 - R() * 20, 0.9 + R() * 0.8, true);
      {
        const sm = new THREE.Group();
        for (const [y, rr] of [[0.45, 0.5], [1.15, 0.36], [1.65, 0.25]] as const) {
          const b = M(geo(`snowball-${rr}`, () => new THREE.SphereGeometry(rr, 18, 14)), "#ffffff");
          b.position.y = y;
          sm.add(b);
        }
        const nose = M(geo("carrot", () => new THREE.ConeGeometry(0.05, 0.25, 8)), "#ff8c2e");
        nose.rotation.x = Math.PI / 2;
        nose.position.set(0, 1.65, 0.33);
        const scarf = M(geo("smscarf", () => new THREE.TorusGeometry(0.28, 0.07, 8, 16)), "#e94f37");
        scarf.rotation.x = Math.PI / 2;
        scarf.position.y = 1.42;
        sm.add(nose, scarf);
        put(sm, -4, 0, -2.6, 1, 0.3);
      }
      for (let i = 0; i < 8; i++) rock(-18 + R() * 36, -2 - R() * 4, 0.5 + R() * 0.5, "#e4ecf4");
      hills("#e9eff7");
      // Falling snow.
      {
        const n = 900;
        const base = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) base.set([(R() - 0.5) * 40, R() * 12, -12 + R() * 18], i * 3);
        const pos = new Float32Array(base);
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geos.set("snowfall", g);
        const m = new THREE.PointsMaterial({ color: "#ffffff", size: 0.06, transparent: true, opacity: 0.9 });
        extra.push(m);
        scene.add(new THREE.Points(g, m));
        updaters.push((t) => {
          for (let i = 0; i < n; i++) {
            pos[i * 3 + 1] = (((base[i * 3 + 1] - t * 0.8) % 12) + 12) % 12;
            pos[i * 3] = base[i * 3] + Math.sin(t * 0.7 + i) * 0.3;
          }
          (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        });
      }
      for (let i = 0; i < 5; i++) cloud(-40 + i * 18, 14, -45, 2.5);
      break;
    }
    case "space": {
      stars(1400);
      for (let i = 0; i < 18; i++) {
        const c = M(geo("crater", () => new THREE.TorusGeometry(1, 0.18, 6, 24)), "#85838f", { receive: true });
        c.rotation.x = -Math.PI / 2;
        const s = 0.4 + R() * 1.4;
        put(c, -25 + R() * 50, 0.02, -2 - R() * 22, s);
        c.rotation.x = -Math.PI / 2;
      }
      for (let i = 0; i < 10; i++) rock(-20 + R() * 40, -2 - R() * 10, 0.5 + R() * 0.8, "#7c7a88");
      {
        const planet = M(geo("planet", () => new THREE.SphereGeometry(14, 32, 20)), "#ff9f6b", { shadow: false, emissive: 0.25 });
        put(planet, -40, 34, -120);
        const ring = M(geo("pring", () => new THREE.TorusGeometry(22, 1.4, 4, 48)), "#ffd9a8", { shadow: false, emissive: 0.3 });
        ring.rotation.x = 1.25;
        ring.rotation.y = 0.3;
        put(ring, -40, 34, -120);
        ring.rotation.x = 1.25;
        const earth = M(geo("earth", () => new THREE.SphereGeometry(6, 24, 16)), "#4aa7f0", { shadow: false, emissive: 0.35 });
        put(earth, 50, 22, -110);
      }
      {
        const ship = new THREE.Group();
        const hull = M(geo("shiphull", () => new THREE.CylinderGeometry(0.9, 1.1, 4, 16)), "#f3f4f6");
        hull.position.y = 2.6;
        const nose = M(geo("shipnose", () => new THREE.ConeGeometry(0.9, 1.6, 16)), "#e94f37");
        nose.position.y = 5.4;
        ship.add(hull, nose);
        for (let k = 0; k < 3; k++) {
          const fin = M(geo("shipfin", () => new THREE.BoxGeometry(0.12, 1.4, 1.1)), "#e94f37");
          const a = (k / 3) * Math.PI * 2;
          fin.position.set(Math.sin(a) * 1.05, 0.9, Math.cos(a) * 1.05);
          fin.rotation.y = a;
          ship.add(fin);
        }
        put(ship, -9, 0, -7, 1, 0.4);
      }
      {
        const flag = new THREE.Group();
        const pole = M(geo("fpole", () => new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6)), "#d8d8e0");
        pole.position.y = 0.8;
        const cloth = M(geo("fcloth", () => new THREE.PlaneGeometry(0.7, 0.45)), "#3b8ed6", { side: THREE.DoubleSide });
        cloth.position.set(0.37, 1.35, 0);
        flag.add(pole, cloth);
        put(flag, 4, 0, -2.4);
      }
      break;
    }
    case "city": {
      const winTex = (() => {
        if (typeof document === "undefined") return null;
        const c = document.createElement("canvas");
        c.width = 64;
        c.height = 128;
        const g = c.getContext("2d")!;
        g.fillStyle = night ? "#1b2236" : "#7d8aa3";
        g.fillRect(0, 0, 64, 128);
        for (let y = 6; y < 128; y += 14) {
          for (let x = 6; x < 64; x += 14) {
            const lit = r(x * 31 + y) > (night ? 0.35 : 0.0);
            g.fillStyle = night ? (lit ? "#ffd98a" : "#2a3350") : "#bcd9f2";
            g.fillRect(x, y, 8, 9);
          }
        }
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        return t;
      })();
      for (let x = -36; x <= 36; x += 5.2) {
        const h = 7 + R() * 16;
        const w = 4.2;
        const mat = new THREE.MeshStandardMaterial({
          color: night ? "#ffffff" : shade(pastel[Math.floor(R() * pastel.length)], -0.1),
          map: winTex,
          emissive: night ? new THREE.Color("#ffffff") : new THREE.Color("#000000"),
          emissiveMap: night ? winTex : null,
          emissiveIntensity: night ? 0.9 : 0,
          roughness: 0.7,
        });
        if (winTex) {
          mat.map = winTex.clone();
          mat.map.repeat.set(1, h / 6);
          mat.map.needsUpdate = true;
          if (night) mat.emissiveMap = mat.map;
          extra.push(mat.map);
        }
        extra.push(mat);
        const b = new THREE.Mesh(geo("bld", () => new THREE.BoxGeometry(1, 1, 1)), mat);
        b.castShadow = true;
        b.scale.set(w, h, 4);
        b.position.set(x, h / 2, -6.5 - R() * 3);
        scene.add(b);
      }
      for (let x = -28; x <= 28; x += 8) lamp(x, -2.4);
      for (let i = 0; i < 4; i++) {
        const car = new THREE.Group();
        const body = M(geo("car", () => new THREE.BoxGeometry(1.8, 0.5, 0.9)), ["#e94f37", "#3b8ed6", "#ffd34d", "#4caf50"][i]);
        body.position.y = 0.4;
        const cab = M(geo("cab", () => new THREE.BoxGeometry(1.0, 0.4, 0.8)), "#cfe3f5");
        cab.position.set(-0.1, 0.8, 0);
        car.add(body, cab);
        put(car, -18 + i * 11, 0, -1.9);
      }
      {
        const sign = M(geo("sign", () => new THREE.BoxGeometry(3.4, 1.2, 0.1)), look === "neon" ? "#ff3cac" : "#ff6b8b", { emissive: night ? 2.0 : 0.2, shadow: false });
        put(sign, 6, 5.5, -4.3);
      }
      if (night) stars(400);
      for (let i = 0; i < 4; i++) cloud(-40 + i * 20, 22, -60, 2.5);
      break;
    }
    case "desert": {
      for (let i = 0; i < 12; i++) {
        const dune = M(geo("dune", () => new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2)), shade("#e8c27e", -R() * 0.12).getStyle(), { receive: true });
        put(dune, -40 + i * 7 + R() * 4, 0, -10 - R() * 25);
        dune.scale.set(5 + R() * 6, 1.4 + R() * 2, 4 + R() * 3);
      }
      for (let i = 0; i < 9; i++) {
        const g = new THREE.Group();
        const trunk = M(geo("cactus", () => new THREE.CapsuleGeometry(0.22, 1.6, 4, 10)), "#4f9a52");
        trunk.position.y = 1.0;
        g.add(trunk);
        for (const s of [-1, 1]) {
          const arm = M(geo("carm", () => new THREE.CapsuleGeometry(0.13, 0.55, 4, 8)), "#4f9a52");
          arm.position.set(s * 0.38, 1.2 + s * 0.15, 0);
          g.add(arm);
        }
        put(g, -24 + R() * 48, 0, -2.4 - R() * 10, 0.7 + R() * 0.5);
      }
      for (let i = 0; i < 4; i++) {
        const mesa = M(geo("mesa", () => new THREE.CylinderGeometry(5, 6.5, 7, 9)), "#c9764a", { shadow: false });
        put(mesa, -50 + i * 32, 3.5, -55 - R() * 10, 0.8 + R() * 0.6);
      }
      for (let i = 0; i < 8; i++) rock(-20 + R() * 40, -1.8 - R() * 5, 0.4 + R() * 0.6, "#b98a5e");
      birds(2);
      break;
    }
    case "bedroom": {
      const wall = time === "night" ? "#6f7fa3" : "#bcd7f0";
      const back = M(geo("wallb", () => new THREE.BoxGeometry(24, 4.2, 0.2)), wall, { shadow: false, receive: true });
      put(back, 0, 2.1, -3.2);
      const side = M(geo("walls", () => new THREE.BoxGeometry(0.2, 4.2, 12)), shade(wall, -0.08).getStyle(), { shadow: false, receive: true });
      put(side, -11, 2.1, 1);
      put(side.clone(), 11, 2.1, 1);
      {
        const frame = M(geo("wframe", () => new THREE.BoxGeometry(2.2, 1.6, 0.14)), "#ffffff");
        put(frame, 3.5, 2.4, -3.08);
        const pane = M(geo("wpane", () => new THREE.PlaneGeometry(1.9, 1.3)), time === "night" ? "#1b2a58" : time === "sunset" ? "#ff9a5c" : "#8fd0ff", { emissive: 0.9, shadow: false });
        put(pane, 3.5, 2.4, -3.0);
        const moon = M(geo("wmoon", () => new THREE.CircleGeometry(0.22, 16)), time === "night" ? "#fff7d6" : "#fff3c4", { emissive: 1.2, shadow: false });
        put(moon, 3.9, 2.65, -2.98);
      }
      {
        const bed = new THREE.Group();
        const base = M(geo("bedb", () => new THREE.BoxGeometry(2.2, 0.5, 3.4)), "#8a5a3c");
        base.position.y = 0.25;
        const mattress = M(geo("bedm", () => new THREE.BoxGeometry(2.1, 0.25, 3.3)), "#ffffff");
        mattress.position.y = 0.62;
        const blanket = M(geo("bedc", () => new THREE.BoxGeometry(2.15, 0.12, 2.2)), "#ff8fa3");
        blanket.position.set(0, 0.78, 0.5);
        const pillow = M(geo("bedp", () => new THREE.BoxGeometry(1.2, 0.2, 0.55)), "#fff4d6");
        pillow.position.set(0, 0.85, -1.2);
        const head = M(geo("bedh", () => new THREE.BoxGeometry(2.3, 1.3, 0.12)), "#8a5a3c");
        head.position.set(0, 0.8, -1.7);
        bed.add(base, mattress, blanket, pillow, head);
        put(bed, -5, 0, -1.3);
      }
      {
        const rug = M(geo("rug", () => new THREE.CircleGeometry(2.2, 32)), "#ffd34d", { shadow: false, receive: true });
        rug.rotation.x = -Math.PI / 2;
        put(rug, 0, 0.01, 0.2);
        rug.rotation.x = -Math.PI / 2;
      }
      {
        const shelf = M(geo("shelf", () => new THREE.BoxGeometry(2.4, 0.1, 0.5)), "#ffffff");
        put(shelf, -1.5, 1.9, -2.9);
        const cols = ["#e94f37", "#3b8ed6", "#ffd34d", "#4caf50"];
        for (let i = 0; i < 4; i++) {
          const blk = M(geo("blk", () => new THREE.BoxGeometry(0.3, 0.3, 0.3)), cols[i]);
          put(blk, -2.4 + i * 0.6, 2.1, -2.9, 1, i * 0.4);
        }
      }
      {
        const lampG = new THREE.Group();
        const stand = M(geo("lstand", () => new THREE.CylinderGeometry(0.05, 0.2, 1.2, 10)), "#ffffff");
        stand.position.y = 0.6;
        const shadeM = M(geo("lshade", () => new THREE.CylinderGeometry(0.25, 0.4, 0.4, 14, 1, true)), "#ffe2a0", { emissive: time === "night" ? 1.4 : 0.2, side: THREE.DoubleSide });
        shadeM.position.y = 1.35;
        lampG.add(stand, shadeM);
        if (time === "night" || time === "sunset") {
          const pl = new THREE.PointLight("#ffcf80", 3, 8, 1.4);
          pl.position.y = 1.4;
          lampG.add(pl);
        }
        put(lampG, 7, 0, -2.4);
      }
      for (let i = 0; i < 3; i++) {
        const poster = M(geo("poster", () => new THREE.PlaneGeometry(0.9, 1.2)), ["#ff9f43", "#b38cff", "#4fd1c5"][i], { shadow: false });
        put(poster, -9 + i * 1.3, 2.6, -3.08);
      }
      // Toys on the floor.
      for (let i = 0; i < 6; i++) {
        const toy = M(geo("toy", () => new THREE.BoxGeometry(0.22, 0.22, 0.22)), ["#e94f37", "#3b8ed6", "#ffd34d", "#4caf50", "#ff8fa3", "#b38cff"][i]);
        put(toy, -8 + R() * 16, 0.11, -2.2 + R() * 0.8, 1, R() * 3);
      }
      break;
    }
  }

  return {
    key: `${world}:${time}`,
    scene,
    sun,
    exposure: L.exposure,
    update: (t, focusX) => {
      sun.position.set(L.sunPos[0] + focusX, L.sunPos[1], L.sunPos[2]);
      sun.target.position.set(focusX, 0, 0);
      for (const u of updaters) u(t);
    },
    dispose: () => {
      for (const g of geos.values()) g.dispose();
      for (const e of extra) e.dispose();
      sun.shadow.map?.dispose();
    },
  };
}
