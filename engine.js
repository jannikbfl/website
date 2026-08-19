/* ============================================================
   Energy Grid Tycoon – engine.js
   Kernlogik: State, Game-Loop, Kaufen, Prestige, Events,
   Save/Load, Offline-Produktion.
   Kein DOM-Zugriff – die Engine meldet Aenderungen ueber
   Engine.on(...) an die UI.
   ============================================================ */

const Engine = (function () {
    'use strict';

    const SAVE_KEY = 'gridTycoonSave';
    const SAVE_VERSION = 2;

    /* --- interner State (nicht global) --- */
    const state = {
        energy: 0,
        lifetimeEnergy: 0,
        prestigeTokens: 0,        // FP
        metaTokens: 0,            // Dyson-Kerne (DK)
        prestigeCount: 0,
        shards: 0,                // Sonnenfragmente (SF)
        buildings: {},
        skills: {},
        metaSkills: {},
        sunSkills: {},
        achievements: [],
        seenHints: [],
        stats: {
            clicks: 0,
            sunsCaught: 0,
            repairs: 0,
            totalFPEarned: 0,
            metaEarned: 0,
            shardsEarned: 0,
            playTimeMs: 0,
            bestEPS: 0,
            totalEnergyClicked: 0,
            buildingsBought: 0,
            eventsSeen: 0,
            sunTypesCaught: {},
            npcStage: {}
        },
        startTime: Date.now(),
        lastSeen: Date.now()
    };

    let currentEvent = null;
    let eventTimer = 0;
    let repairProgress = 0;
    let autoClickCarry = 0;
    let sunBoostUntil = 0;
    let lastSunSpawn = 0;
    let lastTickAt = 0; // Echtzeit-Zeitstempel des letzten Ticks, fuer Delta-basierte Produktion
    let activeBuffs = [];     // Sonnen-Buffs, laufen parallel zu Events
    let saveDisabled = false; // wird beim Wipe gesetzt
    let unloadHandler = null;
    const timers = [];
    const listeners = {};

    /* --- Event-Bus zur UI --- */
    function on(name, fn) {
        (listeners[name] = listeners[name] || []).push(fn);
    }
    function emit(name, payload) {
        (listeners[name] || []).forEach(fn => fn(payload));
    }

    /* ------------------------------------------------------------
       BERECHNUNGEN
       ------------------------------------------------------------ */
    function getBuildingCost(id, count) {
        const b = BUILDINGS_DB.find(x => x.id === id);
        const raw = b.baseCost * Math.pow(b.costFactor, count);
        return Math.floor(raw * getCostDiscount());
    }

    /**
     * Kosten fuer n Stueck ab dem aktuellen Bestand.
     * Kleine Mengen exakt (Rundung pro Stueck zaehlt beim Kauf),
     * grosse Mengen ueber die geometrische Reihe – sonst laeuft
     * hier 10x pro Sekunde eine vierstellige Schleife.
     */
    function getBulkCost(id, amount) {
        const owned = state.buildings[id] || 0;
        if (amount <= 50) {
            let total = 0;
            for (let i = 0; i < amount; i++) total += getBuildingCost(id, owned + i);
            return total;
        }
        const b = BUILDINGS_DB.find(x => x.id === id);
        const f = b.costFactor;
        const first = b.baseCost * Math.pow(f, owned) * getCostDiscount();
        return Math.floor(first * (Math.pow(f, amount) - 1) / (f - 1));
    }

    /**
     * Wie viele Einheiten koennte man sich gerade leisten?
     * Geschlossene Form statt Schleife: k = log_f(1 + budget*(f-1)/first)
     */
    function getMaxAffordable(id) {
        const b = BUILDINGS_DB.find(x => x.id === id);
        const owned = state.buildings[id] || 0;
        const f = b.costFactor;
        const first = b.baseCost * Math.pow(f, owned) * getCostDiscount();
        if (state.energy < first) return 0;

        let k = Math.floor(Math.log(1 + (state.energy * (f - 1)) / first) / Math.log(f));
        k = Math.max(0, Math.min(k, 5000));
        // Rundungsfehler der Formel gegen die echten Kosten korrigieren
        let guard = 0;
        while (k > 0 && getBulkCost(id, k) > state.energy && guard < 5) { k--; guard++; }
        return k;
    }

    function getCostDiscount() {
        let d = 1;
        if (currentEvent && currentEvent.discount) d *= (1 - currentEvent.discount);
        activeBuffs.forEach(b => { if (b.kind === 'discount') d *= (1 - b.discount); });
        return Math.max(0.05, d);
    }

    /* ------------------------------------------------------------
       SONNEN-BUFFS
       ------------------------------------------------------------ */
    function getSunPotency() {
        return 1 + ((state.sunSkills.sun_potency || 0) * CONFIG.sunPotencyPerLevel);
    }

    function addBuff(type) {
        const potency = getSunPotency();
        const lengthBonus = 1 + ((state.sunSkills.sun_afterglow || 0) * CONFIG.sunAfterglowPerLevel);
        const duration = type.buffDuration * lengthBonus;
        const buff = {
            id: type.id,
            name: type.name,
            kind: type.buffKind,
            mult: type.buffKind === 'discount' ? 1 : 1 + ((type.buffMult - 1) * potency),
            discount: type.discount ? Math.min(0.8, type.discount * potency) : 0,
            endsAt: Date.now() + duration * 1000,
            duration: duration
        };
        // Gleicher Buff-Typ verlaengert statt zu stapeln
        const existing = activeBuffs.find(b => b.id === type.id);
        if (existing) existing.endsAt = Math.max(existing.endsAt, buff.endsAt);
        else activeBuffs.push(buff);
        emit('buffs', getActiveBuffs());
    }

    function pruneBuffs() {
        const before = activeBuffs.length;
        activeBuffs = activeBuffs.filter(b => b.endsAt > Date.now());
        if (activeBuffs.length !== before) emit('buffs', getActiveBuffs());
    }

    function getActiveBuffs() {
        return activeBuffs.map(b => ({
            id: b.id, name: b.name, kind: b.kind,
            mult: b.mult, discount: b.discount,
            remaining: Math.max(0, Math.ceil((b.endsAt - Date.now()) / 1000))
        }));
    }

    function getBuffMultiplier(kind) {
        let m = 1;
        activeBuffs.forEach(b => { if (b.kind === kind) m *= b.mult; });
        return m;
    }

    function getSunLifetime() {
        return CONFIG.goldenSunLifetime + ((state.sunSkills.sun_duration || 0) * CONFIG.sunDurationPerLevel);
    }

    /** Aktuell verfuegbare Sonnen-Typen, gewichtet gezogen. */
    function getUnlockedSunTypes() {
        return SUN_TYPES.filter(t => !t.unlock || (state.sunSkills[t.unlock] || 0) >= 1);
    }

    function pickSunType() {
        const pool = getUnlockedSunTypes();
        const total = pool.reduce((s, t) => s + t.weight, 0);
        let roll = Math.random() * total;
        for (let i = 0; i < pool.length; i++) {
            roll -= pool[i].weight;
            if (roll <= 0) return pool[i];
        }
        return pool[0];
    }

    function getSunSkillCost(id, level) {
        const s = SUN_SKILLS_DB.find(x => x.id === id);
        return Math.floor(s.baseCost * Math.pow(s.costFactor, level));
    }

    function buySunSkill(id) {
        const s = SUN_SKILLS_DB.find(x => x.id === id);
        const level = state.sunSkills[id] || 0;
        if (s.maxLevel && level >= s.maxLevel) return false;
        const cost = getSunSkillCost(id, level);
        if (state.shards < cost) return false;
        state.shards -= cost;
        state.sunSkills[id] = level + 1;
        checkAchievements();
        emit('purchase', { id: id, sun: true });
        if (s.maxLevel === 1) {
            emit('log', { msg: s.name + ' freigeschaltet: ' + s.desc, type: 'good' });
        }
        return true;
    }

    function getSkillCost(id, level) {
        const s = SKILLS_DB.find(x => x.id === id);
        return Math.floor(s.baseCost * Math.pow(s.costFactor, level));
    }

    function getMetaSkillCost(id, level) {
        const s = META_SKILLS_DB.find(x => x.id === id);
        return Math.floor(s.baseCost * Math.pow(s.costFactor, level));
    }

    function getBaseEPS() {
        let eps = 0;
        BUILDINGS_DB.forEach(b => {
            eps += (state.buildings[b.id] || 0) * b.baseProd;
        });
        return eps;
    }

    /** Produktionsanteil je Gebaeudetyp – fuer das Breakdown-Panel. */
    function getProductionBreakdown() {
        const mult = getMultiplier();
        const rows = [];
        BUILDINGS_DB.forEach(b => {
            const count = state.buildings[b.id] || 0;
            if (count > 0) {
                rows.push({
                    id: b.id, name: b.name, icon: b.icon, count: count,
                    output: count * b.baseProd * mult
                });
            }
        });
        const total = rows.reduce((sum, r) => sum + r.output, 0);
        rows.forEach(r => r.share = total > 0 ? (r.output / total) * 100 : 0);
        return rows.sort((a, b) => b.output - a.output);
    }

    function getMultiplier() {
        let mult = 1 + ((state.skills.passive || 0) * 0.20);
        mult *= 1 + ((state.metaSkills.core_output || 0) * 0.50);
        mult *= getBuffMultiplier('production');
        if (currentEvent && currentEvent.mult) mult *= currentEvent.mult;
        return mult;
    }

    function getClickPower() {
        const base = 1 + (getBaseEPS() * CONFIG.clickEpsShare);
        let mult = 1 + ((state.skills.click || 0) * 1.0);
        mult *= 1 + ((state.metaSkills.core_output || 0) * 0.50);
        mult *= getBuffMultiplier('click');
        if (currentEvent && currentEvent.mult) mult *= currentEvent.mult;
        return base * mult;
    }

    function getEPS() {
        return getBaseEPS() * getMultiplier();
    }

    /**
     * Die Aera haengt an den insgesamt verdienten Forschungspunkten,
     * nicht an der Anzahl der Reboots. Sonst waere die komplette
     * Story nach sechs Reboots erzaehlt – im Zweifel nach einer Stunde.
     */
    function getEra() {
        let era = ERAS[0];
        for (let i = 0; i < ERAS.length; i++) {
            if (state.stats.totalFPEarned >= ERAS[i].fpRequired) era = ERAS[i];
        }
        return era;
    }

    function getEraProgress() {
        const cur = getEra();
        const next = ERAS.find(e => e.level === cur.level + 1);
        if (!next) return { next: null, pct: 100, remaining: 0 };
        const span = next.fpRequired - cur.fpRequired;
        const done = state.stats.totalFPEarned - cur.fpRequired;
        return {
            next: next,
            pct: Math.max(0, Math.min(100, (done / span) * 100)),
            remaining: Math.max(0, next.fpRequired - state.stats.totalFPEarned)
        };
    }

    function calculatePendingFP() {
        let calculated = Math.floor(Math.sqrt(state.lifetimeEnergy / CONFIG.fpDivisor));
        calculated = Math.floor(calculated * (1 + ((state.metaSkills.core_research || 0) * 0.25)));
        const pending = calculated - state.stats.totalFPEarned;
        return pending > 0 ? pending : 0;
    }

    function calculatePendingMeta() {
        if (state.stats.totalFPEarned < CONFIG.metaUnlockFP) return 0;
        const calculated = Math.floor(Math.sqrt(state.stats.totalFPEarned / CONFIG.metaDivisor));
        const pending = calculated - state.stats.metaEarned;
        return pending > 0 ? pending : 0;
    }

    function isMetaUnlocked() {
        return state.stats.totalFPEarned >= CONFIG.metaUnlockFP || state.stats.metaEarned > 0;
    }

    /* ------------------------------------------------------------
       AKTIONEN
       ------------------------------------------------------------ */
    function addEnergy(amount) {
        state.energy += amount;
        state.lifetimeEnergy += amount;
    }

    function doClick(source) {
        const val = getClickPower();
        addEnergy(val);
        if (source !== 'auto') {
            state.stats.clicks++;
            state.stats.totalEnergyClicked += val;
        }
        checkAchievements();
        return val;
    }

    function buyBuilding(id, amount) {
        amount = amount || 1;
        if (amount === 'max') amount = getMaxAffordable(id);
        if (amount < 1) return 0;

        let bought = 0;
        for (let i = 0; i < amount; i++) {
            const cost = getBuildingCost(id, state.buildings[id] || 0);
            if (state.energy < cost) break;
            state.energy -= cost;
            state.buildings[id] = (state.buildings[id] || 0) + 1;
            bought++;
        }

        if (bought > 0) {
            state.stats.buildingsBought += bought;
            const b = BUILDINGS_DB.find(x => x.id === id);
            if ((state.buildings[id] || 0) === bought) {
                // Erster Kauf dieses Typs → Meilenstein
                emit('milestone', {
                    title: b.name + ' online',
                    text: b.flavor,
                    icon: b.icon
                });
                emit('gridchange', id);
            }
            checkAchievements();
            emit('purchase', { id: id, amount: bought });
        }
        return bought;
    }

    function buySkill(id) {
        const s = SKILLS_DB.find(x => x.id === id);
        const level = state.skills[id] || 0;
        if (s.maxLevel && level >= s.maxLevel) return false;
        const cost = getSkillCost(id, level);
        if (state.prestigeTokens < cost) return false;
        state.prestigeTokens -= cost;
        state.skills[id] = level + 1;
        checkAchievements();
        emit('purchase', { id: id, skill: true });
        return true;
    }

    function buyMetaSkill(id) {
        const s = META_SKILLS_DB.find(x => x.id === id);
        const level = state.metaSkills[id] || 0;
        if (s.maxLevel && level >= s.maxLevel) return false;
        const cost = getMetaSkillCost(id, level);
        if (state.metaTokens < cost) return false;
        state.metaTokens -= cost;
        state.metaSkills[id] = level + 1;
        emit('purchase', { id: id, meta: true });
        return true;
    }

    function doPrestige() {
        const pending = calculatePendingFP();
        if (pending <= 0) return null;

        const eraBefore = getEra().level;
        state.prestigeTokens += pending;
        state.stats.totalFPEarned += pending;
        state.prestigeCount++;
        state.energy = 0;
        BUILDINGS_DB.forEach(b => state.buildings[b.id] = 0);

        // Notfall-Backup: Startkapital an Panels
        const backup = (state.metaSkills.core_start || 0) * 10;
        if (backup > 0) state.buildings.panel = backup;

        currentEvent = null;
        repairProgress = 0;
        checkAchievements();

        const era = getEra();
        const eraChanged = era.level > eraBefore;
        if (eraChanged) {
            emit('era', era);
            emit('log', { msg: 'Neue Aera: ' + era.name + ' – ' + era.subtitle, type: 'good' });
        }
        emit('log', { msg: 'SYSTEM REBOOT! +' + pending + ' FP generiert.', type: 'good' });
        save();
        return { fp: pending, era: era, eraChanged: eraChanged };
    }

    function doMetaPrestige() {
        const pending = calculatePendingMeta();
        if (pending <= 0) return null;

        state.metaTokens += pending;
        state.stats.metaEarned += pending;
        state.energy = 0;
        state.lifetimeEnergy = 0;
        state.prestigeTokens = 0;
        state.prestigeCount = 0;
        state.stats.totalFPEarned = 0;
        BUILDINGS_DB.forEach(b => state.buildings[b.id] = 0);
        SKILLS_DB.forEach(s => state.skills[s.id] = 0);

        const backup = (state.metaSkills.core_start || 0) * 10;
        if (backup > 0) state.buildings.panel = backup;

        currentEvent = null;
        checkAchievements();
        emit('log', { msg: 'DYSON-KOLLAPS! +' + pending + ' Dyson-Kerne. Das Netz beginnt von vorn.', type: 'good' });
        save();
        return { dk: pending };
    }

    /* ------------------------------------------------------------
       ACHIEVEMENTS
       ------------------------------------------------------------ */
    /* ------------------------------------------------------------
       ONBOARDING-HINWEISE
       ------------------------------------------------------------ */
    function checkHints() {
        const api = {
            pendingFP: calculatePendingFP(),
            metaUnlocked: isMetaUnlocked(),
            event: currentEvent
        };
        for (let i = 0; i < HINTS.length; i++) {
            const h = HINTS[i];
            if (state.seenHints.indexOf(h.id) !== -1) continue;
            let ok = false;
            try { ok = h.check(state, api); } catch (e) { ok = false; }
            if (ok) {
                state.seenHints.push(h.id);
                emit('hint', h);
                return; // hoechstens ein Hinweis gleichzeitig
            }
        }
    }

    function dismissAllHints() {
        HINTS.forEach(h => {
            if (state.seenHints.indexOf(h.id) === -1) state.seenHints.push(h.id);
        });
    }

    function resetHints() {
        state.seenHints = [];
    }

    /* ------------------------------------------------------------
       STATISTIKEN
       ------------------------------------------------------------ */
    function getStats() {
        const s = state.stats;
        let totalBuildings = 0;
        BUILDINGS_DB.forEach(b => totalBuildings += (state.buildings[b.id] || 0));

        const sunRows = SUN_TYPES.map(t => ({
            name: t.name,
            color: t.color,
            count: s.sunTypesCaught[t.id] || 0,
            unlocked: !t.unlock || (state.sunSkills[t.unlock] || 0) >= 1
        }));

        let skillLevels = 0;
        SKILLS_DB.forEach(x => skillLevels += (state.skills[x.id] || 0));
        SUN_SKILLS_DB.forEach(x => skillLevels += (state.sunSkills[x.id] || 0));
        META_SKILLS_DB.forEach(x => skillLevels += (state.metaSkills[x.id] || 0));

        return {
            playTimeMs: s.playTimeMs,
            clicks: s.clicks,
            energyClicked: s.totalEnergyClicked,
            lifetimeEnergy: state.lifetimeEnergy,
            currentEPS: getEPS(),
            bestEPS: s.bestEPS,
            buildingsOwned: totalBuildings,
            buildingsBought: s.buildingsBought,
            prestigeCount: state.prestigeCount,
            totalFPEarned: s.totalFPEarned,
            metaEarned: s.metaEarned,
            shardsEarned: s.shardsEarned,
            sunsCaught: s.sunsCaught,
            sunRows: sunRows,
            repairs: s.repairs,
            eventsSeen: s.eventsSeen,
            achievements: state.achievements.length,
            achievementsTotal: ACHIEVEMENTS.length,
            skillLevels: skillLevels,
            era: getEra()
        };
    }

    function formatDuration(ms) {
        const totalSec = Math.floor(ms / 1000);
        const d = Math.floor(totalSec / 86400);
        const h = Math.floor((totalSec % 86400) / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const sec = totalSec % 60;
        if (d > 0) return d + ' d ' + h + ' h ' + m + ' min';
        if (h > 0) return h + ' h ' + m + ' min';
        if (m > 0) return m + ' min ' + sec + ' s';
        return sec + ' s';
    }

    function checkAchievements() {
        ACHIEVEMENTS.forEach(a => {
            if (state.achievements.indexOf(a.id) === -1 && a.check(state)) {
                state.achievements.push(a.id);
                emit('achievement', a);
            }
        });
    }

    /* ------------------------------------------------------------
       EVENTS & GOLDENE SONNE
       ------------------------------------------------------------ */
    function eventLoop() {
        if (currentEvent) {
            eventTimer--;
            if (currentEvent.repairClicks && repairProgress >= currentEvent.repairClicks) {
                state.stats.repairs++;
                emit('log', { msg: 'System wiederhergestellt. Betriebsbereit.', type: 'good' });
                checkAchievements();
                clearEvent();
                return;
            }
            if (eventTimer <= 0) {
                emit('log', { msg: 'Event beendet: ' + currentEvent.name });
                clearEvent();
            }
            return;
        }

        const chance = CONFIG.eventBaseChance
            + ((state.skills.luck || 0) * CONFIG.eventLuckBonus)
            + (state.prestigeCount * CONFIG.eventEraBonus);

        if (Math.random() < chance) {
            const pool = EVENTS.filter(e => {
                // Kritische Events erst ab Aera 1, damit der Einstieg fair bleibt
                if (e.type === 'critical' && state.prestigeCount < 1) return false;
                return true;
            });
            const ev = pool[Math.floor(Math.random() * pool.length)];
            startEvent(ev);
        }
    }

    function startEvent(ev) {
        currentEvent = ev;
        eventTimer = ev.duration;
        repairProgress = 0;
        state.stats.eventsSeen++;
        emit('log', { msg: ev.msg, type: ev.type === 'good' ? 'good' : 'bad' });
        if (ev.lore) emit('log', { msg: ev.lore, type: 'lore' });
        if (ev.npc) speakNPC(ev.npc);
        emit('event', ev);
    }

    function clearEvent() {
        currentEvent = null;
        repairProgress = 0;
        emit('event', null);
    }

    function repairClick() {
        if (!currentEvent || !currentEvent.repairClicks) return null;
        repairProgress++;
        return {
            progress: repairProgress,
            needed: currentEvent.repairClicks
        };
    }

    function speakNPC(key) {
        const npc = NPCS[key];
        if (!npc) return;
        const stage = Math.min(state.prestigeCount, npc.lines.length - 1);
        emit('log', { msg: npc.lines[stage], type: 'npc' });
    }

    /** Die GRID-KI meldet sich, sobald entsprechende Hardware steht. */
    function maybeKiComment() {
        if ((state.buildings.fpga || 0) < 1) return;
        if (Math.random() > 0.15) return;
        const lines = NPCS.ki.lines;
        let stage = 0;
        if ((state.buildings.dyson || 0) > 0) stage = 4;
        else if ((state.buildings.fusion || 0) > 0) stage = 3;
        else if ((state.buildings.riscv || 0) > 0) stage = 2;
        else if ((state.buildings.trading || 0) > 0) stage = 1;
        emit('log', { msg: lines[stage], type: 'npc' });
    }

    function getSunSpawnChance() {
        let chance = CONFIG.sunBaseChance
            + ((state.skills.luck || 0) * CONFIG.sunLuckBonus)
            + ((state.sunSkills.sun_radar || 0) * CONFIG.sunRadarBonus)
            + (state.prestigeCount * CONFIG.sunEraBonus);
        if (Date.now() < sunBoostUntil) chance += CONFIG.sunOfflineBoost;
        return chance;
    }

    function sunLoop() {
        // Abklingzeit verhindert, dass sich Sonnen zu einer Dauerbeschaeftigung
        // haeufen – auch bei voll ausgebautem Solar-Zweig.
        if (Date.now() - lastSunSpawn < CONFIG.sunCooldownMs) return;
        if (Math.random() < getSunSpawnChance()) {
            lastSunSpawn = Date.now();
            emit('spawnsun', { type: pickSunType(), lifetime: getSunLifetime() });
        }
    }

    /**
     * Sonne einsammeln. Gibt immer Fragmente, der Rest haengt
     * am Typ: Sofortenergie, Buff oder Fragment-Ausschuettung.
     */
    function claimSun(typeId) {
        const type = SUN_TYPES.find(t => t.id === typeId) || SUN_TYPES[0];
        const potency = getSunPotency();
        const result = { type: type, energy: 0, shards: 0, buff: null, chained: false };

        // Fragmente – Grundertrag plus Ausbeute-Skill
        let shards = CONFIG.sunShardBase + (state.sunSkills.sun_yield || 0);
        if (type.effect === 'shards') shards = Math.floor(shards * type.shardMult);
        state.shards += shards;
        state.stats.shardsEarned += shards;
        result.shards = shards;

        if (type.effect === 'instant') {
            const seconds = CONFIG.goldenSunBase + ((state.skills.goldengrid || 0) * CONFIG.goldenSunPerLevel);
            let reward = getEPS() * seconds * potency;
            if (reward < CONFIG.goldenSunMin) reward = CONFIG.goldenSunMin;
            addEnergy(reward);
            result.energy = reward;
            emit('log', {
                msg: type.name + ' eingefangen: +' + formatNumber(reward) + ' Wh, +' + shards + ' SF',
                type: 'good'
            });
        } else if (type.effect === 'buff') {
            addBuff(type);
            const b = activeBuffs.find(x => x.id === type.id);
            result.buff = b;
            emit('log', {
                msg: type.name + ' aktiv: ' + type.desc + ' (+' + shards + ' SF)',
                type: 'good'
            });
        } else {
            emit('log', { msg: type.name + ': +' + shards + ' Sonnenfragmente!', type: 'good' });
        }

        state.stats.sunsCaught++;
        state.stats.sunTypesCaught[type.id] = (state.stats.sunTypesCaught[type.id] || 0) + 1;
        checkAchievements();

        // Ketten-Reaktion – umgeht bewusst die Abklingzeit, sonst waere
        // der Skill wirkungslos
        const chainChance = (state.sunSkills.sun_chain || 0) * CONFIG.sunChainChance;
        if (chainChance > 0 && Math.random() < chainChance) {
            result.chained = true;
            emit('log', { msg: 'Ketten-Reaktion! Eine weitere Sonne erscheint.', type: 'good' });
            setTimeout(() => emit('spawnsun', { type: pickSunType(), lifetime: getSunLifetime() }), 400);
        }

        return result;
    }

    /* ------------------------------------------------------------
       HAUPT-LOOP
       ------------------------------------------------------------ */
    function tick() {
        // Delta-basiert statt Tick-Anzahl-basiert: Browser drosseln
        // setInterval in Hintergrund-Tabs (seltenere Aufrufe statt
        // Stillstand), daher zaehlt die tatsaechlich vergangene Zeit,
        // nicht die Anzahl der Tick-Aufrufe. So laeuft die Produktion
        // auch weiter, wenn der Tab im Hintergrund ist.
        const now = Date.now();
        const rawElapsedMs = lastTickAt ? (now - lastTickAt) : CONFIG.tickRate;
        lastTickAt = now;
        // Vor negativen Werten (Systemuhr-Sprung) und absurden Ausreissern
        // (Standby/Ruhezustand) schuetzen; echte lange Abwesenheiten laufen
        // ueber applyOfflineProgress beim naechsten Laden.
        const elapsedMs = Math.min(Math.max(rawElapsedMs, 0), CONFIG.tickMaxCatchUpMs);
        const seconds = elapsedMs / 1000;

        pruneBuffs();
        const eps = getEPS();
        addEnergy(eps * seconds);

        state.stats.playTimeMs += elapsedMs;
        if (eps > state.stats.bestEPS) state.stats.bestEPS = eps;

        // Auto-Klicker
        const cps = state.skills.autoclick || 0;
        if (cps > 0) {
            autoClickCarry += cps * seconds;
            while (autoClickCarry >= 1) {
                doClick('auto');
                autoClickCarry -= 1;
            }
        }

        emit('tick');
    }

    /* ------------------------------------------------------------
       OFFLINE-PRODUKTION
       ------------------------------------------------------------ */
    function applyOfflineProgress() {
        const level = state.skills.offline || 0;
        if (level < 1) return null;

        const elapsedMs = Date.now() - (state.lastSeen || Date.now());
        if (elapsedMs < 60000) return null; // unter 1 Minute ignorieren

        const capMs = level * CONFIG.offlineHoursPerLevel * 3600 * 1000;
        const usedMs = Math.min(elapsedMs, capMs);
        const gained = getEPS() * (usedMs / 1000) * CONFIG.offlineRate;
        if (gained <= 0) return null;

        addEnergy(gained);
        if (elapsedMs > 3600000) sunBoostUntil = Date.now() + 120000;

        return {
            gained: gained,
            minutes: Math.floor(usedMs / 60000),
            capped: elapsedMs > capMs
        };
    }

    /* ------------------------------------------------------------
       SAVE / LOAD
       ------------------------------------------------------------ */
    function save() {
        // Nach einem Wipe darf nichts mehr geschrieben werden – sonst
        // stellt der beforeunload-Handler beim Reload den geloeschten
        // Stand sofort wieder her.
        if (saveDisabled) return false;
        state.lastSeen = Date.now();
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, state: state }));
            return true;
        } catch (e) {
            emit('log', { msg: 'Speichern fehlgeschlagen: ' + e.message, type: 'bad' });
            return false;
        }
    }

    function mergeState(parsed) {
        if (!parsed) return;
        // v1-Saves hatten den State flach im Objekt
        const src = parsed.state ? parsed.state : parsed;

        state.energy = src.energy || 0;
        state.lifetimeEnergy = src.lifetimeEnergy || 0;
        state.prestigeTokens = src.prestigeTokens || 0;
        state.metaTokens = src.metaTokens || 0;
        state.shards = src.shards || 0;
        state.prestigeCount = src.prestigeCount || 0;
        state.lastSeen = src.lastSeen || Date.now();
        state.startTime = src.startTime || Date.now();

        if (src.buildings) Object.assign(state.buildings, src.buildings);
        if (src.skills) Object.assign(state.skills, src.skills);
        if (src.metaSkills) Object.assign(state.metaSkills, src.metaSkills);
        if (src.sunSkills) Object.assign(state.sunSkills, src.sunSkills);
        if (src.stats && src.stats.sunTypesCaught) Object.assign(state.stats.sunTypesCaught, src.stats.sunTypesCaught);
        if (Array.isArray(src.achievements)) state.achievements = src.achievements.slice();
        if (Array.isArray(src.seenHints)) state.seenHints = src.seenHints.slice();
        if (src.stats) Object.assign(state.stats, src.stats);

        // Altsaves ohne totalFPEarned: aus Skill-Ausgaben rekonstruieren
        if (!src.stats || src.stats.totalFPEarned === undefined) {
            let spent = 0;
            SKILLS_DB.forEach(s => {
                const lvl = state.skills[s.id] || 0;
                for (let i = 0; i < lvl; i++) spent += Math.floor(s.baseCost * Math.pow(s.costFactor, i));
            });
            state.stats.totalFPEarned = state.prestigeTokens + spent;
        }
    }

    function load() {
        try {
            const raw = localStorage.getItem(SAVE_KEY);
            if (!raw) return false;
            mergeState(JSON.parse(raw));
            return true;
        } catch (e) {
            emit('log', { msg: 'Spielstand beschaedigt, starte neu.', type: 'bad' });
            return false;
        }
    }

    function exportSave() {
        state.lastSeen = Date.now();
        return btoa(unescape(encodeURIComponent(JSON.stringify({ v: SAVE_VERSION, state: state }))));
    }

    function importSave(code) {
        try {
            const json = decodeURIComponent(escape(atob(code.trim())));
            const parsed = JSON.parse(json);
            if (!parsed || typeof parsed !== 'object') return false;
            mergeState(parsed);
            save();
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Loescht den Spielstand endgueltig. Reihenfolge ist wichtig:
     * erst alle Schreibwege abschalten, dann loeschen. Sonst
     * ueberschreibt ein Autosave oder der beforeunload-Handler des
     * folgenden Reloads den geloeschten Stand wieder.
     */
    function wipe() {
        saveDisabled = true;
        timers.forEach(id => clearInterval(id));
        timers.length = 0;
        if (unloadHandler) {
            window.removeEventListener('beforeunload', unloadHandler);
            unloadHandler = null;
        }
        try {
            localStorage.removeItem(SAVE_KEY);
            return true;
        } catch (e) {
            return false;
        }
    }

    /* ------------------------------------------------------------
       HILFSFUNKTION – auch von der UI genutzt
       ------------------------------------------------------------ */
    function formatNumber(num) {
        if (!isFinite(num)) return '∞';
        if (num < 1000) return Math.floor(num).toString();
        const units = ['k', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No'];
        let i = -1;
        let n = num;
        while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
        return n.toFixed(n < 10 ? 2 : 1) + units[i];
    }

    /* ------------------------------------------------------------
       INIT
       ------------------------------------------------------------ */
    function init() {
        const seedDefaults = () => {
            BUILDINGS_DB.forEach(b => { if (state.buildings[b.id] === undefined) state.buildings[b.id] = 0; });
            SKILLS_DB.forEach(s => { if (state.skills[s.id] === undefined) state.skills[s.id] = 0; });
            META_SKILLS_DB.forEach(s => { if (state.metaSkills[s.id] === undefined) state.metaSkills[s.id] = 0; });
            SUN_SKILLS_DB.forEach(s => { if (state.sunSkills[s.id] === undefined) state.sunSkills[s.id] = 0; });
        };

        seedDefaults();
        load();
        seedDefaults();

        const offline = applyOfflineProgress();

        timers.push(setInterval(tick, CONFIG.tickRate));
        timers.push(setInterval(save, CONFIG.autosaveInterval));
        timers.push(setInterval(eventLoop, 1000));
        timers.push(setInterval(sunLoop, 1000));
        timers.push(setInterval(checkHints, 2000));
        timers.push(setInterval(maybeKiComment, 45000));

        unloadHandler = save;
        window.addEventListener('beforeunload', unloadHandler);

        checkHints();
        return { offline: offline };
    }

    /* --- oeffentliche Schnittstelle --- */
    return {
        init: init,
        on: on,
        state: state,
        // Berechnungen
        getBuildingCost: getBuildingCost,
        getBulkCost: getBulkCost,
        getMaxAffordable: getMaxAffordable,
        getSkillCost: getSkillCost,
        getMetaSkillCost: getMetaSkillCost,
        getBaseEPS: getBaseEPS,
        getEPS: getEPS,
        getClickPower: getClickPower,
        getMultiplier: getMultiplier,
        getProductionBreakdown: getProductionBreakdown,
        getEra: getEra,
        getEraProgress: getEraProgress,
        calculatePendingFP: calculatePendingFP,
        calculatePendingMeta: calculatePendingMeta,
        isMetaUnlocked: isMetaUnlocked,
        getCurrentEvent: function () { return currentEvent; },
        getEventTimer: function () { return eventTimer; },
        getRepairProgress: function () { return repairProgress; },
        // Sonnen
        getSunSkillCost: getSunSkillCost,
        getSunLifetime: getSunLifetime,
        getSunSpawnChance: getSunSpawnChance,
        getUnlockedSunTypes: getUnlockedSunTypes,
        getActiveBuffs: getActiveBuffs,
        // Onboarding & Statistik
        getStats: getStats,
        formatDuration: formatDuration,
        dismissAllHints: dismissAllHints,
        resetHints: resetHints,
        // Aktionen
        doClick: doClick,
        buyBuilding: buyBuilding,
        buySkill: buySkill,
        buyMetaSkill: buyMetaSkill,
        buySunSkill: buySunSkill,
        doPrestige: doPrestige,
        doMetaPrestige: doMetaPrestige,
        claimSun: claimSun,
        repairClick: repairClick,
        // Persistenz
        save: save,
        exportSave: exportSave,
        importSave: importSave,
        wipe: wipe,
        // Utility
        formatNumber: formatNumber
    };
})();
