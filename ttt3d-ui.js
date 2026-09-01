/* ============================================================
   TicTacToe 3D - ttt3d-ui.js
   Oberflaeche, Lobby, Matchmaking und Rundenlogik.

   Rollenmodell: es gibt keinen Spielserver. Wer eine Runde eroeffnet,
   ist "Rundenadmin" und haelt den massgeblichen Spielzustand. Alle
   anderen schicken nur Absichten (beitreten, ziehen, verlassen) an den
   Admin; der prueft sie und veroeffentlicht den neuen Gesamtzustand.
   Dadurch kann kein Client das Spielfeld manipulieren, und jeder sieht
   garantiert dasselbe Brett.
   ============================================================ */

(function (global) {
    'use strict';

    var G = global.TTT3D;
    var Net = global.TTTNet;

    var SYMBOLS = ['✕', '◯', '▲'];
    var SEAT_NAMES = ['Sitz 1', 'Sitz 2', 'Sitz 3'];

    var PING_MS = 4000;        // Lebenszeichen innerhalb einer Runde
    var MEMBER_TTL = 14000;    // danach gilt ein Mitspieler als abgesprungen
    var STATE_BEAT_MS = 5000;  // Admin wiederholt den Zustand
    var STATE_TIMEOUT = 16000; // so lange darf der Admin schweigen
    var ROULETTE_MS = 2600;    // Dauer der Auslosung
    var ROULETTE_HOLD = 1400;  // Nachlauf, bevor es losgeht
    var MANUAL_HOLD = 2200;

    /* ---------------- kleine Helfer ---------------- */

    function $(id) { return document.getElementById(id); }

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = text;
        return n;
    }

    function show(node, on) { node.hidden = !on; }

    function toast(text, kind) {
        var box = $('toasts');
        var t = el('div', 'ttt-toast' + (kind ? ' ' + kind : ''), text);
        box.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 5000);
    }

    /* ---------------- lokaler Zustand ---------------- */

    var me = { id: null, name: '' };
    var lobby = [];       // Spieler in der Lobby (aus Net)
    var gs = null;        // zuletzt empfangener Rundenzustand
    var host = null;      // nur beim Rundenadmin gefuellt, siehe unten
    var pending = {};     // nur beim Admin: offene Einladungen  id -> name
    var view = 'gate';
    var lastStateAt = 0;
    var seenScored = 0;   // wie viele Punktereihen wurden schon animiert
    var animatedPick = null;
    var rouletteTimer = null;
    var cellButtons = [];
    var joiningRoom = null;  // Beitritt losgeschickt, Zustand noch nicht da
    var renderedPhase = null;
    var renderedRoom = null;

    /* ---------------- Ansichten ---------------- */

    function setView(v) {
        view = v;
        show($('v-gate'), v === 'gate');
        show($('v-lobby'), v === 'lobby');
        show($('v-game'), v === 'game');
    }

    /* ---------------- Start ---------------- */

    function init() {
        me.id = Net.randId(8);

        var sel = $('broker-select');
        Net.BROKERS.forEach(function (b) {
            var o = el('option', null, b.label);
            o.value = b.id;
            sel.appendChild(o);
        });
        var savedBroker = localStorage.getItem('ttt3d.broker') || Net.BROKERS[0].id;
        sel.value = savedBroker;
        sel.addEventListener('change', function () {
            localStorage.setItem('ttt3d.broker', sel.value);
            if (Net.me) {
                quitRound(true);
                Net.switchBroker(sel.value);
                toast('Server gewechselt: ' + sel.options[sel.selectedIndex].text);
            }
        });

        var savedName = localStorage.getItem('ttt3d.name') || '';
        $('gate-name').value = savedName;

        $('gate-form').addEventListener('submit', function (e) {
            e.preventDefault();
            var name = Net.cleanName($('gate-name').value);
            if (name.length < 2) {
                $('gate-error').textContent = 'Bitte mindestens 2 Zeichen eingeben.';
                show($('gate-error'), true);
                return;
            }
            show($('gate-error'), false);
            me.name = name;
            localStorage.setItem('ttt3d.name', name);
            enterLobby();
        });

        $('btn-start').addEventListener('click', hostStartPick);
        $('btn-dissolve').addEventListener('click', function () { quitRound(false); });
        $('btn-quit').addEventListener('click', function () { quitRound(false); });
        $('btn-random').addEventListener('click', function () { hostChooseStarter(null); });
        $('btn-back-lobby').addEventListener('click', function () {
            show($('ov-result'), false);
            quitRound(false);
        });

        buildBoard();

        global.addEventListener('beforeunload', function () {
            if (gs) {
                var roomId = gs.room;
                if (host) { hostPublish({ phase: 'closed' }); Net.clearState(roomId); }
                else Net.publishAct(roomId, { t: 'leave' });
            }
            Net.stop();
        });

        setView('gate');
        setInterval(tick, 1000);
    }

    function enterLobby() {
        setView('lobby');
        Net.start({
            id: me.id,
            name: me.name,
            brokerId: $('broker-select').value,
            handlers: {
                onStatus: onStatus,
                onPlayers: onPlayers,
                onInvite: onInvite,
                onInviteResult: onInviteResult,
                onState: onState,
                onAct: onAct,
                onBye: onBye
            }
        });
        setInterval(function () {
            if (gs && gs.room && !host) Net.publishAct(gs.room, { t: 'ping' });
        }, PING_MS);
    }

    /* ---------------- Verbindungsanzeige ---------------- */

    function onStatus(status, detail, broker) {
        var dot = $('net-dot'), txt = $('net-text');
        var map = {
            offline:    ['bg-slate-500', 'nicht verbunden'],
            connecting: ['bg-amber-400', 'verbinde ...'],
            online:     ['bg-emerald-400', 'verbunden'],
            error:      ['bg-rose-500', detail || 'Fehler']
        };
        var m = map[status] || map.offline;
        dot.className = 'w-2 h-2 rounded-full shrink-0 ' + m[0];
        txt.textContent = m[1] + (status === 'online' && broker ? ' · ' + broker.label : '');
    }

    /* ---------------- Lobby ---------------- */

    function onPlayers(list) {
        lobby = list;
        renderLobby();
    }

    function onBye(id) {
        // Falls ein Mitspieler die Seite schliesst, raeumt der Admin auf.
        if (host && gs && memberIndex(id) >= 0) hostMemberGone(id);
        if (pending[id]) { delete pending[id]; renderRoomPanel(); }
    }

    function renderLobby() {
        var box = $('lobby-list');
        box.textContent = '';

        var others = lobby.filter(function (p) { return p.id !== me.id; });
        $('lobby-count').textContent = (others.length + 1) + ' online';
        show($('lobby-empty'), others.length === 0);

        var rows = [{ id: me.id, name: me.name, roomId: gs ? gs.room : null, self: true }].concat(others);

        rows.forEach(function (p) {
            var row = el('div', 'lobby-row' + (p.self ? ' me' : ''));
            row.appendChild(el('span', 'text-lg', p.self ? '\u{1F464}' : '\u{1F3AE}'));

            var mid = el('div', 'flex-1 min-w-0');
            var nm = el('div', 'text-sm font-bold text-slate-100 truncate', p.name);
            mid.appendChild(nm);
            var status = p.roomId
                ? (gs && p.roomId === gs.room ? 'in deiner Runde' : 'in einer Runde')
                : 'frei';
            mid.appendChild(el('div', 'text-[11px] text-slate-500', p.self ? 'du · ' + status : status));
            row.appendChild(mid);

            if (!p.self) {
                var canInvite = !p.roomId && !pending[p.id] &&
                    (!gs || (host && gs.phase === 'lobby' && gs.players.length < 3));
                var b = el('button', 'btn sm primary', pending[p.id] ? 'eingeladen' : 'Einladen');
                b.disabled = !canInvite;
                if (pending[p.id]) b.textContent = 'wartet ...';
                else if (p.roomId) b.textContent = 'belegt';
                b.addEventListener('click', function () { invite(p); });
                row.appendChild(b);
            }

            box.appendChild(row);
        });

        renderRoomPanel();
    }

    function renderRoomPanel() {
        var slots = $('room-slots');
        slots.textContent = '';

        var inRound = !!gs;
        show($('room-code'), inRound);
        show($('btn-dissolve'), inRound);
        if (inRound) {
            $('room-code-value').textContent = gs.room;
            $('btn-dissolve').textContent = gs.host === me.id ? 'Auflösen' : 'Verlassen';
        }

        show($('room-hint'), !inRound);

        var players = inRound ? gs.players : [];
        for (var i = 0; i < 3; i++) {
            var p = players[i];
            var s = el('div', 'slot seat-' + i + (p ? ' filled' : ''));
            s.appendChild(el('span', 'seat-dot'));
            s.appendChild(el('span', 'font-black', SYMBOLS[i]));
            s.appendChild(el('span', 'text-sm truncate', p ? p.name : 'frei'));
            if (p && gs && p.id === gs.host) s.appendChild(el('span', 'ml-auto text-[10px] text-amber-400 font-bold', 'ADMIN'));
            slots.appendChild(s);
        }

        var pen = $('room-pending');
        pen.textContent = '';
        for (var id in pending) {
            pen.appendChild(el('div', 'text-[11px] text-slate-500', 'Einladung an ' + pending[id] + ' verschickt …'));
        }

        var isHost = !!(gs && gs.host === me.id);
        var full = inRound && gs.players.length === 3;
        $('btn-start').disabled = !(isHost && full && gs.phase === 'lobby');
        $('btn-start').textContent = full ? 'Spiel starten' :
            (inRound ? 'Warte auf ' + (3 - gs.players.length) + ' Spieler' : 'Spiel starten');

        $('room-role').textContent = !inRound ? ''
            : (isHost ? 'Du bist Rundenadmin und bestimmst den Startspieler.'
                      : 'Rundenadmin ist ' + nameOf(gs.host) + '.');
    }

    /* ---------------- Matchmaking ---------------- */

    function invite(p) {
        if (!gs) hostCreateRoom();
        if (!host || gs.players.length >= 3) return;
        pending[p.id] = p.name;
        Net.publishLobby({ t: 'invite', to: p.id, roomId: gs.room });
        renderLobby();
        // Falls keine Antwort kommt, den Platz nicht ewig blockieren.
        setTimeout(function () {
            if (pending[p.id]) { delete pending[p.id]; renderLobby(); }
        }, 30000);
    }

    function onInvite(inv) {
        if (gs || joiningRoom) { // schon in einer Runde -> hoeflich absagen
            Net.publishLobby({ t: 'invite-res', to: inv.from, roomId: inv.roomId, ok: false });
            return;
        }
        var stack = $('invite-stack');
        if (stack.querySelector('[data-room="' + inv.roomId + '"]')) return;

        var card = el('div', 'ttt-card pointer-events-auto flex items-center gap-3 max-w-md');
        card.setAttribute('data-room', inv.roomId);

        var txt = el('div', 'flex-1 min-w-0');
        var line = el('div', 'text-sm text-slate-200 font-semibold');
        line.appendChild(el('span', null, inv.name));
        line.appendChild(el('span', 'font-normal text-slate-400', ' lädt dich zu einer Runde ein'));
        txt.appendChild(line);
        txt.appendChild(el('div', 'text-[11px] text-slate-500', 'Runde ' + inv.roomId));
        card.appendChild(txt);

        var no = el('button', 'btn sm', 'Ablehnen');
        var yes = el('button', 'btn sm primary', 'Annehmen');

        function close() { if (card.parentNode) card.parentNode.removeChild(card); }

        no.addEventListener('click', function () {
            Net.publishLobby({ t: 'invite-res', to: inv.from, roomId: inv.roomId, ok: false });
            close();
        });
        yes.addEventListener('click', function () {
            close();
            if (gs || joiningRoom) return;
            joiningRoom = inv.roomId;
            Net.publishLobby({ t: 'invite-res', to: inv.from, roomId: inv.roomId, ok: true });
            Net.enterRoom(inv.roomId);
            Net.publishAct(inv.roomId, { t: 'join' });
            lastStateAt = Date.now();
            toast('Runde ' + inv.roomId + ' beigetreten.');
            // Antwortet der Admin nicht, nicht ewig haengen bleiben.
            setTimeout(function () {
                if (joiningRoom === inv.roomId && !gs) {
                    joiningRoom = null;
                    Net.leaveRoomTopics();
                    toast('Keine Antwort vom Rundenadmin.', 'warn');
                }
            }, 12000);
        });

        card.appendChild(no);
        card.appendChild(yes);
        stack.appendChild(card);

        setTimeout(close, 45000);
    }

    function onInviteResult(res) {
        if (!host) return;
        if (!res.ok) {
            delete pending[res.from];
            toast(res.name + ' hat abgelehnt.', 'warn');
            renderLobby();
        }
        // Bei Zusage warten wir auf die join-Nachricht in der Runde.
    }

    /* ============================================================
       ROLLE: RUNDENADMIN
       ============================================================ */

    function hostCreateRoom() {
        var roomId = Net.randId(5);
        host = { seq: 0, seen: {}, timer: null };
        host.seen[me.id] = Date.now();

        gs = {
            v: 1, t: 'state', id: me.id, name: me.name,
            room: roomId, seq: 0, phase: 'lobby', host: me.id,
            players: [{ id: me.id, name: me.name, seat: 0 }],
            turn: null, board: G.emptyBoard(), scores: {}, scored: [],
            last: null, pick: null, reason: null
        };
        gs.scores[me.id] = 0;

        Net.enterRoom(roomId);
        hostPublish({});
        host.timer = setInterval(function () {
            if (host && gs) Net.publishState(gs.room, gs);
        }, STATE_BEAT_MS);
    }

    /* Uebernimmt Aenderungen, erhoeht die Sequenznummer und verteilt alles. */
    function hostPublish(patch) {
        for (var k in patch) gs[k] = patch[k];
        gs.seq += 1;
        gs.name = me.name;
        Net.publishState(gs.room, gs);
        applyState(gs, true);
    }

    function memberIndex(id) {
        if (!gs) return -1;
        for (var i = 0; i < gs.players.length; i++) if (gs.players[i].id === id) return i;
        return -1;
    }

    function onAct(roomId, senderId, msg) {
        // Absage des Admins an uns: die Runde ist schon voll oder laeuft.
        if (!host && msg.t === 'full' && msg.to === me.id) {
            joiningRoom = null;
            leaveLocally();
            toast('Die Runde ist bereits voll.', 'warn');
            return;
        }
        if (!host || !gs || roomId !== gs.room) return;
        host.seen[senderId] = Date.now();

        if (msg.t === 'join') {
            if (memberIndex(senderId) >= 0) { Net.publishState(gs.room, gs); return; }
            if (gs.phase !== 'lobby' || gs.players.length >= 3) {
                Net.publishAct(gs.room, { t: 'full', to: senderId });
                return;
            }
            delete pending[senderId];
            var name = Net.cleanName(msg.name) || 'Spieler';
            gs.players.push({ id: senderId, name: name, seat: gs.players.length });
            gs.scores[senderId] = 0;
            toast(name + ' ist der Runde beigetreten.');
            hostPublish({});
            return;
        }

        if (msg.t === 'leave') {
            hostMemberGone(senderId);
            return;
        }

        if (msg.t === 'move') {
            hostApplyMove(senderId, msg.cell);
            return;
        }
    }

    function hostMemberGone(id) {
        var i = memberIndex(id);
        if (i < 0) return;
        var name = gs.players[i].name;

        if (gs.phase === 'lobby') {
            gs.players.splice(i, 1);
            gs.players.forEach(function (p, k) { p.seat = k; });
            delete gs.scores[id];
            delete host.seen[id];
            toast(name + ' hat die Runde verlassen.', 'warn');
            hostPublish({});
        } else if (gs.phase !== 'over' && gs.phase !== 'closed') {
            toast(name + ' ist rausgeflogen – Runde abgebrochen.', 'warn');
            hostPublish({ phase: 'over', reason: 'aborted', turn: null });
        }
    }

    function hostStartPick() {
        if (!host || !gs || gs.phase !== 'lobby' || gs.players.length !== 3) return;
        hostPublish({ phase: 'pick', pick: null });
    }

    /* startId === null bedeutet: auslosen */
    function hostChooseStarter(startId) {
        if (!host || gs.phase !== 'pick' || gs.pick) return;

        var ids = gs.players.map(function (p) { return p.id; });
        var random = startId === null;

        if (random) {
            var buf = new Uint32Array(1);
            (global.crypto || global.msCrypto).getRandomValues(buf);
            startId = ids[buf[0] % ids.length];
        }

        var order = null;
        if (random) {
            // Feste Reihenfolge fuer die Auslosung, damit alle Rechner
            // exakt dieselbe Animation sehen und auf demselben Namen enden.
            order = [];
            var steps = 17;
            var startIdx = ids.indexOf(startId);
            for (var s = 0; s < steps; s++) {
                order.push(ids[(startIdx - (steps - 1 - s) % ids.length + ids.length * 4) % ids.length]);
            }
        }

        hostPublish({
            pick: { picked: startId, random: random, order: order, nonce: Net.randId(4) },
            turn: startId
        });

        var wait = random ? ROULETTE_MS + ROULETTE_HOLD : MANUAL_HOLD;
        setTimeout(function () {
            if (host && gs && gs.phase === 'pick') hostPublish({ phase: 'play' });
        }, wait);
    }

    function hostApplyMove(playerId, cell) {
        if (gs.phase !== 'play') return;
        if (gs.turn !== playerId) return;
        if (typeof cell !== 'number' || cell < 0 || cell >= G.CELLS) return;

        var board = gs.board.slice();
        var gained = G.placeStone(board, playerId, cell);
        if (gained === null) return;

        var scored = gs.scored.slice();
        var scores = {};
        for (var k in gs.scores) scores[k] = gs.scores[k];

        gained.forEach(function (lineIdx) {
            scored.push({ line: lineIdx, by: playerId, cell: cell });
            scores[playerId] = (scores[playerId] || 0) + 1;
        });

        var over = G.isFull(board);
        var nextSeat = (seatOf(playerId, gs) + 1) % gs.players.length;

        hostPublish({
            board: board,
            scored: scored,
            scores: scores,
            last: cell,
            turn: over ? null : gs.players[nextSeat].id,
            phase: over ? 'over' : 'play'
        });
    }

    /* Mitspieler, die sich nicht mehr melden, entfernen. */
    function hostPrune() {
        if (!host || !gs) return;
        var now = Date.now();
        gs.players.slice().forEach(function (p) {
            if (p.id === me.id) return;
            var seen = host.seen[p.id] || 0;
            if (now - seen > MEMBER_TTL) hostMemberGone(p.id);
        });
    }

    /* ============================================================
       ROLLE: MITSPIELER (und Admin, denn beide rendern denselben Zustand)
       ============================================================ */

    function onState(roomId, st) {
        if (!Net.roomId || roomId !== Net.roomId) return;
        if (typeof st.seq !== 'number' || !Array.isArray(st.players) || !Array.isArray(st.board)) return;
        if (st.board.length !== G.CELLS) return;
        if (st.host !== st.id) return;               // nur der Admin darf den Zustand setzen
        if (host && st.id !== me.id) return;         // fremder Zustand fuer unsere Runde

        // Auch ein unveraenderter Zustand ist ein Lebenszeichen des Admins.
        lastStateAt = Date.now();
        if (gs && gs.room === st.room && st.seq <= gs.seq) return; // Echo oder veraltet

        st.scored = Array.isArray(st.scored) ? st.scored : [];
        st.scores = (st.scores && typeof st.scores === 'object') ? st.scores : {};
        joiningRoom = null;
        applyState(st, false);
    }

    function applyState(st, local) {
        var prevPhase = renderedPhase;
        var prevRoom = renderedRoom;
        gs = st;
        lastStateAt = Date.now();
        renderedPhase = st.phase;
        renderedRoom = st.room;

        if (st.phase === 'closed') {
            if (!$('ov-result').hidden) return;   // Ergebnis darf stehen bleiben
            leaveLocally();
            toast('Die Runde wurde beendet.', 'warn');
            return;
        }

        if (st.room !== prevRoom) { seenScored = 0; animatedPick = null; }

        if (st.phase === 'lobby') {
            setView('lobby');
            show($('ov-pick'), false);
            show($('ov-result'), false);
            renderLobby();
            return;
        }

        setView('game');
        renderScoreBar();
        renderBoard();
        renderScoreLog();

        if (st.phase === 'pick') {
            renderPick();
        } else {
            show($('ov-pick'), false);
        }

        if (st.phase === 'play') {
            $('turn-text').textContent = st.turn === me.id
                ? 'Du bist am Zug'
                : nameOf(st.turn) + ' ist am Zug';
        } else if (st.phase === 'over') {
            $('turn-text').textContent = st.reason === 'aborted' ? 'Runde abgebrochen' : 'Alle Felder belegt';
        } else {
            $('turn-text').textContent = 'Startspieler wird bestimmt …';
        }
        $('cells-left').textContent = G.freeCells(st.board).length + ' Felder frei';

        if (st.phase === 'over' && prevPhase !== 'over') renderResult();
    }

    /* ---------------- Spielfeld ---------------- */

    function buildBoard() {
        var hostEl = $('board-host');
        hostEl.textContent = '';
        cellButtons = [];

        for (var z = 0; z < 3; z++) {
            var lvl = el('div', 'ttt-level');
            lvl.appendChild(el('div', 'ttt-level-title', 'Ebene ' + (z + 1)));
            var grid = el('div', 'ttt-board');
            for (var r = 0; r < 3; r++) {
                for (var c = 0; c < 3; c++) {
                    var i = G.idx(z, r, c);
                    var b = el('button', 'ttt-cell');
                    b.type = 'button';
                    b.disabled = true;
                    b.setAttribute('data-cell', String(i));
                    b.setAttribute('aria-label', 'Ebene ' + (z + 1) + ', Reihe ' + (r + 1) + ', Spalte ' + (c + 1));
                    b.addEventListener('click', onCellClick);
                    grid.appendChild(b);
                    cellButtons[i] = b;
                }
            }
            lvl.appendChild(grid);
            hostEl.appendChild(lvl);
        }
    }

    function onCellClick(e) {
        var cell = parseInt(e.currentTarget.getAttribute('data-cell'), 10);
        if (!gs || gs.phase !== 'play' || gs.turn !== me.id) return;
        if (gs.board[cell] !== null) return;

        if (host) hostApplyMove(me.id, cell);
        else Net.publishAct(gs.room, { t: 'move', cell: cell });
    }

    function renderBoard() {
        var scoredCells = {};
        gs.scored.forEach(function (s) {
            var line = G.LINES[s.line];
            if (!line) return;
            scoredCells[line[0]] = true; scoredCells[line[1]] = true; scoredCells[line[2]] = true;
        });

        var myTurn = gs.phase === 'play' && gs.turn === me.id;

        for (var i = 0; i < G.CELLS; i++) {
            var b = cellButtons[i];
            var owner = gs.board[i];
            var seat = owner ? seatOf(owner, gs) : -1;

            var cls = 'ttt-cell';
            if (owner) cls += ' taken p' + seat;
            if (scoredCells[i]) cls += ' scored';
            if (gs.last === i) cls += ' last';
            if (!owner && myTurn) cls += ' playable';

            var wasEmpty = b.textContent === '';
            b.className = cls;
            b.textContent = owner ? SYMBOLS[seat] : '';
            b.disabled = !(myTurn && !owner);

            if (owner && wasEmpty) {
                b.classList.add('fresh');
                (function (node) { setTimeout(function () { node.classList.remove('fresh'); }, 300); })(b);
            }
        }

        // Neu geschlossene Reihen einmal aufblitzen lassen.
        if (gs.scored.length > seenScored) {
            for (var k = seenScored; k < gs.scored.length; k++) {
                var l = G.LINES[gs.scored[k].line];
                if (!l) continue;
                l.forEach(function (ci) {
                    var node = cellButtons[ci];
                    node.classList.remove('flash');
                    void node.offsetWidth;   // Animation neu starten
                    node.classList.add('flash');
                });
            }
            seenScored = gs.scored.length;
            bumpScore(gs.scored[gs.scored.length - 1].by);
        }
        if (gs.scored.length < seenScored) seenScored = gs.scored.length;
    }

    /* ---------------- Punkteleiste ---------------- */

    function renderScoreBar() {
        var bar = $('score-bar');
        bar.textContent = '';
        gs.players.forEach(function (p) {
            var row = el('div', 'ttt-player seat-' + p.seat +
                (gs.turn === p.id ? ' active' : ''));
            row.setAttribute('data-player', p.id);
            row.appendChild(el('span', 'sym', SYMBOLS[p.seat]));

            var mid = el('div', 'min-w-0');
            mid.appendChild(el('div', 'nm', p.name + (p.id === me.id ? ' (du)' : '')));
            mid.appendChild(el('div', 'text-[10px] text-slate-500',
                SEAT_NAMES[p.seat] + (p.id === gs.host ? ' · Admin' : '')));
            row.appendChild(mid);

            row.appendChild(el('span', 'pts', String(gs.scores[p.id] || 0)));
            bar.appendChild(row);
        });
    }

    function bumpScore(playerId) {
        var row = document.querySelector('#score-bar [data-player="' + playerId + '"] .pts');
        if (!row) return;
        row.classList.remove('bump');
        void row.offsetWidth;
        row.classList.add('bump');
    }

    function renderScoreLog() {
        var box = $('score-log');
        box.textContent = '';
        show($('score-log-empty'), gs.scored.length === 0);

        gs.scored.slice().reverse().forEach(function (s) {
            var line = el('div', 'log-line seat-' + seatOf(s.by, gs));
            var b = el('b', null, nameOf(s.by));
            line.appendChild(b);
            line.appendChild(document.createTextNode(' +1 · ' + G.describeLine(s.line)));
            box.appendChild(line);
        });
    }

    /* ---------------- Startspieler-Auslosung ---------------- */

    function renderPick() {
        var ov = $('ov-pick');
        show(ov, true);

        var isHost = gs.host === me.id;
        var nameEl = $('pick-name');
        var subEl = $('pick-sub');

        if (!gs.pick) {
            show($('pick-controls'), isHost);
            $('pick-title').textContent = 'Startspieler';
            nameEl.className = 'roulette-name';
            nameEl.textContent = isHost ? 'Wer fängt an?' : 'Der Rundenadmin wählt …';
            subEl.textContent = isHost
                ? 'Wähle einen Spieler oder lass das Los entscheiden.'
                : nameOf(gs.host) + ' bestimmt gerade den Startspieler.';

            if (isHost) {
                var wrap = $('pick-buttons');
                wrap.textContent = '';
                gs.players.forEach(function (p) {
                    var b = el('button', 'btn w-full seat-' + p.seat, SYMBOLS[p.seat] + '  ' + p.name);
                    b.addEventListener('click', function () { hostChooseStarter(p.id); });
                    wrap.appendChild(b);
                });
            }
            return;
        }

        show($('pick-controls'), false);
        if (animatedPick === gs.pick.nonce) return;
        animatedPick = gs.pick.nonce;

        if (rouletteTimer) { clearTimeout(rouletteTimer); rouletteTimer = null; }

        if (gs.pick.random && Array.isArray(gs.pick.order) && gs.pick.order.length) {
            subEl.textContent = 'Das Los entscheidet …';
            runRoulette(gs.pick.order, gs.pick.picked);
        } else {
            subEl.textContent = nameOf(gs.host) + ' hat gewählt.';
            settlePick(gs.pick.picked);
        }
    }

    function runRoulette(order, picked) {
        var nameEl = $('pick-name');
        var i = 0;

        function step() {
            var id = order[i];
            nameEl.className = 'roulette-name seat-' + seatOf(id, gs);
            nameEl.textContent = nameOf(id);
            i++;

            if (i >= order.length) { settlePick(picked); return; }

            // Von schnell nach langsam auslaufen lassen.
            var t = i / order.length;
            rouletteTimer = setTimeout(step, 60 + Math.pow(t, 2.6) * 380);
        }

        if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            settlePick(picked);
            return;
        }
        step();
    }

    function settlePick(picked) {
        var nameEl = $('pick-name');
        nameEl.className = 'roulette-name settled seat-' + seatOf(picked, gs);
        nameEl.textContent = nameOf(picked);
        $('pick-sub').textContent = (picked === me.id ? 'Du fängst an!' : 'fängt an')
            + ' – gleich geht es los.';
        $('pick-title').textContent = 'Startspieler steht fest';
    }

    /* ---------------- Ergebnis ---------------- */

    function renderResult() {
        show($('ov-pick'), false);
        var ov = $('ov-result');
        show(ov, true);

        var rank = G.ranking(gs.players, gs.scores);

        if (gs.reason === 'aborted') {
            $('result-crown').textContent = '⚠️';
            $('result-title').className = 'roulette-name settled';
            $('result-title').textContent = 'Runde abgebrochen';
        } else if (rank.draw) {
            $('result-crown').textContent = '\u{1F91D}';
            $('result-title').className = 'roulette-name settled';
            $('result-title').textContent = 'Unentschieden';
        } else {
            var w = rank.winners[0];
            $('result-crown').textContent = '\u{1F3C6}';
            $('result-title').className = 'roulette-name settled seat-' + w.seat;
            $('result-title').textContent = (w.id === me.id ? 'Du gewinnst!' : w.name + ' gewinnt!');
        }

        var tbl = $('result-table');
        tbl.textContent = '';
        rank.list.forEach(function (p, i) {
            var row = el('div', 'ttt-player seat-' + p.seat);
            row.appendChild(el('span', 'text-slate-500 text-xs font-bold w-4', String(i + 1)));
            row.appendChild(el('span', 'sym', SYMBOLS[p.seat]));
            row.appendChild(el('span', 'nm flex-1', p.name + (p.id === me.id ? ' (du)' : '')));
            row.appendChild(el('span', 'pts', p.score + (p.score === 1 ? ' Punkt' : ' Punkte')));
            tbl.appendChild(row);
        });
    }

    /* ---------------- Runde verlassen ---------------- */

    function quitRound(silent) {
        if (!gs) { setView('lobby'); return; }
        // Achtung: hostPublish loest ueber applyState bereits ein leaveLocally()
        // aus und setzt gs auf null - die Runden-ID vorher sichern.
        var roomId = gs.room;
        if (host) {
            hostPublish({ phase: 'closed' });
            Net.clearState(roomId);
        } else {
            Net.publishAct(roomId, { t: 'leave' });
        }
        leaveLocally();
        if (!silent) toast('Zurück in der Lobby.');
    }

    function leaveLocally() {
        if (host && host.timer) clearInterval(host.timer);
        host = null;
        pending = {};
        gs = null;
        seenScored = 0;
        animatedPick = null;
        joiningRoom = null;
        renderedPhase = null;
        renderedRoom = null;
        if (rouletteTimer) { clearTimeout(rouletteTimer); rouletteTimer = null; }
        show($('ov-pick'), false);
        show($('ov-result'), false);
        Net.leaveRoomTopics();
        setView('lobby');
        renderLobby();
    }

    /* ---------------- Sekundentakt ---------------- */

    function tick() {
        if (host) hostPrune();

        // Als Mitspieler merken, wenn der Admin nicht mehr sendet.
        if (gs && !host && gs.phase !== 'over' && Date.now() - lastStateAt > STATE_TIMEOUT) {
            toast('Kein Lebenszeichen vom Rundenadmin – Runde beendet.', 'warn');
            leaveLocally();
        }
    }

    /* ---------------- Hilfsfunktionen auf dem Zustand ---------------- */

    function seatOf(playerId, state) {
        var s = state || gs;
        if (!s) return 0;
        for (var i = 0; i < s.players.length; i++) if (s.players[i].id === playerId) return s.players[i].seat;
        return 0;
    }

    function nameOf(playerId) {
        if (gs) {
            for (var i = 0; i < gs.players.length; i++) if (gs.players[i].id === playerId) return gs.players[i].name;
        }
        for (var k = 0; k < lobby.length; k++) if (lobby[k].id === playerId) return lobby[k].name;
        return 'Spieler';
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(window);
