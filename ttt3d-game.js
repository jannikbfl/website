/* ============================================================
   3DicDacDoe - ttt3d-game.js
   Regeln und Spielfeld. Lobby, Matchmaking, Chat und Netzwerk kommen
   aus mp-core.js / mp-net.js - hier steht nur, was dieses Spiel
   von seinem Schwesterspiel unterscheidet.

   Das Brett hat 3 Ebenen a 3x3 = 27 Felder.
   Index eines Feldes: z * 9 + r * 3 + c   (z = Ebene, r = Reihe, c = Spalte)
   Gesetzt wird frei auf jedes leere Feld.

   Hausregel: eine Dreierreihe beendet das Spiel NICHT, sondern gibt
   einen Punkt. Gespielt wird, bis alle 27 Felder belegt sind. Sieger
   ist, wer die meisten Punkte hat.
   ============================================================ */

(function (global) {
    'use strict';

    var N = 3;              // Kantenlaenge
    var RUN = 3;            // so viele in einer Reihe geben einen Punkt
    var CELLS = N * N * N;  // 27

    function idx(z, r, c) { return z * N * N + r * N + c; }

    function coords(i) {
        return { z: Math.floor(i / (N * N)), r: Math.floor((i % (N * N)) / N), c: i % N };
    }

    /* --- Alle Gewinnlinien im Wuerfel (hier: 49) ---
       13 Richtungen (je ein Vertreter pro Richtungspaar), von jedem
       Startfeld aus, bei dem noch RUN-1 Felder in die Richtung passen. */
    function buildLines() {
        var dirs = [];
        for (var dz = -1; dz <= 1; dz++) {
            for (var dr = -1; dr <= 1; dr++) {
                for (var dc = -1; dc <= 1; dc++) {
                    if (!dz && !dr && !dc) continue;
                    // nur die lexikografisch positive Haelfte -> keine Duplikate
                    if (!(dz > 0 || (dz === 0 && (dr > 0 || (dr === 0 && dc > 0))))) continue;
                    dirs.push([dz, dr, dc]);
                }
            }
        }

        var lines = [];
        for (var z = 0; z < N; z++) {
            for (var r = 0; r < N; r++) {
                for (var c = 0; c < N; c++) {
                    for (var d = 0; d < dirs.length; d++) {
                        var v = dirs[d];
                        var ez = z + (RUN - 1) * v[0];
                        var er = r + (RUN - 1) * v[1];
                        var ec = c + (RUN - 1) * v[2];
                        if (ez < 0 || ez >= N || er < 0 || er >= N || ec < 0 || ec >= N) continue;

                        var line = [];
                        for (var s = 0; s < RUN; s++) line.push(idx(z + s * v[0], r + s * v[1], c + s * v[2]));
                        lines.push(line);
                    }
                }
            }
        }
        return lines;
    }

    var LINES = buildLines();

    /* Nachschlagetabelle: welche Linien laufen durch Feld i? */
    var LINES_BY_CELL = [];
    for (var i = 0; i < CELLS; i++) LINES_BY_CELL.push([]);
    for (var li = 0; li < LINES.length; li++) {
        for (var k = 0; k < LINES[li].length; k++) LINES_BY_CELL[LINES[li][k]].push(li);
    }

    /* --- Menschenlesbare Beschreibung einer Linie (fuer das Punkte-Log) --- */
    function describeLine(lineIndex) {
        var l = LINES[lineIndex];
        var a = coords(l[0]), b = coords(l[1]), c = coords(l[2]);

        var sameZ = a.z === b.z && b.z === c.z;
        var sameR = a.r === b.r && b.r === c.r;
        var sameC = a.c === b.c && b.c === c.c;

        if (sameZ) {
            if (sameR) return 'Ebene ' + (a.z + 1) + ' - Reihe ' + (a.r + 1);
            if (sameC) return 'Ebene ' + (a.z + 1) + ' - Spalte ' + (a.c + 1);
            return 'Ebene ' + (a.z + 1) + ' - Diagonale';
        }
        if (sameR && sameC) return 'Saeule R' + (a.r + 1) + '/S' + (a.c + 1);
        if (sameR || sameC) return 'Ebenen-Diagonale';
        return 'Raumdiagonale';
    }

    /* ---------------- Zustand ---------------- */

    function emptyBoard() {
        var b = [];
        for (var i = 0; i < CELLS; i++) b.push(null);
        return b;
    }

    function isFull(board) {
        for (var i = 0; i < CELLS; i++) if (board[i] === null) return false;
        return true;
    }

    function freeCount(board) {
        var n = 0;
        for (var i = 0; i < CELLS; i++) if (board[i] === null) n++;
        return n;
    }

    /* Ohne Schwerkraft: der Klick belegt genau das angeklickte Feld. */
    function moveForCell(state, cell) {
        if (!(cell >= 0 && cell < CELLS)) return null;
        return state.board[cell] === null ? cell : null;
    }

    /* Legt einen Stein und liefert die dadurch neu vollendeten Linien.
       Da Felder nie den Besitzer wechseln, wird jede Linie genau einmal
       vollendet - naemlich beim Zug, der ihr letztes Feld fuellt. */
    function applyMove(board, playerId, cell) {
        if (!(cell >= 0 && cell < CELLS)) return null;
        if (board[cell] !== null) return null;

        board[cell] = playerId;

        var gained = [];
        var cand = LINES_BY_CELL[cell];
        for (var k = 0; k < cand.length; k++) {
            var l = LINES[cand[k]];
            var all = true;
            for (var s = 0; s < l.length; s++) if (board[l[s]] !== playerId) { all = false; break; }
            if (all) gained.push(cand[k]);
        }
        return gained;
    }

    /* ---------------- Spielfeld im DOM ---------------- */

    var buttons = [];

    function buildBoard(container, onClick) {
        buttons = [];
        container.className = 'mp-levels';
        container.style.setProperty('--levels', String(N));

        for (var z = 0; z < N; z++) {
            var lvl = document.createElement('div');
            lvl.className = 'mp-level';

            var title = document.createElement('div');
            title.className = 'mp-level-title';
            title.textContent = 'Ebene ' + (z + 1);
            lvl.appendChild(title);

            var grid = document.createElement('div');
            grid.className = 'mp-board';
            grid.style.setProperty('--cols', String(N));

            for (var r = 0; r < N; r++) {
                for (var c = 0; c < N; c++) {
                    var cell = idx(z, r, c);
                    var b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'mp-cell';
                    b.disabled = true;
                    b.setAttribute('aria-label',
                        'Ebene ' + (z + 1) + ', Reihe ' + (r + 1) + ', Spalte ' + (c + 1));
                    (function (target) {
                        b.addEventListener('click', function () { onClick(target); });
                    })(cell);
                    grid.appendChild(b);
                    buttons[cell] = b;
                }
            }
            lvl.appendChild(grid);
            container.appendChild(lvl);
        }
    }

    function renderBoard(state, ctx) {
        for (var i = 0; i < CELLS; i++) {
            var b = buttons[i];
            if (!b) continue;
            var owner = state.board[i];
            var piece = owner ? ctx.piece(owner) : null;

            var cls = 'mp-cell';
            if (owner) cls += ' taken';
            if (ctx.scoredCells[i]) cls += ' scored';
            if (state.last === i) cls += ' last';
            if (!owner && ctx.myTurn) cls += ' playable';

            var wasEmpty = b.textContent === '';
            b.className = cls;
            b.textContent = piece ? piece.shape : '';
            if (piece) b.style.setProperty('--seat', piece.color);
            else b.style.removeProperty('--seat');
            b.disabled = !(ctx.myTurn && !owner);

            if (owner && wasEmpty) {
                b.classList.add('fresh');
                (function (node) { setTimeout(function () { node.classList.remove('fresh'); }, 300); })(b);
            }
        }

        // Neu geschlossene Reihen einmal aufblitzen lassen.
        ctx.flashLines.forEach(function (lineIndex) {
            var l = LINES[lineIndex];
            if (!l) return;
            l.forEach(function (ci) {
                var node = buttons[ci];
                if (!node) return;
                node.classList.remove('flash');
                void node.offsetWidth;   // Animation neu starten
                node.classList.add('flash');
            });
        });
    }

    /* ---------------- Adapter fuer mp-core ---------------- */

    global.GAME_TTT3D = {
        root: 'biefel-de/ttt3d/v1',
        name: '3DicDacDoe',
        icon: 'assets/ttt3d-thumb.svg',
        symbols: ['✕', '◯', '▲'],   // Rueckfallwerte, falls jemand nichts waehlt
        minPlayers: 3,
        maxPlayers: 3,
        cells: CELLS,

        /* Jeder waehlt in der Lobby Form und Farbe und meldet sich bereit.
           Bewusst nur geometrische Zeichen: die haben keine Emoji-Variante
           und werden deshalb ueberall einfarbig gezeichnet, also in der
           gewaehlten Spielerfarbe statt bunt vom System. */
        looks: {
            shapes: ['✕', '✚', '◯', '●', '▲', '▼', '◆', '◇', '■', '□', '★', '◐'],
            colors: [
                { id: 'himmel',  value: '#38bdf8', name: 'Himmelblau' },
                { id: 'bernstein', value: '#fbbf24', name: 'Bernstein' },
                { id: 'smaragd', value: '#34d399', name: 'Smaragd' },
                { id: 'rose',    value: '#fb7185', name: 'Rose' },
                { id: 'violett', value: '#c084fc', name: 'Violett' },
                { id: 'orange',  value: '#fb923c', name: 'Orange' },
                { id: 'tuerkis', value: '#22d3ee', name: 'Türkis' },
                { id: 'limette', value: '#a3e635', name: 'Limette' },
                { id: 'pink',    value: '#f472b6', name: 'Pink' },
                { id: 'schnee',  value: '#e2e8f0', name: 'Schnee' }
            ]
        },
        requireReady: true,

        emptyBoard: emptyBoard,
        isFull: isFull,
        freeCount: freeCount,
        describeLine: describeLine,
        lineCells: function (lineIndex) { return LINES[lineIndex]; },
        moveForCell: moveForCell,
        applyMove: applyMove,
        buildBoard: buildBoard,
        renderBoard: renderBoard
    };
})(window);
