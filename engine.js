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
        buildings: {},
        skills: {},
        metaSkills: {},
        achievements: [],
        stats: {
            clicks: 0,
            sunsCaught: 0,
            repairs: 0,
            totalFPEarned: 0,
            metaEarned: 0,
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

    /** Kosten fuer n Stueck ab dem aktuellen Bestand. */
    function getBulkCost(id, amount) {
        const owned = state.buildings[id] || 0;
        let total = 0;
        for (let i = 0; i < amount; i++) total += getBuildingCost(id, owned + i);
        return total;
    }

    /** Wie viele Einheiten koennte man sich gerade leisten? */
    function getMaxAffordable(id) {
        const owned = state.buildings[id] || 0;
        let budget = state.energy;
        let n = 0;
        while (n < 1000) {
            const cost = getBuildingCost(id, owned + n);
            if (cost > budget) break;
            budget -= cost;
            n++;
        }
        return n;
    }

    function getCostDiscount() {
        if (currentEvent && currentEvent.discount) return 1 - currentEvent.discount;
        return 1;
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
        if (currentEvent && currentEvent.mult) mult *= currentEvent.mult;
        return mult;
    }

    function getClickPower() {
        const base = 1 + (getBaseEPS() * CONFIG.clickEpsShare);
        let mult = 1 + ((state.skills.click || 0) * 1.0);
        mult *= 1 + ((state.metaSkills.core_output || 0) * 0.50);
        if (currentEvent && currentEvent.mult) mult *= currentEvent.mult;
        return base * mult;
    }

    function getEPS() {
        return getBaseEPS() * getMultiplier();
    }

    function getEra() {
        const idx = Math.min(state.prestigeCount, ERAS.length - 1);
        return ERAS[idx];
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
        if (source !== 'auto') state.stats.clicks++;
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
        emit('era', era);
        emit('log', { msg: 'SYSTEM REBOOT! +' + pending + ' FP generiert.', type: 'good' });
        emit('log', { msg: 'Neue Aera: ' + era.name + ' – ' + era.subtitle, type: 'good' });
        save();
        return { fp: pending, era: era };
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

    function sunLoop() {
        let chance = CONFIG.sunBaseChance
            + ((state.skills.luck || 0) * CONFIG.sunLuckBonus)
            + (state.prestigeCount * CONFIG.sunEraBonus);
        if (Date.now() < sunBoostUntil) chance += CONFIG.sunOfflineBoost;
        if (Math.random() < chance) emit('spawnsun');
    }

    function claimSun() {
        const seconds = CONFIG.goldenSunBase + ((state.skills.goldengrid || 0) * CONFIG.goldenSunPerLevel);
        let reward = getEPS() * seconds;
        if (reward < CONFIG.goldenSunMin) reward = CONFIG.goldenSunMin;
        addEnergy(reward);
        state.stats.sunsCaught++;
        checkAchievements();
        emit('log', { msg: 'Verirrter Sonnenstrahl eingefangen! +' + formatNumber(reward) + ' Wh (' + seconds + ' s Produktion)', type: 'good' });
        return reward;
    }

    /* ------------------------------------------------------------
       HAUPT-LOOP
       ------------------------------------------------------------ */
    function tick() {
        const seconds = CONFIG.tickRate / 1000;
        addEnergy(getEPS() * seconds);

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
        state.prestigeCount = src.prestigeCount || 0;
        state.lastSeen = src.lastSeen || Date.now();
        state.startTime = src.startTime || Date.now();

        if (src.buildings) Object.assign(state.buildings, src.buildings);
        if (src.skills) Object.assign(state.skills, src.skills);
        if (src.metaSkills) Object.assign(state.metaSkills, src.metaSkills);
        if (Array.isArray(src.achievements)) state.achievements = src.achievements.slice();
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

    function wipe() {
        localStorage.removeItem(SAVE_KEY);
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
        BUILDINGS_DB.forEach(b => { if (state.buildings[b.id] === undefined) state.buildings[b.id] = 0; });
        SKILLS_DB.forEach(s => { if (state.skills[s.id] === undefined) state.skills[s.id] = 0; });
        META_SKILLS_DB.forEach(s => { if (state.metaSkills[s.id] === undefined) state.metaSkills[s.id] = 0; });

        load();

        // fehlende Keys nach dem Laden erneut absichern
        BUILDINGS_DB.forEach(b => { if (state.buildings[b.id] === undefined) state.buildings[b.id] = 0; });
        SKILLS_DB.forEach(s => { if (state.skills[s.id] === undefined) state.skills[s.id] = 0; });
        META_SKILLS_DB.forEach(s => { if (state.metaSkills[s.id] === undefined) state.metaSkills[s.id] = 0; });

        const offline = applyOfflineProgress();

        setInterval(tick, CONFIG.tickRate);
        setInterval(save, CONFIG.autosaveInterval);
        setInterval(eventLoop, 1000);
        setInterval(sunLoop, 1000);
        setInterval(maybeKiComment, 45000);
        window.addEventListener('beforeunload', save);

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
        calculatePendingFP: calculatePendingFP,
        calculatePendingMeta: calculatePendingMeta,
        isMetaUnlocked: isMetaUnlocked,
        getCurrentEvent: function () { return currentEvent; },
        getEventTimer: function () { return eventTimer; },
        getRepairProgress: function () { return repairProgress; },
        // Aktionen
        doClick: doClick,
        buyBuilding: buyBuilding,
        buySkill: buySkill,
        buyMetaSkill: buyMetaSkill,
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
