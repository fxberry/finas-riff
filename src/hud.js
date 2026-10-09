// Anzeige ueber dem Spiel: Sticker-Album, Buchstabenkarte, Krebschen-Zaehler.

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.album = $('album');
    this.card = $('card');
    this.shrimp = $('shrimp');
    this.dots = $('shrimp-dots');
    this.count = $('shrimp-count');
    for (let i = 0; i < 10; i++) this.dots.appendChild(document.createElement('i'));
  }

  show() { $('hud').classList.add('on'); }

  setAlbum(stations, done) {
    this.album.replaceChildren(...stations.map((s) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.id = s.id;
      slot.innerHTML = `<img src="assets/img/sticker_${s.id}.webp" alt="${s.word}"><b>${s.letter}</b>`;
      if (done.has(s.id)) slot.classList.add('found');
      return slot;
    }));
  }

  addSticker(id) {
    const slot = this.album.querySelector(`[data-id="${id}"]`);
    slot?.classList.add('found', 'new');
    setTimeout(() => slot?.classList.remove('new'), 1600);
  }

  showCard(letter, word) {
    this.card.innerHTML = `<span class="letter">${letter}</span><span class="word"><em>${word[0]}</em>${word.slice(1)}</span>`;
    this.card.classList.add('on');
  }

  hideCard() { this.card.classList.remove('on'); }

  setShrimp(n, bump = false) {
    this.count.textContent = n;
    [...this.dots.children].forEach((d, i) => d.classList.toggle('on', i < n));
    this.shrimp.classList.toggle('on', n > 0);
    if (bump) {
      this.shrimp.classList.remove('bump');
      void this.shrimp.offsetWidth;      // Animation neu starten
      this.shrimp.classList.add('bump');
    }
  }

  finale() {
    $('banner').classList.add('on');
    this.album.classList.add('party');
    setTimeout(() => $('banner').classList.remove('on'), 9000);
  }
}
