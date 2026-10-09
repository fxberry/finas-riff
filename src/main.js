// Finas Riff - Einstieg: Renderer, Laden, Start, Hauptschleife.
import * as THREE from 'three';
import { loadModels, buildWorld } from './world.js';
import { Player } from './player.js';
import { Stations } from './stations.js';
import { Shark } from './shark.js';
import { Sound } from './audio.js';
import { Hud } from './hud.js';
import { STATIONS } from './config.js';

const SAVE_KEY = 'finas-riff-v1';
const $ = (id) => document.getElementById(id);

function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) ?? {}; } catch { return {}; }
}
function writeSave(data) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* privates Fenster: dann eben ohne Speichern */ }
}

const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 700);
const proj = { value: 1000 };     // Pixel pro Meter in 1 m Abstand (fuer Glitzerpunkte)
let pixelRatio = Math.min(devicePixelRatio, 1.75);
let world = null;

function resize() {
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  proj.value = (innerHeight * pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  world?.setPixelScale(pixelRatio * innerHeight / 900);
}
addEventListener('resize', resize);
resize();

const sound = new Sound();
const hud = new Hud();
let player;
let stations;
let shark;
let running = false;
let paused = false;

async function boot() {
  const models = await loadModels((p) => { $('bar').firstElementChild.style.width = `${Math.round(p * 100)}%`; });
  world = buildWorld(scene, models);
  resize();
  player = new Player(scene, models, camera);
  const saved = loadSave();
  stations = new Stations({ scene, models, sound, hud, player, saved, proj, colliders: world.colliders, onSave: writeSave });
  shark = new Shark({ scene, models, player, sound, proj, colliders: world.colliders, maySpeak: () => !stations.active && !sound.speaking });
  sound.preload(['shark_see', 'shark_bump_1', 'shark_bump_2']);
  sound.preload(['intro_1', 'intro_2', 'intro_3', ...STATIONS.map((s) => `st_${s.id}_intro`)]);

  renderer.compile(scene, camera);
  $('play').disabled = false;
  $('bar').style.visibility = 'hidden';
  $('play').focus();
  if (saved.done?.length || saved.eaten?.length) $('again').style.display = 'block';
  window.__riff = { THREE, scene, camera, renderer, player, stations, shark, sound, world };
  renderer.setAnimationLoop(frame);
}

async function start() {
  if (running) return;
  running = true;
  sound.unlock();
  $('start').classList.add('off');
  hud.show();
  const fresh = stations.done.size === 0;
  if (fresh) {
    await sound.say('intro_1');
    player.frozen = false;
    await sound.say('intro_2');
    if (!stations.active) sound.say('intro_3');
  } else {
    player.frozen = false;
    if (!stations.finished) sound.say('hint_glitter');
  }
}

$('play').addEventListener('click', start);
$('again').addEventListener('click', () => { localStorage.removeItem(SAVE_KEY); location.reload(); });
$('resume').addEventListener('click', () => setPaused(false));
$('mute').addEventListener('click', toggleMute);

function toggleMute() {
  sound.setMuted(!sound.muted);
  $('mute').textContent = sound.muted ? '🔇' : '🔊';
  $('mute').blur();
}

function setPaused(p) {
  if (!running) return;
  paused = p;
  $('pause').classList.toggle('off', !p);
  if (p) { sound.stopVoice(); sound.ctx?.suspend(); $('resume').focus(); } else sound.ctx?.resume();
}

addEventListener('keydown', (e) => {
  if (!running) {
    if ((e.code === 'Enter' || e.code === 'Space') && !$('play').disabled && document.activeElement !== $('again')) { e.preventDefault(); start(); }
    return;
  }
  if (e.code === 'Escape' || e.code === 'KeyP') setPaused(!paused);
  else if (paused && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); setPaused(false); }
  else if (e.code === 'KeyM') toggleMute();
});
document.addEventListener('visibilitychange', () => { if (document.hidden && running) setPaused(true); });

// Bildrate beobachten und bei schwachen Rechnern erst die Aufloesung, dann die Schatten opfern.
const perf = { t: 0, frames: 0, step: 0 };
function watchPerformance(dt) {
  perf.t += dt;
  perf.frames++;
  if (perf.t < 4) return;
  const fps = perf.frames / perf.t;
  perf.t = perf.frames = 0;
  if (fps > 40 || perf.step > 1) return;
  if (perf.step === 0) { pixelRatio = 1; resize(); } else { renderer.shadowMap.enabled = false; scene.traverse((o) => { if (o.isLight) o.castShadow = false; }); }
  perf.step++;
}

const timer = new THREE.Timer();
let time = 0;
function frame(now) {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.05);
  if (paused) return;
  time += dt;
  player.update(dt, time, world.colliders);
  if (running) { stations.update(dt, time); shark.update(dt, time); watchPerformance(dt); }
  world.update(dt, time, camera, player.pos);
  renderer.render(scene, camera);
}

boot().catch((err) => {
  console.error(err);
  const box = $('error');
  box.style.display = 'block';
  box.textContent = `Das Spiel konnte nicht geladen werden: ${err.message}. Bitte über start.bat starten (nicht die index.html doppelklicken).`;
});
