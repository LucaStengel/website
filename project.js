// ─── Projektseite: Auftauchen der Bilder + Lightbox ────────────────────────
//
// Die Anordnung selbst steht fertig im HTML (generate.py verteilt die Bilder
// auf Blöcke) — hier wird nichts mehr gerechnet, dadurch springt beim Laden
// auch nichts mehr nach.

const tiles = Array.from(document.querySelectorAll('.tile'));

// ─── Bilder tauchen beim Scrollen auf ──────────────────────────────────────

// Erst einblenden, wenn das Bild wirklich fertig ist — sonst blendet die
// leere Fläche auf und das Foto erscheint mitten in der Bewegung nach.
function revealWhenReady(tile) {
    const img = tile.querySelector('img');
    const show = () => tile.classList.add('is-visible');

    if (!img) return show();

    if (img.complete && img.naturalWidth > 0) {
        if (img.decode) img.decode().then(show, show);
        else show();
        return;
    }

    img.addEventListener('load', () => requestAnimationFrame(show), { once: true });
    img.addEventListener('error', show, { once: true });
}

if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            revealWhenReady(entry.target);
            observer.unobserve(entry.target);
        });
    }, { rootMargin: '0px 0px -4% 0px' });

    tiles.forEach((tile) => observer.observe(tile));

    // Bilder innerhalb eines Blocks leicht versetzt einblenden
    document.querySelectorAll('.block').forEach((block) => {
        block.querySelectorAll('.tile').forEach((tile, i) => {
            tile.style.transitionDelay = `${i * 70}ms`;
        });
    });
} else {
    tiles.forEach((tile) => tile.classList.add('is-visible'));
}

// ─── Lightbox ──────────────────────────────────────────────────────────────

const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const counter = document.getElementById('lb-counter');
const sources = tiles.map((t) => t.dataset.full);

let current = -1;
let lastFocus = null;

function preload(index) {
    if (index < 0 || index >= sources.length) return;
    const img = new Image();
    img.src = sources[index];
}

function show(index, opening = false) {
    if (index < 0 || index >= sources.length) return;
    current = index;

    if (opening) {
        lastFocus = document.activeElement;
        lightbox.hidden = false;
        document.body.classList.add('lightbox-open');
        requestAnimationFrame(() => lightbox.classList.add('is-open'));
    } else {
        lightbox.classList.remove('is-ready');
    }

    const img = new Image();
    img.onload = () => {
        lightboxImg.src = img.src;
        lightbox.classList.add('is-ready');
    };
    img.src = sources[index];
    if (img.complete) img.onload();

    counter.textContent = `${String(index + 1).padStart(2, '0')} / ${String(sources.length).padStart(2, '0')}`;
    preload(index + 1);
    preload(index - 1);
}

function step(delta) {
    show((current + delta + sources.length) % sources.length);
}

function close() {
    lightbox.classList.remove('is-open', 'is-ready');
    document.body.classList.remove('lightbox-open');
    setTimeout(() => {
        lightbox.hidden = true;
        lightboxImg.src = '';
    }, 400);
    if (lastFocus) lastFocus.focus();
}

tiles.forEach((tile, i) => tile.addEventListener('click', () => show(i, true)));

document.getElementById('lb-close').addEventListener('click', close);
document.getElementById('lb-prev').addEventListener('click', (e) => { e.stopPropagation(); step(-1); });
document.getElementById('lb-next').addEventListener('click', (e) => { e.stopPropagation(); step(1); });

lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox || e.target === lightboxImg) close();
});

document.addEventListener('keydown', (e) => {
    if (lightbox.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
});

// Wischen auf dem Handy
let touchStartX = null;
lightbox.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
lightbox.addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    touchStartX = null;
}, { passive: true });
