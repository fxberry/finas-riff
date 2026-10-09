// Der Hai zieht gemuetlich seine Runden durchs Riff. Er jagt niemanden - aber wer in ihn
// hineinschwimmt, wird durchgeschuettelt und in einer Blasenwolke weggespickt.
import * as THREE from 'three';
import { WORLD, groundHeight } from './config.js';
import { makeObject, patchUnderwater, swimWiggle, rawLength, MODEL_ANGLE } from './world.js';

const SIZE = 6;            // Laenge in Metern
const SPEED = 2.4;
const TURN = 0.55;         // rad/s - grosse Tiere drehen traege
const BODY_RADIUS = 1.0;
const HIT_PAUSE = 3.5;     // Sekunden Schonzeit nach einem Zusammenstoss

function bubbleTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 14, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.05)');
  g.addColorStop(0.8, 'rgba(210,240,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  c.fillStyle = 'rgba(255,255,255,0.9)';
  c.beginPath();
  c.ellipse(23, 22, 6, 3.5, -0.7, 0, Math.PI * 2);
  c.fill();
  return new THREE.CanvasTexture(cv);
}

// Luftblasen als ein einziger Punkte-Pool: aufsteigend, auseinandertreibend, verblassend.
class Bubbles {
  constructor(scene, proj, max = 260) {
    this.max = max;
    this.next = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.data = new Float32Array(max * 2);     // Groesse, Restleben (0..1)
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aData', new THREE.BufferAttribute(this.data, 2));
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: { uMap: { value: bubbleTexture() }, uProj: proj },
      vertexShader: `uniform float uProj; attribute vec2 aData; varying float vA;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vA = smoothstep(0.0, 0.25, aData.y);
          gl_PointSize = aData.y > 0.0 ? aData.x * uProj / -mv.z : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform sampler2D uMap; varying float vA;
        void main(){ vec4 c = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(c.rgb, c.a * vA); }`,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    scene.add(this.points);
  }

  emit(origin, count, { spread = 0.6, speed = 3, push = null } = {}) {
    const d = new THREE.Vector3();
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      d.randomDirection();
      this.pos.set([origin.x + d.x * spread, origin.y + d.y * spread, origin.z + d.z * spread], i * 3);
      const s = speed * (0.3 + Math.random() * 0.7);
      this.vel.set([d.x * s + (push?.x ?? 0), Math.abs(d.y) * s + 1.5, d.z * s + (push?.z ?? 0)], i * 3);
      this.data[i * 2] = 0.12 + Math.random() * 0.3;
      this.data[i * 2 + 1] = 0.6 + Math.random() * 0.4;
    }
  }

  update(dt) {
    const drag = Math.exp(-dt * 2.5);
    for (let i = 0; i < this.max; i++) {
      if (this.data[i * 2 + 1] <= 0) continue;
      this.data[i * 2 + 1] -= dt * 0.55;
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.vel[i * 3 + 1] += (2.2 - this.vel[i * 3 + 1]) * Math.min(1, dt * 2);   // Auftrieb
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aData.needsUpdate = true;
  }
}

export class Shark {
  constructor({ scene, models, player, sound, proj, colliders, maySpeak }) {
    Object.assign(this, { player, sound, colliders, maySpeak });
    const model = models.hai;
    const material = patchUnderwater(model.material, {
      caustics: 0.9,
      key: 'hai',
      vertex: swimWiggle({ angle: MODEL_ANGLE.hai ?? 0, length: rawLength(model), speed: 3.2, amount: 0.05 }),
    });
    this.obj = makeObject(model, { size: SIZE, anchor: 'center' }, material);
    scene.add(this.obj);

    this.pos = new THREE.Vector3(-34, 0, -16);
    this.heading = 1.2;
    this.depth = 3.6;                  // Hoehe ueber dem Sand
    this.target = new THREE.Vector3();
    this.cooldown = 0;
    this.speechPause = 0;
    this.seen = false;
    this.bumps = 0;
    this.bubbles = new Bubbles(scene, proj);
    this.#pickTarget();
    this.pos.y = groundHeight(this.pos.x, this.pos.z) + this.depth;
  }

  #pickTarget() {
    const a = Math.random() * Math.PI * 2;
    const r = 10 + Math.random() * (WORLD.radius - 14);
    this.target.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  }

  update(dt, t) {
    // --- gemaechlich zum naechsten Wegpunkt, Felsen und Saeulen ausweichen ---
    if (Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z) < 7) this.#pickTarget();
    let wantX = this.target.x - this.pos.x;
    let wantZ = this.target.z - this.pos.z;
    const wl = Math.hypot(wantX, wantZ) || 1;
    wantX /= wl;
    wantZ /= wl;
    for (const c of this.colliders) {
      if (c.top < this.pos.y - 1.2) continue;
      const dx = this.pos.x - c.x;
      const dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const reach = c.r + 6;
      if (d < reach && d > 1e-3) {
        const w = ((reach - d) / reach) * 2.5;
        wantX += (dx / d) * w;
        wantZ += (dz / d) * w;
      }
    }
    let turn = Math.atan2(wantX, wantZ) - this.heading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const step = THREE.MathUtils.clamp(turn, -TURN * dt, TURN * dt);
    this.heading += step;
    this.pos.x += Math.sin(this.heading) * SPEED * dt;
    this.pos.z += Math.cos(this.heading) * SPEED * dt;
    const wantY = groundHeight(this.pos.x, this.pos.z) + this.depth + Math.sin(t * 0.23) * 1.1;
    this.pos.y += (wantY - this.pos.y) * Math.min(1, dt * 0.8);

    this.obj.position.copy(this.pos);
    this.obj.rotation.set(0, this.heading - Math.PI / 2, 0);
    this.obj.rotateX(-(step / dt || 0) * 0.35);          // legt sich in die Kurve

    // --- Zusammenstoss: Abstand zur Koerperachse (Schnauze bis Schwanz) ---
    this.cooldown -= dt;
    this.speechPause -= dt;
    const p = this.player.pos;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const along = THREE.MathUtils.clamp((p.x - this.pos.x) * fx + (p.z - this.pos.z) * fz, -SIZE * 0.42, SIZE * 0.42);
    const cx = this.pos.x + fx * along;
    const cz = this.pos.z + fz * along;
    const dist = Math.hypot(p.x - cx, p.y - this.pos.y, p.z - cz);
    if (dist < BODY_RADIUS + 0.75 && this.cooldown <= 0 && !this.player.frozen) {
      this.cooldown = HIT_PAUSE;
      this.bumps++;
      const away = new THREE.Vector3(p.x - cx, 0, p.z - cz);
      if (away.lengthSq() < 1e-4) away.set(fz, 0, -fx);
      away.normalize();
      this.sound.bump();
      this.bubbles.emit(p, 40, { spread: 0.5, speed: 2 });
      // der Hai zieht in die Gegenrichtung weiter, damit er Fina nicht gleich nochmals rammt
      this.target.set(this.pos.x - away.x * 30, 0, this.pos.z - away.z * 30).clampLength(0, WORLD.radius - 8);
      this.player.knock(away, () => {
        this.sound.whoosh();
        this.bubbles.emit(this.player.pos, 110, { spread: 0.9, speed: 5 });
      });
      if (this.maySpeak() && this.speechPause <= 0) {
        this.speechPause = 30;
        setTimeout(() => { if (this.maySpeak()) this.sound.say(`shark_bump_${1 + (this.bumps % 2)}`); }, 1300);
      }
    } else if (!this.seen && dist < 15 && this.maySpeak() && !this.player.frozen) {
      this.seen = true;
      this.speechPause = 12;
      this.sound.say('shark_see');
    }

    // Blasenschleppe, solange Fina wegspickt
    if (this.player.flying) this.bubbles.emit(this.player.pos, Math.ceil(dt * 90), { spread: 0.35, speed: 1.2 });
    this.bubbles.update(dt);
  }
}
