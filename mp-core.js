/* ============================================================
   Multiplayer-Kern - mp-core.js
   Lobby, Matchmaking, Rundenlogik, Chat und Benachrichtigungen.
   Alles hier ist spielunabhaengig: 3DicDacDoe und Viergewinnt 3D
   benutzen denselben Kern und liefern nur einen Adapter (siehe unten)
   mit ihren Regeln und ihrem Brett.

   Rollenmodell: es gibt keinen Spielserver. Wer eine Runde eroeffnet,
   ist "Rundenadmin" und haelt den massgeblichen Spielzustand. Alle
   anderen schicken nur Absichten (beitreten, ziehen, verlassen) an den
   Admin; der prueft sie und veroeffentlicht den neuen Gesamtzustand.
   Dadurch kann kein Client das Spielfeld manipulieren, und jeder sieht
   garantiert dasselbe Brett.

   Der Adapter muss liefern:
     root, name, icon, symbols, seatNames
     minPlayers, maxPlayers, cells
     looks (optional): {shapes:[...], colors:[{id,value,name}]} - dann duerfen
       Spieler Form und Farbe waehlen; requireReady sperrt zusaetzlich den
       Start, bis alle bereit sind
     emptyBoard()  isFull(board)  freeCount(board)
     describeLine(lineIndex)
     moveForCell(state, cell)   -> tatsaechlich belegtes Feld oder null
     applyMove(board, playerId, cell) -> Array vollendeter Linien oder null
     buildBoard(container, onClick)
     renderBoard(state, ctx)    ctx = {piece, seatOf, myTurn, scoredCells, flashLines}
   ============================================================ */

(function (global) {
    'use strict';

    var G = null;    // Spiel-Adapter, gesetzt in MPGame.start()
    var Net = null;

    var SYMBOLS = [];
    var SEAT_NAMES = ['Sitz 1', 'Sitz 2', 'Sitz 3'];
    // Rueckfallfarben, wenn das Spiel keine freie Auswahl anbietet.
    var SEAT_COLORS = ['#38bdf8', '#fbbf24', '#34d399'];

    var PING_MS = 4000;        // Lebenszeichen innerhalb einer Runde
    /* Die beiden Fristen sind bewusst lang: Browser drosseln die Timer in
       Hintergrund-Tabs bis auf einen Lauf pro Minute. Ein wartender Mitspieler
       sendet dann seltener - er ist aber nicht weg, und Zuege kommen weiterhin
       sofort an, weil eingehende Nachrichten die Seite aufwecken. Zusaetzlich
       setzt tick() die Fristen nach einer erkannten Drosselpause neu. */
    var MEMBER_TTL = 90000;    // danach gilt ein Mitspieler als abgesprungen
    var STATE_BEAT_MS = 5000;  // Admin wiederholt den Zustand
    var STATE_TIMEOUT = 90000; // so lange darf der Admin schweigen
    var TICK_GAP_LIMIT = 5000; // groessere Luecke = der Tab wurde gedrosselt
    var ROULETTE_MS = 2600;    // Dauer der Auslosung
    var ROULETTE_HOLD = 1400;  // Nachlauf, bevor es losgeht
    var MANUAL_HOLD = 2200;
    var CHAT_MAX_LINES = 120;  // aelteres faellt oben raus
    var CHAT_MIN_GAP = 400;    // Bremse gegen versehentliches Dauerfeuer

    /* ---------------- kleine Helfer ---------------- */

    function $(id) { return document.getElementById(id); }

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = text;
        return n;
    }

    function show(node, on) { node.hidden = !on; }

    /* ---------------- Aussehen eines Spielers ----------------
       Form und Farbe gehoeren dem Spieler, nicht dem Sitz. Bietet ein Spiel
       keine Auswahl an, fallen wir auf die festen Sitzwerte zurueck. */

    function pieceOfPlayer(p) {
        if (!p) return { shape: '?', color: '#64748b' };
        return {
            shape: p.shape || SYMBOLS[p.seat] || '?',
            color: p.color || SEAT_COLORS[p.seat] || '#94a3b8'
        };
    }

    function pieceOf(playerId, state) {
        var s = state || gs;
        if (s && s.players) {
            for (var i = 0; i < s.players.length; i++) {
                if (s.players[i].id === playerId) return pieceOfPlayer(s.players[i]);
            }
        }
        return pieceOfPlayer(null);
    }

    /* Faerbt einen Knoten in der Spielerfarbe - das CSS liest ueberall --seat. */
    function tint(node, color) {
        node.style.setProperty('--seat', color);
        return node;
    }

    function toast(text, kind) {
        var box = $('toasts');
        var t = el('div', 'mp-toast' + (kind ? ' ' + kind : ''), text);
        box.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 5000);
    }

    /* ============================================================
       BROWSER-BENACHRICHTIGUNGEN
       Absichtlich nur, wenn der Tab gerade nicht im Vordergrund ist -
       wer zuschaut, sieht den Zugwechsel ohnehin auf dem Brett.
       ============================================================ */

    function notifySupported() { return typeof global.Notification !== 'undefined'; }

    function notifyPermission() { return notifySupported() ? global.Notification.permission : 'unsupported'; }

    function pageInView() { return !document.hidden && document.hasFocus(); }

    function renderBell() {
        var b = $('btn-notify');
        if (!b) return;
        var perm = notifyPermission();
        var on = notifyOn && perm === 'granted';
        var title;

        if (perm === 'unsupported') title = 'Dein Browser unterstuetzt keine Benachrichtigungen.';
        else if (perm === 'denied') title = 'Benachrichtigungen sind für diese Seite im Browser blockiert.';
        else if (on) title = 'Benachrichtigung, wenn du am Zug bist: an';
        else title = 'Benachrichtigung, wenn du am Zug bist: aus';

        b.textContent = on ? '🔔' : '🔕';
        b.title = title;
        b.setAttribute('aria-label', title);
        b.classList.toggle('on', on);
        b.classList.toggle('blocked', perm === 'denied' || perm === 'unsupported');
    }

    function saveNotifyPref() {
        try { localStorage.setItem('mp.notify', notifyOn ? 'on' : 'off'); } catch (e) { /* egal */ }
    }

    /* ask === true nur aus einer echten Nutzeraktion heraus aufrufen,
       sonst lehnen die Browser die Nachfrage ab. */
    function enableNotifications(ask) {
        if (!notifySupported()) { notifyOn = false; renderBell(); return; }

        var perm = global.Notification.permission;
        if (perm === 'granted') { notifyOn = true; saveNotifyPref(); renderBell(); return; }
        if (perm === 'denied') {
            notifyOn = false; saveNotifyPref(); renderBell();
            if (ask) toast('Benachrichtigungen sind im Browser blockiert. Du kannst sie in den Seiteneinstellungen wieder erlauben.', 'warn');
            return;
        }
        if (!ask) { renderBell(); return; }

        var settled = false;
        function done(result) {
            if (settled) return;
            settled = true;
            notifyOn = result === 'granted';
            saveNotifyPref();
            renderBell();
            if (!notifyOn) toast('Ohne Erlaubnis gibt es keine Benachrichtigungen – im Tab-Titel siehst du trotzdem, wenn du dran bist.');
        }

        var ret;
        try { ret = global.Notification.requestPermission(done); } catch (e) { return; }
        if (ret && typeof ret.then === 'function') ret.then(done, function () { done('denied'); });
    }

    function disableNotifications() {
        notifyOn = false;
        saveNotifyPref();
        closeNote();
        renderBell();
    }

    function pushNote(title, body, tag) {
        if (!notifyOn || notifyPermission() !== 'granted') return;
        if (pageInView()) return;
        closeNote();
        try {
            currentNote = new global.Notification(title, {
                body: body,
                tag: tag || 'mp',
                renotify: true,
                icon: G.icon
            });
            currentNote.onclick = function () {
                try { global.focus(); } catch (e) { /* egal */ }
                closeNote();
            };
        } catch (e) { currentNote = null; }
    }

    function closeNote() {
        if (!currentNote) return;
        try { currentNote.close(); } catch (e) { /* egal */ }
        currentNote = null;
    }

    /* Der Tab-Titel ist die zweite, immer verfügbare Meldung -
       die funktioniert auch ohne erteilte Berechtigung. */
    function updateTitle() {
        var t = baseTitle;
        if (gs && gs.phase === 'play' && gs.turn) {
            t = gs.turn === me.id ? 'DU BIST DRAN!' : nameOf(gs.turn) + ' ist am Zug · ' + G.name;
        } else if (gs && gs.phase === 'pick') {
            t = 'Startspieler wird bestimmt · ' + G.name;
        } else if (gs && gs.phase === 'over') {
            t = 'Spiel beendet · ' + G.name;
        }
        if (document.title !== t) document.title = t;
    }

    /* ============================================================
       CHAT
       Zwei getrennte Kanaele: "lobby" laeuft ueber das Lobby-Topic und
       erreicht alle, die die Seite offen haben; "room" laeuft ueber das
       Aktions-Topic der Runde und damit nur die drei Mitspieler.
       Nichts davon wird retained gesendet oder gespeichert - der Verlauf
       lebt ausschliesslich im DOM dieser Seite.
       ============================================================ */

    var lastChatSent = 0;

    function chatClear(kind, hint) {
        var log = $('chat-' + kind + '-log');
        if (!log) return;
        log.textContent = '';
        log.appendChild(el('p', 'chat-empty', hint || 'Noch keine Nachrichten.'));
    }

    function chatAppend(kind, name, text, color, self) {
        var log = $('chat-' + kind + '-log');
        if (!log) return;

        var hint = log.querySelector('.chat-empty');
        if (hint) log.removeChild(hint);

        // Nur mitscrollen, wenn man ohnehin unten steht - sonst reisst es
        // einem beim Zurueckblaettern die Ansicht weg.
        var atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;

        var line = el('div', 'chat-line' + (self ? ' me' : ''));
        if (color) tint(line, color);
        line.appendChild(el('span', 'chat-name', name));
        line.appendChild(document.createTextNode(' '));
        line.appendChild(el('span', 'chat-text', text));
        log.appendChild(line);

        while (log.children.length > CHAT_MAX_LINES) log.removeChild(log.firstChild);
        if (atBottom) log.scrollTop = log.scrollHeight;
    }

    function setupChat(kind) {
        var form = $('chat-' + kind + '-form');
        var input = $('chat-' + kind + '-input');
        if (!form || !input) return;

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var text = Net.cleanText(input.value);
            if (!text) { input.value = ''; return; }

            var now = Date.now();
            if (now - lastChatSent < CHAT_MIN_GAP) return;

            var sent;
            if (kind === 'lobby') sent = Net.publishLobby({ t: 'chat', text: text });
            else sent = gs ? Net.publishAct(gs.room, { t: 'chat', text: text }) : false;

            if (!sent) {
                toast('Nachricht nicht verschickt – keine Verbindung.', 'warn');
                return;
            }
            lastChatSent = now;
            input.value = '';
            // Angezeigt wird die Nachricht erst, wenn sie vom Broker
            // zurueckkommt - so sehen alle dieselbe Reihenfolge.
        });
    }

    function onLobbyChat(m) {
        chatAppend('lobby', m.name, m.text, null, m.from === me.id);
    }

    /* ---------------- lokaler Zustand ---------------- */

    var me = { id: null, name: '' };
    var lobby = [];       // Spieler in der Lobby (aus Net)
    var gs = null;        // zuletzt empfangener Rundenzustand
    var host = null;      // nur beim Rundenadmin gefuellt, siehe unten
    var pending = {};     // nur beim Admin: offene Einladungen  id -> name
    var view = 'gate';
    var lastStateAt = 0;
    var lastTickAt = 0;
    var seenScored = 0;   // wie viele Punktereihen wurden schon animiert
    var animatedPick = null;
    var rouletteTimer = null;

    var joiningRoom = null;  // Beitritt losgeschickt, Zustand noch nicht da
    var myLook = { shape: null, color: null };  // gemerkter Wunsch fuer die naechste Runde
    var renderedPhase = null;
    var renderedRoom = null;
    var renderedTurn = null;
    var notifyOn = false;    // Benachrichtigungen vom Nutzer gewuenscht
    var currentNote = null;  // gerade offene Browser-Benachrichtigung
    var baseTitle = document.title;

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
        var savedBroker = localStorage.getItem('mp.broker') || Net.BROKERS[0].id;
        sel.value = savedBroker;
        sel.addEventListener('change', function () {
            localStorage.setItem('mp.broker', sel.value);
            if (Net.me) {
                quitRound(true);
                Net.switchBroker(sel.value);
                toast('Server gewechselt: ' + sel.options[sel.selectedIndex].text);
            }
        });

        var savedName = localStorage.getItem('mp.name') || '';
        $('gate-name').value = savedName;

        // Benachrichtigungen: gemerkte Einstellung laden, aber die Berechtigung
        // erst beim Betreten der Lobby erfragen (dort gibt es eine Nutzeraktion).
        notifyOn = localStorage.getItem('mp.notify') !== 'off';
        $('gate-notify').checked = notifyOn && notifyPermission() !== 'denied';
        if (notifyOn && notifyPermission() === 'granted') enableNotifications(false);
        else if (notifyPermission() === 'denied') notifyOn = false;
        renderBell();

        $('btn-notify').addEventListener('click', function () {
            if (notifyOn && notifyPermission() === 'granted') disableNotifications();
            else enableNotifications(true);
        });

        // Wer wieder auf den Tab schaut, braucht die Meldung nicht mehr - und
        // die im Hintergrund gedrosselten Timer muessen wieder aufschliessen.
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) return;
            closeNote();
            grantGracePeriod(Date.now());
            Net.resync();
            if (gs) {
                if (host) Net.publishState(gs.room, gs);
                else Net.publishAct(gs.room, { t: 'ping' });
            }
        });
        global.addEventListener('focus', closeNote);

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
            localStorage.setItem('mp.name', name);

            // Der Klick auf "Lobby betreten" ist die Nutzeraktion, aus der
            // heraus der Browser die Berechtigungsabfrage zulaesst.
            if ($('gate-notify').checked) enableNotifications(true);
            else disableNotifications();

            enterLobby();
        });

        // Spielfigur-Auswahl gibt es nur, wenn das Spiel eine anbietet.
        if (G.looks) loadLook();
        if ($('btn-ready')) $('btn-ready').addEventListener('click', toggleReady);

        $('btn-start').addEventListener('click', hostStartPick);
        $('btn-dissolve').addEventListener('click', function () { quitRound(false); });
        $('btn-quit').addEventListener('click', function () { quitRound(false); });
        $('btn-random').addEventListener('click', function () { hostChooseStarter(null); });
        $('btn-back-lobby').addEventListener('click', function () {
            show($('ov-result'), false);
            quitRound(false);
        });

        buildBoard();

        setupChat('lobby');
        setupChat('room');
        chatClear('lobby', 'Noch keine Nachrichten. Schreib etwas – alle in der Lobby lesen mit.');
        chatClear('room', 'Noch keine Nachrichten in dieser Runde.');

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
            root: G.root,
            handlers: {
                onStatus: onStatus,
                onPlayers: onPlayers,
                onInvite: onInvite,
                onInviteResult: onInviteResult,
                onLobbyChat: onLobbyChat,
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
                    (!gs || (host && gs.phase === 'lobby' && gs.players.length < G.maxPlayers));
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
        for (var i = 0; i < G.maxPlayers; i++) {
            var p = players[i];
            // Leere Plaetze bleiben neutral - welche Figur dort sitzt, waehlt
            // der Spieler ja erst selbst.
            var piece = p ? pieceOfPlayer(p)
                          : (G.looks ? { shape: '·', color: '#475569' }
                                     : { shape: SYMBOLS[i] || '·', color: SEAT_COLORS[i] });
            var s = tint(el('div', 'slot' + (p ? ' filled' : '')), piece.color);
            s.appendChild(el('span', 'seat-dot'));
            s.appendChild(el('span', 'font-black', piece.shape));
            s.appendChild(el('span', 'text-sm truncate',
                p ? p.name : (i >= G.minPlayers ? 'frei (optional)' : 'frei')));
            if (p && gs && p.id === gs.host) s.appendChild(el('span', 'text-[10px] text-amber-400 font-bold', 'ADMIN'));
            if (p && G.requireReady) {
                s.appendChild(el('span', 'ready-badge' + (p.ready ? ' on' : ''),
                    p.ready ? '✓ bereit' : 'wartet'));
            }
            slots.appendChild(s);
        }

        var pen = $('room-pending');
        pen.textContent = '';
        for (var id in pending) {
            pen.appendChild(el('div', 'text-[11px] text-slate-500', 'Einladung an ' + pending[id] + ' verschickt …'));
        }

        var isHost = !!(gs && gs.host === me.id);
        var count = inRound ? gs.players.length : 0;
        var enough = inRound && count >= G.minPlayers;
        var allReady = inRound && everyoneReady();

        $('btn-start').disabled = !(isHost && enough && allReady && gs.phase === 'lobby');
        if (!inRound) $('btn-start').textContent = 'Spiel starten';
        else if (!enough) $('btn-start').textContent = 'Warte auf ' + (G.minPlayers - count) + ' Spieler';
        else if (!allReady) $('btn-start').textContent = 'Warte auf ' + waitingCount() + ' Bereitmeldung' + (waitingCount() === 1 ? '' : 'en');
        else $('btn-start').textContent = 'Mit ' + count + ' Spielern starten';

        var role = '';
        if (inRound) {
            role = isHost ? 'Du bist Rundenadmin und bestimmst den Startspieler.'
                          : 'Rundenadmin ist ' + nameOf(gs.host) + '.';
            // Wenn auch weniger als die volle Besetzung reicht, sagen wir das.
            if (isHost && enough && allReady && count < G.maxPlayers) {
                role = 'Du kannst jetzt starten – oder noch jemanden einladen.';
            }
        }
        $('room-role').textContent = role;

        renderLookPicker();
    }

    function everyoneReady() {
        if (!G.requireReady) return true;
        if (!gs) return false;
        for (var i = 0; i < gs.players.length; i++) if (!gs.players[i].ready) return false;
        return true;
    }

    function waitingCount() {
        if (!gs) return 0;
        var n = 0;
        for (var i = 0; i < gs.players.length; i++) if (!gs.players[i].ready) n++;
        return n;
    }

    /* ============================================================
       SPIELFIGUR WAEHLEN
       Form und Farbe sind innerhalb einer Runde eindeutig - sonst waeren
       zwei Spieler auf dem Brett nicht auseinanderzuhalten. Vergeben wird
       ausschliesslich vom Rundenadmin; die Clients zeigen belegte Optionen
       nur schon vorab als gesperrt an.
       ============================================================ */

    function colorValues() {
        return G.looks.colors.map(function (c) { return c.value; });
    }

    function colorName(value) {
        for (var i = 0; i < G.looks.colors.length; i++) {
            if (G.looks.colors[i].value === value) return G.looks.colors[i].name;
        }
        return 'Farbe';
    }

    function myPlayer() {
        if (!gs) return null;
        for (var i = 0; i < gs.players.length; i++) if (gs.players[i].id === me.id) return gs.players[i];
        return null;
    }

    function loadLook() {
        try {
            myLook.shape = localStorage.getItem('mp.shape') || null;
            myLook.color = localStorage.getItem('mp.color') || null;
        } catch (e) { /* egal */ }
    }

    function saveLook() {
        try {
            if (myLook.shape) localStorage.setItem('mp.shape', myLook.shape);
            if (myLook.color) localStorage.setItem('mp.color', myLook.color);
        } catch (e) { /* egal */ }
    }

    function renderLookPicker() {
        var box = $('look-picker');
        if (!box || !G.looks) return;

        var mine = myPlayer();
        show(box, !!mine && gs.phase === 'lobby');
        if (!mine || gs.phase !== 'lobby') return;

        var locked = !!mine.ready;
        var piece = pieceOfPlayer(mine);

        // Gemerkt wird, was der Admin bestaetigt hat - nicht der blosse Wunsch.
        myLook.shape = mine.shape || null;
        myLook.color = mine.color || null;
        saveLook();

        var takenShape = {}, takenColor = {};
        gs.players.forEach(function (p) {
            if (p.id === me.id) return;
            if (p.shape) takenShape[p.shape] = p.name;
            if (p.color) takenColor[p.color] = p.name;
        });

        var glyph = $('look-glyph');
        glyph.textContent = piece.shape;
        tint(glyph, piece.color);
        tint($('look-picker'), piece.color);

        $('look-hint').textContent = locked
            ? 'Du bist bereit. Zum Ändern erst wieder abmelden.'
            : 'Form und Farbe sind pro Runde eindeutig.';

        var sBox = $('look-shapes');
        sBox.textContent = '';
        G.looks.shapes.forEach(function (sh) {
            var owner = takenShape[sh];
            var b = el('button', 'look-opt' + (sh === piece.shape ? ' on' : ''), sh);
            b.type = 'button';
            b.disabled = locked || !!owner;
            b.title = owner ? 'schon von ' + owner + ' belegt' : 'Form ' + sh;
            b.addEventListener('click', function () { chooseLook(sh, null); });
            sBox.appendChild(b);
        });

        var cBox = $('look-colors');
        cBox.textContent = '';
        G.looks.colors.forEach(function (col) {
            var owner = takenColor[col.value];
            var b = el('button', 'look-opt swatch'
                + (col.value === piece.color ? ' on' : '')
                + (owner ? ' taken' : ''));
            b.type = 'button';
            b.style.setProperty('--swatch', col.value);
            b.disabled = locked || !!owner;
            b.title = owner ? col.name + ' – schon von ' + owner + ' belegt' : col.name;
            b.setAttribute('aria-label', col.name);
            b.addEventListener('click', function () { chooseLook(null, col.value); });
            cBox.appendChild(b);
        });

        var rb = $('btn-ready');
        rb.className = 'btn w-full' + (locked ? '' : ' primary');
        rb.textContent = locked ? '✓ Bereit – doch noch ändern' : 'Bereit';
    }

    /* Es wird immer nur die tatsaechlich geaenderte Eigenschaft geschickt.
       Wuerden wir beides senden, koennte ein noch nicht eingetroffener
       Zustand die eigene, gerade erst bestaetigte Wahl wieder ueberschreiben. */
    function chooseLook(shape, color) {
        var mine = myPlayer();
        if (!mine || mine.ready) return;
        sendSetup(shape || null, color || null, mine.ready);
    }

    function toggleReady() {
        var mine = myPlayer();
        if (!mine) return;
        sendSetup(null, null, !mine.ready);
    }

    function sendSetup(shape, color, ready) {
        if (!gs) return;
        if (host) hostSetup(me.id, { shape: shape, color: color, ready: ready });
        else Net.publishAct(gs.room, { t: 'setup', shape: shape, color: color, ready: !!ready });
    }

    /* Wunsch erfuellen, wenn er zulaessig und frei ist - sonst das erste
       freie Element der Liste. */
    function freeLook(list, taken, wish) {
        if (wish && list.indexOf(wish) >= 0 && !taken[wish]) return wish;
        for (var i = 0; i < list.length; i++) if (!taken[list[i]]) return list[i];
        return list[0];
    }

    function takenLooks(exceptId) {
        var s = {}, c = {};
        gs.players.forEach(function (p) {
            if (p.id === exceptId) return;
            if (p.shape) s[p.shape] = true;
            if (p.color) c[p.color] = true;
        });
        return { shape: s, color: c };
    }

    /* ---------------- Matchmaking ---------------- */

    function invite(p) {
        if (!gs) hostCreateRoom();
        if (!host || gs.players.length >= G.maxPlayers) return;
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

        var card = el('div', 'mp-card pointer-events-auto flex items-center gap-3 max-w-md');
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
            Net.publishAct(inv.roomId, { t: 'join', shape: myLook.shape, color: myLook.color });
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

        // Eine Einladung im Hintergrund-Tab wuerde man sonst verpassen.
        pushNote('Einladung zu einer Runde', inv.name + ' lädt dich zu ' + G.name + ' ein.', 'mp-invite');

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
            players: [{ id: me.id, name: me.name, seat: 0, ready: false }],
            turn: null, board: G.emptyBoard(), scores: {}, scored: [],
            last: null, pick: null, reason: null
        };
        gs.scores[me.id] = 0;
        hostAssignLook(gs.players[0], myLook.shape, myLook.color);

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
        // Chat lesen alle drei Mitspieler, nicht nur der Admin - deshalb vor
        // der Rollenpruefung.
        if (msg.t === 'chat') {
            if (!gs || roomId !== gs.room || memberIndex(senderId) < 0) return;
            var text = Net.cleanText(msg.text);
            if (!text) return;
            if (host) host.seen[senderId] = Date.now();
            chatAppend('room', gs.players[memberIndex(senderId)].name, text,
                       pieceOf(senderId, gs).color, senderId === me.id);
            return;
        }

        if (!host || !gs || roomId !== gs.room) return;
        host.seen[senderId] = Date.now();

        if (msg.t === 'join') {
            if (memberIndex(senderId) >= 0) { Net.publishState(gs.room, gs); return; }
            if (gs.phase !== 'lobby' || gs.players.length >= G.maxPlayers) {
                Net.publishAct(gs.room, { t: 'full', to: senderId });
                return;
            }
            delete pending[senderId];
            var name = Net.cleanName(msg.name) || 'Spieler';
            var joiner = { id: senderId, name: name, seat: gs.players.length, ready: false };
            gs.players.push(joiner);
            // Wunsch des Beitretenden beruecksichtigen, wenn er noch frei ist.
            hostAssignLook(joiner, msg.shape, msg.color);
            gs.scores[senderId] = 0;
            toast(name + ' ist der Runde beigetreten.');
            hostPublish({});
            return;
        }

        if (msg.t === 'setup') {
            hostSetup(senderId, msg);
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

    /* Vergibt Form und Farbe. Der Admin ist die einzige Stelle, die das tut -
       damit kann sich kein Client die Farbe eines anderen greifen. */
    function hostAssignLook(player, wishShape, wishColor) {
        if (!G.looks) return;
        var taken = takenLooks(player.id);
        player.shape = freeLook(G.looks.shapes, taken.shape, wishShape);
        player.color = freeLook(colorValues(), taken.color, wishColor);
    }

    function hostSetup(playerId, wish) {
        if (!host || !gs || gs.phase !== 'lobby') return;
        var i = memberIndex(playerId);
        if (i < 0) return;

        var p = gs.players[i];
        var changed = false;

        if (G.looks) {
            var taken = takenLooks(playerId);
            // Nur uebernehmen, was zulaessig und frei ist - sonst bleibt es,
            // wie es war. freeLook faellt sonst auf ein anderes Element zurueck,
            // was hier nicht gewollt ist.
            if (typeof wish.shape === 'string'
                && G.looks.shapes.indexOf(wish.shape) >= 0
                && !taken.shape[wish.shape]
                && wish.shape !== p.shape) { p.shape = wish.shape; changed = true; }

            if (typeof wish.color === 'string'
                && colorValues().indexOf(wish.color) >= 0
                && !taken.color[wish.color]
                && wish.color !== p.color) { p.color = wish.color; changed = true; }
        }

        var ready = !!wish.ready;
        if (ready !== !!p.ready) { p.ready = ready; changed = true; }

        if (changed) hostPublish({});
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
        if (!host || !gs || gs.phase !== 'lobby' || gs.players.length < G.minPlayers) return;
        if (!everyoneReady()) return;
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
        if (typeof cell !== 'number' || cell < 0 || cell >= G.cells) return;

        var board = gs.board.slice();
        // Der Admin prueft den Zug selbst nach - auch bei Schwerkraft muss
        // das gemeldete Feld genau das sein, auf dem der Stein landen wuerde.
        if (G.moveForCell({ board: board }, cell) !== cell) return;
        var gained = G.applyMove(board, playerId, cell);
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
        if (st.board.length !== G.cells) return;
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
        var prevTurn = renderedTurn;
        gs = st;
        lastStateAt = Date.now();
        renderedPhase = st.phase;
        renderedRoom = st.room;
        renderedTurn = st.turn || null;

        // Genau beim Wechsel melden, nicht bei jedem Zustands-Update. Der
        // Startspieler steht schon in der Auslosungs-Phase fest, deshalb zaehlt
        // auch der Uebergang von "pick" nach "play" als Wechsel.
        var myTurnNow = st.phase === 'play' && st.turn === me.id;
        var myTurnBefore = prevPhase === 'play' && prevTurn === me.id;
        if (myTurnNow && !myTurnBefore) {
            pushNote('Du bist dran!', G.name + ' · Runde ' + st.room, 'mp-turn');
        } else if (!myTurnNow) {
            closeNote();
        }
        updateTitle();

        if (st.phase === 'closed') {
            if (!$('ov-result').hidden) return;   // Ergebnis darf stehen bleiben
            leaveLocally();
            toast('Die Runde wurde beendet.', 'warn');
            return;
        }

        if (st.room !== prevRoom) {
            seenScored = 0;
            animatedPick = null;
            chatClear('room', 'Noch keine Nachrichten in dieser Runde.');
        }

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
        $('cells-left').textContent = G.freeCount(st.board) + ' Felder frei';

        if (st.phase === 'over' && prevPhase !== 'over') renderResult();
    }

    /* ---------------- Spielfeld ----------------
       Das Brett selbst gehoert dem Adapter - nur hier weiss die Anwendung,
       wie viele Ebenen es gibt und ob Steine fallen. */

    function buildBoard() {
        var hostEl = $('board-host');
        hostEl.textContent = '';
        G.buildBoard(hostEl, onCellClick);
    }

    /* Der Klick nennt ein Feld; welches Feld dadurch tatsaechlich belegt
       wird, entscheidet das Spiel (bei Viergewinnt faellt der Stein). */
    function onCellClick(cell) {
        if (!gs || gs.phase !== 'play' || gs.turn !== me.id) return;
        var target = G.moveForCell(gs, cell);
        if (target === null) return;

        if (host) hostApplyMove(me.id, target);
        else Net.publishAct(gs.room, { t: 'move', cell: target });
    }

    function renderBoard() {
        var scoredCells = {};
        gs.scored.forEach(function (s) {
            var line = G.lineCells(s.line);
            if (!line) return;
            for (var i = 0; i < line.length; i++) scoredCells[line[i]] = true;
        });

        // Neu geschlossene Reihen einmal aufblitzen lassen.
        var flashLines = [];
        if (gs.scored.length > seenScored) {
            for (var k = seenScored; k < gs.scored.length; k++) flashLines.push(gs.scored[k].line);
        }

        G.renderBoard(gs, {
            seatOf: function (id) { return seatOf(id, gs); },
            myTurn: gs.phase === 'play' && gs.turn === me.id,
            scoredCells: scoredCells,
            flashLines: flashLines,
            piece: function (id) { return pieceOf(id, gs); }
        });

        if (flashLines.length) {
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
            var pc = pieceOfPlayer(p);
            var row = tint(el('div', 'mp-player' + (gs.turn === p.id ? ' active' : '')), pc.color);
            row.setAttribute('data-player', p.id);
            row.appendChild(el('span', 'sym', pc.shape));

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
            var line = tint(el('div', 'log-line'), pieceOf(s.by, gs).color);
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
                    var pc = pieceOfPlayer(p);
                    var b = tint(el('button', 'btn w-full', pc.shape + '  ' + p.name), pc.color);
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
            nameEl.className = 'roulette-name';
            tint(nameEl, pieceOf(id, gs).color);
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
        nameEl.className = 'roulette-name settled';
        tint(nameEl, pieceOf(picked, gs).color);
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

        var rank = ranking(gs.players, gs.scores);

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
            $('result-title').className = 'roulette-name settled';
            tint($('result-title'), pieceOf(w.id, gs).color);
            $('result-title').textContent = (w.id === me.id ? 'Du gewinnst!' : w.name + ' gewinnt!');
        }

        var tbl = $('result-table');
        tbl.textContent = '';
        rank.list.forEach(function (p, i) {
            var pc = pieceOf(p.id, gs);
            var row = tint(el('div', 'mp-player'), pc.color);
            row.appendChild(el('span', 'text-slate-500 text-xs font-bold w-4', String(i + 1)));
            row.appendChild(el('span', 'sym', pc.shape));
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
        renderedTurn = null;
        closeNote();
        updateTitle();
        chatClear('room', 'Noch keine Nachrichten in dieser Runde.');
        if (rouletteTimer) { clearTimeout(rouletteTimer); rouletteTimer = null; }
        show($('ov-pick'), false);
        show($('ov-result'), false);
        Net.leaveRoomTopics();
        setView('lobby');
        renderLobby();
    }

    /* ---------------- Sekundentakt ---------------- */

    function tick() {
        var now = Date.now();
        var gap = lastTickAt ? now - lastTickAt : 0;
        lastTickAt = now;

        // War der Tab im Hintergrund, hat der Browser unsere Timer angehalten.
        // Diese Pause darf niemandem als Verbindungsabbruch angelastet werden:
        // Fristen neu starten und diesen Durchlauf ueberspringen.
        if (gap > TICK_GAP_LIMIT) {
            grantGracePeriod(now);
            return;
        }

        if (host) hostPrune();

        // Als Mitspieler merken, wenn der Admin nicht mehr sendet.
        if (gs && !host && gs.phase !== 'over' && now - lastStateAt > STATE_TIMEOUT) {
            toast('Kein Lebenszeichen vom Rundenadmin – Runde beendet.', 'warn');
            leaveLocally();
        }
    }

    /* Alle Fristen so behandeln, als waeren gerade eben Lebenszeichen
       eingetroffen - nach einer Drosselpause oder beim Zurueckkehren auf den Tab. */
    function grantGracePeriod(now) {
        lastStateAt = now;
        lastTickAt = now;
        if (host) {
            for (var id in host.seen) host.seen[id] = now;
        }
    }

    /* ---------------- Hilfsfunktionen auf dem Zustand ---------------- */

    /* Rangliste: absteigend nach Punkten. Gleichstand an der Spitze
       bedeutet Unentschieden - gilt fuer beide Spiele gleich. */
    function ranking(players, scores) {
        var list = players.map(function (p) {
            return { id: p.id, name: p.name, seat: p.seat, score: scores[p.id] || 0 };
        });
        list.sort(function (a, b) { return b.score - a.score; });

        var top = list.length ? list[0].score : 0;
        var winners = list.filter(function (p) { return p.score === top; });
        return { list: list, winners: winners, draw: winners.length > 1 };
    }

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

    /* ---------------- Einstieg ---------------- */

    global.MPGame = {
        start: function (adapter) {
            G = adapter;
            Net = global.MPNet;
            SYMBOLS = adapter.symbols;
            if (adapter.seatNames) SEAT_NAMES = adapter.seatNames;

            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
            else init();
        }
    };
})(window);
