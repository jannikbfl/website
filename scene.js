/* ============================================================
   Energy Grid Tycoon – scene.js
   Zeichnet die Hintergrund-Szene hinter der kWh-Anzeige als SVG:
   100 fein abgestufte Ausbaustufen vom froehlichen kleinen Haus
   mit Wiese bis zur hochkomplexen Fabrik. Reine Darstellung,
   keine Spiellogik ausser der Fortschritts-Formel unten.

   Fortschritt = "installierte Hardware" (state.buildings, setzt
   sich bei jedem Reboot zurueck) * "Tech-Level" (Aera + Dyson-
   Kerne, wirkt wie ein Multiplikator). So aendert sich das Bild
   schnell und kleinschrittig waehrend des normalen Spielens,
   faengt aber nach jedem Reboot wieder beim froehlichen Haus an,
   weil dann keine Hardware mehr installiert ist.
   ============================================================ */
const Scene = (function () {
    'use strict';

    const STAGE_COUNT = 100;
    const VIEW_W = 400;
    const VIEW_H = 240;
    const GROUND_Y = 206;

    /* Haus – bleibt in jeder Stufe an derselben Stelle sichtbar.
       Schmal und links vom Klick-Button gehalten: der runde Button
       (die "Sonne") sitzt layoutbedingt immer zentriert im Panel,
       ungefaehr bei Viewbox-x 155-245 – das Haus muss ihm ausweichen,
       sonst verschwindet es dahinter (empirisch ueber mehrere
       Panelbreiten gemessen). */
    const HOUSE = { left: 103, right: 149, top: 187, apexX: 126, apexY: 166 };

    /* ------------------------------------------------------------
       FORTSCHRITTS-FORMEL
       ------------------------------------------------------------ */
    /** Wie viel "Hardware" steht gerade auf dem Grundstueck?
     *  Jeder Gebaeude-Typ traegt gesaettigt bei (ab 20 Stueck voll
     *  gezaehlt) – so zeigt schon das erste gekaufte Gebaeude einer
     *  neuen Kategorie sofort eine sichtbare Veraenderung, statt
     *  dass nur rohe Stueckzahl zaehlt. */
    function hardwareScore(buildings) {
        let hw = 0;
        for (let i = 0; i < BUILDINGS_DB.length; i++) {
            const owned = buildings[BUILDINGS_DB[i].id] || 0;
            hw += (i + 1) * Math.min(owned, 20) / 20;
        }
        return hw;
    }

    /** Fortschritts-Score: Hardware * Tech-Level. techLevel waechst
     *  mit Aera und Dyson-Kernen und ueberdauert einen Reboot – die
     *  Hardware selbst aber nicht, daher: nach jedem Reboot ist der
     *  Score wieder 0, das Grundstueck also wieder das kleine Haus,
     *  auch wenn techLevel hoch bleibt (macht den naechsten Anlauf
     *  spuerbar schneller). */
    function progressScore(buildings, eraLevel, metaTokens) {
        const techLevel = 1 + (eraLevel || 0) + (metaTokens || 0) * 0.1;
        return hardwareScore(buildings) * techLevel;
    }

    /** Score -> Stufe (0..99), asymptotisch: schnelle Anfangsschritte,
     *  die letzten Stufen bleiben ambitionierten Dauerspielern vorbehalten. */
    function stageForScore(score) {
        const K = 42;
        const frac = score / (score + K);
        return Math.max(0, Math.min(STAGE_COUNT - 1, Math.floor(frac * STAGE_COUNT)));
    }

    function stageIndexForState(buildings, eraLevel, metaTokens) {
        return stageForScore(progressScore(buildings, eraLevel, metaTokens));
    }

    /* ------------------------------------------------------------
       Farb-Interpolation (Himmel)
       ------------------------------------------------------------ */
    function hexToRgb(hex) {
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function rgbToHex(rgb) {
        return '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
    }
    function lerpColor(a, b, t) {
        const ca = hexToRgb(a), cb = hexToRgb(b);
        return rgbToHex([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]);
    }
    function skyColors(t) {
        const kf = SCENE_SKY_KEYFRAMES;
        const segT = t * (kf.length - 1);
        const i = Math.max(0, Math.min(kf.length - 2, Math.floor(segT)));
        const localT = segT - i;
        return [lerpColor(kf[i][0], kf[i + 1][0], localT), lerpColor(kf[i][1], kf[i + 1][1], localT)];
    }

    /* ------------------------------------------------------------
       Stufen-Parameter – Formeln statt Tabelle, damit alle 100
       Stufen fliessend ineinander uebergehen (kleinschrittig).
       ------------------------------------------------------------ */
    function clamp01(x) { return Math.max(0, Math.min(1, x)); }
    function ramp(t, from, to) { return clamp01((t - from) / (to - from)); }

    function stageParams(stageIndex) {
        const t = stageIndex / (STAGE_COUNT - 1);
        const roof = Math.round(ramp(t, 0, 0.16) * 6);
        const heatPump = t >= 0.06;
        const groundRaw = ramp(t, 0.08, 0.5);
        const ground = Math.round(groundRaw * 22);
        const meadow = Math.round((1 - ramp(t, 0.08, 0.68)) * 100);
        const dryness = ramp(t, 0.28, 0.55); // Wiese verdorrt, bevor sie ganz weicht
        const treesAlive = clamp01(1 - ramp(t, 0.14, 0.3));
        const trees = Math.round(treesAlive * 2);
        const stumps = t >= 0.14 && t < 0.55 ? (2 - trees) : 0;
        const wildlife = clamp01(1 - ramp(t, 0.08, 0.24)); // Voegel/Falter verschwinden frueh
        const fence = t >= 0.24;
        const craneWindow = t >= 0.42 && t <= 0.53;
        const ext = Math.round(ramp(t, 0.38, 0.86) * 122);
        const chim = Math.round(ramp(t, 0.5, 0.92) * 6);
        const tank = Math.round(ramp(t, 0.46, 0.9) * 5);
        const pipe = Math.round(ramp(t, 0.48, 0.9) * 5);
        const smog = ramp(t, 0.32, 1) * 0.6;
        const rust = ramp(t, 0.6, 1); // Rostspuren/Abnutzung im Endgame
        const cloud = Math.round((1 - ramp(t, 0.28, 0.5)) * 3);
        const batt = Math.round(ramp(t, 0.26, 0.8) * 8);
        const battScale = 1 + ramp(t, 0.55, 1) * 0.55;
        const [skyTop, skyBottom] = skyColors(t);

        return {
            t, roof, heatPump, ground, meadow, dryness, trees, stumps, wildlife, fence,
            crane: craneWindow, ext, chim, tank, pipe, smog, rust, cloud, batt, battScale,
            skyTop, skyBottom
        };
    }

    /* ------------------------------------------------------------
       Bausteine
       ------------------------------------------------------------ */
    function cloudShape(cx, cy, scale) {
        scale = scale || 1;
        return '<g transform="translate(' + cx + ',' + cy + ') scale(' + scale + ')" fill="#ffffff" opacity="0.9">' +
            '<ellipse cx="0" cy="0" rx="17" ry="8"/><ellipse cx="14" cy="-3" rx="12" ry="7"/><ellipse cx="-14" cy="-2" rx="10" ry="6"/></g>';
    }

    function birdShape(cx, cy, scale) {
        scale = scale || 1;
        return '<path d="M' + (cx - 6 * scale) + ' ' + cy + ' Q' + cx + ' ' + (cy - 5 * scale) + ' ' + (cx + 6 * scale) + ' ' + cy +
            ' M' + cx + ' ' + cy + ' Q' + cx + ' ' + (cy - 5 * scale) + ' ' + (cx + 6 * scale) + ' ' + cy + '" ' +
            'fill="none" stroke="#44403c" stroke-width="1.1" stroke-linecap="round" opacity="0.75"/>';
    }

    function butterflyShape(cx, cy) {
        return '<g transform="translate(' + cx + ',' + cy + ')" opacity="0.85">' +
            '<path d="M0 0c-4-5-9-4-9 1s5 5 9 1" fill="#fb923c"/>' +
            '<path d="M0 0c4-5 9-4 9 1s-5 5-9 1" fill="#f97316"/>' +
            '<line x1="0" y1="-1" x2="0" y2="3" stroke="#44403c" stroke-width="0.8"/>' +
            '</g>';
    }

    function flowerTuftShape(cx, baseY) {
        const colors = ['#f472b6', '#facc15', '#f8fafc'];
        const c = colors[Math.abs(Math.round(cx)) % colors.length];
        return '<g>' +
            '<path d="M' + cx + ' ' + baseY + 'v-6" stroke="#4d7c0f" stroke-width="1"/>' +
            '<circle cx="' + cx + '" cy="' + (baseY - 7) + '" r="2.2" fill="' + c + '"/>' +
            '</g>';
    }

    function grassTuftShape(cx, baseY) {
        return '<path d="M' + (cx - 3) + ' ' + baseY + 'q1-6 3-6 M' + cx + ' ' + baseY + 'q0-7 0-7 M' + (cx + 3) + ' ' + baseY + 'q-1-6-3-6" ' +
            'stroke="#4d7c0f" stroke-width="1.1" fill="none" stroke-linecap="round"/>';
    }

    function treeShape(cx, baseY) {
        return '<g>' +
            '<ellipse cx="' + cx + '" cy="' + baseY + '" rx="11" ry="3" fill="#1e293b" opacity="0.12"/>' +
            '<rect x="' + (cx - 2) + '" y="' + (baseY - 14) + '" width="4" height="14" fill="#8a5a3a"/>' +
            '<circle cx="' + (cx - 8) + '" cy="' + (baseY - 19) + '" r="9" fill="#22c55e"/>' +
            '<circle cx="' + (cx + 8) + '" cy="' + (baseY - 19) + '" r="9" fill="#22c55e"/>' +
            '<circle cx="' + cx + '" cy="' + (baseY - 26) + '" r="12" fill="url(#leafGrad)"/>' +
            '</g>';
    }

    function stumpShape(cx, baseY) {
        return '<g><ellipse cx="' + cx + '" cy="' + baseY + '" rx="7" ry="2.5" fill="#6b4a2f" opacity="0.5"/>' +
            '<rect x="' + (cx - 5) + '" y="' + (baseY - 7) + '" width="10" height="7" rx="1" fill="#8a6a45"/></g>';
    }

    function panelShape(x, y, w, h) {
        w = w || 18; h = h || 13;
        return '<g transform="translate(' + x + ',' + y + ')">' +
            '<rect width="' + w + '" height="' + h + '" rx="1" fill="url(#panelGrad)" stroke="#60a5fa" stroke-width="0.7"/>' +
            '<path d="M' + (w / 3).toFixed(1) + ' 0V' + h + ' M' + (w * 2 / 3).toFixed(1) + ' 0V' + h + ' M0 ' + (h / 2).toFixed(1) + 'H' + w + '" stroke="#3b82f6" stroke-width="0.5"/>' +
            '</g>';
    }

    function batteryShape(cx, w, h) {
        w = w || 12; h = h || 32;
        return '<g filter="url(#softShadow)"><rect x="' + (cx - w / 2) + '" y="' + (GROUND_Y - h) + '" width="' + w + '" height="' + h + '" rx="2" fill="#334155" stroke="#1e293b" stroke-width="1"/>' +
            '<rect x="' + (cx - w / 2 + 1.5) + '" y="' + (GROUND_Y - h + 4) + '" width="' + (w - 3) + '" height="4" fill="#22c55e" opacity="0.8"/></g>';
    }

    function tankShape(cx, w, h, rustLevel) {
        w = w || 26; h = h || 46;
        const top = GROUND_Y - h;
        let rustMarks = '';
        if (rustLevel > 0.15) {
            rustMarks = '<path d="M' + (cx - w / 4) + ' ' + (top + 6) + 'v' + (h * 0.6) + ' M' + (cx + w / 5) + ' ' + (top + 10) + 'v' + (h * 0.45) + '" ' +
                'stroke="#92400e" stroke-width="1.6" opacity="' + Math.min(0.5, rustLevel * 0.6).toFixed(2) + '" stroke-linecap="round"/>';
        }
        return '<g filter="url(#softShadow)">' +
            '<rect x="' + (cx - w / 2) + '" y="' + top + '" width="' + w + '" height="' + h + '" rx="4" fill="url(#tankGrad)" stroke="#475569" stroke-width="1"/>' +
            '<ellipse cx="' + cx + '" cy="' + top + '" rx="' + (w / 2) + '" ry="4" fill="#94a3b8"/>' +
            '<rect x="' + (cx - w / 2) + '" y="' + (top + h * 0.55) + '" width="' + w + '" height="4" fill="#475569"/>' +
            rustMarks +
            '</g>';
    }

    function chimneyShape(cx, h, smogLevel) {
        h = h || 34;
        const top = GROUND_Y - h;
        const smokeOp = Math.min(0.55, 0.18 + smogLevel);
        return '<g>' +
            '<rect x="' + (cx - 4) + '" y="' + top + '" width="8" height="' + h + '" fill="#57534e"/>' +
            '<rect x="' + (cx - 5) + '" y="' + (top - 3) + '" width="10" height="4" rx="1" fill="#44403c"/>' +
            '<g filter="url(#smokeBlur)" opacity="' + smokeOp.toFixed(2) + '">' +
            '<ellipse class="scene-smoke" cx="' + cx + '" cy="' + (top - 12) + '" rx="7" ry="5" fill="#a8a29e"/>' +
            '<ellipse class="scene-smoke" cx="' + (cx + 5) + '" cy="' + (top - 21) + '" rx="9" ry="6" fill="#a8a29e"/>' +
            '<ellipse class="scene-smoke" cx="' + (cx - 3) + '" cy="' + (top - 31) + '" rx="10" ry="7" fill="#a8a29e"/>' +
            '</g></g>';
    }

    function pipeShape(x1, y1, x2, y2, midX) {
        midX = midX === undefined ? x1 : midX;
        return '<path d="M' + x1 + ' ' + y1 + ' L' + midX + ' ' + y1 + ' L' + midX + ' ' + y2 + ' L' + x2 + ' ' + y2 + '" ' +
            'fill="none" stroke="#57534e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>';
    }

    function craneShape() {
        return '<g stroke="#78716c" stroke-width="3" fill="none" stroke-linecap="round">' +
            '<line x1="217" y1="' + GROUND_Y + '" x2="217" y2="52"/><line x1="217" y1="52" x2="169" y2="52"/>' +
            '<line x1="217" y1="52" x2="247" y2="60"/><line x1="179" y1="52" x2="179" y2="78" stroke-width="1.5" stroke-dasharray="2 3"/>' +
            '<circle cx="217" cy="52" r="3" fill="#78716c" stroke="none"/></g>';
    }

    function houseShape() {
        const h = HOUSE;
        return '<ellipse cx="' + ((h.left + h.right) / 2) + '" cy="' + GROUND_Y + '" rx="' + (h.right - h.left) / 2 * 1.15 + '" ry="4" fill="#1e293b" opacity="0.15"/>' +
            '<rect x="' + h.left + '" y="' + h.top + '" width="' + (h.right - h.left) + '" height="' + (GROUND_Y - h.top) + '" fill="url(#wallGrad)"/>' +
            '<polygon points="' + (h.left - 6) + ',' + h.top + ' ' + h.apexX + ',' + h.apexY + ' ' + (h.right + 6) + ',' + h.top + '" fill="url(#roofGrad)"/>' +
            '<rect x="140" y="169" width="5" height="14" fill="#78716c"/>' +
            '<rect x="138" y="166" width="9" height="3" rx="1" fill="#57534e"/>' +
            '<rect x="117" y="194" width="8" height="12" rx="0.5" fill="#92400e"/>' +
            '<rect x="106" y="192" width="7" height="7" rx="0.5" fill="#bae6fd" stroke="#78350f" stroke-width="1"/>' +
            '<rect x="127" y="192" width="7" height="7" rx="0.5" fill="#bae6fd" stroke="#78350f" stroke-width="1"/>';
    }

    function roofPanelsShape(count) {
        if (count <= 0) return '';
        const clipId = 'roofClip';
        const clip = '<clipPath id="' + clipId + '"><polygon points="' +
            HOUSE.apexX + ',' + HOUSE.apexY + ' ' + (HOUSE.left - 4) + ',' + HOUSE.top + ' ' + HOUSE.apexX + ',' + HOUSE.top +
            '"/></clipPath>';
        const cells = [];
        const cols = 3, rows = 3, cellW = 8, cellH = 7;
        const gx = HOUSE.left - 1, gy = HOUSE.apexY + 1;
        for (let r = rows - 1; r >= 0; r--) {
            for (let c = 0; c < cols; c++) cells.push({ x: gx + c * cellW, y: gy + r * cellH });
        }
        let out = '<defs>' + clip + '</defs><g clip-path="url(#' + clipId + ')">';
        for (let i = 0; i < Math.min(count, cells.length); i++) {
            out += panelShape(cells[i].x, cells[i].y, cellW - 2, cellH - 2);
        }
        out += '</g>';
        return out;
    }

    function groundPanelsShape(count) {
        if (count <= 0) return '';
        const cols = 5, rows = 5, cellW = 20, cellH = 8, gapX = 2, gapY = 2;
        const startX = 274, startY = 187;
        const order = [];
        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) order.push({ c: c, r: r });
        }
        let out = '';
        for (let i = 0; i < Math.min(count, order.length); i++) {
            const p = order[i];
            out += panelShape(startX + p.c * (cellW + gapX), startY + p.r * (cellH + gapY), cellW, cellH);
        }
        return out;
    }

    function heatPumpShape() {
        return '<g filter="url(#softShadow)">' +
            '<rect x="152" y="189" width="17" height="17" rx="2" fill="#e2e8f0" stroke="#94a3b8" stroke-width="1"/>' +
            '<circle cx="160.5" cy="197.5" r="5" fill="none" stroke="#64748b" stroke-width="1.4"/>' +
            '<path d="M160.5 193v9M156 197.5h9" stroke="#64748b" stroke-width="1"/>' +
            '</g>';
    }

    function fenceShape() {
        let out = '<g stroke="#a8a29e" stroke-width="2">';
        for (let x = 6; x <= VIEW_W - 6; x += 34) {
            out += '<line x1="' + x + '" y1="' + (GROUND_Y - 10) + '" x2="' + x + '" y2="' + (GROUND_Y + 2) + '"/>';
        }
        out += '<line x1="4" y1="' + (GROUND_Y - 4) + '" x2="' + (VIEW_W - 4) + '" y2="' + (GROUND_Y - 4) + '" stroke-width="1.5"/>';
        out += '</g>';
        return out;
    }

    function extensionShape(width) {
        if (width <= 0) return '';
        const extH = 42 + width * 0.22;
        const x = HOUSE.right;
        const top = GROUND_Y - extH;
        let out = '<g filter="url(#softShadow)">';
        out += '<rect x="' + x + '" y="' + top + '" width="' + width + '" height="' + extH + '" fill="url(#extGrad)"/>';
        const winCols = Math.max(1, Math.floor(width / 18));
        for (let c = 0; c < winCols; c++) {
            out += '<rect x="' + (x + 8 + c * 18) + '" y="' + (top + 10) + '" width="9" height="9" fill="#cbd5e1" opacity="0.85"/>';
        }
        out += '</g>';
        return out;
    }

    function tanksAndPipesShape(extWidth, tankCount, pipeCount, rustLevel) {
        if (tankCount <= 0) return '';
        const startX = HOUSE.right + Math.max(extWidth, 0) + 22;
        let out = '';
        const positions = [];
        for (let i = 0; i < tankCount; i++) {
            const cx = Math.min(startX + i * 26, VIEW_W - 14);
            positions.push(cx);
            out += tankShape(cx, 22, 40 + (i % 2) * 8, rustLevel);
        }
        for (let i = 0; i < Math.min(pipeCount, positions.length); i++) {
            out += pipeShape(HOUSE.right + extWidth, GROUND_Y - 20, positions[i], GROUND_Y - 30, (HOUSE.right + extWidth + positions[i]) / 2);
        }
        return out;
    }

    function batteriesShape(count, scale) {
        if (count <= 0) return '';
        let out = '';
        const startX = 176, pitch = 15 * (0.9 + scale * 0.1);
        for (let i = 0; i < count; i++) {
            out += batteryShape(startX + i * pitch, 10 * scale, 30 * scale);
        }
        return out;
    }

    /* ------------------------------------------------------------
       Definitionen (Verlaeufe, Filter) – einmal pro Bild
       ------------------------------------------------------------ */
    function sharedDefs(gradId, skyTop, skyBottom) {
        return '<defs>' +
            '<linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="' + skyTop + '"/><stop offset="100%" stop-color="' + skyBottom + '"/>' +
            '</linearGradient>' +
            '<linearGradient id="roofGrad" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#c2670c"/><stop offset="100%" stop-color="#92400e"/>' +
            '</linearGradient>' +
            '<linearGradient id="wallGrad" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#fffbeb"/><stop offset="100%" stop-color="#fde68a"/>' +
            '</linearGradient>' +
            '<linearGradient id="extGrad" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#64809b"/><stop offset="100%" stop-color="#425a71"/>' +
            '</linearGradient>' +
            '<linearGradient id="tankGrad" x1="0" y1="0" x2="1" y2="0">' +
            '<stop offset="0%" stop-color="#7c8ba0"/><stop offset="55%" stop-color="#9aa7b8"/><stop offset="100%" stop-color="#64748b"/>' +
            '</linearGradient>' +
            '<linearGradient id="panelGrad" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0%" stop-color="#2b4fa8"/><stop offset="100%" stop-color="#16265c"/>' +
            '</linearGradient>' +
            '<radialGradient id="leafGrad"><stop offset="0%" stop-color="#86efac"/><stop offset="100%" stop-color="#4ade80"/></radialGradient>' +
            '<radialGradient id="sunGlow" cx="50%" cy="30%" r="65%">' +
            '<stop offset="0%" stop-color="#fef9c3" stop-opacity="0.55"/><stop offset="100%" stop-color="#fef9c3" stop-opacity="0"/>' +
            '</radialGradient>' +
            '<filter id="softShadow" x="-40%" y="-20%" width="180%" height="160%">' +
            '<feDropShadow dx="0" dy="2" stdDeviation="1.4" flood-color="#1e293b" flood-opacity="0.25"/>' +
            '</filter>' +
            '<filter id="smokeBlur" x="-60%" y="-60%" width="220%" height="220%">' +
            '<feGaussianBlur stdDeviation="1.1"/>' +
            '</filter>' +
            '</defs>';
    }

    function grassDetails(t, meadow) {
        if (meadow <= 0) return '';
        const spots = [[30, GROUND_Y + 10], [58, GROUND_Y + 18], [370, GROUND_Y + 10], [345, GROUND_Y + 20], [18, GROUND_Y + 26]];
        let out = '';
        const showFlowers = t < 0.14;
        spots.forEach((p, i) => {
            if (p[1] > VIEW_H - 2) return;
            out += (showFlowers && i % 2 === 0) ? flowerTuftShape(p[0], p[1]) : grassTuftShape(p[0], p[1]);
        });
        return out;
    }

    function wildlifeShapes(level) {
        if (level <= 0) return '';
        let out = '';
        const birdSpots = [[250, 45], [270, 38], [290, 50]];
        const birdCount = Math.round(level * birdSpots.length);
        for (let i = 0; i < birdCount; i++) out += birdShape(birdSpots[i][0], birdSpots[i][1], 1);
        if (level > 0.5) out += butterflyShape(70, GROUND_Y - 30);
        return out;
    }

    /* ------------------------------------------------------------
       Zusammensetzen
       ------------------------------------------------------------ */
    function build(stageIndex) {
        stageIndex = Math.max(0, Math.min(STAGE_COUNT - 1, stageIndex));
        const s = stageParams(stageIndex);
        const pavedWidth = Math.max(0, (100 - s.meadow) / 100 * VIEW_W);
        const gradId = 'sceneSky' + stageIndex;
        const grassColor = lerpColor('#86efac', '#c9a24a', s.dryness);

        let out = '<svg viewBox="0 0 ' + VIEW_W + ' ' + VIEW_H + '" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Illustration des Grundstuecks im aktuellen Spielfortschritt">';
        out += sharedDefs(gradId, s.skyTop, s.skyBottom);

        /* Himmel */
        out += '<rect x="0" y="0" width="' + VIEW_W + '" height="' + GROUND_Y + '" fill="url(#' + gradId + ')"/>';
        out += '<rect x="0" y="0" width="' + VIEW_W + '" height="' + GROUND_Y + '" fill="url(#sunGlow)"/>';
        for (let i = 0; i < s.cloud; i++) {
            out += cloudShape(60 + i * 140, 36 + (i % 2) * 20, 1 + (i % 2) * 0.2);
        }
        out += wildlifeShapes(s.wildlife);
        if (s.smog > 0) {
            out += '<rect x="0" y="50" width="' + VIEW_W + '" height="90" fill="#78716c" opacity="' + s.smog.toFixed(2) + '"/>';
        }

        /* Boden */
        out += '<rect x="0" y="' + GROUND_Y + '" width="' + VIEW_W + '" height="' + (VIEW_H - GROUND_Y) + '" fill="' + grassColor + '"/>';
        if (pavedWidth > 0) {
            out += '<rect x="' + ((VIEW_W - pavedWidth) / 2) + '" y="' + GROUND_Y + '" width="' + pavedWidth + '" height="' + (VIEW_H - GROUND_Y) + '" fill="#9ca3af"/>';
            if (s.rust > 0.3) {
                out += '<rect x="' + ((VIEW_W - pavedWidth) / 2) + '" y="' + GROUND_Y + '" width="' + pavedWidth + '" height="' + (VIEW_H - GROUND_Y) + '" fill="#57534e" opacity="' + (s.rust * 0.12).toFixed(2) + '"/>';
            }
        }
        out += grassDetails(s.t, s.meadow);

        /* Baeume / Stuempfe */
        const treeSpots = [[86, GROUND_Y], [387, GROUND_Y]];
        for (let i = 0; i < treeSpots.length; i++) {
            if (i < s.trees) out += treeShape(treeSpots[i][0], treeSpots[i][1]);
            else if (i < s.trees + s.stumps) out += stumpShape(treeSpots[i][0], treeSpots[i][1]);
        }

        if (s.fence) out += fenceShape();

        /* Haus + Anbau + Dach */
        out += extensionShape(s.ext);
        out += houseShape();
        out += roofPanelsShape(s.roof);
        if (s.heatPump) out += heatPumpShape();
        if (s.chim > 0) out += extensionChimneys(s.ext, s.chim, s.smog);

        out += groundPanelsShape(s.ground);
        out += batteriesShape(s.batt, s.battScale);
        out += tanksAndPipesShape(s.ext, s.tank, s.pipe, s.rust);

        if (s.crane) out += craneShape();

        out += '</svg>';
        return out;
    }

    function extensionChimneys(extWidth, chimCount, smogLevel) {
        if (extWidth <= 0 || chimCount <= 0) return '';
        const x = HOUSE.right;
        let out = '';
        for (let i = 0; i < chimCount; i++) {
            const cx = Math.min(x + 14 + i * Math.max(14, extWidth / chimCount), x + extWidth - 6);
            out += chimneyShape(cx, 26 + (i % 3) * 6, smogLevel);
        }
        return out;
    }

    return {
        stageCount: STAGE_COUNT,
        stageIndexForState: stageIndexForState,
        progressScore: progressScore,
        stageForScore: stageForScore,
        build: build
    };
})();
