/* ============================================================
   Viergewinnt 3D - vg3d-game.js
   Regeln und Spielfeld. Lobby, Matchmaking, Chat und Netzwerk kommen
   aus mp-core.js / mp-net.js - genau wie beim Schwesterspiel
   3DicDacDoe. Unterschiedlich sind nur Brettgroesse, Schwerkraft und
   die Laenge einer wertenden Reihe.

   Das Brett hat 4 Ebenen a 4x4 = 64 Felder.
   Index eines Feldes: z * 16 + r * 4 + c  (z = Ebene, 0 = unten)

   Schwerkraft: man waehlt eine der 16 Saeulen, der Stein faellt auf die
   unterste freie Ebene dieser Saeule.

   Hausregel wie beim Schwesterspiel: eine Viererreihe beendet das Spiel
   NICHT, sondern gibt einen Punkt. Gespielt wird, bis alle 64 Felder
   belegt sind. Sieger ist, wer die meisten Punkte hat.
   ============================================================ */

(function (global) {
    'use strict';

    var N = 4;              // Kantenlaenge
    var RUN = 4;            // vier in einer Reihe geben einen Punkt
    var LAYER = N * N;      // 16 Felder pro Ebene
    var CELLS = LAYER * N;  // 64

    function idx(z, r, c) { return z * LAYER + r * N + c; }

    function coords(i) {
        return { z: Math.floor(i / LAYER), r: Math.floor((i % LAYER) / N), c: i % N };
    }

    /* --- Alle Viererlinien im 4x4x4-Wuerfel (es sind 76) --- */
    function buildLines() {
        var dirs = [];
        for (var dz = -1; dz <= 1; dz++) {
            for (var dr = -1; dr <= 1; dr++) {
                for (var dc = -1; dc <= 1; dc++) {
                    if (!dz && !dr && !dc) continue;
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

    var LINES_BY_CELL = [];
    for (var i = 0; i < CELLS; i++) LINES_BY_CELL.push([]);
    for (var li = 0; li < LINES.length; li++) {
        for (var k = 0; k < LINES[li].length; k++) LINES_BY_CELL[LINES[li][k]].push(li);
    }

    function describeLine(lineIndex) {
        var l = LINES[lineIndex];
        var pts = l.map(coords);

        function allSame(key) {
            for (var i = 1; i < pts.length; i++) if (pts[i][key] !== pts[0][key]) return false;
            return true;
        }
        var sameZ = allSame('z'), sameR = allSame('r'), sameC = allSame('c');

        if (sameZ) {
            if (sameR) return 'Ebene ' + (pts[0].z + 1) + ' - Reihe ' + (pts[0].r + 1);
            if (sameC) return 'Ebene ' + (pts[0].z + 1) + ' - Spalte ' + (pts[0].c + 1);
            return 'Ebene ' + (pts[0].z + 1) + ' - Diagonale';
        }
        if (sameR && sameC) return 'Saeule R' + (pts[0].r + 1) + '/S' + (pts[0].c + 1);
        if (sameR || sameC) return 'Schraege durch die Ebenen';
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

    /* Unterste freie Ebene einer Saeule, oder null wenn die Saeule voll ist. */
    function dropCell(board, r, c) {
        for (var z = 0; z < N; z++) {
            var cell = idx(z, r, c);
            if (board[cell] === null) return cell;
        }
        return null;
    }

    /* Egal auf welche Ebene geklickt wird - gewertet wird die Saeule, und
       der Stein landet auf deren unterstem freien Feld. */
    function moveForCell(state, cell) {
        if (!(cell >= 0 && cell < CELLS)) return null;
        var p = coords(cell);
        return dropCell(state.board, p.r, p.c);
    }

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
    var container = null;
    var hoverColumn = null;   // {r, c} - fuer die Fallvorschau
    var lastCtx = null;

    function buildBoard(host, onClick) {
        buttons = [];
        container = host;
        hoverColumn = null;

        host.className = 'mp-levels dense';
        host.style.setProperty('--levels', String(N));

        // Ebene 1 (unten) steht links - gleiche Leserichtung wie beim
        // Schwesterspiel, die Beschriftung sagt, wo oben und unten ist.
        for (var z = 0; z < N; z++) {
            var lvl = document.createElement('div');
            lvl.className = 'mp-level';

            var title = document.createElement('div');
            title.className = 'mp-level-title';
            title.textContent = 'Ebene ' + (z + 1) + (z === 0 ? ' (unten)' : (z === N - 1 ? ' (oben)' : ''));
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
                        'Saeule Reihe ' + (r + 1) + ', Spalte ' + (c + 1) + ' - Ebene ' + (z + 1));
                    bindCell(b, cell, r, c, onClick);
                    grid.appendChild(b);
                    buttons[cell] = b;
                }
            }
            lvl.appendChild(grid);
            host.appendChild(lvl);
        }
    }

    function bindCell(b, cell, r, c, onClick) {
        b.addEventListener('click', function () { onClick(cell); });
        b.addEventListener('mouseenter', function () { setHover(r, c); });
        b.addEventListener('mouseleave', function () { setHover(null, null); });
        b.addEventListener('focus', function () { setHover(r, c); });
        b.addEventListener('blur', function () { setHover(null, null); });
    }

    /* Zeigt an, in welcher Saeule man gerade steht und wo der Stein landet.
       Bewusst ohne Abkuerzung bei gleicher Saeule: liegt der Zeiger schon auf
       dem Brett, waehrend die Runde startet, muss die Vorschau trotzdem
       erscheinen, sobald es etwas zu zeigen gibt. 64 Knoten sind billig. */
    function setHover(r, c) {
        hoverColumn = (r === null) ? null : { r: r, c: c };
        if (lastCtx) paintHover(lastCtx);
    }

    function paintHover(ctx) {
        for (var i = 0; i < CELLS; i++) {
            var b = buttons[i];
            if (b) b.classList.remove('drop-target', 'drop-column');
        }
        if (!hoverColumn || !ctx.myTurn || !ctx.board) return;

        var target = dropCell(ctx.board, hoverColumn.r, hoverColumn.c);
        for (var z = 0; z < N; z++) {
            var cell = idx(z, hoverColumn.r, hoverColumn.c);
            var node = buttons[cell];
            if (!node || ctx.board[cell] !== null) continue;
            node.classList.add(cell === target ? 'drop-target' : 'drop-column');
        }
    }

    function renderBoard(state, ctx) {
        lastCtx = { myTurn: ctx.myTurn, board: state.board };

        for (var i = 0; i < CELLS; i++) {
            var b = buttons[i];
            if (!b) continue;
            var owner = state.board[i];
            var piece = owner ? ctx.piece(owner) : null;

            var cls = 'mp-cell';
            if (owner) cls += ' taken';
            if (ctx.scoredCells[i]) cls += ' scored';
            if (state.last === i) cls += ' last';
            // Anklickbar ist jedes Feld einer Saeule, in der noch Platz ist.
            var p = coords(i);
            var free = ctx.myTurn && dropCell(state.board, p.r, p.c) !== null;
            if (free) cls += ' playable';

            var wasEmpty = b.textContent === '';
            b.className = cls;
            b.textContent = piece ? piece.shape : '';
            if (piece) b.style.setProperty('--seat', piece.color);
            else b.style.removeProperty('--seat');
            b.disabled = !free;

            if (owner && wasEmpty) {
                b.classList.add('fresh');
                (function (node) { setTimeout(function () { node.classList.remove('fresh'); }, 300); })(b);
            }
        }

        paintHover(lastCtx);

        ctx.flashLines.forEach(function (lineIndex) {
            var l = LINES[lineIndex];
            if (!l) return;
            l.forEach(function (ci) {
                var node = buttons[ci];
                if (!node) return;
                node.classList.remove('flash');
                void node.offsetWidth;
                node.classList.add('flash');
            });
        });
    }

    /* ---------------- Adapter fuer mp-core ---------------- */

    global.GAME_VG3D = {
        root: 'biefel-de/vg3d/v1',
        name: 'Viergewinnt 3D',
        icon: 'assets/vg3d-thumb.svg',
        symbols: ['●', '◆', '▲'],
        minPlayers: 2,
        maxPlayers: 3,
        cells: CELLS,

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
