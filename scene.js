/* ============================================================
   Energy Grid Tycoon – scene.js
   Zeichnet die Hintergrund-Szene hinter der kWh-Anzeige als SVG:
   20 Stufen vom froehlichen Haus mit Wiese bis zur hochkomplexen
   Fabrik. Reine Darstellung anhand von SCENE_STAGES (data.js),
   keine Spiellogik, kein State-Zugriff.
   ============================================================ */
const Scene = (function () {
    'use strict';

    const VIEW_W = 400;
    const VIEW_H = 240;
    const GROUND_Y = 195;

    /* Haus – bleibt in jeder Stufe an derselben Stelle sichtbar,
       damit man am Ende noch erkennt, wo alles begann.
       Der grosse runde Klick-Button (die "Sonne") sitzt layoutbedingt
       IMMER zentriert im Panel, ziemlich genau bei Viewbox-x 155-245 /
       y 135-230 (gemessen ueber mehrere Panelbreiten hinweg – die
       Breite des sichtbaren Ausschnitts schwankt mit dem Seiten-
       verhaeltnis des Panels, das Zentrum aber nicht). Das Haus ist
       daher bewusst schmal gehalten und in den linken freien
       Streifen (rechts vom Rand, links vom Button) gerueckt, statt
       zentriert – sonst verschwindet es je nach Fensterbreite
       entweder hinter dem Button oder am Bildrand. */
    const HOUSE = { left: 105, right: 151, top: 176, apexX: 128, apexY: 155 };

    function stageIndexForFP(totalFPEarned) {
        let idx = 0;
        for (let i = 0; i < SCENE_STAGES.length; i++) {
            if (totalFPEarned >= SCENE_STAGES[i].fp) idx = i;
        }
        return idx;
    }

    /* ------------------------------------------------------------
       Bausteine
       ------------------------------------------------------------ */
    function cloudShape(cx, cy, scale) {
        scale = scale || 1;
        return '<g transform="translate(' + cx + ',' + cy + ') scale(' + scale + ')" fill="#ffffff" opacity="0.9">' +
            '<ellipse cx="0" cy="0" rx="17" ry="8"/>' +
            '<ellipse cx="14" cy="-3" rx="12" ry="7"/>' +
            '<ellipse cx="-14" cy="-2" rx="10" ry="6"/>' +
            '</g>';
    }

    function treeShape(cx, baseY) {
        return '<g>' +
            '<rect x="' + (cx - 2) + '" y="' + (baseY - 14) + '" width="4" height="14" fill="#8a5a3a"/>' +
            '<circle cx="' + (cx - 8) + '" cy="' + (baseY - 19) + '" r="9" fill="#22c55e"/>' +
            '<circle cx="' + (cx + 8) + '" cy="' + (baseY - 19) + '" r="9" fill="#22c55e"/>' +
            '<circle cx="' + cx + '" cy="' + (baseY - 26) + '" r="12" fill="#4ade80"/>' +
            '</g>';
    }

    function stumpShape(cx, baseY) {
        return '<g><ellipse cx="' + cx + '" cy="' + baseY + '" rx="7" ry="2.5" fill="#6b4a2f" opacity="0.5"/>' +
            '<rect x="' + (cx - 5) + '" y="' + (baseY - 7) + '" width="10" height="7" rx="1" fill="#8a6a45"/></g>';
    }

    function panelShape(x, y, w, h) {
        w = w || 18; h = h || 13;
        return '<g transform="translate(' + x + ',' + y + ')">' +
            '<rect width="' + w + '" height="' + h + '" rx="1" fill="#1e3a8a" stroke="#60a5fa" stroke-width="0.7"/>' +
            '<path d="M' + (w / 3).toFixed(1) + ' 0V' + h + ' M' + (w * 2 / 3).toFixed(1) + ' 0V' + h + ' M0 ' + (h / 2).toFixed(1) + 'H' + w + '" stroke="#3b82f6" stroke-width="0.5"/>' +
            '</g>';
    }

    function batteryShape(cx, w, h) {
        w = w || 12; h = h || 32;
        return '<g>' +
            '<rect x="' + (cx - w / 2) + '" y="' + (GROUND_Y - h) + '" width="' + w + '" height="' + h + '" rx="2" fill="#334155" stroke="#1e293b" stroke-width="1"/>' +
            '<rect x="' + (cx - w / 2 + 1.5) + '" y="' + (GROUND_Y - h + 4) + '" width="' + (w - 3) + '" height="4" fill="#22c55e" opacity="0.8"/>' +
            '</g>';
    }

    function tankShape(cx, w, h) {
        w = w || 26; h = h || 46;
        const top = GROUND_Y - h;
        return '<g>' +
            '<rect x="' + (cx - w / 2) + '" y="' + top + '" width="' + w + '" height="' + h + '" rx="4" fill="#64748b" stroke="#475569" stroke-width="1"/>' +
            '<ellipse cx="' + cx + '" cy="' + top + '" rx="' + (w / 2) + '" ry="4" fill="#94a3b8"/>' +
            '<rect x="' + (cx - w / 2) + '" y="' + (top + h * 0.55) + '" width="' + w + '" height="4" fill="#475569"/>' +
            '</g>';
    }

    function chimneyShape(cx, h, smogLevel) {
        h = h || 34;
        const top = GROUND_Y - h;
        const smokeOp = Math.min(0.55, 0.18 + smogLevel);
        return '<g>' +
            '<rect x="' + (cx - 4) + '" y="' + top + '" width="8" height="' + h + '" fill="#57534e"/>' +
            '<rect x="' + (cx - 5) + '" y="' + (top - 3) + '" width="10" height="4" rx="1" fill="#44403c"/>' +
            '<g class="scene-smoke" opacity="' + smokeOp.toFixed(2) + '">' +
            '<ellipse cx="' + cx + '" cy="' + (top - 12) + '" rx="7" ry="5" fill="#a8a29e"/>' +
            '<ellipse cx="' + (cx + 5) + '" cy="' + (top - 21) + '" rx="9" ry="6" fill="#a8a29e"/>' +
            '<ellipse cx="' + (cx - 3) + '" cy="' + (top - 31) + '" rx="10" ry="7" fill="#a8a29e"/>' +
            '</g></g>';
    }

    function pipeShape(x1, y1, x2, y2, midX) {
        midX = midX === undefined ? x1 : midX;
        return '<path d="M' + x1 + ' ' + y1 + ' L' + midX + ' ' + y1 + ' L' + midX + ' ' + y2 + ' L' + x2 + ' ' + y2 + '" ' +
            'fill="none" stroke="#57534e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>';
    }

    function craneShape() {
        return '<g stroke="#78716c" stroke-width="3" fill="none" stroke-linecap="round">' +
            '<line x1="217" y1="' + GROUND_Y + '" x2="217" y2="52"/>' +
            '<line x1="217" y1="52" x2="169" y2="52"/>' +
            '<line x1="217" y1="52" x2="247" y2="60"/>' +
            '<line x1="179" y1="52" x2="179" y2="78" stroke-width="1.5" stroke-dasharray="2 3"/>' +
            '<circle cx="217" cy="52" r="3" fill="#78716c" stroke="none"/>' +
            '</g>';
    }

    function houseShape() {
        const h = HOUSE;
        return '' +
            /* Wand */
            '<rect x="' + h.left + '" y="' + h.top + '" width="' + (h.right - h.left) + '" height="' + (GROUND_Y - h.top) + '" fill="#fef3c7"/>' +
            /* Dach */
            '<polygon points="' + (h.left - 6) + ',' + h.top + ' ' + h.apexX + ',' + h.apexY + ' ' + (h.right + 6) + ',' + h.top + '" fill="#b45309"/>' +
            /* Original-Schornstein – bleibt in jeder Stufe stehen */
            '<rect x="142" y="158" width="5" height="14" fill="#78716c"/>' +
            '<rect x="140" y="155" width="9" height="3" rx="1" fill="#57534e"/>' +
            /* Tuer */
            '<rect x="119" y="183" width="8" height="12" rx="0.5" fill="#92400e"/>' +
            /* Fenster */
            '<rect x="108" y="181" width="7" height="7" rx="0.5" fill="#bae6fd" stroke="#78350f" stroke-width="1"/>' +
            '<rect x="129" y="181" width="7" height="7" rx="0.5" fill="#bae6fd" stroke="#78350f" stroke-width="1"/>';
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
        /* Rechts aussen platziert: bleibt dauerhaft frei vom Klick-Button
           (Danger Zone ca. x144-256) und vom nach rechts wachsenden Anbau
           (max. Reichweite x230). */
        const cols = 5, rows = 4, cellW = 20, cellH = 9, gapX = 2, gapY = 2;
        const startX = 275, startY = 197;
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
        return '<g>' +
            '<rect x="154" y="178" width="17" height="17" rx="2" fill="#e2e8f0" stroke="#94a3b8" stroke-width="1"/>' +
            '<circle cx="162.5" cy="186.5" r="5" fill="none" stroke="#64748b" stroke-width="1.4"/>' +
            '<path d="M162.5 182v9M158 186.5h9" stroke="#64748b" stroke-width="1"/>' +
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
        let out = '<g>';
        out += '<rect x="' + x + '" y="' + top + '" width="' + width + '" height="' + extH + '" fill="#57708a"/>';
        /* Fenster-Raster */
        const winCols = Math.max(1, Math.floor(width / 18));
        for (let c = 0; c < winCols; c++) {
            out += '<rect x="' + (x + 8 + c * 18) + '" y="' + (top + 10) + '" width="9" height="9" fill="#cbd5e1" opacity="0.85"/>';
        }
        out += '</g>';
        return out;
    }

    function tanksAndPipesShape(extWidth, tankCount, pipeCount) {
        if (tankCount <= 0) return '';
        const startX = HOUSE.right + Math.max(extWidth, 0) + 22;
        let out = '';
        const positions = [];
        for (let i = 0; i < tankCount; i++) {
            const cx = Math.min(startX + i * 26, VIEW_W - 14);
            positions.push(cx);
            out += tankShape(cx, 22, 40 + (i % 2) * 8);
        }
        for (let i = 0; i < Math.min(pipeCount, positions.length); i++) {
            out += pipeShape(HOUSE.right + extWidth, GROUND_Y - 20, positions[i], GROUND_Y - 30, (HOUSE.right + extWidth + positions[i]) / 2);
        }
        return out;
    }

    function batteriesShape(count, scale) {
        if (count <= 0) return '';
        let out = '';
        const startX = 178, pitch = 15 * (0.9 + scale * 0.1);
        for (let i = 0; i < count; i++) {
            out += batteryShape(startX + i * pitch, 10 * scale, 30 * scale);
        }
        return out;
    }

    /* ------------------------------------------------------------
       Zusammensetzen
       ------------------------------------------------------------ */
    function build(stageIndex) {
        const s = SCENE_STAGES[Math.max(0, Math.min(SCENE_STAGES.length - 1, stageIndex))];
        const skyColors = SCENE_SKY_COLORS[s.sky] || SCENE_SKY_COLORS[0];
        const pavedWidth = Math.max(0, (100 - s.meadow) / 100 * VIEW_W);
        const gradId = 'sceneSky' + stageIndex;

        let out = '<svg viewBox="0 0 ' + VIEW_W + ' ' + VIEW_H + '" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Illustration des Grundstuecks im aktuellen Spielfortschritt">';
        out += '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="' + skyColors[0] + '"/>' +
            '<stop offset="100%" stop-color="' + skyColors[1] + '"/>' +
            '</linearGradient></defs>';

        /* Himmel */
        out += '<rect x="0" y="0" width="' + VIEW_W + '" height="' + GROUND_Y + '" fill="url(#' + gradId + ')"/>';
        for (let i = 0; i < s.cloud; i++) {
            out += cloudShape(70 + i * 130, 40 + (i % 2) * 20, 1 + (i % 2) * 0.2);
        }
        if (s.smog > 0) {
            out += '<rect x="0" y="55" width="' + VIEW_W + '" height="80" fill="#78716c" opacity="' + s.smog.toFixed(2) + '"/>';
        }

        /* Boden */
        out += '<rect x="0" y="' + GROUND_Y + '" width="' + VIEW_W + '" height="' + (VIEW_H - GROUND_Y) + '" fill="#86efac"/>';
        if (pavedWidth > 0) {
            out += '<rect x="' + ((VIEW_W - pavedWidth) / 2) + '" y="' + GROUND_Y + '" width="' + pavedWidth + '" height="' + (VIEW_H - GROUND_Y) + '" fill="#9ca3af"/>';
        }

        /* Baeume / Stuempfe (feste Positionen, damit nichts hin- und herspringt) */
        const treeSpots = [[88, GROUND_Y], [385, GROUND_Y]];
        for (let i = 0; i < treeSpots.length; i++) {
            if (i < s.trees) out += treeShape(treeSpots[i][0], treeSpots[i][1]);
            else if (i < s.trees + s.stumps) out += stumpShape(treeSpots[i][0], treeSpots[i][1]);
        }

        if (s.fence) out += fenceShape();

        /* Haus + Anbau + Dach */
        out += extensionShape(s.ext); // Anbau-Koerper hinter dem Haus-Dach zeichnen
        out += houseShape();
        out += roofPanelsShape(s.roof);
        if (s.heatPump) out += heatPumpShape();
        if (s.chim > 0) out += extensionChimneys(s.ext, s.chim, s.smog);

        out += groundPanelsShape(s.ground);
        out += batteriesShape(s.batt, s.battScale);
        out += tanksAndPipesShape(s.ext, s.tank, s.pipe);

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
        stageCount: SCENE_STAGES.length,
        stageIndexForFP: stageIndexForFP,
        build: build
    };
})();
