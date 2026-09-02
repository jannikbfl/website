/* ============================================================
   Multiplayer-Transport - mp-net.js
   Transport-Schicht. Die Seite ist statisch gehostet, es gibt also
   keinen eigenen Server. Stattdessen laeuft die Kommunikation ueber
   einen oeffentlichen MQTT-Broker per WebSocket.

   Topics (alles unter einem eigenen Praefix, damit wir uns weder mit
   anderen Nutzern des oeffentlichen Brokers noch mit dem jeweils anderen
   Spiel ins Gehege kommen). <root> gibt das Spiel beim Start mit, z. B.
   "biefel-de/ttt3d/v1" oder "biefel-de/vg3d/v1":

     <root>/lobby            Praesenz, Einladungen, Lobby-Chat
     <root>/room/<id>/state  Rundenzustand (retained, nur Admin sendet)
     <root>/room/<id>/act    Aktionen der Spieler an den Admin

   Praesenz ohne Server: jeder Client sendet alle PRESENCE_MS einen
   Heartbeat. Wer sich laenger als PRESENCE_TTL nicht meldet, fliegt
   lokal aus der Liste. Beim harten Verbindungsabbruch sorgt zusaetzlich
   das MQTT-Testament (Last Will) fuer eine Abmeldung.
   ============================================================ */

(function (global) {
    'use strict';

    /* Der Topic-Praefix kommt vom Spiel (start({root:...})), damit sich
       mehrere Spiele denselben Transport teilen, ohne sich zu mischen. */


    var PRESENCE_MS = 4000;   // Heartbeat-Intervall
    /* Grosszuegig, weil Browser die Timer in Hintergrund-Tabs auf einen Lauf
       pro Minute drosseln - ein wartender Spieler darf deswegen nicht aus der
       Liste fliegen. Wer die Seite wirklich schliesst, meldet sich ohnehin
       sofort per Testament (Last Will) ab. */
    var PRESENCE_TTL = 70000;
    var CONNECT_TIMEOUT = 9000;
    /* Aus demselben Grund lang: mqtt.js sendet den Keepalive per Timer. Bei
       25 s wuerde ein gedrosselter Tab vom Broker rausgeworfen. */
    var KEEPALIVE = 90;

    var BROKERS = [
        { id: 'emqx', label: 'EMQX', url: 'wss://broker.emqx.io:8084/mqtt' },
        { id: 'hivemq', label: 'HiveMQ', url: 'wss://broker.hivemq.com:8884/mqtt' },
        { id: 'mosquitto', label: 'Mosquitto', url: 'wss://test.mosquitto.org:8081/mqtt' }
    ];

    function brokerById(id) {
        for (var i = 0; i < BROKERS.length; i++) if (BROKERS[i].id === id) return BROKERS[i];
        return BROKERS[0];
    }

    function randId(n) {
        var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        var s = '';
        var buf = new Uint32Array(n);
        (global.crypto || global.msCrypto).getRandomValues(buf);
        for (var i = 0; i < n; i++) s += abc[buf[i] % abc.length];
        return s;
    }

    /* Namen kommen von fremden Rechnern ueber einen oeffentlichen Broker.
       Deshalb hier hart begrenzen und Steuerzeichen entfernen. Ausgegeben
       wird spaeter ausschliesslich per textContent. */
    function cleanName(v) {
        if (typeof v !== 'string') return '';
        return v.split('').filter(function (ch) { var k = ch.charCodeAt(0); return k >= 32 && !(k >= 127 && k < 160); }).join('').trim().slice(0, 16);
    }

    /* Chat-Text kommt ebenfalls von fremden Rechnern: Steuerzeichen raus
       (damit keine Zeilenumbrueche das Log zerreissen) und hart begrenzen.
       Ausgegeben wird ausschliesslich per textContent. */
    function cleanText(v) {
        if (typeof v !== 'string') return '';
        var out = '';
        for (var i = 0; i < v.length && out.length < 260; i++) {
            var code = v.charCodeAt(i);
            if (code < 32 || (code >= 127 && code < 160)) continue;
            out += v.charAt(i);
        }
        return out.trim().slice(0, 200);
    }

    function cleanId(v) {
        return (typeof v === 'string' && /^[A-Z0-9]{4,12}$/.test(v)) ? v : null;
    }

    var Net = {
        BROKERS: BROKERS,
        cleanName: cleanName,
        cleanText: cleanText,
        randId: randId,

        client: null,
        broker: BROKERS[0],
        me: null,              // {id, name}
        roomId: null,          // aktuell abonnierte Runde
        status: 'offline',     // offline | connecting | online | error

        _players: {},          // id -> {id, name, roomId, ts}
        _timers: {},
        _h: {},                // Handler

        /* ---------- Verbindung ---------- */

        root: null,
        topicLobby: null,

        start: function (opts) {
            this.me = { id: opts.id, name: opts.name };
            this._h = opts.handlers || {};
            this.root = opts.root;
            this.topicLobby = opts.root + '/lobby';
            this.broker = brokerById(opts.brokerId);
            this._openBroker(this.broker);
        },

        setName: function (name) {
            this.me.name = name;
            this._sendPresence();
        },

        _openBroker: function (broker) {
            var self = this;
            this._teardownClient();

            this.broker = broker;
            this._setStatus('connecting');

            var will = {
                topic: this.topicLobby,
                payload: JSON.stringify({ v: 1, t: 'bye', id: this.me.id, name: this.me.name }),
                qos: 0,
                retain: false
            };

            var client;
            try {
                client = global.mqtt.connect(broker.url, {
                    clientId: 'ttt3d_' + this.me.id + '_' + randId(4),
                    clean: true,
                    keepalive: KEEPALIVE,
                    reconnectPeriod: 3000,
                    connectTimeout: CONNECT_TIMEOUT,
                    will: will
                });
            } catch (e) {
                this._setStatus('error', 'Verbindung nicht moeglich');
                return;
            }
            this.client = client;

            client.on('connect', function () {
                client.subscribe(self.topicLobby, { qos: 0 });
                if (self.roomId) self._subscribeRoomTopics(self.roomId);
                self._setStatus('online');
                self.publishLobby({ t: 'hello' });
                self._sendPresence();
                self._startPresenceLoop();
            });

            client.on('reconnect', function () { self._setStatus('connecting'); });
            client.on('close', function () { if (self.status === 'online') self._setStatus('connecting'); });
            client.on('error', function () { self._setStatus('error', 'Broker nicht erreichbar'); });

            client.on('message', function (topic, payload) {
                var msg;
                try { msg = JSON.parse(payload.toString()); } catch (e) { return; }
                if (!msg || typeof msg !== 'object') return;
                self._route(topic, msg);
            });
        },

        switchBroker: function (brokerId) {
            var b = brokerById(brokerId);
            if (b.id === this.broker.id) return;
            this.publishLobby({ t: 'bye' });
            this._players = {};
            this._emitPlayers();
            this._openBroker(b);
        },

        stop: function () {
            if (this.client && this.client.connected) this.publishLobby({ t: 'bye' });
            this._teardownClient();
            this._setStatus('offline');
        },

        _teardownClient: function () {
            if (this._timers.presence) { clearInterval(this._timers.presence); this._timers.presence = null; }
            if (this._timers.prune) { clearInterval(this._timers.prune); this._timers.prune = null; }
            if (this.client) {
                try { this.client.end(true); } catch (e) { /* egal */ }
                this.client = null;
            }
        },

        _setStatus: function (s, detail) {
            this.status = s;
            if (this._h.onStatus) this._h.onStatus(s, detail, this.broker);
        },

        /* ---------- Senden ---------- */

        _pub: function (topic, msg, retain) {
            if (!this.client || !this.client.connected) return false;
            try {
                this.client.publish(topic, JSON.stringify(msg), { qos: 0, retain: !!retain });
                return true;
            } catch (e) { return false; }
        },

        publishLobby: function (msg) {
            msg.v = 1;
            msg.id = this.me.id;
            msg.name = this.me.name;
            return this._pub(this.topicLobby, msg, false);
        },

        publishAct: function (roomId, msg) {
            msg.v = 1;
            msg.id = this.me.id;
            msg.name = this.me.name;
            return this._pub(this.root + '/room/' + roomId + '/act', msg, false);
        },

        /* Zustand liegt retained auf dem Broker: wer spaeter dazukommt oder
           kurz die Verbindung verliert, bekommt sofort den aktuellen Stand. */
        publishState: function (roomId, state) {
            return this._pub(this.root + '/room/' + roomId + '/state', state, true);
        },

        clearState: function (roomId) {
            if (!this.client || !this.client.connected) return;
            try {
                this.client.publish(this.root + '/room/' + roomId + '/state', '', { qos: 0, retain: true });
            } catch (e) { /* egal */ }
        },

        /* ---------- Runden-Topics ---------- */

        enterRoom: function (roomId) {
            if (this.roomId === roomId) return;
            this.leaveRoomTopics();
            this.roomId = roomId;
            this._subscribeRoomTopics(roomId);
            this._sendPresence();
        },

        leaveRoomTopics: function () {
            if (!this.roomId) return;
            if (this.client && this.client.connected) {
                try {
                    this.client.unsubscribe(this.root + '/room/' + this.roomId + '/state');
                    this.client.unsubscribe(this.root + '/room/' + this.roomId + '/act');
                } catch (e) { /* egal */ }
            }
            this.roomId = null;
            this._sendPresence();
        },

        _subscribeRoomTopics: function (roomId) {
            if (!this.client || !this.client.connected) return;
            this.client.subscribe(this.root + '/room/' + roomId + '/state', { qos: 0 });
            this.client.subscribe(this.root + '/room/' + roomId + '/act', { qos: 0 });
        },

        /* ---------- Praesenz ---------- */

        _startPresenceLoop: function () {
            var self = this;
            if (this._timers.presence) clearInterval(this._timers.presence);
            if (this._timers.prune) clearInterval(this._timers.prune);
            this._timers.presence = setInterval(function () { self._sendPresence(); }, PRESENCE_MS);
            this._timers.prune = setInterval(function () { self._prune(); }, 2000);
        },

        _sendPresence: function () {
            if (!this.me) return;
            this.publishLobby({ t: 'presence', roomId: this.roomId });
        },

        /* Nach einer Timer-Drosselung (Tab war im Hintergrund) wieder
           aufschliessen: alle anderen antworten auf ein "hello" sofort. */
        resync: function () {
            if (!this.client || !this.client.connected) return;
            this.publishLobby({ t: 'hello' });
            this._sendPresence();
        },

        _prune: function () {
            var now = Date.now(), changed = false;
            for (var id in this._players) {
                if (id === this.me.id) continue;
                if (now - this._players[id].ts > PRESENCE_TTL) { delete this._players[id]; changed = true; }
            }
            if (changed) this._emitPlayers();
        },

        _emitPlayers: function () {
            if (this._h.onPlayers) this._h.onPlayers(this.playerList());
        },

        playerList: function () {
            var out = [];
            for (var id in this._players) out.push(this._players[id]);
            out.sort(function (a, b) {
                return a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id);
            });
            return out;
        },

        /* ---------- Empfangen ---------- */

        _route: function (topic, msg) {
            if (msg.v !== 1) return;
            var senderId = cleanId(msg.id);
            if (!senderId) return;

            if (topic === this.topicLobby) return this._onLobby(senderId, msg);

            var m = topic.match(/\/room\/([A-Z0-9]{4,12})\/(state|act)$/);
            if (!m) return;
            var roomId = m[1];
            if (roomId !== this.roomId) return;

            if (m[2] === 'state' && this._h.onState) this._h.onState(roomId, msg);
            if (m[2] === 'act' && this._h.onAct) this._h.onAct(roomId, senderId, msg);
        },

        _onLobby: function (senderId, msg) {
            var name = cleanName(msg.name);
            if (!name) return;

            if (msg.t === 'bye') {
                if (this._players[senderId]) { delete this._players[senderId]; this._emitPlayers(); }
                if (this._h.onBye) this._h.onBye(senderId);
                return;
            }

            if (msg.t === 'hello' || msg.t === 'presence') {
                var prev = this._players[senderId];
                var room = cleanId(msg.roomId);
                this._players[senderId] = { id: senderId, name: name, roomId: room, ts: Date.now() };
                if (!prev || prev.name !== name || prev.roomId !== room) this._emitPlayers();
                // Neuankoemmling sofort ueber uns informieren, statt ihn auf den
                // naechsten Heartbeat warten zu lassen.
                if (msg.t === 'hello' && senderId !== this.me.id) this._sendPresence();
                return;
            }

            if (msg.t === 'invite' && msg.to === this.me.id) {
                var room2 = cleanId(msg.roomId);
                if (room2 && this._h.onInvite) this._h.onInvite({ from: senderId, name: name, roomId: room2 });
                return;
            }

            if (msg.t === 'invite-res' && msg.to === this.me.id) {
                if (this._h.onInviteResult) {
                    this._h.onInviteResult({ from: senderId, name: name, ok: !!msg.ok, roomId: cleanId(msg.roomId) });
                }
                return;
            }

            /* Lobby-Chat. Bewusst ohne retain: wer spaeter dazukommt, sieht
               den bisherigen Verlauf nicht - gespeichert wird nirgends etwas. */
            if (msg.t === 'chat') {
                var text = cleanText(msg.text);
                if (text && this._h.onLobbyChat) {
                    this._h.onLobbyChat({ from: senderId, name: name, text: text });
                }
            }
        }
    };

    global.MPNet = Net;
})(window);
