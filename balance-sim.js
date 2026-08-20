/* ============================================================
   Energy Grid Tycoon – balance-sim.js
   ------------------------------------------------------------
   Balancing-Verifikation. Laedt numbers.js, data.js und engine.js
   unveraendert und spielt das Spiel beschleunigt durch. Es wird also
   die echte Spiellogik getestet, keine Nachbildung – wenn du in
   data.js eine Zahl aenderst, aendert sich hier sofort das Ergebnis.

   Aufruf:
     node balance-sim.js                    (Standard: 24 h, aktiver Spieler)
     node balance-sim.js 72                 (72 Stunden simulieren)
     node balance-sim.js 24 idle            (ohne Klicken, nur passiv)
     node balance-sim.js 24 aktiv 5         (5 Klicks pro Sekunde)

   Ohne Node-Installation tut simrun.html im Browser denselben
   Dienst – dort lassen sich die Balancing-Werte zusaetzlich per
   Query-Parameter durchprobieren (siehe pflichtenheft.md, Kap. 7).

   Diese Datei gehoert NICHT auf den Webserver – sie ist ein
   reines Entwickler-Werkzeug und wird von game.html nicht geladen.
   ============================================================ */

const fs = require('fs');
const path = require('path');

/* --- Browser-Umgebung minimal nachbilden --- */
const store = {};
global.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
};
global.window = { addEventListener() {} };
global.btoa = s => Buffer.from(s, 'binary').toString('base64');
global.atob = s => Buffer.from(s, 'base64').toString('binary');
global.unescape = s => s;
global.escape = s => s;

/* --- Timer abfangen: die Engine startet Intervalle, die wir
       hier selbst und beschleunigt takten wollen --- */
const scheduled = [];
global.setInterval = (fn, ms) => { scheduled.push({ fn, ms, acc: 0 }); return scheduled.length; };
global.setTimeout = () => 0;

/* --- Zeit kontrollierbar machen, damit Buffs und Offline-
       Berechnung mit der simulierten Uhr laufen --- */
let simNow = Date.now();
const RealDate = Date;
global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [simNow])); }
    static now() { return simNow; }
};

/* --- Spielcode laden ---
   Die Dateien deklarieren ihre Konstanten mit const/let. Damit die
   im Modul-Scope von Node sichtbar werden, haengen wir eine kleine
   Export-Zeile an und werten alles in einem Rutsch aus. */
const dir = __dirname;
const src = ['numbers.js', 'data.js', 'engine.js']
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');

const exportLine = `
    globalThis.Engine = Engine;
    globalThis.Num = Num;
    globalThis.BUILDINGS_DB = BUILDINGS_DB;
    globalThis.BUILDING_MILESTONES = BUILDING_MILESTONES;
    globalThis.SKILLS_DB = SKILLS_DB;
    globalThis.SUN_SKILLS_DB = SUN_SKILLS_DB;
    globalThis.META_SKILLS_DB = META_SKILLS_DB;
    globalThis.SUN_TYPES = SUN_TYPES;
    globalThis.EVENTS = EVENTS;
    globalThis.ERAS = ERAS;
    globalThis.ACHIEVEMENTS = ACHIEVEMENTS;
    globalThis.HINTS = HINTS;
    globalThis.CONFIG = CONFIG;
`;

eval(src + exportLine);

/* --- Parameter --- */
const HOURS = parseFloat(process.argv[2]) || 168;
const MODE = (process.argv[3] || 'aktiv').toLowerCase();
const CPS = parseFloat(process.argv[4]) || (MODE === 'idle' ? 0 : 3);

/* --- Strategie: was kauft ein Spieler als naechstes?
       Heuristik "bestes Verhaeltnis Produktion pro Wh". --- */
function bestBuildingBuy() {
    let best = null;
    BUILDINGS_DB.forEach(b => {
        const owned = Engine.state.buildings[b.id] || 0;
        const cost = Engine.getBuildingCost(b.id, owned);
        if (cost > Engine.state.energy) return;
        // Zuwachs statt Basiswert: der naechste Kauf kann eine Mengen-Schwelle
        // reissen und damit die gesamte bisherige Stueckzahl mit hochziehen.
        const before = owned * b.baseProd * Engine.getMilestoneMultiplier(b.id, owned);
        const after = (owned + 1) * b.baseProd * Engine.getMilestoneMultiplier(b.id, owned + 1);
        const ratio = (after - before) / cost;
        if (!best || ratio > best.ratio) best = { id: b.id, ratio, cost, name: b.name };
    });
    return best;
}

function spendResearch() {
    // Reihenfolge: Offline > Netz-Effizienz > Auto-Klicker > Rest
    const order = ['offline', 'passive', 'autoclick', 'click', 'luck', 'goldengrid'];
    for (const id of order) {
        const s = SKILLS_DB.find(x => x.id === id);
        const lvl = Engine.state.skills[id] || 0;
        if (s.maxLevel && lvl >= s.maxLevel) continue;
        if (Engine.state.prestigeTokens >= Engine.getSkillCost(id, lvl)) {
            Engine.buySkill(id);
            return true;
        }
    }
    return false;
}

function spendShards() {
    const order = ['sun_duration', 'sun_radar', 'sun_variants', 'sun_yield', 'sun_chain', 'sun_potency'];
    for (const id of order) {
        const s = SUN_SKILLS_DB.find(x => x.id === id);
        const lvl = Engine.state.sunSkills[id] || 0;
        if (s.maxLevel && lvl >= s.maxLevel) continue;
        if (Engine.state.shards >= Engine.getSunSkillCost(id, lvl)) {
            Engine.buySunSkill(id);
            return true;
        }
    }
    return false;
}

/* --- Meilensteine mitschreiben --- */
const milestones = [];
const seenBuildings = new Set();
const seenEras = new Set();
let lastPrestige = 0;

function note(hours, text) {
    milestones.push({ h: hours, text });
}

/* --- Ereignisse der Engine abgreifen --- */
let sunSpawns = 0;
Engine.on('spawnsun', payload => {
    sunSpawns++;
    // Simulierter Spieler faengt Sonnen zuverlaessig, ausser im Idle-Modus
    if (MODE !== 'idle' || Math.random() < 0.3) {
        Engine.claimSun(payload.type.id);
    }
});

/* --- Start ---
   WICHTIG: tickRate muss vor Engine.init() gesetzt sein. Die Engine
   registriert ihre Intervalle mit diesem Wert und rechnet auch damit –
   wird er nachtraeglich geaendert, laeuft die Wirtschaft um den
   Faktor der Abweichung zu schnell. */
const TICK = parseInt(process.env.SIM_TICK || '1000', 10);
CONFIG.tickRate = TICK;

Engine.init();
console.log('Simuliere ' + HOURS + ' h  |  Modus: ' + MODE + '  |  ' + CPS + ' Klicks/s\n');

const totalTicks = Math.floor((HOURS * 3600 * 1000) / TICK);
let clickCarry = 0;

for (let i = 0; i < totalTicks; i++) {
    simNow += TICK;

    // Alle von der Engine registrierten Intervalle takten
    scheduled.forEach(job => {
        job.acc += TICK;
        while (job.acc >= job.ms) {
            job.acc -= job.ms;
            try { job.fn(); } catch (e) { /* Autosave etc. ignorieren */ }
        }
    });

    // Spieler klickt
    clickCarry += CPS * (TICK / 1000);
    while (clickCarry >= 1) { Engine.doClick(); clickCarry -= 1; }

    // Spieler kauft alle 2 s ein
    if (i % Math.max(1, Math.round(2000 / TICK)) === 0) {
        let buy;
        while ((buy = bestBuildingBuy())) {
            Engine.buyBuilding(buy.id, 1);
            if (!seenBuildings.has(buy.id)) {
                seenBuildings.add(buy.id);
                note(i * TICK / 3600000, 'Erstes Gebaeude: ' + buy.name);
            }
        }
        while (spendResearch()) {}
        while (spendShards()) {}
    }

    // Prestige, sobald es sich deutlich lohnt
    if (i % Math.max(1, Math.round(10000 / TICK)) === 0) {
        // Der simulierte Spieler folgt der Reboot-Empfehlung des Spiels,
        // damit Simulation und angezeigter Rat dieselbe Regel benutzen.
        if (Engine.getPrestigeAdvice().ready) {
            const res = Engine.doPrestige();
            if (res) {
                lastPrestige++;
                if (res.eraChanged && !seenEras.has(res.era.name)) {
                    seenEras.add(res.era.name);
                    note(i * TICK / 3600000, 'Aera erreicht: ' + res.era.name + ' (+' + res.fp + ' FP)');
                }
            }
        }
    }
}

/* --- Auswertung --- */
const s = Engine.getStats();
const f = Engine.formatNumber;

console.log('--- Meilensteine ---');
if (milestones.length === 0) console.log('  (keine)');
milestones.forEach(m => {
    console.log('  ' + m.h.toFixed(2).padStart(7) + ' h   ' + m.text);
});

console.log('\n--- Endstand nach ' + HOURS + ' h ---');
console.log('  Aera                 ' + s.era.name);
console.log('  Gesamtenergie        ' + f(s.lifetimeEnergy) + ' Wh');
console.log('  Produktion           ' + f(s.currentEPS) + ' Wh/s');
console.log('  Reboots              ' + s.prestigeCount);
console.log('  FP verdient          ' + s.totalFPEarned);
console.log('  Dyson-Kerne          ' + s.metaEarned);
console.log('  Sonnen: gespawnt     ' + sunSpawns + ', gefangen ' + s.sunsCaught);
console.log('  Fragmente            ' + s.shardsEarned);
console.log('  Erfolge              ' + s.achievements + '/' + s.achievementsTotal);

console.log('\n--- Hardware ---');
BUILDINGS_DB.forEach(b => {
    const n = Engine.state.buildings[b.id] || 0;
    const bar = '#'.repeat(Math.min(30, Math.floor(n / 5)));
    console.log('  ' + b.name.padEnd(24) + String(n).padStart(5) + '  ' + bar);
});

console.log('\n--- Nicht erreicht ---');
const missing = BUILDINGS_DB.filter(b => (Engine.state.buildings[b.id] || 0) === 0);
if (missing.length === 0) console.log('  Alles freigeschaltet.');
else missing.forEach(b => console.log('  ' + b.name + ' (Basiskosten ' + f(b.baseCost) + ')'));

console.log('\n--- Skill-Level ---');
[['Forschung', SKILLS_DB, Engine.state.skills],
 ['Solar', SUN_SKILLS_DB, Engine.state.sunSkills],
 ['Dyson', META_SKILLS_DB, Engine.state.metaSkills]].forEach(([label, db, store]) => {
    const line = db.map(x => x.name + ' ' + (store[x.id] || 0)).join(', ');
    console.log('  ' + label + ': ' + line);
});

console.log('\nHinweis: Die Kaufstrategie ist eine Heuristik, kein echter Spieler.');
console.log('Sie zeigt die Form der Kurve, nicht die exakte Spielzeit.');
