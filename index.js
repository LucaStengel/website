// ─── Startseite: Bildbühne ─────────────────────────────────────────────────
//
// Titelbild und Einleitungstext stehen im HTML noch im jeweiligen
// Listenpunkt (so funktioniert die mobile Ansicht ohne Umbauten). Auf dem
// Desktop werden sie in  #stage  umgehängt — ein Element direkt unter <body>.
// Grund: ein Vorfahre mit Transform (die Einblend-Animation der Liste) macht
// sich selbst zum Bezugsrahmen für  position: fixed , das Bild landete dann
// in der linken Spalte statt mittig rechts.

const stage = document.getElementById('stage');
const list = document.getElementById('project-index');
const items = Array.from(document.querySelectorAll('.project-item'));
// Ob die Bühne überhaupt gezeigt wird, hängt an der Fenstergrösse — nicht
// daran, ob das Gerät hovern kann. Sonst fiele jedes iPad ins Handy-Layout.
const stageLayout = window.matchMedia('(min-width: 701px) and (min-height: 500px)');
const canHover = window.matchMedia('(hover: hover)');

const slots = [];
let mounted = false;
let active = -1;
let lastIndex = -1;   // bleibt erhalten, auch wenn gerade nichts aktiv ist

// Das Bild verlässt die Bühne in die Richtung, in die man weitergeht: nach
// unten in der Liste schiebt es nach links hinaus und das nächste kommt von
// rechts herein — nach oben umgekehrt.
function setActive(index) {
    if (index === active) return;

    if (index !== -1) {
        if (lastIndex !== -1 && index !== lastIndex) {
            stage.dataset.dir = index > lastIndex ? 'fwd' : 'back';
        } else if (!stage.dataset.dir) {
            stage.dataset.dir = 'fwd';
        }
        lastIndex = index;
    }

    const leaving = slots[active];
    if (leaving) {
        leaving.classList.remove('is-active');
        leaving.classList.add('is-leaving');
        clearTimeout(leaving._timer);
        // Erst wenn es draussen ist, die Richtungsmarkierung wieder lösen —
        // sonst springt das Bild beim Klassenwechsel auf die andere Seite
        leaving._timer = setTimeout(() => leaving.classList.remove('is-leaving'), 700);
    }

    // Muss vor dem Aufruf unten stehen: ist das Bild schon bereit, läuft der
    // Rückruf sofort und prüft gegen genau diesen Wert.
    active = index;

    // Ohne Zeiger greift kein :hover — der angesteuerte Titel wird deshalb
    // zusätzlich markiert
    items.forEach((item, i) => item.classList.toggle('is-current', i === index));

    const entering = slots[index];
    if (entering) {
        // Ist das Bild noch nicht dekodiert, wird erst gewartet: sonst muss
        // der Browser mitten in der Drehung ein grosses Foto zum ersten Mal
        // aufbereiten, und die Bewegung ruckelt — direkt nach dem Neuladen
        // trifft das jeden Hover, später keinen mehr.
        whenReady(entering, () => { if (active === index) reveal(entering); });
    }
}

function reveal(entering) {
    clearTimeout(entering._timer);
    const wasLeaving = entering.classList.contains('is-leaving');
    entering.classList.remove('is-leaving');

    // Das eintretende Bild steht noch auf der Seite, die die vorige
    // Laufrichtung vorgab. Würde man es einfach aktivieren, liefe die
    // Bewegung von dort los — beim Zurückgehen also von der falschen
    // Seite. Deshalb zuerst ohne Übergang auf die richtige Seite setzen,
    // festschreiben, dann erst die Bewegung starten.
    // (Nicht nötig, wenn es gerade selbst hinausläuft: dann ist es noch
    // sichtbar und soll aus seiner aktuellen Lage zurückkommen.)
    if (!wasLeaving) {
        entering.classList.add('no-anim');
        void entering.offsetWidth;
        entering.classList.remove('no-anim');
        void entering.offsetWidth;
    }

    entering.classList.add('is-active');
}

// ─── Bereitschaft der Titelbilder ──────────────────────────────────────────

function whenReady(slot, callback) {
    if (slot._ready) return callback();
    (slot._waiting || (slot._waiting = [])).push(callback);
}

function markReady(slot) {
    if (slot._ready) return;
    slot._ready = true;
    (slot._waiting || []).forEach((cb) => cb());
    slot._waiting = null;
}

function watchImage(slot) {
    const img = slot.querySelector('img');
    if (!img) return markReady(slot);

    const decodeThen = () => {
        if (img.decode) img.decode().then(() => markReady(slot), () => markReady(slot));
        else markReady(slot);
    };

    if (img.complete && img.naturalWidth > 0) decodeThen();
    else {
        img.addEventListener('load', decodeThen, { once: true });
        img.addEventListener('error', () => markReady(slot), { once: true });
    }

    // Notbremse: sollte ein Bild hängen, blockiert es die Bühne nicht dauerhaft
    setTimeout(() => markReady(slot), 4000);
}

function mount() {
    if (mounted || !stage) return;

    items.forEach((item, i) => {
        const media = item.querySelector('.item-media');
        const blurb = item.querySelector('.item-blurb');
        if (!media) return;

        const slot = document.createElement('div');
        slot.className = 'stage-slot';
        slot.append(media);
        if (blurb) slot.append(blurb);
        stage.append(slot);
        slots[i] = slot;
    });

    stage.hidden = false;
    mounted = true;

    // Die Titelbilder stehen im HTML auf „lazy“, damit Handys sie gar nicht
    // erst laden — dort werden sie nie gezeigt. Sobald die Bühne steht, werden
    // sie hier sofort angefordert und dekodiert, damit der erste Hover direkt
    // nach dem Laden nicht stockt.
    slots.forEach((slot, i) => {
        const img = slot.querySelector('img');
        if (img) {
            img.loading = 'eager';
            if (i === 0) img.fetchPriority = 'high';
        }
        slot._ready = false;
        watchImage(slot);
    });

    // Ohne Zeiger gibt es kein Hover — dann steht von Anfang an ein Bild da
    if (!canHover.matches) setActive(0);
}

function unmount() {
    if (!mounted) return;

    items.forEach((item, i) => {
        const slot = slots[i];
        if (!slot) return;
        const media = slot.querySelector('.item-media');
        const blurb = slot.querySelector('.item-blurb');
        if (media) item.insertBefore(media, item.firstElementChild);
        if (blurb) item.append(blurb);
        slot.remove();
    });

    slots.length = 0;
    stage.hidden = true;
    mounted = false;
    active = -1;
}

function sync() {
    if (stageLayout.matches) mount();
    else unmount();
}

// ─── Bedienung ─────────────────────────────────────────────────────────────

// Mit Zeiger: Hover, mit kurzer Verzögerung. Fährt die Maus nur über die
// Liste hinweg, fängt kein Bild an aufzutauchen — sonst flackert es.
const HOVER_INTENT = 40;
let intentTimer;

if (canHover.matches) {
    items.forEach((item, i) => {
        item.addEventListener('pointerenter', () => {
            clearTimeout(intentTimer);
            if (mounted) intentTimer = setTimeout(() => setActive(i), HOVER_INTENT);
        });
    });

    // Abgemeldet wird erst beim Verlassen der ganzen Liste, nicht schon beim
    // Verlassen eines einzelnen Titels. Sonst läge zwischen zwei Titeln immer
    // ein „nichts aktiv“, und die Laufrichtung — sie ergibt sich aus dem
    // Vergleich mit dem vorher aktiven Titel — wäre nicht mehr bestimmbar.
    if (list) {
        list.addEventListener('pointerleave', () => {
            clearTimeout(intentTimer);
            if (mounted) setActive(-1);
        });
    }
}

// Ohne Zeiger (iPad): der erste Fingertipp holt das Bild hervor, der zweite
// auf denselben Titel öffnet das Projekt. Beim Laden steht das erste Projekt
// schon auf der Bühne, damit die rechte Seite nicht leer wirkt.
if (!canHover.matches) {
    items.forEach((item, i) => {
        const link = item.querySelector('.item-link');
        if (!link) return;
        link.addEventListener('click', (e) => {
            if (mounted && active !== i) {
                e.preventDefault();
                setActive(i);
            }
        });
    });
}

// Tastatur führt immer direkt, egal welches Eingabegerät
items.forEach((item, i) => {
    item.addEventListener('focusin', () => {
        clearTimeout(intentTimer);
        if (mounted) setActive(i);
    });
});

if (list) {
    list.addEventListener('focusout', (e) => {
        if (mounted && canHover.matches && !list.contains(e.relatedTarget)) setActive(-1);
    });
}

sync();

if (stageLayout.addEventListener) stageLayout.addEventListener('change', sync);
else stageLayout.addListener(sync); // ältere Safari-Versionen
