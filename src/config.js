// Spielinhalt an einem Ort: Stationen (Tier/Ding + Anlaut), Weltmasse.
// Alle Tripo-Modelle schauen im Rohzustand entlang +X; `yaw` dreht sie in der Welt.

export const WORLD = {
  radius: 54,        // ab hier schiebt die Stroemung zurueck
  ceiling: 15,       // hoeher steigt das Seepferdchen nicht
  surface: 24,       // Wasseroberflaeche
  start: { x: 0, z: 0, heading: 0.62 },   // Blick Richtung Fisch
};

// pos: [x, Hoehe ueber Sand, z]   size: groesste Ausdehnung in Metern
export const STATIONS = [
  { id: 'fisch',    word: 'FISCH',    letter: 'F', model: 'fisch',    pos: [10, 2.0, 14],   size: 1.3, yaw: 0,    trigger: 8, move: 'kreis' },
  { id: 'muschel',  word: 'MUSCHEL',  letter: 'M', model: 'muschel',  pos: [-15, 0, 11],    size: 1.6, yaw: 0.6,  trigger: 8, move: 'atmen' },
  { id: 'krabbe',   word: 'KRABBE',   letter: 'K', model: 'krabbe',   pos: [23, 0, -5],     size: 1.7, yaw: 2.4,  trigger: 8.5, move: 'seitwaerts' },
  { id: 'seestern', word: 'SEESTERN', letter: 'S', model: 'seestern', pos: [-22, 0, -9],    size: 1.5, yaw: 0.3,  trigger: 8, move: 'atmen' },
  { id: 'anker',    word: 'ANKER',    letter: 'A', model: 'anker',    pos: [5, 0, -25],     size: 4.2, yaw: 1.1,  trigger: 9, move: 'still' },
  { id: 'tor',      word: 'TOR',      letter: 'T', model: 'tor',      pos: [0, 0, 39],      size: 8.5, yaw: Math.PI / 2, trigger: 10, move: 'still', through: true },
  { id: 'qualle',   word: 'QUALLE',   letter: 'Q', model: null,       pos: [31, 3.2, 24],   size: 1.5, yaw: 0,    trigger: 8.5, move: 'schweben' },
  { id: 'oktopus',  word: 'OKTOPUS',  letter: 'O', model: 'oktopus',  pos: [-31, 0, 26],    size: 2.2, yaw: -0.9, trigger: 8.5, move: 'atmen' },
  { id: 'rochen',   word: 'ROCHEN',   letter: 'R', model: 'rochen',   pos: [-12, 4.5, -38], size: 6.0, yaw: 0,    trigger: 11, move: 'gleiten' },
];

export const LETTERS = STATIONS.map((s) => s.letter);

export const MODELS = ['seepferd', 'saeule', 'tor', 'korallenfels_a', 'korallenfels_b', 'anker',
  'fisch', 'fisch_klein', 'muschel', 'krabbe', 'rochen', 'seestern', 'oktopus', 'hai'];

// Krebschen zum Fressen und Zaehlen (1-10): liegen als Brotkrumen auf den Wegen zu den Stationen.
export const SHRIMPS = [
  [4, 1.8, 5.5], [7.5, 2.2, 10.5], [-6, 1.6, 4.5], [-11, 1.4, 8.5], [10, 1.8, -2],
  [17, 1.5, -4], [-9, 1.7, -4], [-16, 1.5, -7], [1.5, 1.8, -11], [3.5, 1.6, -18],
];

// Sanft gewellter Sandboden; am Rand steigt er zu einer Schuessel an.
export function groundHeight(x, z) {
  const r = Math.hypot(x, z);
  const t = Math.min(Math.max((r - 46) / 26, 0), 1);
  const rim = t * t * (3 - 2 * t) * 11;
  return 0.8 * Math.sin(x * 0.07) * Math.cos(z * 0.06)
    + 0.35 * Math.sin(x * 0.19 + 1.3) * Math.sin(z * 0.23)
    + rim;
}

// Kleiner deterministischer Zufall, damit das Riff bei jedem Start gleich aussieht.
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
