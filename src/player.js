// Fina, das Seepferdchen: Steuerung, Schwimmphysik und Verfolgerkamera.
import * as THREE from 'three';
import { WORLD, groundHeight } from './config.js';
import { makeObject, patchUnderwater } from './world.js';

const TURN = 1.9;        // rad/s
const ACCEL = 16;
const MAX_SPEED = 6.2;
const RISE = 3.6;
const HOVER = 1.9;       // Schwebehoehe ueber dem Sand, wenn nichts gedrueckt ist
const PROFILE = 0.5;     // Fina ist leicht zur Kamera gedreht
const CAM_SIDE = -0.38;  // Kamera sitzt schraeg hinter ihr
const CAM_DIST = 6.4;
const SHAKE_TIME = 0.4;  // nach einem Zusammenstoss: so lange zittern ...
const FLIGHT_TIME = 1.0; // ... und so lange wegspicken
const LAUNCH_SPEED = 16;

export class Player {
  constructor(scene, models, camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(WORLD.start.x, groundHeight(WORLD.start.x, WORLD.start.z) + HOVER, WORLD.start.z);
    this.vel = new THREE.Vector3();
    this.heading = WORLD.start.heading;
    this.turnVel = 0;
    this.camHeading = this.heading;
    this.frozen = true;
    this.keys = new Set();
    this.atEdge = false;
    this.moved = 0;
    this.stun = null;       // laeuft, solange Fina nach einem Zusammenstoss zittert und wegspickt

    // Rohmodell: aufrecht entlang Y, Blick entlang +X. Schwanz (unten) schlaengelt mit.
    const material = patchUnderwater(models.seepferd.material, {
      caustics: 0.5,
      key: 'seepferd',
      vertex: `
        float sw = clamp(0.45 - position.y, 0.0, 1.0);
        transformed.z += sin(uTime * 4.5 + position.y * 5.0) * 0.045 * sw * sw;`,
    });
    material.color.setScalar(1.35);       // Tripo liefert die Textur etwas dunkel
    material.emissive.setScalar(1);
    material.emissiveMap = material.map;  // leichtes Eigenleuchten, damit sie nie im Schatten versinkt
    material.emissiveIntensity = 0.22;
    this.body = makeObject(models.seepferd, { size: 1.9, by: 'height', anchor: 'center' }, material);
    this.tilt = new THREE.Group();        // Vorlage/Schraeglage getrennt von der Drehung ins Profil
    this.tilt.add(this.body);
    this.root = new THREE.Group();
    this.root.add(this.tilt);
    scene.add(this.root);

    // sanftes Eigenlicht, damit Fina auch im Schatten gut zu sehen ist
    const glow = new THREE.PointLight(0xffe2b0, 5, 7, 1.6);
    glow.position.set(0, 0.6, 0);
    this.root.add(glow);

    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.snapCamera();
  }

  get forward() { return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)); }

  get flying() { return Boolean(this.stun?.launched); }

  // Zusammenstoss: erst kurz auf der Stelle zittern, dann in Richtung `dir` wegspicken.
  knock(dir, onLaunch) {
    if (this.stun) return;
    this.stun = { t: 0, dir: dir.clone(), launched: false, onLaunch };
    this.vel.set(0, 0, 0);
  }

  #down(...codes) { return codes.some((c) => this.keys.has(c)); }

  update(dt, t, colliders) {
    this.colliders = colliders;
    const stun = this.stun;
    if (stun) {
      stun.t += dt;
      if (!stun.launched && stun.t >= SHAKE_TIME) {
        stun.launched = true;
        this.vel.copy(stun.dir).multiplyScalar(LAUNCH_SPEED);
        this.vel.y = 3.2;
        stun.onLaunch?.();
      }
      if (stun.t > SHAKE_TIME + FLIGHT_TIME) this.stun = null;
    }
    const k = this.frozen || stun ? { turn: 0, thrust: 0, up: false } : {
      turn: (this.#down('ArrowLeft', 'KeyA') ? 1 : 0) - (this.#down('ArrowRight', 'KeyD') ? 1 : 0),
      thrust: (this.#down('ArrowUp', 'KeyW') ? 1 : 0) - (this.#down('ArrowDown', 'KeyS') ? 0.5 : 0),
      up: this.#down('Space'),
    };

    this.turnVel += (k.turn * TURN - this.turnVel) * Math.min(1, dt * 7);
    this.heading += this.turnVel * dt;

    const f = this.forward;
    this.vel.x += f.x * k.thrust * ACCEL * dt;
    this.vel.z += f.z * k.thrust * ACCEL * dt;
    const drag = Math.exp(-dt * 2.2);
    this.vel.x *= drag;
    this.vel.z *= drag;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > MAX_SPEED && !stun) { this.vel.x *= MAX_SPEED / sp; this.vel.z *= MAX_SPEED / sp; }
    if (stun && !stun.launched) this.vel.set(0, 0, 0);

    // hoch mit der Leertaste, sonst sanft zurueck auf Schwebehoehe sinken
    const floor = groundHeight(this.pos.x, this.pos.z);
    const targetVy = k.up ? RISE : (this.pos.y > floor + HOVER + 0.15 ? -1.3 : 0);
    if (!stun?.launched || stun.t > SHAKE_TIME + 0.4) this.vel.y += (targetVy - this.vel.y) * Math.min(1, dt * 3);

    // Rand der Welt: eine sanfte Stroemung schiebt zurueck
    const r = Math.hypot(this.pos.x, this.pos.z);
    this.atEdge = r > WORLD.radius;
    if (this.atEdge) {
      const push = (r - WORLD.radius) * 3.5 * dt;
      this.vel.x -= (this.pos.x / r) * push * 4;
      this.vel.z -= (this.pos.z / r) * push * 4;
    }

    this.pos.addScaledVector(this.vel, dt);
    this.moved += sp * dt;

    // an Felsen und Saeulen abgleiten
    for (const c of colliders) {
      if (this.pos.y > c.top + 0.3) continue;
      const dx = this.pos.x - c.x;
      const dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + 0.55;
      if (d < min && d > 1e-4) {
        this.pos.x = c.x + (dx / d) * min;
        this.pos.z = c.z + (dz / d) * min;
      }
    }
    const floor2 = groundHeight(this.pos.x, this.pos.z) + 1.2;
    if (this.pos.y < floor2) { this.pos.y = floor2; this.vel.y = Math.max(0, this.vel.y); }
    if (this.pos.y > WORLD.ceiling) { this.pos.y = WORLD.ceiling; this.vel.y = Math.min(0, this.vel.y); }

    // Darstellung: Blickrichtung, Vorlage beim Schwimmen, Schraeglage in Kurven, Wippen
    this.root.position.copy(this.pos);
    this.root.position.y += Math.sin(t * 2.1) * 0.07;
    this.root.rotation.y = this.heading - Math.PI / 2;
    const fwdSpeed = this.vel.x * f.x + this.vel.z * f.z;
    this.tilt.rotation.z = THREE.MathUtils.lerp(this.tilt.rotation.z, -fwdSpeed * 0.05 + this.vel.y * 0.03, Math.min(1, dt * 5));
    this.tilt.rotation.x = THREE.MathUtils.lerp(this.tilt.rotation.x, -this.turnVel * 0.12, Math.min(1, dt * 5));
    // Fina zeigt der Kamera ihr Profil: von hinten waere sie nur ein schmaler Strich
    this.body.rotation.y = THREE.MathUtils.lerp(this.body.rotation.y, PROFILE + this.turnVel * 0.22, Math.min(1, dt * 4));

    if (stun && !stun.launched) {
      // zittern: schnelle kleine Ausschlaege in alle Richtungen
      this.root.position.x += Math.sin(t * 97) * 0.13;
      this.root.position.y += Math.sin(t * 113 + 1) * 0.1;
      this.root.position.z += Math.cos(t * 89) * 0.13;
      this.tilt.rotation.z += Math.sin(t * 71) * 0.28;
      this.tilt.rotation.y = 0;
    } else if (stun) {
      // wegspicken: dreht sich dabei zweimal um sich selbst, am Ende langsamer
      const u = Math.min(1, (stun.t - SHAKE_TIME) / FLIGHT_TIME);
      this.tilt.rotation.y = (1 - (1 - u) * (1 - u)) * Math.PI * 4;
    } else {
      this.tilt.rotation.y = 0;
    }

    this.#updateCamera(dt);
  }

  #cameraTarget(out) {
    const h = this.camHeading + CAM_SIDE;
    out.set(this.pos.x - Math.sin(h) * CAM_DIST, this.pos.y + 1.9, this.pos.z - Math.cos(h) * CAM_DIST);
    // Kamera nicht in Felsen oder Saeulen stecken lassen
    for (const c of this.colliders ?? []) {
      if (out.y > c.top + 0.5) continue;
      const dx = out.x - c.x;
      const dz = out.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + 1.0;
      if (d < min && d > 1e-4) { out.x = c.x + (dx / d) * min; out.z = c.z + (dz / d) * min; }
    }
    out.y = Math.max(out.y, groundHeight(out.x, out.z) + 1.0);
    return out;
  }

  #updateCamera(dt) {
    let d = this.heading - this.camHeading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.camHeading += d * Math.min(1, dt * 2.6);
    const target = this.#cameraTarget(new THREE.Vector3());
    this.camera.position.lerp(target, Math.min(1, dt * 4));
    this.#look();
  }

  #look() {
    const h = this.camHeading;
    this.camera.lookAt(this.pos.x + Math.sin(h) * 2.5, this.pos.y + 0.5, this.pos.z + Math.cos(h) * 2.5);
  }

  snapCamera() {
    this.camHeading = this.heading;
    this.#cameraTarget(this.camera.position);
    this.#look();
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading - Math.PI / 2;
  }
}
