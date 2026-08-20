/* ============================================================
   Erzgrund - erzgrund-engine.js
   Spiellogik: Welt, Bewegung, Abbau, Pflanzen, Maschinen,
   Wirtschaft, Speicherstand. Kein DOM-Zugriff - Aenderungen
   meldet die Engine ueber EG.on(...) an die Oberflaeche.

   Zeitmodell: alles haengt an state.clock, gezaehlt in
   Ingame-Minuten seit Spielbeginn. Pflanzen und Maschinen
   speichern ihren Fertig-Zeitpunkt auf derselben Uhr, damit
   Wachstum, Produktion, Tageszeit und Offline-Nachlauf
   automatisch zusammenpassen.
   ============================================================ */

const EG = (function () {
    'use strict';

    const T = EG_CONFIG.tile;
    const SOLID = { '#': 1, '~': 1, 'T': 1, 'R': 1, 'C': 1, 'K': 1, 'I': 1,
                    'G': 1, 'X': 1, 'H': 1, 'S': 1, 'V': 1, 'M': 1, 'E': 1, 'f': 1 };

    const listeners = {};
    let maps = {};              // gebaute Gitter je Karte
    let lastActionAt = 0;
    let saveTimer = null;
    let wiped = false;          // blockt Autosave nach dem Loeschen
    let manualTask = null;      // laufende Handarbeit (nicht Teil des Spielstands)

    const state = {
        clock: 6 * 60,          // Ingame-Minuten, Start: Tag 1, 6:00
        taler: EG_CONFIG.startTaler,
        stamina: EG_CONFIG.staminaMax,
        map: 'tal',
        px: 0, py: 0, dir: 'down',
        inv: {},
        seeds: {},              // cropId -> Anzahl
        activeSeed: null,
        tools: { axt: 0, spitzhacke: 0 },
        nodes: {},              // key -> Ingame-Minute, ab der das Feld wieder da ist
        nodeHp: {},             // key -> bereits abgetragene Haerte
        plots: {},              // key -> { crop, ready }
        extraPlots: [],         // nachgekaufte Beete (Schluessel)
        machines: {},           // key -> { type, queue:[{r,done}], out:{} }
        railway: [],            // fertige Bauabschnitte (ids)
        finished: false,
        finishedDay: 0,
        goals: [],              // erledigte Ziele
        hints: [],              // gesehene Hinweise
        stats: {
            gathered: {}, produced: {}, sold: 0, planted: 0, harvested: 0,
            deepestMine: 0, earned: 0, steps: 0, sleeps: 0
        }
    };

    /* ------------------------------------------------------------
       EVENT-BUS
       ------------------------------------------------------------ */
    function on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); }
    function emit(name, payload) { (listeners[name] || []).forEach(fn => fn(payload)); }
    function log(msg, kind) { emit('log', { msg: msg, kind: kind || 'neutral' }); }

    /* ------------------------------------------------------------
       DETERMINISTISCHER ZUFALL
       Die Welt muss nach jedem Reload identisch sein, sonst liegen
       gespeicherte Rohstoff-Felder ploetzlich woanders.
       ------------------------------------------------------------ */
    function mulberry32(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /* ------------------------------------------------------------
       WELT BAUEN
       ------------------------------------------------------------ */
    function buildMap(def) {
        const rnd = mulberry32(def.seed || 1);
        const g = [];
        for (let y = 0; y < def.h; y++) g.push(new Array(def.w).fill(def.base));

        const inside = (x, y) => x >= 0 && y >= 0 && x < def.w && y < def.h;
        const put = (x, y, t) => { if (inside(x, y)) g[y][x] = t; };

        def.build.forEach(op => {
            if (op.op === 'fill') {
                for (let y = op.y; y < op.y + op.h; y++) {
                    for (let x = op.x; x < op.x + op.w; x++) {
                        if (op.border) {
                            const edge = x === op.x || y === op.y ||
                                         x === op.x + op.w - 1 || y === op.y + op.h - 1;
                            if (edge) put(x, y, op.tile);
                        } else {
                            put(x, y, op.tile);
                        }
                    }
                }
            } else if (op.op === 'scatter') {
                for (let y = op.y; y < op.y + op.h; y++) {
                    for (let x = op.x; x < op.x + op.w; x++) {
                        if (!inside(x, y)) continue;
                        if (g[y][x] !== '.') continue;      // nie Wege oder Gebaeude ueberschreiben
                        if (rnd() < op.p) put(x, y, op.tile);
                    }
                }
            } else if (op.op === 'path') {
                for (let i = 0; i < op.len; i++) {
                    const x = op.dir === 'h' ? op.x + i : op.x;
                    const y = op.dir === 'h' ? op.y : op.y + i;
                    if (inside(x, y) && g[y][x] !== '#') put(x, y, ',');
                }
            } else if (op.op === 'set') {
                put(op.x, op.y, op.tile);
            } else if (op.op === 'pond') {
                const cx = op.x + op.w / 2, cy = op.y + op.h / 2;
                for (let y = op.y; y < op.y + op.h; y++) {
                    for (let x = op.x; x < op.x + op.w; x++) {
                        const dx = (x - cx) / (op.w / 2), dy = (y - cy) / (op.h / 2);
                        if (dx * dx + dy * dy <= 1) put(x, y, '~');
                    }
                }
            } else if (op.op === 'fence') {
                for (let x = op.x; x < op.x + op.w; x++) {
                    [op.y, op.y + op.h - 1].forEach(y => {
                        if (inside(x, y) && g[y][x] === '.') put(x, y, 'f');
                    });
                }
                for (let y = op.y; y < op.y + op.h; y++) {
                    [op.x, op.x + op.w - 1].forEach(x => {
                        if (inside(x, y) && g[y][x] === '.') put(x, y, 'f');
                    });
                }
            } else if (op.op === 'caves') {
                carveCaves(g, op, mulberry32(op.seed || def.seed || 7), inside, put);
            }
        });
        return g;
    }

    /** Raeume plus verbindende Gaenge - reicht voellig fuer einen Stollen. */
    function carveCaves(g, op, rnd, inside, put) {
        const rooms = [];
        for (let i = 0; i < op.rooms; i++) {
            const w = 4 + Math.floor(rnd() * 6);
            const h = 3 + Math.floor(rnd() * 4);
            const x = op.x + 1 + Math.floor(rnd() * (op.w - w - 2));
            const y = op.y + 1 + Math.floor(rnd() * (op.h - h - 2));
            rooms.push({ x: x, y: y, w: w, h: h, cx: x + (w >> 1), cy: y + (h >> 1) });
            for (let yy = y; yy < y + h; yy++) {
                for (let xx = x; xx < x + w; xx++) put(xx, yy, '.');
            }
        }
        // Startbereich immer frei, sonst steht man in der Wand
        for (let yy = op.y + 2; yy <= op.y + 5; yy++) {
            for (let xx = op.x + 2; xx <= op.x + 6; xx++) put(xx, yy, '.');
        }
        rooms.push({ cx: op.x + 4, cy: op.y + 4 });
        rooms.push({ cx: op.x + op.w - 4, cy: op.y + op.h - 4 });
        for (let i = 1; i < rooms.length; i++) {
            const a = rooms[i - 1], b = rooms[i];
            const x0 = Math.min(a.cx, b.cx), x1 = Math.max(a.cx, b.cx);
            const y0 = Math.min(a.cy, b.cy), y1 = Math.max(a.cy, b.cy);
            for (let x = x0; x <= x1; x++) { put(x, a.cy, '.'); put(x, a.cy + 1, '.'); }
            for (let y = y0; y <= y1; y++) { put(b.cx, y, '.'); put(b.cx + 1, y, '.'); }
        }
    }

    /* ------------------------------------------------------------
       ERREICHBARKEIT SICHERN
       Die Hoehlen werden gewuerfelt und danach mit Erz bestreut - dabei
       kann ein Gang zuwachsen oder eine Leiter in einer Wand landen.
       Statt das mit vorsichtigeren Wahrscheinlichkeiten zu umgehen (was
       nie ganz sicher waere), wird die fertige Karte geprueft und wo
       noetig ein Stollen nachtraeglich freigeraeumt.
       ------------------------------------------------------------ */
    function floodFrom(g, sx, sy) {
        const seen = {};
        const q = [[sx, sy]];
        seen[sx + ',' + sy] = 1;
        while (q.length) {
            const p = q.pop();
            [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(d => {
                const nx = p[0] + d[0], ny = p[1] + d[1];
                if (ny < 0 || nx < 0 || ny >= g.length || nx >= g[0].length) return;
                const k = nx + ',' + ny;
                if (seen[k] || SOLID[g[ny][nx]]) return;
                seen[k] = 1; q.push([nx, ny]);
            });
        }
        return seen;
    }

    /** Graebt einen L-foermigen Gang vom naechsten erreichbaren Feld zum Ziel. */
    function tunnelTo(g, reach, tx, ty) {
        let best = null, bestD = 1e9;
        Object.keys(reach).forEach(k => {
            const p = k.split(',');
            const x = +p[0], y = +p[1];
            const d = Math.abs(x - tx) + Math.abs(y - ty);
            if (d < bestD) { bestD = d; best = [x, y]; }
        });
        if (!best) return;
        const dig = (x, y) => {
            if (x < 1 || y < 1 || y >= g.length - 1 || x >= g[0].length - 1) return;
            if (g[y][x] !== 'N' && g[y][x] !== 'U' && g[y][x] !== 'D') g[y][x] = '.';
        };
        const x0 = best[0], y0 = best[1];
        for (let x = Math.min(x0, tx); x <= Math.max(x0, tx); x++) dig(x, y0);
        for (let y = Math.min(y0, ty); y <= Math.max(y0, ty); y++) dig(tx, y);
    }

    function repairMap(g, def) {
        const sp = def.spawn;
        let reach = floodFrom(g, sp.x, sp.y);
        // 1) Leitern und Eingaenge muessen erreichbar sein
        def.build.forEach(op => {
            if (op.op !== 'set' || 'NUD'.indexOf(op.tile) === -1) return;
            if (reach[op.x + ',' + op.y]) return;
            tunnelTo(g, reach, op.x, op.y);
            reach = floodFrom(g, sp.x, sp.y);
        });
        // 2) groessere abgeschnittene Kammern anbinden, sonst liegt Erz brach
        for (let pass = 0; pass < 5; pass++) {
            const seen = {};
            let biggest = null;
            for (let y = 1; y < def.h - 1; y++) {
                for (let x = 1; x < def.w - 1; x++) {
                    const k = x + ',' + y;
                    if (SOLID[g[y][x]] || reach[k] || seen[k]) continue;
                    const region = floodFrom(g, x, y);
                    Object.keys(region).forEach(rk => seen[rk] = 1);
                    const size = Object.keys(region).length;
                    if (!biggest || size > biggest.size) biggest = { size: size, x: x, y: y };
                }
            }
            if (!biggest || biggest.size < 12) break;
            tunnelTo(g, reach, biggest.x, biggest.y);
            reach = floodFrom(g, sp.x, sp.y);
        }
    }

    function rebuildMaps() {
        maps = {};
        Object.keys(EG_MAPS).forEach(id => {
            maps[id] = buildMap(EG_MAPS[id]);
            repairMap(maps[id], EG_MAPS[id]);
        });
        // nachgekaufte Beete wieder einsetzen
        state.extraPlots.forEach(key => {
            const p = parseKey(key);
            if (maps[p.map] && maps[p.map][p.y]) maps[p.map][p.y][p.x] = 'b';
        });
    }

    function grid() { return maps[state.map]; }
    function mapDef() { return EG_MAPS[state.map]; }
    function tileAt(x, y) {
        const g = grid();
        if (!g || y < 0 || x < 0 || y >= g.length || x >= g[0].length) return '#';
        return g[y][x];
    }
    function key(map, x, y) { return map + ':' + x + ':' + y; }
    function parseKey(k) {
        const p = k.split(':');
        return { map: p[0], x: parseInt(p[1], 10), y: parseInt(p[2], 10) };
    }

    /* ------------------------------------------------------------
       ZEIT
       ------------------------------------------------------------ */
    function day() { return Math.floor((state.clock - 360) / 1440) + 1; }
    function timeOfDay() { return state.clock % 1440; }
    function clockText() {
        const m = timeOfDay();
        const h = Math.floor(m / 60), mm = Math.floor(m % 60);
        return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
    }
    /** 0 = tiefe Nacht, 1 = heller Tag. Fuer die Beleuchtung. */
    function daylight() {
        const m = timeOfDay();
        if (m >= 420 && m <= 1050) return 1;
        if (m > 1050 && m < 1260) return 1 - (m - 1050) / 210;
        if (m >= 1260 || m < 300) return 0.12;
        return 0.12 + ((m - 300) / 120) * 0.88;
    }
    function isNight() { return daylight() < 0.5; }

    /* ------------------------------------------------------------
       INVENTAR
       ------------------------------------------------------------ */
    function count(item) { return state.inv[item] || 0; }
    function give(item, n) {
        if (n <= 0) return;
        state.inv[item] = count(item) + n;
        emit('inventory');
    }
    function take(item, n) {
        if (count(item) < n) return false;
        state.inv[item] -= n;
        if (state.inv[item] <= 0) delete state.inv[item];
        emit('inventory');
        return true;
    }
    function canAfford(cost) {
        if (!cost) return true;
        if (cost.taler && state.taler < cost.taler) return false;
        return Object.keys(cost).every(k => k === 'taler' || count(k) >= cost[k]);
    }
    function pay(cost) {
        if (!canAfford(cost)) return false;
        Object.keys(cost).forEach(k => {
            if (k === 'taler') state.taler -= cost.taler;
            else take(k, cost[k]);
        });
        emit('inventory');
        return true;
    }
    function costText(cost) {
        return Object.keys(cost).map(k => {
            if (k === 'taler') return cost.taler + ' T';
            return cost[k] + 'x ' + (EG_ITEMS[k] ? EG_ITEMS[k].name : k);
        }).join(', ');
    }

    /* ------------------------------------------------------------
       BEWEGUNG
       ------------------------------------------------------------ */
    const HALF = 9;   // halbe Spielerbreite in Pixeln
    function solidAtPixel(x, y) {
        const t = tileAt(Math.floor(x / T), Math.floor(y / T));
        return !!SOLID[t];
    }
    function blocked(x, y) {
        return solidAtPixel(x - HALF, y - HALF) || solidAtPixel(x + HALF, y - HALF) ||
               solidAtPixel(x - HALF, y + HALF) || solidAtPixel(x + HALF, y + HALF);
    }

    function move(dx, dy, dtMs) {
        if (dx === 0 && dy === 0) return false;
        const len = Math.hypot(dx, dy) || 1;
        const step = EG_CONFIG.speed * (dtMs / 16.67);
        const nx = (dx / len) * step, ny = (dy / len) * step;

        if (Math.abs(dx) > Math.abs(dy)) state.dir = dx > 0 ? 'right' : 'left';
        else if (dy !== 0) state.dir = dy > 0 ? 'down' : 'up';

        let moved = false;
        if (!blocked(state.px + nx, state.py)) { state.px += nx; moved = true; }
        if (!blocked(state.px, state.py + ny)) { state.py += ny; moved = true; }
        if (moved) state.stats.steps++;
        return moved;
    }

    /* ------------------------------------------------------------
       INTERAKTION
       Zielfeld ist das Feld vor der Figur; steht dort nichts,
       zaehlt das Feld unter der Figur (fuer Beete).
       ------------------------------------------------------------ */
    function facingTile() {
        const tx = Math.floor(state.px / T), ty = Math.floor(state.py / T);
        const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[state.dir];
        return { x: tx + d[0], y: ty + d[1] };
    }

    function describeTile(x, y) {
        const t = tileAt(x, y);
        const k = key(state.map, x, y);
        if (EG_NODES[t]) {
            const n = EG_NODES[t];
            if ((state.nodes[k] || 0) > state.clock) return null;   // abgebaut, waechst nach
            const tier = EG_TOOLS[n.tool].tiers[state.tools[n.tool]];
            if (tier.level < n.level) {
                return { type: 'node', x: x, y: y, tile: t, node: n, locked: true,
                         label: n.name + ' - braucht ' + EG_TOOLS[n.tool].tiers[n.level - 1].name };
            }
            return { type: 'node', x: x, y: y, tile: t, node: n,
                     label: n.name + ' ' + EG_TOOLS[n.tool].verb };
        }
        if (t === 'b') {
            const plot = state.plots[k];
            if (!plot) {
                const c = state.activeSeed ? cropById(state.activeSeed) : null;
                if (!c) return { type: 'plot', x: x, y: y, label: 'Beet - kein Saatgut gewaehlt' };
                if ((state.seeds[c.id] || 0) < 1) return { type: 'plot', x: x, y: y, label: 'Beet - kein ' + c.seedName + ' im Beutel' };
                return { type: 'plot', x: x, y: y, label: c.seedName + ' pflanzen' };
            }
            const c = cropById(plot.crop);
            if (plot.ready <= state.clock) return { type: 'plot', x: x, y: y, label: c.name + ' ernten' };
            return { type: 'plot', x: x, y: y, label: c.name + ' waechst noch', wait: true };
        }
        if (t === 'H') return { type: 'bed', x: x, y: y, label: 'Schlafen bis zum Morgen' };
        if (t === 'S') return { type: 'shop', x: x, y: y, label: 'Laden' };
        if (t === 'V') return { type: 'sell', x: x, y: y, label: 'Verkaufskiste' };
        if (t === 'E') return { type: 'rail', x: x, y: y, label: 'Erzbahn-Station' };
        if (t === 'M') {
            const m = state.machines[k];
            if (!m) return { type: 'pad', x: x, y: y, label: 'Freier Bauplatz' };
            const def = machineDef(m.type);
            return { type: 'machine', x: x, y: y, label: def.name };
        }
        if (t === 'D') return { type: 'down', x: x, y: y, label: 'In den Stollen' };
        if (t === 'N') return { type: 'down', x: x, y: y, label: 'Tiefer hinab' };
        if (t === 'U') return { type: 'up', x: x, y: y, label: 'Nach oben' };
        return null;
    }

    /** Das, was gerade mit E benutzt wuerde. */
    function target() {
        const tx = Math.floor(state.px / T), ty = Math.floor(state.py / T);
        // Leitern gewinnen gegen das Feld davor: wer auf einer Leiter steht,
        // will sie benutzen - sonst blockiert eine Erzader daneben den Abstieg.
        const here = tileAt(tx, ty);
        if (here === 'D' || here === 'N' || here === 'U') return describeTile(tx, ty);
        const f = facingTile();
        const front = describeTile(f.x, f.y);
        if (front) return front;
        return describeTile(tx, ty);
    }

    function interact() {
        const tgt = target();
        if (!tgt) return null;
        switch (tgt.type) {
            case 'node': return hitNode(tgt);
            case 'plot': return usePlot(tgt);
            case 'bed': emit('open', { panel: 'sleep' }); return null;
            case 'shop': emit('open', { panel: 'shop' }); return null;
            case 'sell': emit('open', { panel: 'sell' }); return null;
            case 'rail': emit('open', { panel: 'rail' }); return null;
            case 'pad': emit('open', { panel: 'build', key: key(state.map, tgt.x, tgt.y) }); return null;
            case 'machine': emit('open', { panel: 'machine', key: key(state.map, tgt.x, tgt.y) }); return null;
            case 'down': return descend();
            case 'up': return ascend();
        }
        return null;
    }

    /* ------------------------------------------------------------
       ABBAU
       ------------------------------------------------------------ */
    function hitNode(tgt) {
        if (Date.now() - lastActionAt < EG_CONFIG.actionMs) return null;
        const n = tgt.node;
        const tool = EG_TOOLS[n.tool];
        const tier = tool.tiers[state.tools[n.tool]];
        if (tier.level < n.level) {
            log(n.name + ': dafuer ist die ' + tier.name + ' zu weich.', 'bad');
            return null;
        }
        if (state.stamina < tier.stamina) {
            log('Keine Kraft mehr. Iss etwas oder leg dich schlafen.', 'bad');
            emit('exhausted');
            return null;
        }
        const k = key(state.map, tgt.x, tgt.y);

        // Ohne richtiges Werkzeug (und mit dem ersten geschnitzten) laeuft der
        // Abbau ueber die Handarbeit: die UI oeffnet dafuer ein eigenes Fenster.
        if (tier.manual) {
            manualTask = {
                key: k, x: tgt.x, y: tgt.y, node: n, tool: n.tool,
                needed: tier.manual, done: 0,
                stamina: tier.stamina, onlyOne: !!tier.manualYield,
                // Baum: abwechselnd von der Seite. Stein: immer von oben.
                side: n.tool === 'axt' ? (Math.random() < 0.5 ? 'left' : 'right') : 'top'
            };
            emit('manual', manualState());
            return { manual: true };
        }

        lastActionAt = Date.now();
        state.stamina = Math.max(0, state.stamina - tier.stamina);

        const hp = (state.nodeHp[k] || 0) + tier.power;
        emit('hit', { x: tgt.x, y: tgt.y, tool: n.tool });

        if (hp < n.hardness) {
            state.nodeHp[k] = hp;
            emit('stamina');
            return { progress: hp / n.hardness };
        }

        return finishNode(k, tgt.x, tgt.y, n);
    }

    /**
     * Feld abgeraeumt: Beute ausschuetten, Nachwuchs-Uhr stellen.
     * Gemeinsamer Abschluss fuer Werkzeug- und Handarbeit.
     * onlyOne = mit blossen Haenden faellt genau ein Stueck ab.
     */
    function finishNode(k, x, y, n, onlyOne) {
        delete state.nodeHp[k];
        state.nodes[k] = state.clock + n.respawnMin;
        const got = [];
        if (onlyOne) {
            const item = n.drops[0].item;
            give(item, 1);
            state.stats.gathered[item] = (state.stats.gathered[item] || 0) + 1;
            got.push({ item: item, n: 1 });
        } else {
            n.drops.forEach(d => {
                const amount = d.min + Math.floor(Math.random() * (d.max - d.min + 1));
                if (amount > 0) {
                    give(d.item, amount);
                    state.stats.gathered[d.item] = (state.stats.gathered[d.item] || 0) + amount;
                    got.push({ item: d.item, n: amount });
                }
            });
        }
        emit('gathered', { x: x, y: y, drops: got });
        checkGoals();
        return { done: true, drops: got };
    }

    /* ------------------------------------------------------------
       HANDARBEIT
       Ohne Werkzeug wird gegen den Stamm geschlagen statt Taste gehalten:
       zehn Treffer fuer ein Holz. Die erste geschnitzte Axt macht daraus
       einen einzigen Schlag, ab der Steinstufe faellt der Schritt ganz weg.
       Der Zustand liegt bewusst nicht im Spielstand - ein abgebrochener
       Baum soll nach dem Neuladen kein halbfertiges Fenster hinterlassen.
       ------------------------------------------------------------ */
    function manualState() {
        if (!manualTask) return null;
        const t = manualTask;
        return {
            tool: t.tool, node: t.node, needed: t.needed, done: t.done,
            side: t.side, x: t.x, y: t.y,
            progress: t.done / t.needed
        };
    }

    /**
     * Ein Schlag von aussen. side ist die Seite, von der geschlagen wurde
     * ('left', 'right' beim Baum, 'top' beim Stein). Passt sie nicht,
     * zaehlt der Schlag nicht - kostet aber auch keine Kraft.
     */
    function manualStrike(side) {
        if (!manualTask) return null;
        const t = manualTask;
        if (side !== t.side) return { miss: true, state: manualState() };
        if (state.stamina < t.stamina) {
            log('Keine Kraft mehr. Iss etwas oder leg dich schlafen.', 'bad');
            emit('exhausted');
            manualTask = null;
            return { aborted: true };
        }
        state.stamina = Math.max(0, state.stamina - t.stamina);
        t.done++;
        emit('stamina');
        emit('hit', { x: t.x, y: t.y, tool: t.tool });

        if (t.done < t.needed) {
            // Beim Baum wechselt die Seite, beim Stein bleibt es der Schlag von oben.
            if (t.tool === 'axt') t.side = t.side === 'left' ? 'right' : 'left';
            return { hit: true, state: manualState() };
        }
        const res = finishNode(t.key, t.x, t.y, t.node, t.onlyOne);
        manualTask = null;
        return { done: true, drops: res.drops };
    }

    function cancelManual() { manualTask = null; }

    /* ------------------------------------------------------------
       PFLANZEN
       ------------------------------------------------------------ */
    function cropById(id) { return EG_CROPS.find(c => c.id === id) || null; }

    /** Steht dieses Saatgut schon im Laden? */
    function cropAvailable(c) {
        if (!c.unlock) return true;
        try { return !!c.unlock(state); } catch (e) { return false; }
    }

    function usePlot(tgt) {
        const k = key(state.map, tgt.x, tgt.y);
        const plot = state.plots[k];
        if (!plot) {
            const c = state.activeSeed ? cropById(state.activeSeed) : null;
            if (!c) { log('Waehle unten erst Saatgut aus.', 'bad'); return null; }
            if ((state.seeds[c.id] || 0) < 1) { log('Kein ' + c.seedName + ' mehr im Beutel.', 'bad'); return null; }
            state.seeds[c.id]--;
            state.plots[k] = { crop: c.id, planted: state.clock, ready: state.clock + c.growHours * 60 };
            state.stats.planted++;
            emit('inventory');
            checkGoals();
            return { planted: c.id };
        }
        if (plot.ready > state.clock) {
            const left = Math.ceil((plot.ready - state.clock) / 60);
            log(cropById(plot.crop).name + ' braucht noch rund ' + left + ' Stunden.', 'neutral');
            return null;
        }
        const c = cropById(plot.crop);
        const amount = c.yield[0] + Math.floor(Math.random() * (c.yield[1] - c.yield[0] + 1));
        give(c.id, amount);
        state.stats.gathered[c.id] = (state.stats.gathered[c.id] || 0) + amount;
        state.stats.harvested++;
        delete state.plots[k];
        emit('gathered', { x: tgt.x, y: tgt.y, drops: [{ item: c.id, n: amount }] });
        checkGoals();
        return { harvested: c.id, n: amount };
    }

    function plotStage(k) {
        const plot = state.plots[k];
        if (!plot) return null;
        const c = cropById(plot.crop);
        const total = c.growHours * 60;
        const done = 1 - Math.max(0, (plot.ready - state.clock)) / total;
        return { crop: c, progress: Math.max(0, Math.min(1, done)) };
    }

    /* ------------------------------------------------------------
       MASCHINEN
       ------------------------------------------------------------ */
    function machineDef(id) { return EG_MACHINES.find(m => m.id === id); }

    function buildMachine(padKey, typeId) {
        if (state.machines[padKey]) return false;
        const def = machineDef(typeId);
        if (!def || !canAfford(def.cost)) return false;
        pay(def.cost);
        state.machines[padKey] = { type: typeId, lvl: 1, queue: [], out: {} };
        log(def.name + ' steht.', 'good');
        checkGoals();
        emit('inventory');
        return true;
    }

    /** Stufe einer Maschine (1-basiert) und die zugehoerigen Werte. */
    function machineLevel(padKey) {
        const m = state.machines[padKey];
        if (!m) return null;
        const lvl = m.lvl || 1;
        return { lvl: lvl, max: EG_MACHINE_LEVELS.length, cur: EG_MACHINE_LEVELS[lvl - 1],
                 next: EG_MACHINE_LEVELS[lvl] || null };
    }

    /** Ausbaukosten: Vielfaches der Baukosten plus Materialsperre. */
    function machineUpgradeCost(padKey) {
        const info = machineLevel(padKey);
        if (!info || !info.next) return null;
        const def = machineDef(state.machines[padKey].type);
        const c = info.next.cost;
        const out = {};
        Object.keys(def.cost).forEach(k => {
            out[k] = Math.ceil(def.cost[k] * c.costFactor);
        });
        Object.keys(c.extra || {}).forEach(k => {
            out[k] = (out[k] || 0) + c.extra[k];
        });
        return out;
    }

    function upgradeMachine(padKey) {
        const info = machineLevel(padKey);
        if (!info || !info.next) return false;
        const cost = machineUpgradeCost(padKey);
        if (!canAfford(cost)) { log('Fuer den Ausbau fehlt noch: ' + costText(cost), 'bad'); return false; }
        pay(cost);
        state.machines[padKey].lvl = info.lvl + 1;
        const def = machineDef(state.machines[padKey].type);
        log(def.name + ' auf Stufe ' + (info.lvl + 1) + ' ausgebaut.', 'good');
        emit('inventory');
        checkGoals();
        return true;
    }

    function recipeAvailable(r) {
        if (!r.unlock) return true;
        if (r.unlock === 'eisen') return (state.stats.gathered.eisenerz || 0) > 0;
        if (r.unlock === 'gold') return (state.stats.gathered.golderz || 0) > 0;
        if (r.unlock === 'kuerbis') return (state.stats.gathered.kuerbis || 0) > 0;
        return true;
    }

    function queueRecipe(padKey, index) {
        const m = state.machines[padKey];
        if (!m) return false;
        const def = machineDef(m.type);
        const r = def.recipes[index];
        if (!r || !recipeAvailable(r)) return false;
        const lvl = machineLevel(padKey);
        if (m.queue.length >= lvl.cur.queue) {
            log(def.name + ': Warteschlange ist voll (Stufe ' + lvl.lvl + ' fasst ' + lvl.cur.queue + ').', 'bad');
            return false;
        }
        if (!canAfford(r.in)) { log('Zutaten fehlen: ' + costText(r.in), 'bad'); return false; }
        pay(r.in);
        const startAt = m.queue.length ? m.queue[m.queue.length - 1].done : state.clock;
        m.queue.push({ r: index, done: startAt + Math.round(r.minutes * lvl.cur.speed) });
        emit('inventory');
        return true;
    }

    function updateMachines() {
        Object.keys(state.machines).forEach(k => {
            const m = state.machines[k];
            const def = machineDef(m.type);
            let changed = false;
            while (m.queue.length && m.queue[0].done <= state.clock) {
                const job = m.queue.shift();
                const r = def.recipes[job.r];
                Object.keys(r.out).forEach(item => {
                    m.out[item] = (m.out[item] || 0) + r.out[item];
                    state.stats.produced[item] = (state.stats.produced[item] || 0) + r.out[item];
                });
                changed = true;
            }
            if (changed) { emit('machineDone', { key: k }); checkGoals(); }
        });
    }

    function collectMachine(padKey) {
        const m = state.machines[padKey];
        if (!m) return null;
        const got = [];
        Object.keys(m.out).forEach(item => {
            give(item, m.out[item]);
            got.push({ item: item, n: m.out[item] });
        });
        m.out = {};
        if (got.length) emit('collected', { key: padKey, drops: got });
        return got;
    }

    function machineStatus(padKey) {
        const m = state.machines[padKey];
        if (!m) return null;
        const def = machineDef(m.type);
        const jobs = m.queue.map(j => ({
            name: Object.keys(def.recipes[j.r].out).map(o => EG_ITEMS[o].name).join(', '),
            remaining: Math.max(0, j.done - state.clock),
            total: Math.round(def.recipes[j.r].minutes * (EG_MACHINE_LEVELS[(m.lvl || 1) - 1].speed))
        }));
        const lvl = machineLevel(padKey);
        return { def: def, jobs: jobs, out: m.out, level: lvl,
                 upgradeCost: machineUpgradeCost(padKey) };
    }

    /* ------------------------------------------------------------
       LADEN, VERKAUF, WERKZEUGE, BEETE
       ------------------------------------------------------------ */
    function buySeed(cropId, n) {
        const c = cropById(cropId);
        if (!c) return false;
        const price = c.seedPrice * n;
        if (state.taler < price) { log('Zu wenig Taler.', 'bad'); return false; }
        state.taler -= price;
        state.seeds[cropId] = (state.seeds[cropId] || 0) + n;
        if (!state.activeSeed) state.activeSeed = cropId;
        emit('inventory');
        return true;
    }

    function sell(item, n) {
        const def = EG_ITEMS[item];
        if (!def || !def.price) return false;
        n = Math.min(n, count(item));
        if (n <= 0) return false;
        take(item, n);
        const sum = def.price * n;
        state.taler += sum;
        state.stats.sold += n;
        state.stats.earned += sum;
        log('Verkauft: ' + n + 'x ' + def.name + ' fuer ' + sum + ' Taler.', 'good');
        checkGoals();
        return true;
    }

    function toolUpgradeCost(toolId) {
        const next = state.tools[toolId] + 1;
        const tier = EG_TOOLS[toolId].tiers[next];
        return tier ? tier.cost : null;
    }

    function upgradeTool(toolId) {
        const next = state.tools[toolId] + 1;
        const tier = EG_TOOLS[toolId].tiers[next];
        if (!tier) return false;
        if (!canAfford(tier.cost)) { log('Dafuer fehlt noch etwas: ' + costText(tier.cost), 'bad'); return false; }
        pay(tier.cost);
        state.tools[toolId] = next;
        log(tier.name + ' geschmiedet.', 'good');
        checkGoals();
        return true;
    }

    function plotPrice() {
        return Math.round(EG_CONFIG.plotPrice * Math.pow(EG_CONFIG.plotPriceFactor, state.extraPlots.length));
    }

    /** Naechstes freies Grasfeld in den Erweiterungsflaechen. */
    function nextPlotSpot() {
        const g = maps.tal;
        for (let i = 0; i < EG_PLOT_AREAS.length; i++) {
            const a = EG_PLOT_AREAS[i];
            for (let y = a.y; y < a.y + a.h; y++) {
                for (let x = a.x; x < a.x + a.w; x++) {
                    if (g[y] && g[y][x] === '.') return { x: x, y: y };
                }
            }
        }
        return null;
    }

    function buyPlot() {
        const spot = nextPlotSpot();
        if (!spot) { log('Auf dem Hof ist kein Platz mehr fuer ein Beet.', 'bad'); return false; }
        const price = plotPrice();
        if (state.taler < price) { log('Zu wenig Taler.', 'bad'); return false; }
        state.taler -= price;
        const k = key('tal', spot.x, spot.y);
        state.extraPlots.push(k);
        maps.tal[spot.y][spot.x] = 'b';
        log('Neues Beet angelegt.', 'good');
        return true;
    }

    /* ------------------------------------------------------------
       ESSEN UND SCHLAFEN
       ------------------------------------------------------------ */
    function eat(item) {
        const def = EG_ITEMS[item];
        if (!def || !def.food) return false;
        if (!take(item, 1)) return false;
        state.stamina = Math.min(EG_CONFIG.staminaMax, state.stamina + def.food);
        log(def.name + ' gegessen. +' + def.food + " Ausdauer.", 'good');
        emit('stamina');
        return true;
    }

    function sleep() {
        const next = Math.floor((state.clock - 360) / 1440 + 1) * 1440 + 360;
        state.clock = next;
        state.stamina = EG_CONFIG.sleepStamina;
        state.stats.sleeps++;
        updateMachines();
        save();
        emit('slept', { day: day() });
        emit('stamina');
        log('Tag ' + day() + ' beginnt.', 'good');
        return true;
    }

    /* ------------------------------------------------------------
       STOLLEN
       ------------------------------------------------------------ */
    function enterMap(id, spawnTile) {
        state.map = id;
        const def = EG_MAPS[id];
        const sp = spawnTile || def.spawn;
        state.px = sp.x * T + T / 2;
        state.py = sp.y * T + T / 2;
        if (def.depth) state.stats.deepestMine = Math.max(state.stats.deepestMine, def.depth);
        emit('map', { id: id, name: def.name });
        checkGoals();
    }

    function descend() {
        const def = mapDef();
        const nextId = state.map === 'tal' ? 'mine1' : def.down;
        if (!nextId) { log('Tiefer geht es nicht.', 'neutral'); return null; }
        const nextDef = EG_MAPS[nextId];
        if (nextDef.needLevel) {
            const tier = EG_TOOLS.spitzhacke.tiers[state.tools.spitzhacke];
            if (tier.level < nextDef.needLevel) {
                log('Der Schacht ist verschuettet. Mit einer ' +
                    EG_TOOLS.spitzhacke.tiers[nextDef.needLevel - 1].name + ' kaemst du durch.', 'bad');
                return null;
            }
        }
        enterMap(nextId);
        return { map: nextId };
    }

    function ascend() {
        const def = mapDef();
        const up = def.up;
        if (!up) return null;
        if (up === 'tal') enterMap('tal', { x: 36, y: 15 });
        else enterMap(up, { x: EG_MAPS[up].w - 5, y: EG_MAPS[up].h - 5 });
        return { map: up };
    }

    /* ------------------------------------------------------------
       ERZBAHN
       ------------------------------------------------------------ */
    function railwayStatus() {
        return EG_RAILWAY.map((sec, i) => ({
            index: i, def: sec,
            done: state.railway.indexOf(sec.id) !== -1,
            open: i === state.railway.length,
            can: canAfford(sec.need)
        }));
    }

    function buildRailway(index) {
        const sec = EG_RAILWAY[index];
        if (!sec || state.railway.indexOf(sec.id) !== -1) return false;
        if (index !== state.railway.length) return false;
        if (!canAfford(sec.need)) { log('Es fehlt noch: ' + costText(sec.need), 'bad'); return false; }
        pay(sec.need);
        state.railway.push(sec.id);
        log(sec.name + ' fertiggestellt.', 'good');
        checkGoals();
        if (state.railway.length === EG_RAILWAY.length && !state.finished) {
            state.finished = true;
            state.finishedDay = day();
            save();
            emit('finished', { day: state.finishedDay });
        }
        return true;
    }

    /* ------------------------------------------------------------
       ZIELE UND HINWEISE
       ------------------------------------------------------------ */
    function checkGoals() {
        EG_GOALS.forEach(g => {
            if (state.goals.indexOf(g.id) !== -1) return;
            let ok = false;
            try { ok = g.check(state); } catch (e) { ok = false; }
            if (ok) {
                state.goals.push(g.id);
                state.taler += g.reward;
                emit('goal', g);
            }
        });
    }

    function checkHints() {
        for (let i = 0; i < EG_HINTS.length; i++) {
            const h = EG_HINTS[i];
            if (state.hints.indexOf(h.id) !== -1) continue;
            let ok = false;
            try { ok = h.check(state); } catch (e) { ok = false; }
            if (ok) { state.hints.push(h.id); emit('hint', h); return; }
        }
    }

    /* ------------------------------------------------------------
       HAUPTSCHLEIFE
       Wird vom Renderer pro Frame aufgerufen.
       ------------------------------------------------------------ */
    let hintTimer = 0;
    function update(dtMs, input) {
        const before = Math.floor(state.clock);
        state.clock += (dtMs / 1000) * EG_CONFIG.minutesPerSecond;

        if (input) move(input.dx, input.dy, dtMs);

        if (Math.floor(state.clock) !== before) updateMachines();

        // Zwangsschlaf: nach 2:00 kippt die Figur um
        const m = timeOfDay();
        if (m >= 120 && m < 360) {
            log('Du bist unterwegs eingeschlafen.', 'neutral');
            if (state.map !== 'tal') enterMap('tal', EG_MAPS.tal.spawn);
            sleep();
        }

        hintTimer += dtMs;
        if (hintTimer > 2000) { hintTimer = 0; checkHints(); }
    }

    /* ------------------------------------------------------------
       SPEICHERSTAND
       ------------------------------------------------------------ */
    function save() {
        if (wiped) return false;      // nach dem Loeschen nichts mehr zurueckschreiben
        try {
            localStorage.setItem(EG_CONFIG.saveKey, JSON.stringify({
                v: EG_CONFIG.saveVersion, t: Date.now(), state: state
            }));
            return true;
        } catch (e) { return false; }
    }

    function load() {
        try {
            const raw = localStorage.getItem(EG_CONFIG.saveKey);
            if (!raw) return false;
            const parsed = JSON.parse(raw);
            const src = parsed.state;
            if (!src) return false;
            Object.keys(state).forEach(k => {
                if (src[k] === undefined) return;
                if (k === 'stats') {
                    Object.keys(state.stats).forEach(sk => {
                        if (src.stats[sk] !== undefined) state.stats[sk] = src.stats[sk];
                    });
                } else {
                    state[k] = src[k];
                }
            });
            // Offline-Nachlauf: Pflanzen und Maschinen holen auf
            const elapsedMs = Date.now() - (parsed.t || Date.now());
            const gained = Math.min(
                (elapsedMs / 1000) * EG_CONFIG.minutesPerSecond,
                EG_CONFIG.offlineCapHours * 60
            );
            if (gained > 1) {
                state.clock += gained;
                return { offlineMinutes: gained };
            }
            return true;
        } catch (e) { return false; }
    }

    /* Wichtig: erst das Speichern stilllegen. Sonst schreibt der
       beforeunload-Haken beim Neuladen den alten Stand direkt wieder hin. */
    function wipe() {
        wiped = true;
        clearInterval(saveTimer);
        localStorage.removeItem(EG_CONFIG.saveKey);
        location.reload();
    }

    function exportSave() { return btoa(unescape(encodeURIComponent(JSON.stringify(state)))); }
    function importSave(text) {
        try {
            const parsed = JSON.parse(decodeURIComponent(escape(atob(text.trim()))));
            localStorage.setItem(EG_CONFIG.saveKey, JSON.stringify({
                v: EG_CONFIG.saveVersion, t: Date.now(), state: parsed
            }));
            location.reload();
            return true;
        } catch (e) { return false; }
    }

    /* ------------------------------------------------------------
       START
       ------------------------------------------------------------ */
    function init() {
        const res = load();
        rebuildMaps();
        if (!res) {
            // Neues Spiel: Startausruestung
            state.seeds.karotte = 6;
            state.seeds.weizen = 4;
            state.activeSeed = 'karotte';
            const sp = EG_MAPS.tal.spawn;
            state.px = sp.x * T + T / 2;
            state.py = sp.y * T + T / 2;
        } else if (!state.px) {
            const sp = EG_MAPS[state.map].spawn;
            state.px = sp.x * T + T / 2;
            state.py = sp.y * T + T / 2;
        }
        updateMachines();
        checkGoals();
        saveTimer = setInterval(save, EG_CONFIG.autosaveMs);
        window.addEventListener('beforeunload', save);
        return res && res.offlineMinutes ? { offline: Math.round(res.offlineMinutes) } : null;
    }

    /* --- oeffentliche Schnittstelle --- */
    return {
        init: init, on: on, state: state,
        // Welt
        grid: grid, mapDef: mapDef, tileAt: tileAt, key: key, maps: () => maps,
        nodeReady: k => (state.nodes[k] || 0) <= state.clock,
        plotStage: plotStage, machineStatus: machineStatus, machineDef: machineDef,
        // Zeit
        day: day, timeOfDay: timeOfDay, clockText: clockText,
        daylight: daylight, isNight: isNight,
        // Spiel
        update: update, interact: interact, target: target, move: move,
        manualState: manualState, manualStrike: manualStrike, cancelManual: cancelManual,
        // Wirtschaft
        count: count, give: give, take: take, canAfford: canAfford, costText: costText,
        buySeed: buySeed, sell: sell, eat: eat, sleep: sleep,
        upgradeTool: upgradeTool, toolUpgradeCost: toolUpgradeCost,
        plotPrice: plotPrice, buyPlot: buyPlot,
        buildMachine: buildMachine, queueRecipe: queueRecipe, collectMachine: collectMachine,
        machineLevel: machineLevel, machineUpgradeCost: machineUpgradeCost, upgradeMachine: upgradeMachine,
        recipeAvailable: recipeAvailable,
        railwayStatus: railwayStatus, buildRailway: buildRailway,
        cropById: cropById, cropAvailable: cropAvailable,
        // Persistenz
        save: save, wipe: wipe, exportSave: exportSave, importSave: importSave
    };
})();
