/* ============================================================
   Erzgrund - erzgrund-ui.js
   Eingabe, Spielschleife und saemtliche Bedienoberflaeche.
   Greift nur ueber die oeffentliche EG-Schnittstelle zu.
   ============================================================ */

const EGUI = (function () {
    'use strict';

    const $ = id => document.getElementById(id);
    const keys = {};
    let panel = null;          // offener Panel-Name
    let panelKey = null;       // Bauplatz-Schluessel beim Maschinen-Panel
    let lastFrame = 0;
    let interactLatch = false; // verhindert Dauerfeuer bei Panels
    let touch = { dx: 0, dy: 0 };

    /* ------------------------------------------------------------
       HILFEN
       ------------------------------------------------------------ */
    /** Ingame-Minuten in echte Wartezeit umrechnen - das interessiert
     *  den Spieler mehr als die Spielweltuhr. */
    function fmtWait(gameMinutes) {
        const sec = Math.ceil(gameMinutes / EG_CONFIG.minutesPerSecond);
        if (sec < 60) return sec + ' s';
        const m = Math.floor(sec / 60), s = sec % 60;
        if (m < 60) return m + ':' + (s < 10 ? '0' : '') + s + ' min';
        return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
    }
    function itemName(id) { return EG_ITEMS[id] ? EG_ITEMS[id].name : id; }
    function itemIcon(id) { return EG_ITEMS[id] ? EG_ITEMS[id].icon : '❔'; }
    function taler(n) { return Num.format(n) + ' T'; }
    function costList(cost) {
        return Object.keys(cost).map(k => {
            if (k === 'taler') {
                const ok = EG.state.taler >= cost.taler;
                return '<span class="' + (ok ? 'text-amber-300' : 'text-red-400') + '">' + Num.format(cost.taler) + ' T</span>';
            }
            const ok = EG.count(k) >= cost[k];
            return '<span class="' + (ok ? 'text-slate-200' : 'text-red-400') + '">' + itemIcon(k) + ' ' +
                   cost[k] + '&times; ' + itemName(k) + '</span>';
        }).join('<span class="text-slate-600"> &middot; </span>');
    }

    function toast(title, text, kind) {
        const stack = $('eg-toasts');
        const el = document.createElement('div');
        el.className = 'eg-toast ' + (kind || 'neutral');
        el.innerHTML = '<div class="font-bold text-sm">' + title + '</div>' +
                       (text ? '<div class="text-[11px] opacity-80 leading-snug mt-0.5">' + text + '</div>' : '');
        stack.appendChild(el);
        setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 4200);
    }

    function logLine(msg, kind) {
        const box = $('eg-log');
        const el = document.createElement('div');
        el.className = 'eg-logline ' + (kind || 'neutral');
        el.textContent = msg;
        box.appendChild(el);
        while (box.children.length > 5) box.removeChild(box.firstChild);
        setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 600); }, 4000);
    }

    /* ------------------------------------------------------------
       PANELS
       ------------------------------------------------------------ */
    function openPanel(name, key) {
        panel = name; panelKey = key || null;
        $('eg-panel').classList.remove('hidden');
        renderPanel();
    }
    function closePanel() {
        panel = null; panelKey = null;
        $('eg-panel').classList.add('hidden');
    }
    function togglePanel(name) {
        if (panel === name) closePanel(); else openPanel(name);
    }

    function renderPanel() {
        if (!panel) return;
        const titles = {
            shop: 'Laden', sell: 'Verkaufskiste', build: 'Bauplatz', machine: 'Maschine',
            sleep: 'Schlafen', rail: 'Erzbahn', goals: 'Ziele', inv: 'Beutel',
            options: 'Optionen', help: 'Steuerung'
        };
        $('eg-panel-title').textContent = titles[panel] || '';
        const body = $('eg-panel-body');
        body.innerHTML = ({
            shop: panelShop, sell: panelSell, build: panelBuild, machine: panelMachine,
            sleep: panelSleep, rail: panelRail, goals: panelGoals, inv: panelInv,
            options: panelOptions, help: panelHelp
        }[panel] || (() => ''))();
        body.querySelectorAll('[data-act]').forEach(el => {
            el.addEventListener('click', () => handleAction(el.dataset.act, el.dataset.arg, el.dataset.n));
        });
    }

    function handleAction(act, arg, n) {
        const num = parseInt(n || '1', 10);
        if (act === 'buyseed') EG.buySeed(arg, num);
        else if (act === 'sell') EG.sell(arg, num === -1 ? EG.count(arg) : num);
        else if (act === 'eat') EG.eat(arg);
        else if (act === 'tool') EG.upgradeTool(arg);
        else if (act === 'plot') EG.buyPlot();
        else if (act === 'build') { if (EG.buildMachine(panelKey, arg)) openPanel('machine', panelKey); }
        else if (act === 'queue') EG.queueRecipe(panelKey, num);
        else if (act === 'collect') EG.collectMachine(panelKey);
        else if (act === 'upgrade') EG.upgradeMachine(panelKey);
        else if (act === 'sleep') { EG.sleep(); closePanel(); }
        else if (act === 'rail') EG.buildRailway(num);
        else if (act === 'seed') { EG.state.activeSeed = arg; renderSeedBar(); }
        else if (act === 'save') { EG.save(); toast('Gespeichert', 'Der Hof liegt sicher im Browser.', 'good'); }
        else if (act === 'wipe') { if (confirm('Wirklich alles loeschen und neu anfangen?')) EG.wipe(); }
        else if (act === 'export') {
            const t = EG.exportSave();
            navigator.clipboard && navigator.clipboard.writeText(t);
            prompt('Spielstand (Strg+C):', t);
        } else if (act === 'import') {
            const t = prompt('Spielstand einfuegen:');
            if (t) EG.importSave(t);
        } else if (act === 'close') closePanel();
        renderPanel();
        renderHud();
    }

    function panelShop() {
        let h = '<div class="eg-sec">Saatgut</div>';
        EG_CROPS.forEach(c => {
            if (!EG.cropAvailable(c)) return;
            h += '<div class="eg-row">' +
                '<div class="flex-1"><div class="font-bold text-sm">' + c.icon + ' ' + c.seedName + '</div>' +
                '<div class="text-[11px] text-slate-400">' + c.growHours + ' h Wachszeit (' +
                fmtWait(c.growHours * 60) + ') &middot; Ertrag ' + c.yield[0] + '-' + c.yield[1] +
                ' &middot; im Beutel: ' + (EG.state.seeds[c.id] || 0) + '</div></div>' +
                '<button class="eg-btn" data-act="buyseed" data-arg="' + c.id + '" data-n="1">1 fuer ' + c.seedPrice + ' T</button>' +
                '<button class="eg-btn" data-act="buyseed" data-arg="' + c.id + '" data-n="10">10</button></div>';
        });

        h += '<div class="eg-sec">Werkzeuge</div>';
        Object.keys(EG_TOOLS).forEach(id => {
            const t = EG_TOOLS[id];
            const lvl = EG.state.tools[id];
            const cur = t.tiers[lvl];
            const next = t.tiers[lvl + 1];
            h += '<div class="eg-row"><div class="flex-1">' +
                '<div class="font-bold text-sm">' + t.icon + ' ' + cur.name + '</div>';
            if (next) {
                h += '<div class="text-[11px] text-slate-400">Naechste Stufe: ' + next.name +
                     ' &middot; Kraft ' + cur.power + ' &rarr; ' + next.power + '</div>' +
                     '<div class="text-[11px] mt-1">' + costList(next.cost) + '</div></div>' +
                     '<button class="eg-btn primary" data-act="tool" data-arg="' + id + '">Schmieden</button>';
            } else {
                h += '<div class="text-[11px] text-emerald-400">Beste Stufe erreicht.</div></div>';
            }
            h += '</div>';
        });

        h += '<div class="eg-sec">Hof</div>';
        h += '<div class="eg-row"><div class="flex-1"><div class="font-bold text-sm">🟫 Neues Beet anlegen</div>' +
             '<div class="text-[11px] text-slate-400">Bisher zugekauft: ' + EG.state.extraPlots.length + '</div></div>' +
             '<button class="eg-btn primary" data-act="plot">' + taler(EG.plotPrice()) + '</button></div>';
        return h;
    }

    function panelSell() {
        const items = Object.keys(EG.state.inv).filter(i => EG_ITEMS[i] && EG_ITEMS[i].price > 0);
        if (!items.length) return '<div class="eg-empty">Der Beutel ist leer. Bring etwas mit.</div>';
        let sum = 0;
        items.forEach(i => sum += EG_ITEMS[i].price * EG.count(i));
        let h = '<div class="text-[11px] text-slate-400 mb-2">Alles zusammen waere ' + taler(sum) + ' wert.</div>';
        items.forEach(i => {
            const it = EG_ITEMS[i];
            h += '<div class="eg-row"><div class="flex-1"><div class="font-bold text-sm">' + it.icon + ' ' + it.name +
                ' <span class="text-slate-500">&times;' + EG.count(i) + '</span></div>' +
                '<div class="text-[11px] text-slate-400">' + it.price + ' T pro Stueck</div></div>' +
                '<button class="eg-btn" data-act="sell" data-arg="' + i + '" data-n="1">1</button>' +
                '<button class="eg-btn" data-act="sell" data-arg="' + i + '" data-n="10">10</button>' +
                '<button class="eg-btn primary" data-act="sell" data-arg="' + i + '" data-n="-1">Alle</button></div>';
        });
        return h;
    }

    function panelBuild() {
        let h = '<div class="text-[11px] text-slate-400 mb-2">Was soll hier stehen? Maschinen arbeiten weiter, ' +
                'auch wenn du in der Mine bist.</div>';
        EG_MACHINES.forEach(m => {
            const owned = Object.keys(EG.state.machines).filter(k => EG.state.machines[k].type === m.id).length;
            h += '<div class="eg-row"><div class="flex-1">' +
                '<div class="font-bold text-sm">' + m.icon + ' ' + m.name +
                (owned ? ' <span class="text-slate-500 text-[10px]">(' + owned + 'x gebaut)</span>' : '') + '</div>' +
                '<div class="text-[11px] text-slate-400">' + m.desc + '</div>' +
                '<div class="text-[11px] mt-1">' + costList(m.cost) + '</div></div>' +
                '<button class="eg-btn primary" data-act="build" data-arg="' + m.id + '">Bauen</button></div>';
        });
        return h;
    }

    function panelMachine() {
        const st = EG.machineStatus(panelKey);
        if (!st) return '<div class="eg-empty">Hier steht nichts.</div>';
        const lv = st.level;
        let h = '<div class="font-bold text-base mb-1">' + st.def.icon + ' ' + st.def.name +
                ' <span class="text-[11px] text-amber-300">Stufe ' + lv.lvl + '/' + lv.max + '</span></div>' +
                '<div class="text-[11px] text-slate-400 mb-2">' + st.def.desc + '</div>' +
                '<div class="text-[11px] text-slate-300 mb-3">Tempo ' + Math.round(100 / lv.cur.speed) + '% ' +
                '<span class="text-slate-600">&middot;</span> Warteschlange ' + st.jobs.length + '/' + lv.cur.queue + '</div>';
        if (lv.next) {
            h += '<div class="eg-row"><div class="flex-1">' +
                '<div class="font-bold text-sm">Ausbau auf Stufe ' + (lv.lvl + 1) + '</div>' +
                '<div class="text-[11px] text-slate-400">Tempo ' + Math.round(100 / lv.cur.speed) + '% &rarr; ' +
                Math.round(100 / lv.next.speed) + '% ' +
                '<span class="text-slate-600">&middot;</span> Warteschlange ' + lv.cur.queue + ' &rarr; ' + lv.next.queue + '</div>' +
                '<div class="text-[11px] mt-1">' + costList(st.upgradeCost) + '</div></div>' +
                '<button class="eg-btn primary" data-act="upgrade">Ausbauen</button></div>';
        } else {
            h += '<div class="text-[11px] text-emerald-400 mb-2">Hoechste Stufe erreicht.</div>';
        }

        const outItems = Object.keys(st.out);
        if (outItems.length) {
            h += '<div class="eg-ready"><div class="flex-1"><div class="font-bold text-sm text-emerald-300">Fertig</div>' +
                 '<div class="text-[11px]">' + outItems.map(i => itemIcon(i) + ' ' + st.out[i] + '&times; ' + itemName(i)).join(', ') + '</div></div>' +
                 '<button class="eg-btn primary" data-act="collect">Einsammeln</button></div>';
        }
        if (st.jobs.length) {
            h += '<div class="eg-sec">Warteschlange</div>';
            st.jobs.forEach((j, i) => {
                const pct = Math.max(0, Math.min(100, (1 - j.remaining / j.total) * 100));
                h += '<div class="eg-job"><div class="flex justify-between text-[11px]"><span>' + j.name + '</span>' +
                     '<span class="text-slate-400">' + (i === 0 ? 'noch ' + fmtWait(j.remaining) : 'wartet') + '</span></div>' +
                     '<div class="eg-bar"><div style="width:' + (i === 0 ? pct : 0) + '%"></div></div></div>';
            });
        }
        h += '<div class="eg-sec">Rezepte</div>';
        st.def.recipes.forEach((r, i) => {
            if (!EG.recipeAvailable(r)) {
                h += '<div class="eg-row opacity-50"><div class="flex-1"><div class="font-bold text-sm">? ? ?</div>' +
                     '<div class="text-[11px] text-slate-400">Noch nicht bekannt - bring erst den Rohstoff mit.</div></div></div>';
                return;
            }
            const outTxt = Object.keys(r.out).map(o => itemIcon(o) + ' ' + r.out[o] + '&times; ' + itemName(o)).join(', ');
            h += '<div class="eg-row"><div class="flex-1"><div class="font-bold text-sm">' + outTxt + '</div>' +
                '<div class="text-[11px] mt-0.5">' + costList(r.in) + '</div>' +
                '<div class="text-[11px] text-slate-500">Dauer: ' + fmtWait(r.minutes) + '</div></div>' +
                '<button class="eg-btn primary" data-act="queue" data-n="' + i + '">Starten</button></div>';
        });
        return h;
    }

    function panelSleep() {
        return '<div class="text-sm text-slate-300 leading-relaxed">Bis zum naechsten Morgen schlafen? ' +
            'Das fuellt deine Ausdauer komplett auf, laesst Pflanzen und Maschinen weiterlaufen und speichert.</div>' +
            '<div class="mt-4 flex gap-2"><button class="eg-btn primary flex-1" data-act="sleep">Schlafen</button>' +
            '<button class="eg-btn flex-1" data-act="close">Doch nicht</button></div>';
    }

    function panelRail() {
        const st = EG.railwayStatus();
        let h = '<div class="text-[11px] text-slate-400 mb-3">Die Erzbahn hat den Grund frueher mit dem Tal verbunden. ' +
                'Vier Abschnitte, dann faehrt sie wieder.</div>';
        st.forEach(s => {
            h += '<div class="eg-row ' + (s.done ? 'done' : (s.open ? '' : 'opacity-50')) + '">' +
                '<div class="flex-1"><div class="font-bold text-sm">' + (s.done ? '✅ ' : '') + s.def.name + '</div>' +
                '<div class="text-[11px] text-slate-400">' + s.def.text + '</div>' +
                (s.done ? '' : '<div class="text-[11px] mt-1">' + costList(s.def.need) + '</div>') + '</div>' +
                (s.done ? '' : (s.open ? '<button class="eg-btn primary" data-act="rail" data-n="' + s.index + '">Bauen</button>'
                                       : '<div class="text-[10px] text-slate-500 self-center">spaeter</div>')) +
                '</div>';
        });
        if (EG.state.finished) {
            h += '<div class="eg-ready mt-3"><div class="flex-1"><div class="font-bold text-sm text-emerald-300">' +
                 '🚂 Die Bahn faehrt.</div><div class="text-[11px]">Fertig an Tag ' + EG.state.finishedDay + '.</div></div></div>';
        }
        return h;
    }

    function panelGoals() {
        let h = '';
        EG_GOALS.forEach(g => {
            const done = EG.state.goals.indexOf(g.id) !== -1;
            h += '<div class="eg-row ' + (done ? 'done' : '') + '"><div class="flex-1">' +
                '<div class="font-bold text-sm">' + (done ? '✅ ' : '◻️ ') + g.name + '</div>' +
                '<div class="text-[11px] text-slate-400">' + g.desc + '</div></div>' +
                '<div class="text-[11px] text-amber-300 self-center shrink-0">+' + g.reward + ' T</div></div>';
        });
        const s = EG.state.stats;
        h += '<div class="eg-sec">Chronik</div><div class="text-[11px] text-slate-400 leading-relaxed">' +
             'Tag ' + EG.day() + ' &middot; ' + s.harvested + ' Ernten &middot; ' + s.sleeps + ' Naechte &middot; ' +
             'tiefste Sohle: ' + (s.deepestMine || '-') + ' &middot; verdient: ' + taler(s.earned) + '</div>';
        return h;
    }

    function panelInv() {
        const items = Object.keys(EG.state.inv);
        if (!items.length) return '<div class="eg-empty">Noch nichts gesammelt.</div>';
        let h = '<div class="eg-grid">';
        items.forEach(i => {
            const it = EG_ITEMS[i];
            const food = it && it.food;
            h += '<div class="eg-cell' + (food ? ' food' : '') + '"' + (food ? ' data-act="eat" data-arg="' + i + '"' : '') + '>' +
                '<div class="text-xl">' + itemIcon(i) + '</div>' +
                '<div class="text-[10px] leading-tight">' + itemName(i) + '</div>' +
                '<div class="text-[11px] font-bold text-amber-300">' + EG.count(i) + '</div>' +
                (food ? '<div class="text-[9px] text-emerald-400">essen +' + it.food + '</div>' : '') +
                '</div>';
        });
        return h + '</div>';
    }

    function panelOptions() {
        return '<div class="flex flex-col gap-2">' +
            '<button class="eg-btn" data-act="save">Jetzt speichern</button>' +
            '<button class="eg-btn" data-act="export">Spielstand exportieren</button>' +
            '<button class="eg-btn" data-act="import">Spielstand importieren</button>' +
            '<button class="eg-btn danger" data-act="wipe">Alles loeschen</button></div>' +
            '<div class="text-[11px] text-slate-500 mt-3">Der Hof liegt im Browser-Speicher dieses Geraets. ' +
            'Ein anderer Browser kennt ihn nicht.</div>';
    }

    function panelHelp() {
        return '<div class="text-sm leading-relaxed text-slate-300">' +
            '<p class="mb-2"><b>Laufen:</b> WASD oder Pfeiltasten. Auf dem Handy das Steuerkreuz unten links.</p>' +
            '<p class="mb-2"><b>Benutzen:</b> E oder Leertaste - und der Knopf unten rechts. Damit faellst du Baeume, ' +
            'baust Erz ab, pflanzt, erntest, oeffnest Laden, Kiste, Maschinen und Bett. Taste gedrueckt halten schlaegt weiter.</p>' +
            '<p class="mb-2"><b>Saatgut:</b> Mit 1-4 oder ueber die Leiste unten waehlen, dann auf einem freien Beet E druecken.</p>' +
            '<p class="mb-2"><b>Ausdauer:</b> Jeder Schlag kostet Kraft. Essen hilft sofort, Schlafen fuellt alles auf.</p>' +
            '<p class="mb-2"><b>Zeit:</b> Eine echte Sekunde ist anderthalb Spielminuten. Pflanzen und Maschinen laufen ' +
            'auch weiter, waehrend du woanders bist - und ein Stueck weit sogar, waehrend der Tab zu ist.</p>' +
            '<p><b>Ziel:</b> Die alte Erzbahn suedoestlich wieder in Betrieb nehmen.</p></div>';
    }

    /* ------------------------------------------------------------
       HUD
       ------------------------------------------------------------ */
    function renderHud() {
        $('eg-day').textContent = 'Tag ' + EG.day();
        $('eg-clock').textContent = EG.clockText();
        $('eg-taler').textContent = Num.format(EG.state.taler);
        const pct = (EG.state.stamina / EG_CONFIG.staminaMax) * 100;
        $('eg-stamina-bar').style.width = pct + '%';
        $('eg-stamina-bar').className = 'eg-stamina-fill ' + (pct < 25 ? 'low' : pct < 55 ? 'mid' : '');
        $('eg-stamina-text').textContent = Math.round(EG.state.stamina);
        $('eg-place').textContent = EG.mapDef().name;
        const ax = EG_TOOLS.axt.tiers[EG.state.tools.axt];
        const pk = EG_TOOLS.spitzhacke.tiers[EG.state.tools.spitzhacke];
        $('eg-tools').textContent = '🪓 ' + ax.name + '  ⛏️ ' + pk.name;
    }

    function renderSeedBar() {
        const bar = $('eg-seedbar');
        let h = '';
        EG_CROPS.forEach((c, i) => {
            const n = EG.state.seeds[c.id] || 0;
            if (n <= 0 && EG.state.activeSeed !== c.id) return;
            h += '<button class="eg-seed' + (EG.state.activeSeed === c.id ? ' active' : '') +
                 '" data-act="seed" data-arg="' + c.id + '">' +
                 '<span class="text-base">' + c.icon + '</span><span class="text-[10px]">' + n + '</span>' +
                 '<span class="eg-seed-key">' + (i + 1) + '</span></button>';
        });
        if (!h) h = '<div class="text-[11px] text-slate-500 px-2">Kein Saatgut - kauf welches im Laden.</div>';
        bar.innerHTML = h;
        bar.querySelectorAll('[data-act]').forEach(el => {
            el.addEventListener('click', () => { EG.state.activeSeed = el.dataset.arg; renderSeedBar(); });
        });
    }

    /* ------------------------------------------------------------
       HANDARBEIT
       Ohne Werkzeug (und mit dem ersten geschnitzten) wird nicht die
       Taste gehalten, sondern von Hand geschlagen: die Engine meldet
       eine Aufgabe, hier laeuft das Fenster dazu.
       ------------------------------------------------------------ */
    let manualTask = null;

    function openManual(task) {
        manualTask = task;
        const hand = EG.state.tools[task.tool] === 0;
        const wood = task.tool === 'axt';
        $('eg-manual-title').textContent = wood ? 'Baum faellen' : task.node.name + ' aufbrechen';
        $('eg-manual-hint').textContent = wood
            ? (hand ? 'Kein Werkzeug: schlag abwechselnd von links und rechts gegen den Stamm. Klick auf die leuchtende Seite (oder A und D).'
                    : 'Ein sauberer Schlag gegen den Stamm - klick auf die leuchtende Seite.')
            : (hand ? 'Kein Werkzeug: schlag von oben auf den Stein. Klick auf das leuchtende Feld (oder W).'
                    : 'Ein sauberer Schlag von oben - klick auf das leuchtende Feld.');
        $('eg-manual').classList.remove('hidden');
        updateManualBar();
    }

    function updateManualBar() {
        if (!manualTask) return;
        const pct = (manualTask.done / manualTask.needed) * 100;
        $('eg-manual-bar').style.width = pct + '%';
        $('eg-manual-count').textContent = manualTask.done + ' / ' + manualTask.needed + ' Schlaege';
    }

    function closeManual() {
        manualTask = null;
        EG.cancelManual();
        $('eg-manual').classList.add('hidden');
    }

    function manualStrike(side) {
        if (!manualTask) return;
        const res = EG.manualStrike(side);
        if (!res) return;
        if (res.miss) { EGRender.manualHit(side, false); return; }
        EGRender.manualHit(side, true);
        if (res.aborted) { closeManual(); return; }
        if (res.done) {
            manualTask = null;
            $('eg-manual').classList.add('hidden');
            const txt = res.drops.map(d => d.n + 'x ' + itemName(d.item)).join(', ');
            toast('Geschafft', txt + ' im Beutel.', 'good');
            return;
        }
        manualTask = res.state;
        updateManualBar();
    }

    /** Klick auf das Canvas in eine der Zonen uebersetzen. */
    function manualClick(ev) {
        if (!manualTask) return;
        const cv = $('eg-manual-canvas');
        const box = cv.getBoundingClientRect();
        const p = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
        const x = (p.clientX - box.left) / box.width * cv.width;
        const y = (p.clientY - box.top) / box.height * cv.height;
        if (manualTask.tool === 'axt') {
            if (x < cv.width * 0.38) manualStrike('left');
            else if (x > cv.width * 0.62) manualStrike('right');
        } else if (y < cv.height * 0.42) {
            manualStrike('top');
        }
    }

    /* ------------------------------------------------------------
       EINGABE
       ------------------------------------------------------------ */
    function bindInput() {
        window.addEventListener('keydown', e => {
            const k = e.key.toLowerCase();
            if (k === 'escape') { closePanel(); closeManual(); return; }
            if (manualTask) {
                // Waehrend der Handarbeit steuern A/D bzw. W die Schlaege
                if (k === 'a' || k === 'arrowleft') { e.preventDefault(); manualStrike('left'); return; }
                if (k === 'd' || k === 'arrowright') { e.preventDefault(); manualStrike('right'); return; }
                if (k === 'w' || k === 'arrowup') { e.preventDefault(); manualStrike('top'); return; }
                if (k === 'e' || k === ' ') { e.preventDefault(); return; }
            }
            if (['w', 'a', 's', 'd', 'e', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].indexOf(k) !== -1) {
                e.preventDefault();
            }
            if (!keys[k] && (k === 'e' || k === ' ')) interactLatch = false;
            keys[k] = true;
            if (k === 'i') togglePanel('inv');
            if (k === 'z') togglePanel('goals');
            if (k === 'h') togglePanel('help');
            if (k >= '1' && k <= '4') {
                const c = EG_CROPS[parseInt(k, 10) - 1];
                if (c) { EG.state.activeSeed = c.id; renderSeedBar(); }
            }
        });
        window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
        window.addEventListener('blur', () => { Object.keys(keys).forEach(k => keys[k] = false); });

        $('eg-panel-close').addEventListener('click', closePanel);
        $('eg-manual-cancel').addEventListener('click', closeManual);
        $('eg-manual-canvas').addEventListener('mousedown', manualClick);
        $('eg-manual-canvas').addEventListener('touchstart', e => { e.preventDefault(); manualClick(e); }, { passive: false });
        $('eg-panel').addEventListener('click', e => { if (e.target === $('eg-panel')) closePanel(); });
        ['inv', 'goals', 'options', 'help'].forEach(p => {
            const b = $('eg-btn-' + p);
            if (b) b.addEventListener('click', () => togglePanel(p));
        });

        // Touch: Steuerkreuz und Aktionsknopf
        const pad = $('eg-dpad');
        const setDir = (dx, dy) => { touch.dx = dx; touch.dy = dy; };
        pad.querySelectorAll('[data-dir]').forEach(btn => {
            const d = btn.dataset.dir;
            const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[d];
            const start = e => { e.preventDefault(); setDir(v[0], v[1]); };
            const stop = e => { e.preventDefault(); setDir(0, 0); };
            btn.addEventListener('touchstart', start, { passive: false });
            btn.addEventListener('touchend', stop);
            btn.addEventListener('touchcancel', stop);
            btn.addEventListener('mousedown', start);
            btn.addEventListener('mouseup', stop);
            btn.addEventListener('mouseleave', stop);
        });
        const act = $('eg-action');
        const actDown = e => { e.preventDefault(); keys.e = true; interactLatch = false; };
        const actUp = e => { e.preventDefault(); keys.e = false; };
        act.addEventListener('touchstart', actDown, { passive: false });
        act.addEventListener('touchend', actUp);
        act.addEventListener('mousedown', actDown);
        act.addEventListener('mouseup', actUp);
    }

    function inputVector() {
        let dx = touch.dx, dy = touch.dy;
        if (keys.a || keys.arrowleft) dx -= 1;
        if (keys.d || keys.arrowright) dx += 1;
        if (keys.w || keys.arrowup) dy -= 1;
        if (keys.s || keys.arrowdown) dy += 1;
        return { dx: Math.max(-1, Math.min(1, dx)), dy: Math.max(-1, Math.min(1, dy)) };
    }

    /* ------------------------------------------------------------
       SCHLEIFE
       ------------------------------------------------------------ */
    function frame(ts) {
        const dt = Math.min(100, ts - (lastFrame || ts));
        lastFrame = ts;

        const open = !!panel || !!manualTask;
        const inp = open ? { dx: 0, dy: 0 } : inputVector();
        EG.update(dt, inp);

        if (!open && (keys.e || keys[' '])) {
            const tgt = EG.target();
            if (tgt && tgt.type === 'node') {
                EG.interact();                    // Dauerfeuer erlaubt
            } else if (!interactLatch) {
                interactLatch = true;
                EG.interact();
            }
        }
        if (!keys.e && !keys[' ']) interactLatch = false;

        EGRender.draw(dt, !open && (inp.dx !== 0 || inp.dy !== 0));
        if (manualTask) {
            EGRender.manual($('eg-manual-canvas'), manualTask, EG.state.tools[manualTask.tool] === 0, dt);
        }
        renderHud();
        if (open && (panel === 'machine' || panel === 'rail')) renderPanel();

        requestAnimationFrame(frame);
    }

    /* ------------------------------------------------------------
       ENGINE-EREIGNISSE
       ------------------------------------------------------------ */
    function bindEngine() {
        EG.on('log', d => logLine(d.msg, d.kind));
        EG.on('inventory', () => { renderSeedBar(); if (panel) renderPanel(); });
        EG.on('open', d => openPanel(d.panel, d.key));
        EG.on('manual', openManual);
        EG.on('gathered', d => {
            d.drops.forEach((drop, i) => {
                EGRender.popup('+' + drop.n + ' ' + itemIcon(drop.item),
                    d.x * EG_CONFIG.tile + 16, d.y * EG_CONFIG.tile + 8 - i * 14, '#fde68a');
            });
        });
        EG.on('hit', d => EGRender.hitBits(d.x, d.y, d.tool === 'axt' ? '#8b5a2b' : '#d6d3d1'));
        EG.on('collected', d => toast('Eingesammelt', d.drops.map(x => x.n + 'x ' + itemName(x.item)).join(', '), 'good'));
        EG.on('goal', g => toast('Ziel erreicht: ' + g.name, g.desc + ' (+' + g.reward + ' Taler)', 'good'));
        EG.on('hint', h => toast(h.title, h.text, 'hint'));
        EG.on('machineDone', () => { if (panel === 'machine') renderPanel(); });
        EG.on('map', d => { logLine(d.name, 'neutral'); EGRender.resize(); });
        EG.on('slept', d => toast('Tag ' + d.day, 'Ausgeschlafen. Ausdauer voll, Felder gewachsen.', 'good'));
        EG.on('exhausted', () => toast('Voellig erschoepft', 'Iss etwas aus dem Beutel oder leg dich ins Bett.', 'bad'));
        EG.on('finished', d => showEnding(d.day));
    }

    function showEnding(day) {
        const box = $('eg-ending');
        $('eg-ending-body').innerHTML =
            '<h2 class="text-2xl font-black text-amber-300 mb-4">' + EG_ENDING.title + '</h2>' +
            EG_ENDING.lines.map(l => '<p class="mb-3 leading-relaxed text-slate-200">' + l + '</p>').join('') +
            '<div class="mt-5 p-3 rounded-xl bg-slate-900/60 border border-slate-700 text-[12px] text-slate-400">' +
            'Fertig an Tag ' + day + ' &middot; ' + EG.state.stats.harvested + ' Ernten &middot; ' +
            Num.format(EG.state.stats.earned) + ' Taler verdient &middot; tiefste Sohle ' + EG.state.stats.deepestMine +
            '</div>' +
            '<p class="mt-4 text-[12px] text-slate-500">' + EG_ENDING.outro + '</p>';
        box.classList.remove('hidden');
        $('eg-ending-close').onclick = () => box.classList.add('hidden');
    }

    /* ------------------------------------------------------------
       START
       ------------------------------------------------------------ */
    function init() {
        bindEngine();
        const res = EG.init();
        EGRender.init($('eg-canvas'));
        bindInput();
        renderHud();
        renderSeedBar();
        requestAnimationFrame(frame);

        if (res && res.offline) {
            toast('Willkommen zurueck', 'Waehrend deiner Abwesenheit sind rund ' +
                Math.round(res.offline / 60) + ' Stunden vergangen. Felder und Maschinen haben weitergearbeitet.', 'good');
        }
    }

    return { init: init, toast: toast };
})();

window.addEventListener('DOMContentLoaded', EGUI.init);
