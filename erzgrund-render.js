/* ============================================================
   Erzgrund - erzgrund-render.js
   Zeichnet die Welt auf ein Canvas. Alles wird mit Canvas-
   Primitiven gemalt, es gibt keine Bilddateien - das haelt die
   Ladezeit bei null und die Grafik konsistent.

   Deterministische Variation: Grasbueschel, Felsformen und
   Baumgroessen kommen aus einem Hash der Feldkoordinaten. Damit
   sieht jedes Feld anders aus, aber immer gleich anders.
   ============================================================ */

const EGRender = (function () {
    'use strict';

    const T = EG_CONFIG.tile;
    let cv = null, ctx = null;
    let vw = 0, vh = 0, dpr = 1;
    let camX = 0, camY = 0;
    let anim = 0;            // laeuft immer weiter, fuer Wasser und Schwanken
    let walkPhase = 0;
    const pops = [];         // aufsteigende Texte
    const bits = [];         // Splitter beim Schlagen

    /* Stabiler Pseudo-Zufall pro Feld. */
    function hash(x, y) {
        let h = x * 374761393 + y * 668265263;
        h = (h ^ (h >> 13)) * 1274126177;
        return ((h ^ (h >> 16)) >>> 0) / 4294967296;
    }

    function init(canvas) {
        cv = canvas;
        ctx = cv.getContext('2d');
        resize();
        window.addEventListener('resize', resize);
        // Tailwind kommt per CDN und legt sein Layout erst nach DOMContentLoaded
        // an. Ohne Beobachter bliebe das Canvas auf der Notgroesse stehen.
        if (window.ResizeObserver) new ResizeObserver(resize).observe(cv.parentElement);
        window.addEventListener('load', resize);
    }

    function resize() {
        if (!cv) return;
        const box = cv.parentElement.getBoundingClientRect();
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        vw = Math.max(320, Math.floor(box.width));
        vh = Math.max(240, Math.floor(box.height));
        cv.width = Math.floor(vw * dpr);
        cv.height = Math.floor(vh * dpr);
        cv.style.width = vw + 'px';
        cv.style.height = vh + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = false;
    }

    function popup(text, wx, wy, color) {
        pops.push({ text: text, x: wx, y: wy, life: 1400, color: color || '#fff' });
    }

    function hitBits(tx, ty, color) {
        for (let i = 0; i < 7; i++) {
            bits.push({
                x: tx * T + T / 2, y: ty * T + T / 2,
                vx: (Math.random() - 0.5) * 2.4, vy: -Math.random() * 2.2 - 0.6,
                life: 420, color: color || '#d6d3d1'
            });
        }
    }

    /* ------------------------------------------------------------
       BODEN
       ------------------------------------------------------------ */
    function drawGround(x, y, t, outdoor) {
        const px = x * T, py = y * T;
        const r = hash(x, y);

        if (t === '~') {
            const w = Math.sin(anim / 600 + x * 0.7 + y * 0.4);
            ctx.fillStyle = '#1d4ed8';
            ctx.fillRect(px, py, T, T);
            ctx.fillStyle = 'rgba(96,165,250,' + (0.25 + w * 0.12) + ')';
            ctx.fillRect(px, py + 6 + w * 3, T, 5);
            ctx.fillStyle = 'rgba(191,219,254,0.35)';
            ctx.fillRect(px + 4, py + 18 - w * 2, T - 12, 2);
            return;
        }
        if (t === ',') {
            ctx.fillStyle = outdoor ? '#a98f63' : '#4b4340';
            ctx.fillRect(px, py, T, T);
            ctx.fillStyle = 'rgba(0,0,0,0.10)';
            if (r > 0.6) ctx.fillRect(px + 6 + r * 12, py + 4 + r * 18, 3, 3);
            if (r < 0.25) ctx.fillRect(px + 20 - r * 30, py + 20, 4, 2);
            return;
        }
        if (t === 'b') {
            ctx.fillStyle = '#6b4423';
            ctx.fillRect(px, py, T, T);
            ctx.fillStyle = '#5a3819';
            for (let i = 0; i < 3; i++) ctx.fillRect(px + 2, py + 6 + i * 9, T - 4, 3);
            ctx.strokeStyle = 'rgba(0,0,0,0.18)';
            ctx.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);
            return;
        }
        if (!outdoor) {
            // Hoehlenboden
            // Deutlich heller als die Wand - sonst verschwimmt unter Tage
            // begehbarer Boden mit Fels und man sieht den Gang nicht.
            const shade = 96 + Math.floor(r * 14);
            ctx.fillStyle = 'rgb(' + shade + ',' + (shade - 8) + ',' + (shade - 16) + ')';
            ctx.fillRect(px, py, T, T);
            if (r > 0.86) {
                ctx.fillStyle = 'rgba(0,0,0,0.25)';
                ctx.fillRect(px + 8, py + 12, 8, 4);
            }
            return;
        }
        // Gras
        const g = 118 + Math.floor(r * 26);
        ctx.fillStyle = 'rgb(' + (58 + Math.floor(r * 14)) + ',' + g + ',' + (52 + Math.floor(r * 12)) + ')';
        ctx.fillRect(px, py, T, T);
        if (r > 0.72) {
            ctx.fillStyle = 'rgba(30,80,30,0.55)';
            const gx = px + 5 + r * 18, gy = py + 8 + (1 - r) * 16;
            ctx.fillRect(gx, gy, 2, 5);
            ctx.fillRect(gx + 4, gy + 2, 2, 4);
        } else if (r < 0.06) {
            ctx.fillStyle = 'rgba(250,240,140,0.75)';   // Blume
            ctx.beginPath(); ctx.arc(px + 12 + r * 60, py + 18, 2.4, 0, 7); ctx.fill();
        }
    }

    /* ------------------------------------------------------------
       OBJEKTE
       ------------------------------------------------------------ */
    function drawWall(x, y, outdoor) {
        const px = x * T, py = y * T;
        const r = hash(x, y);
        const top = EG.tileAt(x, y - 1) !== '#';
        ctx.fillStyle = outdoor ? '#6b7280' : '#2e2926';
        ctx.fillRect(px, py, T, T);
        ctx.fillStyle = outdoor ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(px + 3 + r * 8, py + 5, 9, 6);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(px + 16, py + 18, 10, 7);
        if (top) {
            ctx.fillStyle = outdoor ? '#9ca3af' : '#463d37';
            ctx.fillRect(px, py, T, 6);
        }
    }

    function drawTree(x, y, ready) {
        const px = x * T, py = y * T;
        const r = hash(x, y);
        if (!ready) {   // Stumpf
            ctx.fillStyle = '#6b4423';
            ctx.fillRect(px + 12, py + 20, 8, 7);
            ctx.fillStyle = '#8b5a2b';
            ctx.beginPath(); ctx.ellipse(px + 16, py + 20, 6, 3, 0, 0, 7); ctx.fill();
            return;
        }
        const sway = Math.sin(anim / 900 + r * 6) * 1.6;
        ctx.fillStyle = '#5b3a1c';
        ctx.fillRect(px + 13, py + 16, 6, 14);
        const cx = px + 16 + sway, cy = py + 12 - r * 3;
        ctx.fillStyle = '#1e6b34';
        ctx.beginPath(); ctx.arc(cx - 6, cy + 2, 8, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + 6, cy + 2, 8, 0, 7); ctx.fill();
        ctx.fillStyle = '#2f8f43';
        ctx.beginPath(); ctx.arc(cx, cy - 4, 9.5, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(190,255,170,0.30)';
        ctx.beginPath(); ctx.arc(cx - 3, cy - 7, 3.5, 0, 7); ctx.fill();
    }

    function drawRock(x, y, ready, gem) {
        const px = x * T, py = y * T;
        const r = hash(x, y);
        if (!ready) {
            ctx.fillStyle = 'rgba(0,0,0,0.22)';
            ctx.beginPath(); ctx.ellipse(px + 16, py + 24, 9, 4, 0, 0, 7); ctx.fill();
            return;
        }
        ctx.fillStyle = 'rgba(0,0,0,0.20)';
        ctx.beginPath(); ctx.ellipse(px + 16, py + 26, 11, 4, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#8a8580';
        ctx.beginPath();
        ctx.moveTo(px + 5, py + 26);
        ctx.lineTo(px + 8 + r * 3, py + 12);
        ctx.lineTo(px + 17, py + 6 + r * 3);
        ctx.lineTo(px + 26, py + 13);
        ctx.lineTo(px + 28, py + 26);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.moveTo(px + 9, py + 15); ctx.lineTo(px + 17, py + 8); ctx.lineTo(px + 18, py + 17);
        ctx.closePath(); ctx.fill();
        if (gem) {
            const spark = 0.55 + Math.sin(anim / 320 + r * 9) * 0.45;
            ctx.fillStyle = gem;
            [[11, 19], [20, 14], [17, 23]].forEach((p, i) => {
                ctx.globalAlpha = i === 0 ? 1 : spark;
                ctx.beginPath(); ctx.arc(px + p[0], py + p[1], 2.6, 0, 7); ctx.fill();
            });
            ctx.globalAlpha = 1;
        }
    }

    function drawCrop(x, y, stage) {
        const px = x * T, py = y * T;
        if (!stage) return;
        const c = stage.crop, p = stage.progress;
        const h = 4 + p * 16;
        ctx.strokeStyle = p < 1 ? '#3f9142' : '#2f7a34';
        ctx.lineWidth = 2;
        [-6, 0, 6].forEach((off, i) => {
            if (i !== 1 && p < 0.4) return;
            ctx.beginPath();
            ctx.moveTo(px + 16 + off, py + 26);
            ctx.lineTo(px + 16 + off * 1.4, py + 26 - h);
            ctx.stroke();
        });
        if (p >= 1) {
            ctx.font = '15px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(c.icon, px + 16, py + 20);
            ctx.textAlign = 'left';
        } else if (p > 0.55) {
            ctx.fillStyle = c.color;
            ctx.beginPath(); ctx.arc(px + 16, py + 22 - h * 0.4, 3, 0, 7); ctx.fill();
        }
    }

    function drawHouse(x, y) {
        const px = x * T, py = y * T;
        const roof = EG.tileAt(x, y - 1) !== 'H';
        ctx.fillStyle = '#c8a97e';
        ctx.fillRect(px, py, T, T);
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.fillRect(px, py + T - 4, T, 4);
        if (roof) {
            ctx.fillStyle = '#8c2f21';
            ctx.fillRect(px, py, T, 16);
            ctx.fillStyle = '#a83a2a';
            for (let i = 0; i < 4; i++) ctx.fillRect(px + i * 8, py + 2, 6, 12);
        } else {
            const left = EG.tileAt(x - 1, y) !== 'H';
            if (left) {   // Tuer
                ctx.fillStyle = '#5b3a1c';
                ctx.fillRect(px + 8, py + 8, 14, 24);
                ctx.fillStyle = '#facc15';
                ctx.fillRect(px + 18, py + 20, 3, 3);
            } else {      // Fenster
                ctx.fillStyle = '#334155';
                ctx.fillRect(px + 7, py + 8, 16, 13);
                ctx.fillStyle = 'rgba(250,204,21,0.75)';
                ctx.fillRect(px + 9, py + 10, 12, 9);
            }
        }
    }

    function drawShop(x, y) {
        const px = x * T, py = y * T;
        ctx.fillStyle = '#8b5a2b';
        ctx.fillRect(px, py + 12, T, T - 12);
        for (let i = 0; i < 4; i++) {
            ctx.fillStyle = i % 2 ? '#dc2626' : '#f8fafc';
            ctx.fillRect(px + i * 8, py, 8, 12);
        }
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(px + 4, py + 16, T - 8, 4);
        ctx.font = '13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🧺', px + 16, py + 30);
        ctx.textAlign = 'left';
    }

    function drawCrate(x, y) {
        const px = x * T, py = y * T;
        ctx.fillStyle = '#a16207';
        ctx.fillRect(px + 3, py + 8, T - 6, T - 12);
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 3, py + 8, T - 6, T - 12);
        ctx.beginPath();
        ctx.moveTo(px + 3, py + 8); ctx.lineTo(px + T - 3, py + T - 4);
        ctx.moveTo(px + T - 3, py + 8); ctx.lineTo(px + 3, py + T - 4);
        ctx.stroke();
        ctx.fillStyle = '#c98a2e';
        ctx.fillRect(px + 3, py + 5, T - 6, 4);
    }

    function drawPad(x, y, key) {
        const px = x * T, py = y * T;
        const m = EG.state.machines[key];
        ctx.fillStyle = '#57534e';
        ctx.fillRect(px + 1, py + 6, T - 2, T - 8);
        ctx.fillStyle = '#78716c';
        ctx.fillRect(px + 3, py + 8, T - 6, T - 12);
        if (!m) {
            ctx.strokeStyle = 'rgba(250,204,21,0.55)';
            ctx.setLineDash([4, 3]);
            ctx.lineWidth = 1.5;
            ctx.strokeRect(px + 4, py + 9, T - 8, T - 14);
            ctx.setLineDash([]);
            return;
        }
        const def = EG.machineDef(m.type);
        ctx.fillStyle = def.color;
        ctx.fillRect(px + 3, py + 2, T - 6, T - 6);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(px + 3, py + T - 8, T - 6, 4);
        ctx.font = '16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(def.icon, px + 16, py + 21);
        ctx.textAlign = 'left';
        const busy = m.queue.length > 0;
        const ready = Object.keys(m.out).length > 0;
        if (busy) {
            const puff = (anim / 260) % 1;
            ctx.fillStyle = 'rgba(226,232,240,' + (0.5 - puff * 0.5) + ')';
            ctx.beginPath(); ctx.arc(px + 24, py - 2 - puff * 10, 3 + puff * 3, 0, 7); ctx.fill();
        }
        if (ready) {
            const bob = Math.sin(anim / 300) * 2;
            ctx.fillStyle = '#22c55e';
            ctx.beginPath(); ctx.arc(px + 27, py + 5 + bob, 4.5, 0, 7); ctx.fill();
            ctx.fillStyle = '#052e16';
            ctx.font = 'bold 7px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('✓', px + 27, py + 8 + bob);
            ctx.textAlign = 'left';
        }
    }

    function drawStairs(x, y, down) {
        const px = x * T, py = y * T;
        ctx.fillStyle = '#1c1917';
        ctx.fillRect(px + 2, py + 2, T - 4, T - 4);
        ctx.fillStyle = down ? '#44403c' : '#57534e';
        for (let i = 0; i < 4; i++) {
            ctx.fillRect(px + 5, py + 6 + i * 6, T - 10, 3);
        }
        ctx.fillStyle = '#fbbf24';
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(down ? '▼' : '▲', px + 16, py + 29);
        ctx.textAlign = 'left';
    }

    function drawStation(x, y) {
        const px = x * T, py = y * T;
        const done = EG.state.railway.length;
        ctx.fillStyle = '#57534e';
        ctx.fillRect(px, py + 10, T, T - 10);
        ctx.fillStyle = '#3f3f46';
        ctx.fillRect(px, py + 18, T, 4);
        ctx.fillRect(px, py + 26, T, 4);
        if (done >= 1) {
            ctx.fillStyle = '#a8a29e';
            ctx.fillRect(px, py + 16, T, 2);
            ctx.fillRect(px, py + 24, T, 2);
        }
        ctx.fillStyle = '#78350f';
        ctx.fillRect(px + 2, py + 2, T - 4, 10);
        ctx.fillStyle = done >= 4 ? '#facc15' : '#a16207';
        ctx.fillRect(px + 4, py + 4, T - 8, 6);
        if (EG.state.finished) {
            ctx.font = '15px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('🚂', px + 16, py + 12);
            ctx.textAlign = 'left';
        }
    }

    function drawFence(x, y) {
        const px = x * T, py = y * T;
        // Zwei helle Riegel und ein Pfosten je Feld. Dunkler Grundton
        // wuerde auf dem Gruen als roter Strich lesen.
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(px, py + 25, T, 3);
        ctx.fillStyle = '#b39264';
        ctx.fillRect(px, py + 13, T, 3);
        ctx.fillRect(px, py + 20, T, 3);
        ctx.fillStyle = '#8a6d45';
        ctx.fillRect(px + 14, py + 8, 5, 18);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(px + 14, py + 8, 2, 18);
    }

    /* ------------------------------------------------------------
       FIGUR
       ------------------------------------------------------------ */
    function drawPlayer(moving) {
        const s = EG.state;
        const bob = moving ? Math.sin(walkPhase) * 1.8 : Math.sin(anim / 700) * 0.6;
        const x = s.px, y = s.py + bob;

        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(s.px, s.py + 13, 9, 4, 0, 0, 7); ctx.fill();

        // Beine
        ctx.fillStyle = '#1f2937';
        const step = moving ? Math.sin(walkPhase) * 3 : 0;
        ctx.fillRect(x - 6, y + 4 + Math.max(0, step), 4, 9 - Math.abs(step) * 0.4);
        ctx.fillRect(x + 2, y + 4 + Math.max(0, -step), 4, 9 - Math.abs(step) * 0.4);

        // Rumpf
        ctx.fillStyle = '#2563eb';
        ctx.fillRect(x - 7, y - 6, 14, 12);
        ctx.fillStyle = '#1d4ed8';
        ctx.fillRect(x - 7, y + 2, 14, 4);

        // Kopf
        ctx.fillStyle = '#f2c396';
        ctx.beginPath(); ctx.arc(x, y - 12, 6.5, 0, 7); ctx.fill();
        ctx.fillStyle = '#78350f';   // Hut
        ctx.fillRect(x - 8, y - 16, 16, 3);
        ctx.fillRect(x - 5, y - 20, 10, 5);

        // Gesicht je nach Blickrichtung
        ctx.fillStyle = '#1c1917';
        if (s.dir === 'down') { ctx.fillRect(x - 3, y - 13, 2, 2); ctx.fillRect(x + 1, y - 13, 2, 2); }
        else if (s.dir === 'left') { ctx.fillRect(x - 4, y - 13, 2, 2); }
        else if (s.dir === 'right') { ctx.fillRect(x + 2, y - 13, 2, 2); }

        // Werkzeug in der Hand
        const tool = EG.state.dir === 'left' ? -1 : 1;
        ctx.strokeStyle = '#8b5a2b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 8 * tool, y - 2);
        ctx.lineTo(x + 12 * tool, y - 12);
        ctx.stroke();
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(x + (tool > 0 ? 10 : -15), y - 16, 5, 5);
    }

    /* ------------------------------------------------------------
       HAUPT-ZEICHENROUTINE
       ------------------------------------------------------------ */
    function draw(dt, moving) {
        if (!ctx) return;
        anim += dt;
        if (moving) walkPhase += dt / 90;

        const def = EG.mapDef();
        const outdoor = !!def.outdoor;
        const mapW = def.w * T, mapH = def.h * T;

        camX = Math.round(Math.max(0, Math.min(mapW - vw, EG.state.px - vw / 2)));
        camY = Math.round(Math.max(0, Math.min(mapH - vh, EG.state.py - vh / 2)));
        if (mapW < vw) camX = -Math.floor((vw - mapW) / 2);
        if (mapH < vh) camY = -Math.floor((vh - mapH) / 2);

        ctx.fillStyle = outdoor ? '#1b3a1f' : '#111014';
        ctx.fillRect(0, 0, vw, vh);
        ctx.save();
        ctx.translate(-camX, -camY);

        const x0 = Math.max(0, Math.floor(camX / T));
        const y0 = Math.max(0, Math.floor(camY / T));
        const x1 = Math.min(def.w - 1, Math.ceil((camX + vw) / T));
        const y1 = Math.min(def.h - 1, Math.ceil((camY + vh) / T));

        // Boden
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const t = EG.tileAt(x, y);
                if (t === '#') { drawGround(x, y, '.', outdoor); continue; }
                if (EG_NODES[t] || 'HSVMEfDNU'.indexOf(t) !== -1) { drawGround(x, y, '.', outdoor); continue; }
                drawGround(x, y, t, outdoor);
            }
        }

        // Objekte, von oben nach unten damit sich Ueberlappungen richtig stapeln
        const gemColor = { C: '#1f2937', K: '#c2703a', I: '#d8d3cc', G: '#fcd34d', X: '#67e8f9' };
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const t = EG.tileAt(x, y);
                const k = EG.key(EG.state.map, x, y);
                if (t === '#') drawWall(x, y, outdoor);
                else if (t === 'T') drawTree(x, y, EG.nodeReady(k));
                else if (EG_NODES[t]) drawRock(x, y, EG.nodeReady(k), gemColor[t]);
                else if (t === 'H') drawHouse(x, y);
                else if (t === 'S') drawShop(x, y);
                else if (t === 'V') drawCrate(x, y);
                else if (t === 'M') drawPad(x, y, k);
                else if (t === 'E') drawStation(x, y);
                else if (t === 'f') drawFence(x, y);
                else if (t === 'D' || t === 'N') drawStairs(x, y, true);
                else if (t === 'U') drawStairs(x, y, false);
                else if (t === 'b') drawCrop(x, y, EG.plotStage(k));
            }
        }

        // Zielmarkierung
        const tgt = EG.target();
        if (tgt) {
            const px = tgt.x * T, py = tgt.y * T;
            ctx.strokeStyle = tgt.locked ? 'rgba(248,113,113,0.9)' : 'rgba(250,204,21,0.95)';
            ctx.lineWidth = 2;
            ctx.strokeRect(px + 1, py + 1, T - 2, T - 2);
        }

        drawPlayer(moving);

        // Splitter
        for (let i = bits.length - 1; i >= 0; i--) {
            const b = bits[i];
            b.life -= dt;
            b.x += b.vx * (dt / 16);
            b.y += b.vy * (dt / 16);
            b.vy += 0.12 * (dt / 16);
            if (b.life <= 0) { bits.splice(i, 1); continue; }
            ctx.fillStyle = b.color;
            ctx.globalAlpha = Math.max(0, b.life / 420);
            ctx.fillRect(b.x, b.y, 3, 3);
            ctx.globalAlpha = 1;
        }

        ctx.restore();

        // Licht: draussen die Tageszeit, unter Tage immer daemmrig -
        // eine Hoehle ist mittags nicht hell und um Mitternacht nicht dunkler.
        const light = outdoor ? EG.daylight() : 0.42;
        if (light < 1) {
            const dark = (1 - light) * (outdoor ? 0.78 : 0.55);
            ctx.fillStyle = 'rgba(8,12,35,' + dark + ')';
            ctx.fillRect(0, 0, vw, vh);
            const lx = EG.state.px - camX, ly = EG.state.py - camY;
            const grd = ctx.createRadialGradient(lx, ly, 8, lx, ly, outdoor ? 150 : 190);
            grd.addColorStop(0, 'rgba(255,214,140,' + (dark * 0.65) + ')');
            grd.addColorStop(1, 'rgba(255,214,140,0)');
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = grd;
            ctx.fillRect(lx - 160, ly - 160, 320, 320);
            ctx.globalCompositeOperation = 'source-over';
        }

        // Aufsteigende Texte
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        for (let i = pops.length - 1; i >= 0; i--) {
            const p = pops[i];
            p.life -= dt;
            if (p.life <= 0) { pops.splice(i, 1); continue; }
            const a = Math.min(1, p.life / 500);
            const sx = p.x - camX, sy = p.y - camY - (1400 - p.life) / 40;
            ctx.globalAlpha = a;
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillText(p.text, sx + 1, sy + 1);
            ctx.fillStyle = p.color;
            ctx.fillText(p.text, sx, sy);
            ctx.globalAlpha = 1;
        }
        ctx.textAlign = 'left';

        // Hinweis am Ziel
        if (tgt && tgt.label) {
            const sx = tgt.x * T + T / 2 - camX;
            const sy = tgt.y * T - camY - 6;
            ctx.font = '11px system-ui, sans-serif';
            ctx.textAlign = 'center';
            const w = ctx.measureText(tgt.label).width + 22;
            ctx.fillStyle = 'rgba(15,23,42,0.85)';
            ctx.fillRect(sx - w / 2, sy - 15, w, 18);
            ctx.strokeStyle = 'rgba(148,163,184,0.5)';
            ctx.lineWidth = 1;
            ctx.strokeRect(sx - w / 2, sy - 15, w, 18);
            ctx.fillStyle = '#facc15';
            ctx.fillText('E', sx - w / 2 + 9, sy - 2);
            ctx.fillStyle = '#e2e8f0';
            ctx.fillText(tgt.label, sx + 8, sy - 2);
            ctx.textAlign = 'left';
        }
    }

    return { init: init, draw: draw, popup: popup, hitBits: hitBits, resize: resize };
})();
