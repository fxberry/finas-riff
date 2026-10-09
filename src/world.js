// Die Unterwasserwelt: Sand, Licht, Kaustik, Sonnenstrahlen, Schwebeteilchen,
// Korallenfelsen, Saeulen, Seegras und Fischschwaerme.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WORLD, STATIONS, MODELS, groundHeight, makeRng } from './config.js';

export const FOG_COLOR = new THREE.Color(0x075383);

// Gemeinsame Uniforms aller Unterwasser-Materialien
export const U = {
  uTime: { value: 0 },
  uCaustics: { value: null },
};

// Rohmodelle schauen ungefaehr entlang +X; manche kamen verdreht aus Tripo. MODEL_ANGLE ist
// der in der Draufsicht gemessene Winkel der Koerperachse, normMatrix dreht ihn zurueck.
export const MODEL_ANGLE = { fisch: 1.13, fisch_klein: 1.13, rochen: 0.35, hai: -1.21 };

// Schwanzschlag fuer Fischmodelle: Auslenkung quer zur Koerperachse, zum Schwanz hin staerker.
// length = Laenge des Rohmodells (die Werte skalieren damit), phase = GLSL-Ausdruck.
export function swimWiggle({ angle, length, phase = '0.0', speed = 9, amount = 0.073 }) {
  const f = (v) => v.toFixed(4);
  return `
  {
    vec2 fh = vec2(${f(Math.cos(angle))}, ${f(-Math.sin(angle))});
    float fs = -dot(position.xz, fh);
    transformed.xz += vec2(-fh.y, fh.x) * sin(uTime * ${f(speed)} + fs * ${f(6 / length)} + ${phase})
      * ${f(amount * length)} * smoothstep(${f(-0.27 * length)}, ${f(0.4 * length)}, fs);
  }`;
}

// ---------------------------------------------------------------------------
// Modelle laden

export async function loadModels(onProgress) {
  const loader = new GLTFLoader();
  const models = {};
  let done = 0;
  await Promise.all(MODELS.map(async (name) => {
    const gltf = await loader.loadAsync(`assets/models/${name}.glb`);
    gltf.scene.updateMatrixWorld(true);
    let mesh = null;
    gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    models[name] = { name, geometry: mesh.geometry, material: mesh.material, base: mesh.matrixWorld.clone(), box };
    onProgress?.(++done / MODELS.length);
  }));
  return models;
}

// Laenge des Rohmodells in der Waagrechten (fuer swimWiggle)
export function rawLength(model) {
  const d = model.box.getSize(new THREE.Vector3());
  return Math.max(d.x, d.z);
}

// Matrix, die ein Rohmodell auf `size` Meter bringt und seinen Ankerpunkt in den Ursprung legt.
//   by: 'max' = groesste Ausdehnung, 'height' = Hoehe      anchor: 'bottom' | 'center'
export function normMatrix(model, { size, by = 'max', anchor = 'bottom' }) {
  const dim = model.box.getSize(new THREE.Vector3());
  const c = model.box.getCenter(new THREE.Vector3());
  const s = size / (by === 'height' ? dim.y : Math.max(dim.x, dim.y, dim.z));
  const ay = anchor === 'bottom' ? model.box.min.y : c.y;
  return new THREE.Matrix4().makeRotationY(-(MODEL_ANGLE[model.name] ?? 0))
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-c.x, -ay, -c.z))
    .multiply(model.base);
}

// Einzelnes Objekt: Gruppe (frei beweg- und animierbar) mit normalisiertem Mesh darin.
export function makeObject(model, opts, material = model.material) {
  const mesh = new THREE.Mesh(model.geometry, material);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(normMatrix(model, opts));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

// ---------------------------------------------------------------------------
// Unterwasser-Look fuer Standard-Materialien: wandernde Lichtflecken (Kaustik)
// und optional eine Bewegung der Eckpunkte (Seegras wiegt sich, Fisch schlaengelt).

export function patchUnderwater(material, { caustics = 1, vertex = '', fragment = '', key = '' } = {}) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uCaustics = U.uCaustics;
    sh.uniforms.uCausticStrength = { value: caustics };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertex}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vWPos = (modelMatrix * wp).xyz;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        uniform float uTime;
        uniform sampler2D uCaustics;
        uniform float uCausticStrength;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
${fragment}`)
      .replace('#include <opaque_fragment>', `{
          vec2 cuv = vWPos.xz * 0.06;
          float c1 = texture2D(uCaustics, cuv + uTime * vec2(0.013, 0.009)).r;
          float c2 = texture2D(uCaustics, cuv * 1.37 - uTime * vec2(0.011, 0.016) + 0.37).r;
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float upf = smoothstep(-0.3, 0.9, dot(normal, upV));
          outgoingLight += diffuseColor.rgb * min(c1, c2) * upf * uCausticStrength * vec3(1.0, 0.97, 0.82) * 2.4;
        }
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `uw-${caustics}-${key}`;
  return material;
}

// Was direkt vor der Kamera steht, loest sich gerastert auf, statt Fina zu verdecken.
export const NEAR_FADE = `{
  float kd = length(vWPos - cameraPosition);
  float kn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  if (kd < 2.6 + kn * 3.0) discard;
}`;

// Kachelbare Kaustik-Textur (nach Dave Hoskins' "Tileable Water Caustic"), einmal in JS berechnet.
function makeCausticTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const TAU = Math.PI * 2;
  const time = 23.0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x / size) * TAU - 250;
      const py = (y / size) * TAU - 250;
      let ix = px;
      let iy = py;
      let c = 1;
      const inten = 0.005;
      for (let n = 0; n < 5; n++) {
        const t = time * (1 - 3.5 / (n + 1));
        const nx = px + Math.cos(t - ix) + Math.sin(t + iy);
        const ny = py + Math.sin(t - iy) + Math.cos(t + ix);
        ix = nx;
        iy = ny;
        c += 1 / Math.hypot(px / (Math.sin(ix + t) / inten), py / (Math.cos(iy + t) / inten));
      }
      c = 1.17 - Math.pow(c / 5, 1.4);
      const v = Math.min(255, Math.pow(Math.abs(c), 8) * 255);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function makeSandTexture() {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S);
  const rng = makeRng(7);
  const k = (Math.PI * 2) / S;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const ripple = Math.sin((y + 14 * Math.sin(x * k * 2) + 6 * Math.sin(x * k * 5 + 1.7)) * k * 9);
      const v = 0.86 + 0.1 * ripple + (rng() - 0.5) * 0.09;
      const i = (y * S + x) * 4;
      img.data[i] = 232 * v;
      img.data[i + 1] = 214 * v;
      img.data[i + 2] = 172 * v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(22, 22);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------------------------

export function buildWorld(scene, models) {
  const rng = makeRng(20261006);
  const colliders = [];      // {x, z, r, top}: Zylinder, an denen das Seepferdchen abgleitet
  const updaters = [];

  U.uCaustics.value = makeCausticTexture();
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.03);

  // --- Licht ---
  scene.add(new THREE.HemisphereLight(0x8fd6ff, 0x0d3a57, 1.15));
  const sun = new THREE.DirectionalLight(0xfff0cc, 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -32;
  sc.right = sc.top = 32;
  sc.near = 1;
  sc.far = 110;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);
  const sunOffset = new THREE.Vector3(14, 50, 9);

  // --- Himmel: Verlauf von der hellen Oberflaeche in die Tiefe ---
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(320, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uFog: { value: FOG_COLOR } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        uniform vec3 uFog; varying vec3 vDir;
        void main(){
          float h = normalize(vDir).y;
          vec3 deep = uFog * 0.55;
          vec3 top = vec3(0.30, 0.74, 0.92);
          vec3 col = mix(uFog, deep, smoothstep(0.0, -0.6, h));
          col = mix(col, top, smoothstep(0.05, 0.9, h));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -10;
  scene.add(sky);

  // --- Wasseroberflaeche von unten ---
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700).rotateX(Math.PI / 2),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: { uTime: U.uTime, uCaustics: U.uCaustics, uFog: { value: FOG_COLOR } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `
        uniform float uTime; uniform sampler2D uCaustics; uniform vec3 uFog; varying vec3 vW;
        void main(){
          vec2 uv = vW.xz * 0.022;
          float a = texture2D(uCaustics, uv + uTime * vec2(0.010, 0.006)).r;
          float b = texture2D(uCaustics, uv * 1.6 - uTime * vec2(0.008, 0.012)).r;
          float c = min(a, b) * 2.2 + a * 0.35;
          float d = length(vW - cameraPosition);
          float fade = exp(-pow(d * 0.013, 2.0));
          vec3 col = mix(uFog, vec3(0.62, 0.93, 1.0) + c, fade);
          gl_FragColor = vec4(col, 0.25 + 0.75 * fade);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  surface.position.y = WORLD.surface;
  scene.add(surface);

  // --- Sandboden ---
  const groundGeo = new THREE.PlaneGeometry(210, 210, 160, 160).rotateX(-Math.PI / 2);
  const gp = groundGeo.attributes.position;
  for (let i = 0; i < gp.count; i++) gp.setY(i, groundHeight(gp.getX(i), gp.getZ(i)));
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, patchUnderwater(
    new THREE.MeshStandardMaterial({ map: makeSandTexture(), color: 0xc9b98f, roughness: 1 }), { caustics: 1.6, key: 'sand' }));
  ground.receiveShadow = true;
  scene.add(ground);

  // --- Sonnenstrahlen ---
  const rayGeo = new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0);
  const rays = [];
  for (let i = 0; i < 60; i++) {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: U.uTime, uPhase: { value: rng() * 20 } },
      vertexShader: `varying vec2 vUv; varying float vDist;
        void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vDist = length(mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uTime; uniform float uPhase; varying vec2 vUv; varying float vDist;
        void main(){
          float a = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x);
          a *= smoothstep(0.0, 0.85, vUv.y);
          a *= 0.55 + 0.45 * sin(uTime * 0.5 + uPhase);
          a *= smoothstep(75.0, 25.0, vDist) * smoothstep(4.0, 14.0, vDist);
          gl_FragColor = vec4(vec3(0.62, 0.90, 1.0) * a * 0.5, 1.0);
        }`,
    });
    const ray = new THREE.Mesh(rayGeo, mat);
    const a = rng() * Math.PI * 2;
    const r = 6 + Math.sqrt(rng()) * 62;
    ray.position.set(Math.cos(a) * r, WORLD.surface, Math.sin(a) * r);
    ray.scale.set(4 + rng() * 9, WORLD.surface + 4, 1);
    ray.rotation.order = 'YXZ';
    ray.rotation.z = 0.22;
    ray.renderOrder = 5;
    rays.push(ray);
    scene.add(ray);
  }

  // --- Schwebeteilchen rund um die Kamera ---
  const N = 700;
  const pPos = new Float32Array(N * 3);
  const pSeed = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) { pPos[i] = rng() * 40; pSeed[i] = rng(); }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('seed', new THREE.BufferAttribute(pSeed, 3));
  const dust = new THREE.Points(pGeo, new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.uTime, uCam: { value: new THREE.Vector3() }, uScale: { value: 1 } },
    vertexShader: `uniform float uTime; uniform vec3 uCam; uniform float uScale; attribute vec3 seed; varying float vA;
      void main(){
        vec3 p = position + vec3(sin(uTime*0.21+seed.x*6.3), uTime*0.12*(0.3+seed.y), cos(uTime*0.17+seed.z*6.3));
        p = mod(p - uCam + 20.0, 40.0) - 20.0 + uCam;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float d = length(p - uCam);
        vA = smoothstep(20.0, 11.0, d) * smoothstep(0.8, 2.5, d) * (0.25 + 0.5 * seed.x);
        gl_PointSize = (1.5 + seed.y * 4.0) * uScale * 14.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA;
      void main(){ float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(0.8, 0.95, 1.0) * smoothstep(0.5, 0.1, r) * vA, 1.0); }`,
  }));
  dust.frustumCulled = false;
  scene.add(dust);

  // --- Felsen und Saeulen als Instanzen ---
  const placer = (name, by, count) => {
    const model = models[name];
    const mesh = new THREE.InstancedMesh(model.geometry, patchUnderwater(model.material, { key: name, fragment: NEAR_FADE }), count);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const dim = model.box.getSize(new THREE.Vector3());
    const footprint = Math.max(dim.x, dim.z) / (by === 'height' ? dim.y : Math.max(dim.x, dim.y, dim.z));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    scene.add(mesh);
    return {
      add(x, z, size, { yaw = rng() * Math.PI * 2, sink = 0.04, solid = true, squash = 1 } = {}) {
        if (n >= count) return;
        const y = groundHeight(x, z) - size * sink;
        m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, yaw), new THREE.Vector3(1, squash, 1))
          .multiply(normMatrix(model, { size, by }));
        mesh.setMatrixAt(n++, m);
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        if (solid) {
          const height = (by === 'height' ? size : size * dim.y / Math.max(dim.x, dim.y, dim.z)) * squash;
          colliders.push({ x, z, r: size * footprint * 0.4, top: y + height * 0.92 });
        }
      },
    };
  };
  const rockA = placer('korallenfels_a', 'max', 40);
  const rockB = placer('korallenfels_b', 'height', 60);
  const column = placer('saeule', 'height', 24);

  // freie Zonen: Start, Stationen, Ruinenstrasse
  const keepClear = [{ x: 0, z: 0, r: 8 }, ...STATIONS.map((s) => ({ x: s.pos[0], z: s.pos[2], r: s.id === 'rochen' ? 10 : 6.5 }))];
  const blocked = (x, z, r) => (Math.abs(x) < 7.5 && z > 8 && z < 46)
    || keepClear.some((k) => Math.hypot(x - k.x, z - k.z) < k.r + r);
  const placed = [];
  const tryPlace = (minR, maxR, fn, tries = 40) => {
    for (let i = 0; i < tries; i++) {
      const a = rng() * Math.PI * 2;
      const r = minR + rng() * (maxR - minR);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const size = fn(null);
      if (blocked(x, z, size * 0.5) || placed.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + size * 0.55)) continue;
      placed.push({ x, z, r: size * 0.5 });
      fn({ x, z, size });
      return;
    }
  };
  for (let i = 0; i < 22; i++) {
    let size;
    tryPlace(9, 50, (p) => { if (!p) return (size = 3 + rng() * 4.5); rockA.add(p.x, p.z, p.size); });
  }
  for (let i = 0; i < 24; i++) {
    let size;
    tryPlace(10, 52, (p) => { if (!p) return (size = 3.5 + rng() * 6); rockB.add(p.x, p.z, p.size); });
  }
  // Begleitfelsen direkt neben einigen Stationen
  rockA.add(13.5, 16.5, 4.2);
  rockB.add(-34.5, 28.5, 6);
  rockA.add(-25.5, -11.5, 3.6);
  rockB.add(27, -8, 5);
  // Riesen am Rand: im Dunst nur noch blaue Silhouetten, sie schliessen die Welt ab
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rng() * 0.2;
    const r = 66 + rng() * 14;
    rockB.add(Math.cos(a) * r, Math.sin(a) * r, 26 + rng() * 22, { sink: 0.3, solid: false });
  }
  // Ruinenstrasse zum Tor
  for (const z of [12, 19, 26, 33]) {
    for (const sx of [-1, 1]) {
      column.add(sx * 5.4, z, 6 + rng() * 2.5, { squash: rng() < 0.3 ? 0.6 : 1 });
    }
  }
  column.add(9, -27, 5.5, { squash: 0.7 });
  column.add(-27, 31, 7);
  column.add(-37, 21, 5, { squash: 0.6 });
  column.add(34, 29, 7.5);
  column.add(-6, -31, 6.5);
  column.add(-19, -33, 5, { squash: 0.55 });

  // --- Seegras ---
  const bladeGeo = new THREE.PlaneGeometry(0.34, 1, 2, 12).translate(0, 0.5, 0);
  {
    const bp = bladeGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {      // zur Spitze hin schmaler, leicht gewellt
      const y = bp.getY(i);
      bp.setX(i, bp.getX(i) * (1 - y * y * 0.85) + Math.sin(y * 9) * 0.05);
      bp.setZ(i, Math.sin(y * 7) * 0.04);
    }
    bladeGeo.computeVertexNormals();
  }
  const clumps = 90;
  const perClump = 12;
  const kelp = new THREE.InstancedMesh(bladeGeo, patchUnderwater(
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }),
    {
      caustics: 0.6,
      key: 'kelp',
      fragment: NEAR_FADE,
      vertex: `
        #ifdef USE_INSTANCING
          float kph = instanceMatrix[3].x * 0.9 + instanceMatrix[3].z * 0.7;
          float kb = position.y * position.y;
          transformed.x += sin(uTime * 1.2 + kph + position.y * 3.2) * 0.9 * kb;
          transformed.z += cos(uTime * 0.9 + kph * 1.3 + position.y * 2.1) * 0.6 * kb;
        #endif`,
    }), clumps * perClump);
  kelp.frustumCulled = false;
  kelp.receiveShadow = true;
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    let n = 0;
    for (let c = 0; c < clumps; c++) {
      let x;
      let z;
      do {
        const a = rng() * Math.PI * 2;
        const r = 7 + rng() * 46;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
      } while (blocked(x, z, 1.5));
      const tall = 2.2 + rng() * 4.5;
      for (let b = 0; b < perClump; b++) {
        const bx = x + (rng() - 0.5) * 1.3;
        const bz = z + (rng() - 0.5) * 1.3;
        m.compose(new THREE.Vector3(bx, groundHeight(bx, bz) - 0.1, bz), q.setFromAxisAngle(up, rng() * Math.PI),
          new THREE.Vector3(0.5 + rng() * 0.6, tall * (0.5 + rng() * 0.7), 1));
        kelp.setMatrixAt(n, m);
        kelp.setColorAt(n++, col.setHSL(0.11 + rng() * 0.12, 0.7, 0.2 + rng() * 0.16));
      }
    }
  }
  scene.add(kelp);

  // --- Fischschwaerme (Kulisse) ---
  const small = models.fisch_klein;
  const schoolCount = 42;
  const school = new THREE.InstancedMesh(small.geometry, patchUnderwater(small.material, {
    caustics: 0.5,
    key: 'school',
    vertex: swimWiggle({ angle: MODEL_ANGLE.fisch_klein, length: rawLength(small), phase: 'float(gl_InstanceID)' }),
  }), schoolCount);
  school.frustumCulled = false;
  const smallNorm = normMatrix(small, { size: 0.55, anchor: 'center' });
  const fishes = [];
  const centers = [[-8, 7.5, 18, 7], [20, 9, -18, 9], [-28, 8, -22, 8]];
  for (let i = 0; i < schoolCount; i++) {
    const c = centers[i % centers.length];
    fishes.push({ c, r: c[3] * (0.6 + rng() * 0.6), a: rng() * Math.PI * 2, y: (rng() - 0.5) * 2.4, sp: 0.22 + rng() * 0.12, ph: rng() * 6 });
  }
  scene.add(school);
  {
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    updaters.push((dt, t) => {
      fishes.forEach((f, i) => {
        const a = f.a + t * f.sp;
        pos.set(f.c[0] + Math.cos(a) * f.r, f.c[1] + f.y + Math.sin(t * 0.6 + f.ph) * 0.4, f.c[2] + Math.sin(a) * f.r);
        // Schwimmrichtung = Tangente des Kreises; normalisierte Modelle schauen entlang +X
        q.setFromAxisAngle(up, -a - Math.PI / 2);
        school.setMatrixAt(i, m.compose(pos, q, one).multiply(smallNorm));
      });
      school.instanceMatrix.needsUpdate = true;
    });
  }

  return {
    colliders,
    update(dt, t, camera, focus) {
      U.uTime.value = t;
      sky.position.copy(camera.position);
      surface.position.x = camera.position.x;
      surface.position.z = camera.position.z;
      dust.material.uniforms.uCam.value.copy(camera.position);
      sun.target.position.copy(focus);
      sun.position.copy(focus).add(sunOffset);
      for (const ray of rays) ray.rotation.y = Math.atan2(camera.position.x - ray.position.x, camera.position.z - ray.position.z);
      for (const u of updaters) u(dt, t);
    },
    setPixelScale(s) { dust.material.uniforms.uScale.value = s; },
  };
}
