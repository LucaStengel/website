// ─── Hintergrund: Punktefeld und Kritzelzeiger ─────────────────────────────
//
// Frei verstreute Punkte; jeder kreist in eigenem Tempo um seinen Platz und
// glimmt für sich auf und ab. Darüber treiben flache Wellen aus vielen
// Richtungen und, schwächer, zwei schräge Wellenzüge — zusammen ergeben sie
// helle Flecken, die wandern, wachsen und zerfallen. Bewegt sich die Maus,
// hellen sich die Punkte um sie herum in einem wabernden Fleck auf.
//
// Dazu (nur mit Maus) ein kleiner, mit dem Bleistift hingekritzelter Kringel
// statt des Pfeils.
//
// Die Seite legt nur  <div class="backdrop">  an; Zeichenflächen entstehen hier.
// Ohne JavaScript bleibt der dunkle Grund mit Schwaden und Korn aus base.css.

(() => {
    const backdrop = document.querySelector('.backdrop');
    if (!backdrop) return;

    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const TAU = Math.PI * 2;

    // Mischung aus gerichteten Wellenzügen (0) und freiem Zufall (1)
    const MIX = 0.75;
    // Punktabstand = grössere Fensterseite / DENSITY
    const DENSITY = 115;

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    // Fester Zufall je Gitterplatz — beim Neuaufbau springt nichts
    const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
    // Reproduzierbarer Zufall für die Wellenparameter
    const seeded = a => () => {
        a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };

    // Helligkeit wird in Stufen gezeichnet: alle Punkte einer Stufe landen
    // in einem Pfad und werden mit einem einzigen fill() gemalt. Die Stufen
    // liegen nach der Wurzel verteilt — unten sehr fein, damit blasse Punkte
    // nicht sichtbar springen oder plötzlich auftauchen.
    const LEVELS = 64;
    const A_MAX = 0.62;
    const FILLS = Array.from({ length: LEVELS }, (_, i) =>
        `rgba(242, 241, 238, ${((i / (LEVELS - 1)) ** 2 * A_MAX).toFixed(4)})`);
    const level = a => Math.min(LEVELS - 1, Math.round(Math.sqrt(a > 0 ? a / A_MAX : 0) * (LEVELS - 1)));

    // Sehr kleine Punkte flimmern, wenn sie übers Pixelraster wandern —
    // darum nie kleiner als rMin, dafür entsprechend blasser
    let rMin = 0.6;

    // ── Maus ────────────────────────────────────────────────────────────
    const pointer = { x: 0, y: 0, inside: false };
    const place = e => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true; };
    addEventListener('pointermove', place, { passive: true });
    addEventListener('pointerdown', place, { passive: true });
    // Finger hebt ab, Maus verlässt das Fenster: die nächste Berührung soll
    // nicht als Bewegung vom alten Punkt zum neuen gelten
    addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') pointer.inside = false; });
    document.addEventListener('mouseout', e => { if (!e.relatedTarget) pointer.inside = false; });
    addEventListener('blur', () => { pointer.inside = false; });

    // ── Wellen ──────────────────────────────────────────────────────────
    // Zwei schräge Wellenzüge, Quellen weit ausserhalb des Bilds (in vmax),
    // dadurch leicht gebogene Fronten: A von links unten, B von rechts oben
    const TRAINS = [
        { sx: -1.36, sy:  1.24, len: 0.25,  period: 13,  amp: 1.00, orbit: 0.60, phase: 0.0 },
        { sx: -1.10, sy:  1.30, len: 0.11,  period: 8,   amp: 0.32, orbit: 0.20, phase: 1.7 },
        { sx:  1.49, sy: -1.11, len: 0.19,  period: 16,  amp: 0.78, orbit: 0.50, phase: 0.6 },
        { sx:  1.25, sy: -0.85, len: 0.075, period: 6.5, amp: 0.20, orbit: 0.12, phase: 2.9 },
    ];
    // Sehr lange, langsame Dünung — hebt und senkt nur die Helligkeit
    const SWELL = { sx: -0.4, sy: -0.6, len: 1.1, period: 40 };

    let W = 0, H = 0;

    function buildField() {
        const vmax = Math.max(W, H);
        const s = clamp(vmax / DENSITY, 5, 19);
        // Je dichter, desto kleiner und zarter der einzelne Punkt — sonst
        // würde mehr Punkte vor allem heller bedeuten
        const dim = Math.sqrt(Math.min(1, s / 18));
        const m = s * 2;
        const cols = Math.ceil((W + 2 * m) / s) + 1;
        const rows = Math.ceil((H + 2 * m) / s) + 1;

        // Viele flache Wellen aus zufälligen Richtungen. Einzeln wäre jede ein
        // Band, zusammen löschen sie sich mal aus, mal türmen sie sich — übrig
        // bleiben Flecken. Lange Wellen tragen mehr als kurze.
        const rnd = seeded(7);
        const noise = Array.from({ length: 7 }, () => {
            const ang = rnd() * TAU;
            const len = 0.1 + rnd() * 0.32;
            return { dx: Math.cos(ang), dy: Math.sin(ang), len, period: 9 + rnd() * 12, amp: len, phase: rnd() * TAU };
        });

        const WN = TRAINS.length, NN = noise.length;
        const n = cols * rows;
        const bx = new Float32Array(n), by = new Float32Array(n);
        // Alles, was nur vom Ort abhängt, wird hier einmal ausgerechnet. Pro
        // Bild dreht sich nur noch die Zeit weiter — dank
        // cos(a − b) = cos a · cos b + sin a · sin b genügen dafür ein paar
        // Multiplikationen statt Winkelfunktionen je Punkt und Welle.
        const wC = new Float32Array(n * WN), wS = new Float32Array(n * WN);
        const wUx = new Float32Array(n * WN), wUy = new Float32Array(n * WN);
        const nC = new Float32Array(n * NN), nS = new Float32Array(n * NN);
        const gC = new Float32Array(n), gS = new Float32Array(n);
        const orbR = new Float32Array(n), orbW = new Float32Array(n), orbP = new Float32Array(n);
        const twW = new Float32Array(n), twP = new Float32Array(n);
        const size = new Float32Array(n), vig = new Float32Array(n);

        let p = 0;
        for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols; i++, p++) {
                // Je Rasterzelle ein Punkt an beliebiger Stelle darin: wirkt
                // zufällig, lässt aber keine grossen Löcher
                const x = -m + (i + hash(i, j)) * s;
                const y = -m + (j + hash(j, i + 7)) * s;
                bx[p] = x; by[p] = y;

                for (let w = 0; w < WN; w++) {
                    const tr = TRAINS[w];
                    const dx = x - tr.sx * vmax, dy = y - tr.sy * vmax;
                    const r = Math.hypot(dx, dy);
                    const ph = r * TAU / (tr.len * vmax) + tr.phase;
                    const o = p * WN + w;
                    wC[o] = Math.cos(ph); wS[o] = Math.sin(ph);
                    wUx[o] = dx / r; wUy[o] = dy / r;
                }
                for (let k = 0; k < NN; k++) {
                    const nz = noise[k];
                    const ph = (nz.dx * x + nz.dy * y) * TAU / (nz.len * vmax) + nz.phase;
                    nC[p * NN + k] = Math.cos(ph); nS[p * NN + k] = Math.sin(ph);
                }

                // Eigene Kreisbahn: Radius, Tempo (7–15 s je Runde, mal links,
                // mal rechts herum) und Startpunkt für jeden Punkt anders
                orbR[p] = s * (0.15 + 0.45 * hash(i + 101, j));
                orbW[p] = TAU / (7 + 8 * hash(i + 202, j)) * (hash(i + 303, j) < 0.5 ? -1 : 1);
                orbP[p] = hash(i + 404, j) * TAU;
                // Eigenes, langsames Auf- und Abglimmen (4–12 s)
                twW[p] = TAU / (4 + 8 * hash(i + 505, j));
                twP[p] = hash(i + 606, j) * TAU;
                size[p] = 0.7 + 0.6 * hash(i + 707, j);

                const gp = Math.hypot(x - SWELL.sx * vmax, y - SWELL.sy * vmax) * TAU / (SWELL.len * vmax);
                gC[p] = Math.cos(gp); gS[p] = Math.sin(gp);
                // Zu den Rändern hin blasser
                const e = Math.hypot((x - W / 2) / (W / 2), (y - H * 0.46) / (H / 2));
                vig[p] = 1 - 0.65 * smooth(0.45, 1.3, e);
            }
        }

        const wOmega = Float32Array.from(TRAINS, w => TAU / w.period);
        const wAmp = Float32Array.from(TRAINS, w => w.amp);
        const wOrbit = Float32Array.from(TRAINS, w => w.orbit * s);
        const wAmpSum = TRAINS.reduce((a, w) => a + w.amp, 0);

        const nOmega = Float32Array.from(noise, z => TAU / z.period);
        const nAmp = Float32Array.from(noise, z => z.amp);
        const ampMax = Math.max(...nAmp);
        const nOrbX = Float32Array.from(noise, z => 0.5 * s * z.amp / ampMax * z.dx);
        const nOrbY = Float32Array.from(noise, z => 0.5 * s * z.amp / ampMax * z.dy);
        // Die Summe zufälliger Wellen erreicht ihr theoretisches Maximum
        // praktisch nie — normiert wird auf die typische Streuung
        const nNorm = 1.6 * Math.sqrt(noise.reduce((a, z) => a + z.amp * z.amp, 0) / 2);
        const swellOmega = TAU / SWELL.period;
        // Zeitanteil der Phasen, einmal pro Bild
        const wCt = new Float32Array(WN), wSt = new Float32Array(WN);
        const nCt = new Float32Array(NN), nSt = new Float32Array(NN);

        // ── Schein um die Maus ──────────────────────────────────────────
        // Bewegt sich die Maus, hellen sich die Punkte um sie herum auf — ein
        // weicher Fleck, dessen Rand langsam wabert: drei ruhige Ausbuchtungen
        // wandern in verschiedenem Tempo um den Umriss, und der Fleck selbst
        // pendelt leicht um den Zeiger. Innen glimmt jeder Punkt in seinem
        // eigenen Takt. Steht die Maus, verglimmt der Fleck.
        const R0 = clamp(vmax * 0.09, 80, 150);       // mittlerer Radius
        const RMAX2 = (R0 * 1.45) ** 2;               // grösste Ausbuchtung
        const FOLLOW = 0.04;    // s — so weich folgt der Fleck der Maus
        const RISE = 0.15;      // s — so schnell erscheint er
        const FADE = 1.0;       // s — so langsam verglimmt er
        const glow = { x: 0, y: 0, on: 0, idle: Infinity, lastX: null, lastY: null };

        return {
            n,
            advance(dt) {
                if (pointer.inside) {
                    if (glow.lastX === null) {
                        // Maus taucht auf: Fleck gleich dort, nicht hinfliegen
                        if (glow.on < 0.01) { glow.x = pointer.x; glow.y = pointer.y; }
                    } else if (Math.hypot(pointer.x - glow.lastX, pointer.y - glow.lastY) > 0.5) {
                        glow.idle = 0;
                    }
                    glow.lastX = pointer.x;
                    glow.lastY = pointer.y;
                    const k = 1 - Math.exp(-dt / FOLLOW);
                    glow.x += (pointer.x - glow.x) * k;
                    glow.y += (pointer.y - glow.y) * k;
                } else {
                    glow.lastX = null;
                    glow.idle = Infinity;
                }
                glow.idle += dt;
                const target = glow.idle < 0.15 ? 1 : 0;
                glow.on += (target - glow.on) * (1 - Math.exp(-dt / (target ? RISE : FADE)));
            },
            step(t, ox, oy, or, lv) {
                const mx = MIX, wv = 1 - MIX;
                const gOn = glow.on;
                const gX = glow.x + R0 * 0.1 * Math.cos(0.9 * t);
                const gY = glow.y + R0 * 0.1 * Math.sin(0.7 * t);
                for (let w = 0; w < WN; w++) { wCt[w] = Math.cos(wOmega[w] * t); wSt[w] = Math.sin(wOmega[w] * t); }
                for (let k = 0; k < NN; k++) { nCt[k] = Math.cos(nOmega[k] * t); nSt[k] = Math.sin(nOmega[k] * t); }
                const sCt = Math.cos(swellOmega * t), sSt = Math.sin(swellOmega * t);

                for (let p = 0; p < n; p++) {
                    // Wellenzüge: Höhe fürs Licht, Kreisbahn für die Lage
                    // (Phase θ = Ortsanteil − ω·t)
                    let hw = 0, dx = 0, dy = 0;
                    for (let w = 0, o = p * WN; w < WN; w++, o++) {
                        const cs = wC[o] * wCt[w] + wS[o] * wSt[w];
                        const sn = wS[o] * wCt[w] - wC[o] * wSt[w];
                        hw += wAmp[w] * cs;
                        dx -= wOrbit[w] * sn * wUx[o];
                        dy -= wOrbit[w] * sn * wUy[o];
                    }
                    hw /= wAmpSum;
                    dx *= wv; dy *= wv;

                    // Wellen kreuz und quer
                    let hn = 0, nx = 0, ny = 0;
                    for (let k = 0, o = p * NN; k < NN; k++, o++) {
                        const cs = nC[o] * nCt[k] + nS[o] * nSt[k];
                        const sn = nS[o] * nCt[k] - nC[o] * nSt[k];
                        hn += nAmp[k] * cs;
                        nx -= nOrbX[k] * sn;
                        ny -= nOrbY[k] * sn;
                    }
                    hn = clamp(hn / nNorm, -1, 1);

                    // Eigene Kreisbahn
                    const ph = orbP[p] + orbW[p] * t;
                    dx += mx * (nx + orbR[p] * Math.cos(ph));
                    dy += mx * (ny + orbR[p] * Math.sin(ph));

                    const x = bx[p] + dx, y = by[p] + dy;
                    const tw = 0.5 + 0.5 * Math.sin(twP[p] + twW[p] * t);

                    // Schein um die Maus: weicher Fleck mit wabberndem Rand
                    let boost = 0;
                    if (gOn > 0.003) {
                        const ex = x - gX, ey = y - gY, d2 = ex * ex + ey * ey;
                        if (d2 < RMAX2) {
                            const th = Math.atan2(ey, ex);
                            const R = R0 * (1 + 0.2 * Math.sin(2 * th + 1.1 * t)
                                              + 0.13 * Math.sin(3 * th - 0.8 * t + 1.7)
                                              + 0.07 * Math.sin(5 * th + 1.9 * t + 0.4));
                            const u = d2 / (R * R);
                            if (u < 1) boost = (1 - u) * (1 - u) * gOn * (0.6 + 0.4 * tw);
                        }
                    }

                    const c = clamp(0.5 + 0.5 * (wv * hw + mx * hn), 0, 1);   // 0 Tal … 1 Kamm
                    const flicker = 1 - 0.65 * mx * (1 - tw);
                    const gain = 0.7 + 0.3 * (gC[p] * sCt + gS[p] * sSt);
                    let a = (0.03 + 0.5 * Math.pow(c, 2.4)) * flicker * gain * vig[p] * dim
                          + 0.3 * boost * dim;
                    let r = (0.5 + 1.05 * Math.pow(c, 1.8)) * (1 + mx * (size[p] - 1)) * dim * (1 + 0.35 * boost);
                    if (r < rMin) { a *= (r * r) / (rMin * rMin); r = rMin; }

                    ox[p] = x;
                    oy[p] = y;
                    or[p] = r;
                    lv[p] = level(a);
                }
                return n;
            }
        };
    }

    // ── Zeichnen ────────────────────────────────────────────────────────
    const canvas = document.createElement('canvas');
    canvas.className = 'dots';
    backdrop.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    let field = null, raf = 0, last = 0;
    let ox, oy, or, lv, order;
    const counts = new Int32Array(LEVELS + 1);
    const starts = new Int32Array(LEVELS);

    function build() {
        const dpr = Math.min(devicePixelRatio || 1, 2);
        rMin = dpr >= 2 ? 0.6 : 0.85;
        W = backdrop.clientWidth;
        H = backdrop.clientHeight;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        field = buildField();
        ox = new Float32Array(field.n);
        oy = new Float32Array(field.n);
        or = new Float32Array(field.n);
        lv = new Uint8Array(field.n);
        order = new Int32Array(field.n);
    }

    function render(t) {
        ctx.clearRect(0, 0, W, H);
        const n = field.step(t, ox, oy, or, lv);

        // Nach Helligkeitsstufe sortieren (Zählsortierung, kein Speicher pro Bild)
        counts.fill(0);
        for (let p = 0; p < n; p++) counts[lv[p] + 1]++;
        for (let l = 1; l <= LEVELS; l++) counts[l] += counts[l - 1];
        starts.set(counts.subarray(0, LEVELS));
        for (let p = 0; p < n; p++) order[starts[lv[p]]++] = p;

        for (let l = 1; l < LEVELS; l++) {
            const from = counts[l], to = counts[l + 1];
            if (from === to) continue;
            ctx.beginPath();
            for (let q = from; q < to; q++) {
                const p = order[q];
                ctx.moveTo(ox[p] + or[p], oy[p]);
                ctx.arc(ox[p], oy[p], or[p], 0, TAU);
            }
            ctx.fillStyle = FILLS[l];
            ctx.fill();
        }
    }

    function loop(now) {
        const t = now / 1000;
        field.advance(clamp(t - last, 0, 0.1));
        last = t;
        render(t);
        raf = requestAnimationFrame(loop);
    }

    function start() {
        cancelAnimationFrame(raf);
        build();
        if (still) render(20);
        else raf = requestAnimationFrame(loop);
    }

    // Nur neu aufbauen, wenn sich die Fläche wirklich ändert
    let resizeQueued = false;
    addEventListener('resize', () => {
        if (resizeQueued) return;
        resizeQueued = true;
        requestAnimationFrame(() => {
            resizeQueued = false;
            if (backdrop.clientWidth !== W || backdrop.clientHeight !== H) start();
        });
    });

    start();

    // ── Kritzelzeiger ───────────────────────────────────────────────────
    //
    // Statt des Pfeils ein kleiner, mehrfach übermalter Kringel, wie mit dem
    // Bleistift hingekritzelt. Alle ~200 ms wird er neu gekritzelt — dasselbe
    // «Kochen» der Linie wie bei handgezeichnetem Trickfilm. Über Links und
    // Knöpfen wird er grösser und dichter, beim Klicken zieht er sich
    // zusammen. Ein kurzer Krakel in der Mitte markiert die genaue Stelle.
    // Nur mit echter Maus; auf Touch bleibt alles, wie es ist.

    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const pen = document.createElement('canvas');
    pen.className = 'scribble';
    pen.setAttribute('aria-hidden', 'true');
    document.body.appendChild(pen);
    const c = pen.getContext('2d');
    const SIZE = 48;
    const BOIL = still ? Infinity : 200;
    const penDpr = Math.min(devicePixelRatio || 1, 2);
    pen.width = pen.height = SIZE * penDpr;
    c.setTransform(penDpr, 0, 0, penDpr, 0, 0);
    document.documentElement.classList.add('has-scribble');

    let shown = false;
    let hot = 0, hotTarget = 0, press = 0, pressTarget = 0;
    let boilSeed = 1, seed = 1, lastBoil = -Infinity, drawn = '';

    addEventListener('pointermove', e => {
        if (!shown) { shown = true; pen.classList.add('is-visible'); }
        const target = e.target;
        hotTarget = target && target.closest && target.closest('a, button, input, label') ? 1 : 0;
    }, { passive: true });
    addEventListener('pointerdown', () => { pressTarget = 1; });
    addEventListener('pointerup', () => { pressTarget = 0; });
    document.addEventListener('mouseout', e => {
        if (!e.relatedTarget) { shown = false; pen.classList.remove('is-visible'); }
    });

    // Eigener kleiner Zufall: pro «Kochen» ein neuer Startwert, damit sich
    // beim Wachsen über einem Link nur die Grösse ändert, nicht die Form
    const rand = () => (seed = seed * 16807 % 2147483647) / 2147483647;

    function scribble() {
        seed = boilSeed;
        c.clearRect(0, 0, SIZE, SIZE);
        const cx = SIZE / 2, cy = SIZE / 2;
        const R = 5 + 6 * hot - 1.8 * press;
        const turns = 2.1 + 0.9 * hot;
        const steps = Math.round(turns * 28);
        const a1 = rand() * TAU, a2 = rand() * TAU;
        const wob = 0.1 + 0.06 * rand();
        const squash = 0.9 + 0.1 * rand();
        const driftX = (rand() - 0.5) * 3, driftY = (rand() - 0.5) * 3;
        const begin = rand() * TAU;

        c.lineCap = c.lineJoin = 'round';
        c.strokeStyle = 'rgba(255, 255, 255, 0.88)';
        c.lineWidth = 1;
        c.beginPath();
        for (let i = 0; i <= steps; i++) {
            const u = i / steps;
            const th = begin + u * turns * TAU;
            // Radius schwankt um den Kreis herum und wächst von Runde zu
            // Runde — Anfang innen, Ende als kleiner Schwung nach aussen
            const r = R * (1 + wob * Math.sin(2 * th + a1) + 0.05 * Math.sin(3 * th + a2) + 0.14 * (u - 0.5))
                    + (rand() - 0.5) * 0.5;
            const px = cx + driftX * u + Math.cos(th) * r;
            const py = cy + driftY * u + Math.sin(th) * r * squash;
            if (i) c.lineTo(px, py); else c.moveTo(px, py);
        }
        c.stroke();

        c.beginPath();
        c.moveTo(cx + (rand() - 0.5) * 1.5, cy + (rand() - 0.5) * 1.5);
        for (let i = 0; i < 3; i++) c.lineTo(cx + (rand() - 0.5) * 2.5, cy + (rand() - 0.5) * 2.5);
        c.stroke();
    }

    function tick(now) {
        hot += (hotTarget - hot) * 0.18;
        press += (pressTarget - press) * 0.35;
        pen.style.transform = `translate3d(${pointer.x - SIZE / 2}px, ${pointer.y - SIZE / 2}px, 0)`;
        if (now - lastBoil > BOIL) {
            boilSeed = 1 + Math.floor(Math.random() * 2147483645);
            lastBoil = now;
        }
        const state = `${boilSeed}|${hot.toFixed(3)}|${press.toFixed(3)}`;
        if (state !== drawn) { scribble(); drawn = state; }
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
})();
