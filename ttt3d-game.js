/* ============================================================
   TicTacToe 3D - ttt3d-game.js
   Reine Spiellogik, komplett ohne DOM und ohne Netzwerk.
   Das Brett hat 3 Ebenen a 3x3 = 27 Felder.
   Index eines Feldes: z * 9 + r * 3 + c   (z = Ebene, r = Reihe, c = Spalte)

   Besonderheit dieser Variante: eine Dreierreihe beendet das Spiel
   NICHT, sondern gibt einen Punkt. Gespielt wird, bis alle 27 Felder
   belegt sind. Sieger ist, wer die meisten Punkte hat.
   ============================================================ */

(function (global) {
    'use strict';

    var CELLS = 27;

    function coords(i) {
        return { z: Math.floor(i / 9), r: Math.floor((i % 9) / 3), c: i % 3 };
    }

    function idx(z, r, c) { return z * 9 + r * 3 + c; }

    /* --- Alle Gewinnlinien im 3x3x3-Wuerfel (es sind exakt 49) ---
       13 Richtungen (je ein Vertreter pro Richtungspaar), von jedem
       Startfeld aus, bei dem noch zwei Felder in die Richtung passen. */
    function buildLines() {
        var dirs = [];
        for (var dz = -1; dz <= 1; dz++) {
            for (var dr = -1; dr <= 1; dr++) {
                for (var dc = -1; dc <= 1; dc++) {
                    if (!dz && !dr && !dc) continue;
                    // nur die lexikografisch positive Haelfte -> keine Duplikate
                    var positive = dz > 0 || (dz === 0 && (dr > 0 || (dr === 0 && dc > 0)));
                    if (!positive) continue;
                    dirs.push([dz, dr, dc]);
                }
            }
        }

        var lines = [];
        for (var z = 0; z < 3; z++) {
            for (var r = 0; r < 3; r++) {
                for (var c = 0; c < 3; c++) {
                    for (var d = 0; d < dirs.length; d++) {
                        var v = dirs[d];
                        var z2 = z + 2 * v[0], r2 = r + 2 * v[1], c2 = c + 2 * v[2];
                        if (z2 < 0 || z2 > 2 || r2 < 0 || r2 > 2 || c2 < 0 || c2 > 2) continue;
                        lines.push([
                            idx(z, r, c),
                            idx(z + v[0], r + v[1], c + v[2]),
                            idx(z2, r2, c2)
                        ]);
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
        LINES_BY_CELL[LINES[li][0]].push(li);
        LINES_BY_CELL[LINES[li][1]].push(li);
        LINES_BY_CELL[LINES[li][2]].push(li);
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

    /* --- Spielzustand --- */

    function emptyBoard() {
        var b = [];
        for (var i = 0; i < CELLS; i++) b.push(null);
        return b;
    }

    function isFull(board) {
        for (var i = 0; i < CELLS; i++) if (board[i] === null) return false;
        return true;
    }

    function freeCells(board) {
        var out = [];
        for (var i = 0; i < CELLS; i++) if (board[i] === null) out.push(i);
        return out;
    }

    /* Legt einen Stein und liefert die dadurch neu vollendeten Linien.
       Da Felder nie den Besitzer wechseln, wird jede Linie genau einmal
       vollendet - naemlich beim Zug, der ihr letztes Feld fuellt.
       Rueckgabe: null bei ungueltigem Zug, sonst Array von Linien-Indizes. */
    function placeStone(board, playerId, cell) {
        if (!(cell >= 0 && cell < CELLS)) return null;
        if (board[cell] !== null) return null;

        board[cell] = playerId;

        var gained = [];
        var cand = LINES_BY_CELL[cell];
        for (var k = 0; k < cand.length; k++) {
            var l = LINES[cand[k]];
            if (board[l[0]] === playerId && board[l[1]] === playerId && board[l[2]] === playerId) {
                gained.push(cand[k]);
            }
        }
        return gained;
    }

    /* Rangliste: absteigend nach Punkten. Gleichstand an der Spitze -> Unentschieden. */
    function ranking(players, scores) {
        var list = players.map(function (p) {
            return { id: p.id, name: p.name, seat: p.seat, score: scores[p.id] || 0 };
        });
        list.sort(function (a, b) { return b.score - a.score; });

        var top = list.length ? list[0].score : 0;
        var winners = list.filter(function (p) { return p.score === top; });
        return { list: list, winners: winners, draw: winners.length > 1 };
    }

    global.TTT3D = {
        CELLS: CELLS,
        LINES: LINES,
        LINES_BY_CELL: LINES_BY_CELL,
        coords: coords,
        idx: idx,
        describeLine: describeLine,
        emptyBoard: emptyBoard,
        isFull: isFull,
        freeCells: freeCells,
        placeStone: placeStone,
        ranking: ranking
    };
})(window);
