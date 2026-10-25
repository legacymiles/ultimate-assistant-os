// ---------------------------------------------------------------------------
// The thing he wants — kite, balloon, puppy… — built from primitives.
// Each prop has its own idle life (the kite's tail ripples, the puppy's tail
// wags, the star glows), driven by time so it stays deterministic.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import type { Prop } from "./plan";
import type { Materials } from "./hero";
import type { PropMode } from "./director";

export interface PropRig {
  kind: Prop;
  obj: THREE.Group;
  /** Floating props get a string to the hand when held. */
  tethered: boolean;
  /** Ground props run/roll along with him. */
  grounded: boolean;
  update: (t: number, mode: PropMode, moving: boolean) => void;
  dispose: () => void;
}

export function buildProp(kind: Prop, mats: Materials, accent: string): PropRig | null {
  if (kind === "none") return null;
  const geos: THREE.BufferGeometry[] = [];
  const G = <T extends THREE.BufferGeometry>(g: T): T => {
    geos.push(g);
    return g;
  };
  const m = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const x = new THREE.Mesh(G(geo), mat);
    x.castShadow = true;
    return x;
  };
  const obj = new THREE.Group();
  obj.name = `prop-${kind}`;
  let update: PropRig["update"] = () => {};
  let tethered = false;
  let grounded = false;

  switch (kind) {
    case "kite": {
      tethered = true;
      const sail = new THREE.Group();
      const shape = (a: THREE.Vector2[]) => new THREE.ShapeGeometry(new THREE.Shape(a));
      const top = m(shape([new THREE.Vector2(0, 0.5), new THREE.Vector2(0.32, 0.08), new THREE.Vector2(-0.32, 0.08)]), mats.get(accent, { side: THREE.DoubleSide, key: "kite" }));
      const bot = m(shape([new THREE.Vector2(0.32, 0.08), new THREE.Vector2(0, -0.55), new THREE.Vector2(-0.32, 0.08)]), mats.get("#ffd34d", { side: THREE.DoubleSide, key: "kite" }));
      sail.add(top, bot);
      const spar = m(new THREE.CylinderGeometry(0.008, 0.008, 1.05, 4), mats.get("#6b4a2b"));
      sail.add(spar);
      obj.add(sail);
      const bows: THREE.Object3D[] = [];
      for (let i = 0; i < 5; i++) {
        const bow = m(new THREE.ConeGeometry(0.05, 0.1, 4), mats.get(i % 2 ? "#ffffff" : accent));
        bow.rotation.z = Math.PI / 2;
        obj.add(bow);
        bows.push(bow);
      }
      update = (t) => {
        sail.rotation.z = Math.sin(t * 1.7) * 0.18;
        sail.rotation.x = -0.25 + Math.sin(t * 1.1) * 0.08;
        bows.forEach((b, i) => {
          b.position.set(Math.sin(t * 3 + i * 0.9) * 0.08 * (i + 1) * 0.5, -0.62 - i * 0.16, 0);
        });
      };
      break;
    }
    case "balloon": {
      tethered = true;
      const ball = m(new THREE.SphereGeometry(0.28, 24, 18), mats.get(accent, { key: "balloon" }));
      ball.scale.set(1, 1.18, 1);
      obj.add(ball);
      const knot = m(new THREE.ConeGeometry(0.04, 0.06, 8), mats.get(accent));
      knot.position.y = -0.34;
      knot.rotation.x = Math.PI;
      obj.add(knot);
      update = (t) => {
        obj.rotation.z = Math.sin(t * 1.3) * 0.12;
      };
      break;
    }
    case "ball": {
      grounded = true;
      const ball = m(new THREE.SphereGeometry(0.16, 20, 14), mats.get("#ffffff"));
      const band = m(new THREE.TorusGeometry(0.16, 0.035, 8, 24), mats.get(accent));
      ball.add(band);
      ball.position.y = 0.16;
      obj.add(ball);
      update = (t, _mode, moving) => {
        ball.rotation.z = moving ? -t * 9 : Math.sin(t) * 0.2;
        ball.position.y = 0.16 + (moving ? Math.abs(Math.sin(t * 6)) * 0.08 : 0);
      };
      break;
    }
    case "puppy": {
      grounded = true;
      const fur = mats.get("#d9a066");
      const dark = mats.get("#7a4a25");
      const dog = new THREE.Group();
      const body = m(new THREE.CapsuleGeometry(0.11, 0.22, 4, 12), fur);
      body.rotation.z = Math.PI / 2;
      body.position.y = 0.24;
      dog.add(body);
      const head = m(new THREE.SphereGeometry(0.12, 16, 12), fur);
      head.position.set(0.2, 0.36, 0);
      dog.add(head);
      const snout = m(new THREE.SphereGeometry(0.06, 10, 8), mats.get("#f1d2a8"));
      snout.position.set(0.3, 0.33, 0);
      dog.add(snout);
      const nose = m(new THREE.SphereGeometry(0.022, 8, 6), mats.get("#1b1210"));
      nose.position.set(0.355, 0.35, 0);
      dog.add(nose);
      for (const s of [-1, 1]) {
        const ear = m(new THREE.SphereGeometry(0.05, 8, 6), dark);
        ear.scale.set(0.6, 1.4, 0.6);
        ear.position.set(0.17, 0.42, s * 0.09);
        dog.add(ear);
        const eye = m(new THREE.SphereGeometry(0.018, 8, 6), mats.get("#1b1210"));
        eye.position.set(0.29, 0.4, s * 0.05);
        dog.add(eye);
      }
      const collar = m(new THREE.TorusGeometry(0.075, 0.016, 6, 16), mats.get(accent));
      collar.position.set(0.14, 0.3, 0);
      collar.rotation.y = Math.PI / 2;
      dog.add(collar);
      const tail = m(new THREE.CapsuleGeometry(0.02, 0.12, 3, 6), dark);
      tail.position.set(-0.22, 0.34, 0);
      dog.add(tail);
      const legs: THREE.Object3D[] = [];
      for (const [x, z] of [[0.12, 0.06], [0.12, -0.06], [-0.12, 0.06], [-0.12, -0.06]]) {
        const leg = m(new THREE.CapsuleGeometry(0.03, 0.12, 3, 6), fur);
        leg.position.set(x, 0.1, z);
        dog.add(leg);
        legs.push(leg);
      }
      obj.add(dog);
      update = (t, _mode, moving) => {
        tail.rotation.z = 0.8 + Math.sin(t * 16) * 0.5;
        legs.forEach((l, i) => (l.rotation.z = moving ? Math.sin(t * 14 + (i % 2 ? Math.PI : 0) + (i > 1 ? 1 : 0)) * 0.6 : 0));
        dog.position.y = moving ? Math.abs(Math.sin(t * 14)) * 0.04 : 0;
        head.rotation.z = Math.sin(t * 2) * 0.1;
      };
      break;
    }
    case "star": {
      tethered = false;
      const shape = new THREE.Shape();
      for (let i = 0; i <= 10; i++) {
        const r = i % 2 ? 0.12 : 0.28;
        const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
        if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      const star = m(new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 }), mats.get("#ffd84a", { emissive: 0.9, key: "star" }));
      star.geometry.center();
      obj.add(star);
      const light = new THREE.PointLight("#ffd84a", 1.2, 3, 2);
      obj.add(light);
      update = (t) => {
        star.rotation.y = t * 1.6;
        star.scale.setScalar(1 + Math.sin(t * 4) * 0.06);
      };
      break;
    }
    case "gift": {
      const box = m(new THREE.BoxGeometry(0.26, 0.22, 0.26), mats.get(accent));
      box.position.y = 0.11;
      obj.add(box);
      const rib = mats.get("#ffd34d");
      const r1 = m(new THREE.BoxGeometry(0.27, 0.23, 0.05), rib);
      r1.position.y = 0.11;
      const r2 = m(new THREE.BoxGeometry(0.05, 0.23, 0.27), rib);
      r2.position.y = 0.11;
      obj.add(r1, r2);
      for (const s of [-1, 1]) {
        const loop = m(new THREE.TorusGeometry(0.05, 0.015, 6, 12), rib);
        loop.position.set(s * 0.05, 0.25, 0);
        loop.rotation.y = s * 0.6;
        obj.add(loop);
      }
      update = (t) => {
        obj.rotation.y = Math.sin(t * 0.8) * 0.3;
      };
      break;
    }
    case "book": {
      const cover = m(new THREE.BoxGeometry(0.22, 0.04, 0.3), mats.get(accent));
      const pages = m(new THREE.BoxGeometry(0.2, 0.035, 0.28), mats.get("#fff7e6"));
      pages.position.x = 0.01;
      obj.add(cover, pages);
      obj.rotation.x = -0.6;
      update = (t) => {
        obj.rotation.z = Math.sin(t) * 0.1;
      };
      break;
    }
    case "robot": {
      grounded = true;
      const metal = mats.get("#c9d3df");
      const bot = new THREE.Group();
      const body = m(new THREE.BoxGeometry(0.24, 0.26, 0.2), metal);
      body.position.y = 0.26;
      const head = m(new THREE.BoxGeometry(0.22, 0.17, 0.18), metal);
      head.position.y = 0.48;
      const visor = m(new THREE.BoxGeometry(0.17, 0.07, 0.02), mats.get("#24324a"));
      visor.position.set(0, 0.49, 0.095);
      const eyes: THREE.Mesh[] = [];
      for (const s of [-1, 1]) {
        const e = m(new THREE.SphereGeometry(0.018, 8, 6), mats.get("#5ef0ff", { emissive: 1.2, key: "robot-eye" }));
        e.position.set(s * 0.04, 0.49, 0.105);
        eyes.push(e);
        bot.add(e);
      }
      const ant = m(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 4), metal);
      ant.position.y = 0.61;
      const bulb = m(new THREE.SphereGeometry(0.025, 8, 6), mats.get(accent, { emissive: 0.8 }));
      bulb.position.y = 0.67;
      const wheel = m(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 14), mats.get("#4a5568"));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.y = 0.08;
      bot.add(body, head, visor, ant, bulb, wheel);
      obj.add(bot);
      update = (t, _mode, moving) => {
        head.rotation.y = Math.sin(t * 1.3) * 0.4;
        bot.position.y = Math.sin(t * 5) * 0.01;
        wheel.rotation.y = moving ? t * 10 : 0;
        eyes.forEach((e) => e.scale.setScalar(Math.sin(t * 2.7) > 0.95 ? 0.2 : 1));
      };
      break;
    }
    case "rocket": {
      tethered = false;
      const hull = m(new THREE.CylinderGeometry(0.1, 0.12, 0.42, 16), mats.get("#f3f4f6"));
      const nose = m(new THREE.ConeGeometry(0.1, 0.2, 16), mats.get(accent));
      nose.position.y = 0.31;
      const win = m(new THREE.SphereGeometry(0.045, 10, 8), mats.get("#5ec8ff", { emissive: 0.4 }));
      win.position.set(0, 0.06, 0.1);
      obj.add(hull, nose, win);
      for (let i = 0; i < 3; i++) {
        const fin = m(new THREE.BoxGeometry(0.02, 0.14, 0.12), mats.get(accent));
        const a = (i / 3) * Math.PI * 2;
        fin.position.set(Math.sin(a) * 0.12, -0.16, Math.cos(a) * 0.12);
        fin.rotation.y = a;
        obj.add(fin);
      }
      const flame = m(new THREE.ConeGeometry(0.07, 0.22, 10), mats.get("#ff9a3c", { emissive: 1.4, key: "flame" }));
      flame.position.y = -0.33;
      flame.rotation.x = Math.PI;
      obj.add(flame);
      update = (t, mode) => {
        flame.visible = mode === "leaving" || mode === "ahead";
        flame.scale.set(1, 0.8 + Math.sin(t * 40) * 0.25, 1);
        obj.rotation.z = Math.sin(t * 1.4) * 0.1;
      };
      break;
    }
    case "flower": {
      const stem = m(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 5), mats.get("#3f9a4a"));
      stem.position.y = 0.15;
      obj.add(stem);
      const center = m(new THREE.SphereGeometry(0.045, 10, 8), mats.get("#ffd34d"));
      center.position.y = 0.32;
      obj.add(center);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const pet = m(new THREE.SphereGeometry(0.05, 8, 6), mats.get(accent));
        pet.scale.set(1, 0.5, 1);
        pet.position.set(Math.cos(a) * 0.075, 0.32, Math.sin(a) * 0.075);
        obj.add(pet);
      }
      update = (t) => {
        obj.rotation.z = Math.sin(t * 1.5) * 0.08;
      };
      break;
    }
  }

  return {
    kind,
    obj,
    tethered,
    grounded,
    update,
    dispose: () => geos.forEach((g) => g.dispose()),
  };
}
