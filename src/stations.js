// Entdecker-Stationen: Tier oder Ding finden -> Anlaut hoeren -> richtige Buchstaben-Blase waehlen.
// Dazu die Krebschen zum Fressen und Zaehlen.
import * as THREE from 'three';
import { STATIONS, LETTERS, SHRIMPS, groundHeight } from './config.js';
import { U, makeObject, patchUnderwater, swimWiggle, rawLength, MODEL_ANGLE, NEAR_FADE } from './world.js';

const BUBBLE_COLORS = ['#ffd166', '#9be7ff', '#ffadc6', '#b9f6a5', '#d9c2ff'];

function letterTexture(letter, color) {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.48);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.86)');
  g.addColorStop(1, color);
  c.fillStyle = g;
  c.beginPath();
  c.arc(S / 2, S / 2, S * 0.46, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = 9;
  c.strokeStyle = color;
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.9)';      // Glanzlicht
  c.beginPath();
  c.ellipse(S * 0.33, S * 0.27, S * 0.09, S * 0.05, -0.6, 0, Math.PI * 2);
  c.fill();
  c.font = `900 ${S * 0.6}px "Arial Rounded MT Bold", "Segoe UI", Arial, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = '#0b3558';
  c.fillText(letter, S / 2, S * 0.545);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let dotTex = null;
function dotTexture() {
  if (dotTex) return dotTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(cv);
  return dotTex;
}

function shrimpTexture() {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,220,170,0.75)');
  g.addColorStop(1, 'rgba(255,170,90,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  c.lineCap = 'round';
  c.strokeStyle = '#ff6f3c';
  c.lineWidth = 17;
  c.beginPath();
  c.arc(S * 0.5, S * 0.52, S * 0.2, Math.PI * 0.95, Math.PI * 2.45);
  c.stroke();
  c.strokeStyle = '#ffb48a';
  c.lineWidth = 3;
  for (let i = 0; i < 4; i++) {            // Panzerringe
    const a = Math.PI * (1.15 + i * 0.3);
    c.beginPath();
    c.moveTo(S * 0.5 + Math.cos(a) * S * 0.13, S * 0.52 + Math.sin(a) * S * 0.13);
    c.lineTo(S * 0.5 + Math.cos(a) * S * 0.27, S * 0.52 + Math.sin(a) * S * 0.27);
    c.stroke();
  }
  c.fillStyle = '#1b1b1b';
  c.beginPath();
  c.arc(S * 0.33, S * 0.5, 5, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#ff6f3c';
  c.lineWidth = 2.5;
  c.beginPath();
  c.moveTo(S * 0.3, S * 0.47);
  c.quadraticCurveTo(S * 0.15, S * 0.3, S * 0.1, S * 0.42);
  c.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Glitzer-Saeule ueber allem, was noch nicht entdeckt ist (durch den Dunst weit sichtbar).
function makeBeacon(proj) {
  const N = 46;
  const seed = new Float32Array(N * 3);
  for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.uTime, uOn: { value: 1 }, uProj: proj },
    vertexShader: `uniform float uTime; uniform float uOn; uniform float uProj; attribute vec3 aSeed; varying float vA;
      void main(){
        float life = fract(uTime * 0.16 * (0.6 + aSeed.y) + aSeed.x);
        float ang = aSeed.z * 6.2832 + uTime * 0.8;
        float rad = 0.5 + 1.3 * aSeed.y * (0.4 + life);
        vec4 mv = modelViewMatrix * vec4(cos(ang) * rad, 0.4 + life * 9.5, sin(ang) * rad, 1.0);
        vA = sin(life * 3.1416) * uOn * (0.6 + 0.4 * sin(uTime * 7.0 + aSeed.x * 40.0));
        gl_PointSize = max(3.0, (0.22 + aSeed.x * 0.3) * uProj / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA;
      void main(){
        vec2 p = gl_PointCoord - 0.5;
        float star = smoothstep(0.5, 0.0, length(p)) * 0.7 + smoothstep(0.06, 0.0, abs(p.x)) * smoothstep(0.5, 0.0, abs(p.y)) + smoothstep(0.06, 0.0, abs(p.y)) * smoothstep(0.5, 0.0, abs(p.x));
        gl_FragColor = vec4(vec3(1.0, 0.92, 0.6) * star * vA, 1.0);
      }`,
  }));
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  return pts;
}

function makeJellyfish() {
  const g = new THREE.Group();
  const bellMat = patchUnderwater(new THREE.MeshStandardMaterial({
    color: 0xffa6d6, emissive: 0x8a2f72, emissiveIntensity: 0.55, roughness: 0.35,
    transparent: true, opacity: 0.78, side: THREE.DoubleSide,
  }), { caustics: 0.4, key: 'jelly' });
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.62, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), bellMat);
  const inner = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.6),
    new THREE.MeshStandardMaterial({ color: 0xff7fc0, emissive: 0xb0388c, emissiveIntensity: 0.8, roughness: 0.4 }));
  inner.position.y = -0.02;
  g.add(bell, inner);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x15101c, roughness: 0.15 });
  const shine = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 10), eyeMat);
    eye.position.set(0.5, 0.2, s * 0.24);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), shine);
    dot.position.set(0.085, 0.045, s * 0.02);
    eye.add(dot);
    g.add(eye);
  }
  const tGeo = new THREE.CylinderGeometry(0.04, 0.008, 1.5, 5, 10).translate(0, -0.75, 0);
  const tMat = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0xffc4e4, emissive: 0x8a2f72, emissiveIntensity: 0.4, roughness: 0.5 }), {
    caustics: 0.2,
    key: 'tentacle',
    vertex: `
      float tph = float(gl_InstanceID) * 1.7;
      transformed.x += sin(uTime * 2.2 + position.y * 4.0 + tph) * 0.13 * -position.y;
      transformed.z += cos(uTime * 1.7 + position.y * 3.2 + tph) * 0.10 * -position.y;`,
  });
  const tent = new THREE.InstancedMesh(tGeo, tMat, 8);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    m.makeTranslation(Math.cos(a) * 0.36, 0.05, Math.sin(a) * 0.36);
    tent.setMatrixAt(i, m);
  }
  tent.frustumCulled = false;
  g.add(tent);
  g.userData.bell = bell;
  return g;
}

export class Stations {
  constructor({ scene, models, sound, hud, player, saved, proj, colliders, onSave }) {
    Object.assign(this, { scene, sound, hud, player, colliders, onSave });
    this.active = null;
    this.bubbles = [];
    this.idleTimer = 28;
    this.edgeCooldown = 0;
    this.hintIndex = 0;
    this.finished = false;
    this.done = new Set(saved.done ?? []);
    this.eaten = new Set(saved.eaten ?? []);
    this.sparks = [];

    this.list = STATIONS.map((cfg) => {
      const ground = groundHeight(cfg.pos[0], cfg.pos[2]);
      const base = new THREE.Vector3(cfg.pos[0], ground + cfg.pos[1], cfg.pos[2]);
      let obj;
      if (cfg.model) {
        const model = models[cfg.model];
        const swimmer = cfg.move === 'kreis' || cfg.move === 'gleiten';
        let vertex = '';
        if (cfg.model === 'fisch') vertex = swimWiggle({ angle: MODEL_ANGLE.fisch, length: rawLength(model) });
        if (cfg.model === 'rochen') {
          // Fluegelschlag: je weiter aussen, desto staerker (Koerperachse wie in MODEL_ANGLE gemessen)
          vertex = `
            float rl = abs(dot(position.xz, vec2(0.3429, 0.9394)));
            transformed.y += sin(uTime * 2.4 - rl * 0.9) * rl * 0.2;`;
        }
        obj = makeObject(model, { size: cfg.size, anchor: swimmer ? 'center' : 'bottom' },
          patchUnderwater(model.material, { caustics: 0.8, vertex, key: cfg.model, fragment: cfg.id === 'tor' ? NEAR_FADE : '' }));
      } else {
        obj = makeJellyfish();
        obj.scale.setScalar(cfg.size);
      }
      obj.position.copy(base);
      obj.rotation.y = cfg.yaw;
      scene.add(obj);
      const beacon = makeBeacon(proj);
      beacon.position.set(base.x, ground, base.z);
      scene.add(beacon);
      const st = { cfg, obj, base, ground, beacon, state: this.done.has(cfg.id) ? 'done' : 'idle', celebrate: 0 };
      if (st.state === 'done') beacon.visible = false;
      return st;
    });

    // Das Tor ist massiv: zwei Pfeiler links und rechts der Oeffnung
    const tor = this.list.find((s) => s.cfg.id === 'tor');
    for (const sx of [-1, 1]) colliders.push({ x: tor.base.x + sx * 3.1, z: tor.base.z, r: 1.3, top: tor.ground + 7 });

    // Krebschen
    const tex = shrimpTexture();
    this.shrimps = SHRIMPS.map(([x, h, z], i) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      sp.position.set(x, groundHeight(x, z) + h, z);
      sp.scale.setScalar(0.95);
      sp.visible = !this.eaten.has(i);
      scene.add(sp);
      return { sp, i, y: sp.position.y, ph: i * 1.3 };
    });

    hud.setAlbum(STATIONS, this.done);
    hud.setShrimp(this.eaten.size);
    if (this.done.size === STATIONS.length) this.finished = true;
  }

  get remaining() { return this.list.filter((s) => s.state !== 'done'); }

  #save() { this.onSave({ done: [...this.done], eaten: [...this.eaten] }); }

  #burst(pos, color = 0xfff0a0, n = 26) {
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3);
    const v = [];
    for (let i = 0; i < n; i++) {
      p.set([pos.x, pos.y, pos.z], i * 3);
      v.push(new THREE.Vector3().randomDirection().multiplyScalar(1.5 + Math.random() * 3));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color, size: 0.34, map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    pts.frustumCulled = false;
    this.scene.add(pts);
    this.sparks.push({ pts, v, life: 1 });
  }

  // ---- Ablauf einer Station ----------------------------------------------

  async #start(st) {
    this.active = st;
    st.state = 'intro';
    this.hud.showCard(st.cfg.letter, st.cfg.word);
    this.sound.sparkle();
    await this.sound.say(`st_${st.cfg.id}_intro`, { interrupt: true });
    if (this.active !== st || st.state !== 'intro') return;
    this.#spawnBubbles(st);
    st.state = 'quiz';
    this.sound.say(`find_${st.cfg.letter}`);
  }

  #spawnBubbles(st) {
    const p = this.player;
    const f = p.forward;
    const side = new THREE.Vector3(f.z, 0, -f.x);
    const others = LETTERS.filter((l) => l !== st.cfg.letter).sort(() => Math.random() - 0.5).slice(0, 2);
    const letters = [st.cfg.letter, ...others].sort(() => Math.random() - 0.5);
    const colors = [...BUBBLE_COLORS].sort(() => Math.random() - 0.5);
    letters.forEach((letter, i) => {
      const lat = (i - 1) * 3.8;
      const pos = p.pos.clone().addScaledVector(f, i === 1 ? 7 : 6).addScaledVector(side, lat);
      for (const c of this.colliders) {           // nicht im Felsen erscheinen
        const d = Math.hypot(pos.x - c.x, pos.z - c.z);
        if (d < c.r + 1.3 && d > 1e-3) { pos.x = c.x + ((pos.x - c.x) / d) * (c.r + 1.3); pos.z = c.z + ((pos.z - c.z) / d) * (c.r + 1.3); }
      }
      const floor = groundHeight(pos.x, pos.z);
      pos.y = floor + 2.3;      // auf Schwebehoehe: ohne Leertaste erreichbar
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: letterTexture(letter, colors[i]), transparent: true, depthWrite: false, fog: false,
      }));
      sp.position.copy(pos);
      sp.scale.setScalar(0.01);
      sp.renderOrder = 8;
      this.scene.add(sp);
      this.bubbles.push({ sp, letter, y: pos.y, age: 0, ph: i * 2.1, st });
    });
    this.sound.sparkle();
  }

  #removeBubble(b) {
    this.scene.remove(b.sp);
    b.sp.material.map.dispose();
    b.sp.material.dispose();
    this.bubbles = this.bubbles.filter((x) => x !== b);
  }

  #clearBubbles() { for (const b of [...this.bubbles]) this.#removeBubble(b); }

  async #hit(b) {
    const st = b.st;
    this.sound.pop();
    this.#burst(b.sp.position, b.letter === st.cfg.letter ? 0xfff0a0 : 0xbfe9ff);
    if (b.letter !== st.cfg.letter) {
      this.#removeBubble(b);
      this.sound.wrong();
      this.sound.say([`is_${b.letter}`, `seek_${st.cfg.letter}`], { interrupt: true });
      return;
    }
    this.#clearBubbles();
    st.state = 'done';
    st.celebrate = 1;
    st.beacon.visible = false;
    this.done.add(st.cfg.id);
    this.#save();
    this.sound.chime();
    this.hud.addSticker(st.cfg.id);
    const n = this.done.size;
    await this.sound.say(`st_${st.cfg.id}_done`, { interrupt: true });
    if (this.active === st) { this.active = null; this.hud.hideCard(); }
    this.idleTimer = 30;
    if (n === STATIONS.length && !this.finished) this.#finale();
    else if (n === 5 && !this.active) this.sound.say('half');
  }

  #cancel(st) {
    this.#clearBubbles();
    st.state = 'idle';
    this.active = null;
    this.hud.hideCard();
    this.sound.stopVoice();
  }

  #finale() {
    this.finished = true;
    this.sound.fanfare();
    this.hud.finale();
    for (let i = 0; i < 6; i++) {
      setTimeout(() => this.#burst(this.player.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 1 + Math.random() * 3, (Math.random() - 0.5) * 6)),
        [0xfff0a0, 0xffadc6, 0x9be7ff][i % 3], 40), i * 350);
    }
    this.sound.say(['finale_1', 'finale_2'], { interrupt: true });
  }

  // ---- pro Bild -------------------------------------------------------------

  update(dt, t) {
    const p = this.player.pos;

    for (const st of this.list) {
      this.#animate(st, dt, t);
      const d = Math.hypot(p.x - st.obj.position.x, p.z - st.obj.position.z);
      if (st.state === 'idle' && !this.active && d < st.cfg.trigger && !this.player.frozen) this.#start(st);
      else if ((st.state === 'intro' || st.state === 'quiz') && Math.hypot(p.x - st.base.x, p.z - st.base.z) > st.cfg.trigger + 24) this.#cancel(st);
    }

    for (const b of [...this.bubbles]) {
      b.age += dt;
      const grow = Math.min(1, b.age * 2.2);
      b.sp.scale.setScalar(2.3 * (grow * grow * (3 - 2 * grow)) * (1 + Math.sin(t * 3 + b.ph) * 0.03));
      b.sp.position.y = b.y + Math.sin(t * 1.3 + b.ph) * 0.18;
      // grosszuegig in der Hoehe, damit auch von oben anschwimmende Kinder treffen
      if (b.age > 0.7 && Math.hypot(b.sp.position.x - p.x, b.sp.position.z - p.z) < 1.5 && Math.abs(b.sp.position.y - p.y) < 2.4) this.#hit(b);
    }

    for (const s of this.shrimps) {
      if (!s.sp.visible) continue;
      s.sp.position.y = s.y + Math.sin(t * 2 + s.ph) * 0.15;
      s.sp.material.rotation = Math.sin(t * 1.5 + s.ph) * 0.3;
      if (s.sp.position.distanceTo(p) < 1.25) this.#eat(s);
    }

    for (const s of [...this.sparks]) {
      s.life -= dt * 1.1;
      const a = s.pts.geometry.attributes.position;
      s.v.forEach((v, i) => a.setXYZ(i, a.getX(i) + v.x * dt, a.getY(i) + v.y * dt + dt * 0.6, a.getZ(i) + v.z * dt));
      a.needsUpdate = true;
      s.pts.material.opacity = Math.max(0, s.life);
      if (s.life <= 0) {
        this.scene.remove(s.pts);
        s.pts.geometry.dispose();
        s.pts.material.dispose();
        this.sparks = this.sparks.filter((x) => x !== s);
      }
    }

    // Rand der Welt und gelegentliche Hinweise
    this.edgeCooldown -= dt;
    if (this.player.atEdge && this.edgeCooldown <= 0 && !this.active && !this.sound.speaking) {
      this.edgeCooldown = 25;
      this.sound.say('edge');
    }
    if (!this.active && !this.sound.speaking && !this.player.frozen) {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) {
        this.idleTimer = 45;
        const pool = this.finished ? ['fact_upright', 'fact_papa', 'fact_tail'] : ['hint_glitter', 'fact_upright', 'hint_glitter', 'fact_papa', 'hint_glitter', 'fact_tail'];
        this.sound.say(pool[this.hintIndex++ % pool.length]);
      }
    }
  }

  #eat(s) {
    s.sp.visible = false;
    this.eaten.add(s.i);
    this.#save();
    this.sound.slurp();
    this.#burst(s.sp.position, 0xffb48a, 12);
    const n = this.eaten.size;
    this.hud.setShrimp(n, true);
    if (this.active || this.sound.speaking) return;
    const lines = [`n${n}`];
    if (n === 1) lines.push('shrimp_first');
    if (n === SHRIMPS.length) lines.push('shrimp_ten');
    this.sound.say(lines);
  }

  #animate(st, dt, t) {
    const { cfg, obj, base } = st;
    let spin = 0;
    let hop = 0;
    if (st.celebrate > 0) {
      st.celebrate = Math.max(0, st.celebrate - dt * 0.8);
      const k = 1 - st.celebrate;
      spin = k * Math.PI * 2;
      hop = Math.sin(k * Math.PI) * 0.8;
    }
    switch (cfg.move) {
      case 'kreis': {
        const a = t * 0.55;
        obj.position.set(base.x + Math.cos(a) * 2.2, base.y + Math.sin(t * 1.1) * 0.3 + hop, base.z + Math.sin(a) * 2.2);
        obj.rotation.y = -a - Math.PI / 2 + spin;
        break;
      }
      case 'gleiten': {
        const a = t * 0.2;
        obj.position.set(base.x + Math.cos(a) * 7, base.y + Math.sin(t * 0.5) * 0.7 + hop, base.z + Math.sin(a) * 7);
        obj.rotation.y = -a - Math.PI / 2 + spin;
        obj.rotation.z = 0.12;
        break;
      }
      case 'seitwaerts': {
        const s = Math.sin(t * 0.7) * 2.2;
        obj.position.set(base.x + Math.sin(cfg.yaw) * s, base.y + Math.abs(Math.sin(t * 6)) * 0.05 + hop, base.z + Math.cos(cfg.yaw) * s);
        obj.rotation.y = cfg.yaw + spin;
        break;
      }
      case 'schweben': {
        const pulse = Math.sin(t * 2.2);
        obj.position.set(base.x + Math.sin(t * 0.3) * 0.8, base.y + Math.sin(t * 0.7) * 0.6 + hop, base.z + Math.cos(t * 0.25) * 0.8);
        obj.userData.bell.scale.set(1 + pulse * 0.1, 1 - pulse * 0.09, 1 + pulse * 0.1);
        obj.rotation.y = cfg.yaw + spin + Math.sin(t * 0.2) * 0.4;
        break;
      }
      case 'atmen': {
        const b = 1 + Math.sin(t * 1.8) * 0.025;
        obj.scale.set(b, 2 - b, b);
        obj.position.y = base.y + hop;
        obj.rotation.y = cfg.yaw + spin;
        break;
      }
      default:
        obj.position.y = base.y + hop * 0.3;
    }
  }
}
