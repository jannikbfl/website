/* ============================================================
   Energy Grid Tycoon – ui.js
   Saemtliche DOM-Manipulation und Listener.
   Greift nur ueber die oeffentliche Engine-Schnittstelle zu.
   ============================================================ */

const UI = (function () {
    'use strict';

    const fmt = Engine.formatNumber;
    let buyAmount = 1;            // 1 | 10 | 100 | 'max'
    let breakdownOpen = false;
    const knownNodes = {};        // fuer die "neu"-Animation im Netz-Schema

    const $ = id => document.getElementById(id);

    /* ------------------------------------------------------------
       LOG & TOASTS
       ------------------------------------------------------------ */
    function log(msg, type) {
        const box = $('event-log');
        if (!box) return;
        const time = new Date().toLocaleTimeString('de-DE', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const colors = {
            good: 'text-emerald-400',
            bad: 'text-red-400',
            lore: 'text-slate-500 italic',
            npc: 'text-cyan-300',
            neutral: 'text-slate-400'
        };
        const cls = colors[type] || colors.neutral;
        const line = document.createElement('div');
        line.className = cls;
        line.textContent = '[' + time + '] ' + msg;
        box.appendChild(line);
        while (box.children.length > 120) box.removeChild(box.firstChild);
        box.scrollTop = box.scrollHeight;
    }

    function toast(title, text, icon, accent) {
        const stack = $('toast-stack');
        if (!stack) return;
        const el = document.createElement('div');
        el.className = 'toast bg-slate-800 border rounded-xl p-3 shadow-2xl flex gap-3 items-start max-w-xs ' +
            (accent === 'purple' ? 'border-purple-500/60' : 'border-amber-500/60');
        el.innerHTML =
            '<div class="h-8 w-8 shrink-0 ' + (accent === 'purple' ? 'text-purple-300' : 'text-amber-300') + '">' + (icon || '') + '</div>' +
            '<div><div class="text-sm font-bold text-white">' + title + '</div>' +
            '<div class="text-[11px] text-slate-400 leading-snug mt-0.5">' + (text || '') + '</div></div>';
        stack.appendChild(el);
        setTimeout(() => {
            el.classList.add('leaving');
            setTimeout(() => el.remove(), 400);
        }, 5000);
    }

    /* ------------------------------------------------------------
       RENDERING: GEBAEUDE
       ------------------------------------------------------------ */
    function renderBuildings() {
        let html = '';
        BUILDINGS_DB.forEach((b, i) => {
            const owned = Engine.state.buildings[b.id] || 0;
            const prevOwned = i === 0 ? 1 : (Engine.state.buildings[BUILDINGS_DB[i - 1].id] || 0);
            // Sichtbar, sobald das vorherige Tier steht – nie an die Aera gekoppelt,
            // sonst sieht man Hardware nicht, die man sich laengst leisten koennte.
            const locked = owned === 0 && prevOwned === 0;
            if (locked) {
                html +=
                    '<div class="w-full flex items-center gap-3 p-3 bg-slate-900/40 rounded-xl border border-slate-800 border-dashed opacity-60">' +
                    '<div class="h-8 w-8 text-slate-600">' + b.icon + '</div>' +
                    '<div class="text-xs text-slate-600 font-mono">??? – erst ' + BUILDINGS_DB[i - 1].name + ' bauen</div></div>';
                return;
            }
            html +=
                '<div class="w-full p-3 bg-slate-700/40 rounded-xl border border-slate-600 transition" data-building="' + b.id + '">' +
                  '<div class="flex items-start gap-3">' +
                    '<div class="h-9 w-9 shrink-0 text-cyan-400 mt-0.5">' + b.icon + '</div>' +
                    '<div class="flex-1 min-w-0">' +
                      '<div class="font-bold text-white text-sm">' + b.name + '</div>' +
                      '<div class="text-[10px] text-slate-400 leading-tight">' + b.desc + '</div>' +
                      '<div class="text-xs text-cyan-400 font-medium mt-1">+' + fmt(b.baseProd) + ' Wh/s pro Stueck</div>' +
                    '</div>' +
                    '<div class="text-right shrink-0 pl-2 border-l border-slate-600/50">' +
                      '<div class="text-[10px] text-slate-400">Besitz</div>' +
                      '<div class="text-white font-bold text-lg leading-none" id="count-' + b.id + '">0</div>' +
                    '</div>' +
                  '</div>' +
                  '<button id="btn-' + b.id + '" class="mt-2 w-full py-2 px-3 bg-slate-800 hover:bg-cyan-900/50 border border-slate-600 rounded-lg text-xs font-bold text-yellow-400 transition disabled:opacity-40 disabled:cursor-not-allowed flex justify-between items-center">' +
                    '<span id="label-' + b.id + '">Kaufen</span>' +
                    '<span id="cost-' + b.id + '">0</span>' +
                  '</button>' +
                '</div>';
        });
        $('buildings-container').innerHTML = html;

        BUILDINGS_DB.forEach(b => {
            const btn = $('btn-' + b.id);
            if (btn) btn.addEventListener('click', () => {
                const bought = Engine.buyBuilding(b.id, buyAmount);
                if (bought > 0) { updateAll(); renderGrid(); }
            });
        });
    }

    /* ------------------------------------------------------------
       RENDERING: SKILLS
       ------------------------------------------------------------ */
    function renderSkills() {
        let html = '';
        SKILLS_DB.forEach(s => {
            html +=
                '<button id="skill-btn-' + s.id + '" class="w-full flex justify-between items-center p-3 bg-purple-900/20 hover:bg-purple-900/40 rounded-xl transition border border-purple-900/50 disabled:opacity-40 disabled:cursor-not-allowed text-left">' +
                  '<div class="flex-1 min-w-0">' +
                    '<div class="font-bold text-purple-300 text-sm">' + s.name +
                      ' <span class="text-[10px] bg-purple-900 text-purple-200 px-1.5 py-0.5 rounded ml-1">Lvl <span id="skill-level-' + s.id + '">0</span></span></div>' +
                    '<div class="text-[10px] text-slate-400 leading-tight mt-1">' + s.desc + '</div>' +
                  '</div>' +
                  '<div class="text-right ml-2 bg-purple-900/50 px-2 py-1 rounded shrink-0">' +
                    '<div class="text-purple-300 font-bold text-xs"><span id="skill-cost-' + s.id + '">0</span> FP</div>' +
                  '</div>' +
                '</button>';
        });
        $('skills-container').innerHTML = html;
        SKILLS_DB.forEach(s => {
            const btn = $('skill-btn-' + s.id);
            if (btn) btn.addEventListener('click', () => { if (Engine.buySkill(s.id)) updateAll(); });
        });
    }

    function renderMetaSkills() {
        let html = '';
        META_SKILLS_DB.forEach(s => {
            html +=
                '<button id="meta-btn-' + s.id + '" class="w-full flex justify-between items-center p-3 bg-amber-900/20 hover:bg-amber-900/40 rounded-xl transition border border-amber-700/50 disabled:opacity-40 disabled:cursor-not-allowed text-left">' +
                  '<div class="flex-1 min-w-0">' +
                    '<div class="font-bold text-amber-300 text-sm">' + s.name +
                      ' <span class="text-[10px] bg-amber-900 text-amber-200 px-1.5 py-0.5 rounded ml-1">Lvl <span id="meta-level-' + s.id + '">0</span></span></div>' +
                    '<div class="text-[10px] text-slate-400 leading-tight mt-1">' + s.desc + '</div>' +
                  '</div>' +
                  '<div class="text-right ml-2 bg-amber-900/50 px-2 py-1 rounded shrink-0">' +
                    '<div class="text-amber-300 font-bold text-xs"><span id="meta-cost-' + s.id + '">0</span> DK</div>' +
                  '</div>' +
                '</button>';
        });
        $('meta-skills-container').innerHTML = html;
        META_SKILLS_DB.forEach(s => {
            const btn = $('meta-btn-' + s.id);
            if (btn) btn.addEventListener('click', () => { if (Engine.buyMetaSkill(s.id)) updateAll(); });
        });
    }

    /* ------------------------------------------------------------
       RENDERING: NETZ-SCHEMA
       Waechst mit der gebauten Hardware mit.
       ------------------------------------------------------------ */
    function renderGrid() {
        const box = $('grid-schematic');
        if (!box) return;

        const owned = BUILDINGS_DB.filter(b => (Engine.state.buildings[b.id] || 0) > 0);
        if (owned.length === 0) {
            box.innerHTML = '<div class="text-[10px] text-slate-600 font-mono py-4 text-center">Noch keine Hardware verbaut.</div>';
            return;
        }

        let nodes = '';
        owned.forEach((b, i) => {
            const isNew = !knownNodes[b.id];
            knownNodes[b.id] = true;
            nodes +=
                '<div class="grid-node' + (isNew ? ' is-new' : '') + ' flex flex-col items-center gap-1 shrink-0" title="' + b.name + '">' +
                  '<div class="h-7 w-7 text-cyan-300">' + b.icon + '</div>' +
                  '<div class="text-[9px] text-slate-500 font-mono">' + (Engine.state.buildings[b.id]) + 'x</div>' +
                '</div>';
            if (i < owned.length - 1) {
                nodes += '<svg class="h-4 w-6 shrink-0" viewBox="0 0 24 16"><line x1="0" y1="8" x2="24" y2="8" stroke="#22d3ee" stroke-width="2" class="grid-line-active" opacity="0.7"/></svg>';
            }
        });

        box.innerHTML = '<div class="flex items-center gap-1 overflow-x-auto py-2">' + nodes + '</div>';
    }

    /* ------------------------------------------------------------
       RENDERING: PRODUKTIONS-BREAKDOWN
       ------------------------------------------------------------ */
    function renderBreakdown() {
        const box = $('breakdown-body');
        if (!box || !breakdownOpen) return;
        const rows = Engine.getProductionBreakdown();
        if (rows.length === 0) {
            box.innerHTML = '<div class="text-[11px] text-slate-500 py-2">Noch keine Produktion.</div>';
            return;
        }
        let html = '';
        rows.forEach(r => {
            html +=
                '<div class="flex items-center gap-2 py-1">' +
                  '<div class="h-4 w-4 text-cyan-400 shrink-0">' + r.icon + '</div>' +
                  '<div class="flex-1 min-w-0">' +
                    '<div class="flex justify-between text-[11px]">' +
                      '<span class="text-slate-300 truncate">' + r.name + ' <span class="text-slate-500">x' + r.count + '</span></span>' +
                      '<span class="text-cyan-400 font-mono ml-2">' + fmt(r.output) + '</span>' +
                    '</div>' +
                    '<div class="h-1 bg-slate-700 rounded mt-1 overflow-hidden">' +
                      '<div class="h-full bg-cyan-500" style="width:' + r.share.toFixed(1) + '%"></div>' +
                    '</div>' +
                  '</div>' +
                  '<span class="text-[10px] text-slate-500 font-mono w-10 text-right shrink-0">' + r.share.toFixed(0) + '%</span>' +
                '</div>';
        });
        box.innerHTML = html;
    }

    /* ------------------------------------------------------------
       RENDERING: ACHIEVEMENTS
       ------------------------------------------------------------ */
    function renderAchievements() {
        const box = $('achievements-container');
        if (!box) return;
        let html = '';
        ACHIEVEMENTS.forEach(a => {
            const done = Engine.state.achievements.indexOf(a.id) !== -1;
            html +=
                '<div class="p-2.5 rounded-lg border ' + (done ? 'bg-emerald-900/15 border-emerald-800/50' : 'bg-slate-900/40 border-slate-800') + '">' +
                  '<div class="flex items-center gap-2">' +
                    '<span class="text-xs ' + (done ? 'text-emerald-400' : 'text-slate-600') + '">' + (done ? '✓' : '○') + '</span>' +
                    '<span class="text-xs font-bold ' + (done ? 'text-white' : 'text-slate-500') + '">' + (done ? a.name : '???') + '</span>' +
                  '</div>' +
                  '<div class="text-[10px] text-slate-500 mt-1 pl-5">' + a.desc + '</div>' +
                  (done ? '<div class="text-[10px] text-slate-400 italic mt-1 pl-5">' + a.lore + '</div>' : '') +
                '</div>';
        });
        const unlocked = Engine.state.achievements.length;
        $('achievement-count').textContent = unlocked + '/' + ACHIEVEMENTS.length;
        box.innerHTML = html;
    }

    /* ------------------------------------------------------------
       UPDATE-SCHLEIFE
       ------------------------------------------------------------ */
    function updateAll() {
        const st = Engine.state;
        const ev = Engine.getCurrentEvent();

        $('energy-display').textContent = fmt(st.energy);
        $('eps-display').textContent = fmt(Engine.getEPS());
        $('click-power-float').textContent = '+' + fmt(Engine.getClickPower());
        $('fp-display').textContent = fmt(st.prestigeTokens);
        $('fp-header-display').textContent = fmt(st.prestigeTokens);
        $('lifetime-energy-display').textContent = fmt(st.lifetimeEnergy);

        // Aera und Fortschritt zur naechsten
        const era = Engine.getEra();
        $('era-name').textContent = era.name;
        $('era-subtitle').textContent = era.subtitle;
        const prog = Engine.getEraProgress();
        const progBar = $('era-progress');
        const progText = $('era-progress-text');
        if (prog.next) {
            progBar.style.width = prog.pct.toFixed(1) + '%';
            progText.textContent = 'noch ' + fmt(prog.remaining) + ' FP bis ' + prog.next.name;
        } else {
            progBar.style.width = '100%';
            progText.textContent = 'letzte Aera erreicht';
        }

        // Event-Banner
        const alert = $('event-alert');
        const multDisplay = $('event-multiplier-display');
        const repairBox = $('repair-box');
        if (ev) {
            multDisplay.textContent = ev.discount ? '(-' + (ev.discount * 100) + '% Kosten)' : '(x' + ev.mult.toFixed(1) + ')';
            alert.textContent = 'EVENT: ' + ev.name + ' – noch ' + Engine.getEventTimer() + ' s';
            alert.className = 'absolute top-0 inset-x-0 text-slate-900 text-xs font-bold text-center py-1 transform transition-transform duration-300 z-20 ' +
                (ev.type === 'good' ? 'bg-emerald-400' : ev.type === 'critical' ? 'bg-red-500 text-white' : 'bg-amber-400');
            if (ev.repairClicks) {
                repairBox.classList.remove('hidden');
                $('repair-progress').textContent = Engine.getRepairProgress() + ' / ' + ev.repairClicks;
                $('repair-bar').style.width = Math.min(100, (Engine.getRepairProgress() / ev.repairClicks) * 100) + '%';
            } else {
                repairBox.classList.add('hidden');
            }
        } else {
            multDisplay.textContent = '';
            alert.classList.add('-translate-y-full');
            repairBox.classList.add('hidden');
        }
        if (ev) alert.classList.remove('-translate-y-full');

        // Prestige
        const pending = Engine.calculatePendingFP();
        $('pending-fp-display').textContent = fmt(pending);
        $('ascension-btn').disabled = pending <= 0;

        // Meta-Prestige
        const metaBox = $('meta-section');
        if (Engine.isMetaUnlocked()) {
            metaBox.classList.remove('hidden');
            const pendingMeta = Engine.calculatePendingMeta();
            $('dk-display').textContent = fmt(st.metaTokens);
            $('pending-dk-display').textContent = fmt(pendingMeta);
            $('meta-btn').disabled = pendingMeta <= 0;
        } else {
            metaBox.classList.add('hidden');
        }

        // Gebaeude-Buttons
        BUILDINGS_DB.forEach(b => {
            const btn = $('btn-' + b.id);
            if (!btn) return;
            const owned = st.buildings[b.id] || 0;
            let amount = buyAmount === 'max' ? Engine.getMaxAffordable(b.id) : buyAmount;
            if (buyAmount === 'max' && amount < 1) amount = 1;
            const cost = Engine.getBulkCost(b.id, amount);
            $('count-' + b.id).textContent = owned;
            $('cost-' + b.id).textContent = fmt(cost) + ' Wh';
            $('label-' + b.id).textContent = 'Kaufen x' + amount;
            btn.disabled = st.energy < cost;
        });

        // Skills
        SKILLS_DB.forEach(s => {
            const btn = $('skill-btn-' + s.id);
            if (!btn) return;
            const lvl = st.skills[s.id] || 0;
            const maxed = s.maxLevel && lvl >= s.maxLevel;
            const cost = Engine.getSkillCost(s.id, lvl);
            $('skill-level-' + s.id).textContent = lvl;
            $('skill-cost-' + s.id).textContent = maxed ? 'MAX' : fmt(cost);
            btn.disabled = maxed || st.prestigeTokens < cost;
        });

        META_SKILLS_DB.forEach(s => {
            const btn = $('meta-btn-' + s.id);
            if (!btn) return;
            const lvl = st.metaSkills[s.id] || 0;
            const maxed = s.maxLevel && lvl >= s.maxLevel;
            const cost = Engine.getMetaSkillCost(s.id, lvl);
            $('meta-level-' + s.id).textContent = lvl;
            $('meta-cost-' + s.id).textContent = maxed ? 'MAX' : fmt(cost);
            btn.disabled = maxed || st.metaTokens < cost;
        });

        // Sonnenfragmente
        $('shard-display').textContent = fmt(st.shards);
        $('sf-header-display').textContent = fmt(st.shards);

        // Solar-Buttons nur bei Aenderung neu bewerten (kein Re-Render pro Tick)
        SUN_SKILLS_DB.forEach(s => {
            const btn = $('sun-btn-' + s.id);
            if (!btn) return;
            const lvl = st.sunSkills[s.id] || 0;
            const maxed = s.maxLevel && lvl >= s.maxLevel;
            btn.disabled = maxed || st.shards < Engine.getSunSkillCost(s.id, lvl);
        });

        renderBuffs();
        renderBreakdown();
    }

    /* ------------------------------------------------------------
       KLICK-FEEDBACK
       ------------------------------------------------------------ */
    function spawnFloater(x, y, text) {
        const el = document.createElement('div');
        el.className = 'floating-text';
        el.textContent = text;
        el.style.left = (x + (Math.random() - 0.5) * 50) + 'px';
        el.style.top = (y + (Math.random() - 0.5) * 30) + 'px';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 800);
    }

    /* ------------------------------------------------------------
       ONBOARDING-HINWEISE
       ------------------------------------------------------------ */
    function showHint(hint) {
        const box = $('hint-box');
        if (!box) return;
        $('hint-title').textContent = hint.title;
        $('hint-text').textContent = hint.text;
        box.classList.remove('hidden');
        box.classList.add('flex');
    }

    function hideHint() {
        const box = $('hint-box');
        box.classList.add('hidden');
        box.classList.remove('flex');
    }

    /* ------------------------------------------------------------
       STATISTIKEN
       ------------------------------------------------------------ */
    function renderStats() {
        const s = Engine.getStats();
        const row = (label, value, accent) =>
            '<div class="flex justify-between items-baseline py-1.5 border-b border-slate-800">' +
            '<span class="text-[11px] text-slate-400">' + label + '</span>' +
            '<span class="text-xs font-mono font-bold ' + (accent || 'text-white') + '">' + value + '</span></div>';

        let html = '';

        html += '<h4 class="text-[10px] uppercase tracking-widest text-slate-500 font-bold mt-1 mb-1">Allgemein</h4>';
        html += row('Spielzeit', Engine.formatDuration(s.playTimeMs));
        html += row('Aktuelle Aera', s.era.name, 'text-cyan-300');
        html += row('Erfolge', s.achievements + ' / ' + s.achievementsTotal, 'text-emerald-400');
        html += row('Skill-Level gesamt', s.skillLevels);

        html += '<h4 class="text-[10px] uppercase tracking-widest text-slate-500 font-bold mt-4 mb-1">Produktion</h4>';
        html += row('Gesamtenergie', fmt(s.lifetimeEnergy) + ' Wh', 'text-yellow-400');
        html += row('Aktuelle Produktion', fmt(s.currentEPS) + ' Wh/s', 'text-emerald-400');
        html += row('Bestwert Produktion', fmt(s.bestEPS) + ' Wh/s', 'text-emerald-400');
        html += row('Hardware im Besitz', fmt(s.buildingsOwned));
        html += row('Hardware je gekauft', fmt(s.buildingsBought));

        html += '<h4 class="text-[10px] uppercase tracking-widest text-slate-500 font-bold mt-4 mb-1">Handarbeit</h4>';
        html += row('Klicks', fmt(s.clicks));
        html += row('Davon erzeugt', fmt(s.energyClicked) + ' Wh');
        html += row('Anteil an Gesamtenergie',
            s.lifetimeEnergy > 0 ? ((s.energyClicked / s.lifetimeEnergy) * 100).toFixed(1) + ' %' : '0 %');

        html += '<h4 class="text-[10px] uppercase tracking-widest text-slate-500 font-bold mt-4 mb-1">Sonnen</h4>';
        html += row('Gefangen gesamt', fmt(s.sunsCaught), 'text-yellow-300');
        html += row('Fragmente verdient', fmt(s.shardsEarned), 'text-yellow-300');
        s.sunRows.forEach(r => {
            html += '<div class="flex justify-between items-baseline py-1 pl-3 border-b border-slate-800/60">' +
                '<span class="text-[11px] ' + (r.unlocked ? r.color : 'text-slate-600') + '">● ' +
                (r.unlocked ? r.name : 'noch gesperrt') + '</span>' +
                '<span class="text-xs font-mono ' + (r.unlocked ? 'text-slate-300' : 'text-slate-600') + '">' + r.count + '</span></div>';
        });

        html += '<h4 class="text-[10px] uppercase tracking-widest text-slate-500 font-bold mt-4 mb-1">Prestige & Ereignisse</h4>';
        html += row('System-Reboots', fmt(s.prestigeCount), 'text-purple-300');
        html += row('Forschungspunkte verdient', fmt(s.totalFPEarned), 'text-purple-300');
        html += row('Dyson-Kerne verdient', fmt(s.metaEarned), 'text-amber-300');
        html += row('Events erlebt', fmt(s.eventsSeen));
        html += row('Systeme repariert', fmt(s.repairs), 'text-red-300');

        $('stats-container').innerHTML = html;
    }

    let sunCounter = 0;

    function spawnGoldenSun(payload) {
        const type = (payload && payload.type) || SUN_TYPES[0];
        const lifetime = (payload && payload.lifetime) || CONFIG.goldenSunLifetime;

        // Mehrere Sonnen gleichzeitig sind durch die Ketten-Reaktion moeglich
        if (document.querySelectorAll('.golden-sun').length >= 3) return;

        const sun = document.createElement('button');
        sun.id = 'sun-' + (++sunCounter);
        sun.className = 'golden-sun ' + type.color;
        sun.style.setProperty('--sun-glow', type.glow);
        sun.setAttribute('aria-label', type.name + ' einfangen');
        sun.title = type.name + ' – ' + type.desc;
        sun.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">' +
            '<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" /></svg>';
        sun.style.left = Math.random() * Math.max(40, window.innerWidth - 90) + 'px';
        sun.style.top = Math.random() * Math.max(40, window.innerHeight - 90) + 'px';

        // Verbleibende Sichtdauer als schrumpfender Ring
        const ring = document.createElement('span');
        ring.className = 'sun-timer';
        ring.style.animationDuration = lifetime + 'ms';
        sun.appendChild(ring);

        sun.addEventListener('click', e => {
            const res = Engine.claimSun(type.id);
            if (res.energy > 0) spawnFloater(e.clientX, e.clientY, '+' + fmt(res.energy));
            else spawnFloater(e.clientX, e.clientY, res.type.name);
            spawnFloater(e.clientX, e.clientY + 26, '+' + res.shards + ' SF');
            sun.remove();
            renderSunSkills();
            updateAll();
        });

        document.body.appendChild(sun);
        setTimeout(() => { if (sun.parentNode) sun.remove(); }, lifetime);
    }

    /* ------------------------------------------------------------
       SOLAR-ZWEIG
       ------------------------------------------------------------ */
    function renderSunSkills() {
        const box = $('sun-skills-container');
        if (!box) return;
        let html = '';
        SUN_SKILLS_DB.forEach(s => {
            const lvl = Engine.state.sunSkills[s.id] || 0;
            const maxed = s.maxLevel && lvl >= s.maxLevel;
            const isUnlock = s.maxLevel === 1;
            const cost = Engine.getSunSkillCost(s.id, lvl);
            html +=
                '<button id="sun-btn-' + s.id + '" class="w-full flex justify-between items-center p-3 rounded-xl transition border text-left disabled:opacity-40 disabled:cursor-not-allowed ' +
                  (isUnlock ? 'bg-fuchsia-900/20 hover:bg-fuchsia-900/40 border-fuchsia-700/50' : 'bg-yellow-900/15 hover:bg-yellow-900/30 border-yellow-700/40') + '">' +
                  '<div class="flex-1 min-w-0">' +
                    '<div class="font-bold text-sm ' + (isUnlock ? 'text-fuchsia-300' : 'text-yellow-300') + '">' + s.name +
                      (isUnlock
                        ? (maxed ? ' <span class="text-[10px] bg-fuchsia-900 text-fuchsia-200 px-1.5 py-0.5 rounded ml-1">AKTIV</span>' : '')
                        : ' <span class="text-[10px] bg-yellow-900 text-yellow-200 px-1.5 py-0.5 rounded ml-1">Lvl ' + lvl + '</span>') +
                    '</div>' +
                    '<div class="text-[10px] text-slate-400 leading-tight mt-1">' + s.desc + '</div>' +
                  '</div>' +
                  '<div class="text-right ml-2 px-2 py-1 rounded shrink-0 ' + (isUnlock ? 'bg-fuchsia-900/50' : 'bg-yellow-900/40') + '">' +
                    '<div class="font-bold text-xs ' + (isUnlock ? 'text-fuchsia-300' : 'text-yellow-300') + '">' +
                      (maxed ? 'MAX' : fmt(cost) + ' SF') + '</div>' +
                  '</div>' +
                '</button>';
        });
        box.innerHTML = html;

        SUN_SKILLS_DB.forEach(s => {
            const btn = $('sun-btn-' + s.id);
            if (!btn) return;
            const lvl = Engine.state.sunSkills[s.id] || 0;
            const maxed = s.maxLevel && lvl >= s.maxLevel;
            btn.disabled = maxed || Engine.state.shards < Engine.getSunSkillCost(s.id, lvl);
            if (!maxed) btn.addEventListener('click', () => {
                if (Engine.buySunSkill(s.id)) { renderSunSkills(); updateAll(); }
            });
        });

        // Freigeschaltete Sonnen-Typen als Legende
        const legend = $('sun-legend');
        if (legend) {
            const types = Engine.getUnlockedSunTypes();
            legend.innerHTML = types.map(t =>
                '<span class="inline-flex items-center gap-1 text-[10px] ' + t.color + ' bg-slate-900/60 border border-slate-700 rounded-full px-2 py-0.5" title="' + t.desc + '">● ' + t.name + '</span>'
            ).join(' ');
        }
    }

    /* ------------------------------------------------------------
       AKTIVE BUFFS
       ------------------------------------------------------------ */
    function renderBuffs() {
        const box = $('buff-bar');
        if (!box) return;
        const buffs = Engine.getActiveBuffs();
        if (buffs.length === 0) { box.innerHTML = ''; box.classList.add('hidden'); return; }
        box.classList.remove('hidden');
        box.innerHTML = buffs.map(b => {
            const label = b.kind === 'discount'
                ? '-' + Math.round(b.discount * 100) + '% Kosten'
                : 'x' + fmt(b.mult) + (b.kind === 'click' ? ' Klick' : ' Prod.');
            return '<div class="flex items-center gap-1.5 bg-slate-900/80 border border-yellow-600/50 rounded-full px-2.5 py-1">' +
                   '<span class="text-[10px] font-bold text-yellow-300">' + b.name + '</span>' +
                   '<span class="text-[10px] text-slate-400">' + label + '</span>' +
                   '<span class="text-[10px] font-mono text-slate-500">' + b.remaining + 's</span></div>';
        }).join('');
    }

    /* ------------------------------------------------------------
       MOBILE TABS
       ------------------------------------------------------------ */
    function setTab(name) {
        ['core', 'hardware', 'research'].forEach(t => {
            const panel = $('panel-' + t);
            const btn = $('tab-' + t);
            if (!panel || !btn) return;
            const active = t === name;
            panel.classList.toggle('hidden', !active);
            panel.classList.toggle('lg:flex', true);
            btn.className = 'flex-1 py-2 text-xs font-bold rounded-lg transition ' +
                (active ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white');
        });
    }

    function applyResponsiveTabs() {
        const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
        ['core', 'hardware', 'research'].forEach(t => {
            const panel = $('panel-' + t);
            if (panel && isDesktop) panel.classList.remove('hidden');
        });
        if (!isDesktop) setTab(currentTab);
    }

    let currentTab = 'core';

    /* ------------------------------------------------------------
       MODALS
       ------------------------------------------------------------ */
    function showModal(title, bodyHtml) {
        $('modal-title').textContent = title;
        $('modal-body').innerHTML = bodyHtml;
        $('modal').classList.remove('hidden');
        $('modal').classList.add('flex');
    }
    function hideModal() {
        $('modal').classList.add('hidden');
        $('modal').classList.remove('flex');
    }

    /* ------------------------------------------------------------
       LISTENER
       ------------------------------------------------------------ */
    function bindListeners() {
        // Haupt-Klick
        $('click-btn').addEventListener('click', e => {
            const ev = Engine.getCurrentEvent();
            if (ev && ev.repairClicks) {
                const rep = Engine.repairClick();
                spawnFloater(e.clientX, e.clientY, 'REPAIR ' + rep.progress + '/' + rep.needed);
                updateAll();
                return;
            }
            const val = Engine.doClick();
            spawnFloater(e.clientX, e.clientY, '+' + fmt(val));
            const btn = e.currentTarget;
            btn.style.transform = 'scale(0.95)';
            setTimeout(() => btn.style.transform = '', 100);
            updateAll();
        });

        // Kaufmenge
        document.querySelectorAll('[data-buy]').forEach(btn => {
            btn.addEventListener('click', () => {
                const v = btn.getAttribute('data-buy');
                buyAmount = v === 'max' ? 'max' : parseInt(v, 10);
                document.querySelectorAll('[data-buy]').forEach(b => {
                    const active = b === btn;
                    b.className = 'flex-1 py-1.5 text-[11px] font-bold rounded-md transition ' +
                        (active ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600');
                });
                updateAll();
            });
        });

        // Breakdown auf/zu
        $('breakdown-toggle').addEventListener('click', () => {
            breakdownOpen = !breakdownOpen;
            $('breakdown-body').classList.toggle('hidden', !breakdownOpen);
            $('breakdown-caret').textContent = breakdownOpen ? '▾' : '▸';
            renderBreakdown();
        });

        // Prestige
        $('ascension-btn').addEventListener('click', () => {
            const pending = Engine.calculatePendingFP();
            if (pending <= 0) return;
            if (!confirm('System-Reboot durchfuehren?\nDu verlierst Energie und Hardware, erhaeltst aber ' + pending + ' Forschungspunkte.')) return;
            const res = Engine.doPrestige();
            if (res) {
                renderBuildings();
                renderGrid();
                updateAll();
                if (res.eraChanged) {
                    showModal('Aera ' + res.era.level + ': ' + res.era.name,
                        '<p class="text-slate-300 text-sm leading-relaxed">' + res.era.story + '</p>' +
                        '<p class="text-purple-300 text-sm font-bold mt-4">+' + res.fp + ' Forschungspunkte</p>');
                }
            }
        });

        // Meta-Prestige
        $('meta-btn').addEventListener('click', () => {
            const pending = Engine.calculatePendingMeta();
            if (pending <= 0) return;
            if (!confirm('DYSON-KOLLAPS?\nAlles inkl. Forschungspunkten wird zurueckgesetzt. Du erhaeltst ' + pending + ' Dyson-Kerne, die dauerhaft bleiben.')) return;
            const res = Engine.doMetaPrestige();
            if (res) {
                renderBuildings();
                renderMetaSkills();
                renderGrid();
                updateAll();
                showModal('Dyson-Kollaps',
                    '<p class="text-slate-300 text-sm leading-relaxed">Der Schwarm faltet sich zusammen und presst die gesammelte Erfahrung in ' + res.dk + ' Dyson-Kerne. Das Netz startet bei null – aber die Kerne bleiben.</p>');
            }
        });

        // Speichern / Wipe / Export / Import
        $('save-btn').addEventListener('click', () => {
            if (Engine.save()) log('Spiel manuell gespeichert.', 'good');
        });

        $('reset-btn').addEventListener('click', () => {
            if (!confirm('ACHTUNG! Dies loescht den gesamten Spielstand inkl. Forschungspunkten, Sonnenfragmenten und Dyson-Kernen unwiderruflich! Sicher?')) return;
            const ok = Engine.wipe();
            if (!ok) {
                alert('Der Spielstand konnte nicht geloescht werden. Moeglicherweise blockiert dein Browser den lokalen Speicher.');
                return;
            }
            // Cache-Buster, damit der Reload garantiert frisch startet
            window.location.replace(window.location.pathname + '?wiped=' + Date.now());
        });

        $('export-btn').addEventListener('click', () => {
            const code = Engine.exportSave();
            if (navigator.clipboard) {
                navigator.clipboard.writeText(code).then(
                    () => { log('Save-Code in die Zwischenablage kopiert.', 'good'); showModal('Save-Code', '<textarea readonly class="w-full h-32 bg-slate-900 border border-slate-700 rounded p-2 text-[10px] font-mono text-slate-300">' + code + '</textarea><p class="text-[11px] text-slate-500 mt-2">Der Code liegt bereits in deiner Zwischenablage.</p>'); },
                    () => showModal('Save-Code', '<textarea readonly class="w-full h-32 bg-slate-900 border border-slate-700 rounded p-2 text-[10px] font-mono text-slate-300">' + code + '</textarea>')
                );
            } else {
                showModal('Save-Code', '<textarea readonly class="w-full h-32 bg-slate-900 border border-slate-700 rounded p-2 text-[10px] font-mono text-slate-300">' + code + '</textarea>');
            }
        });

        $('import-btn').addEventListener('click', () => {
            const code = prompt('Bitte fuege hier deinen kopierten Save-Code ein:');
            if (!code) return;
            if (Engine.importSave(code)) location.reload();
            else alert('Der Code ist fehlerhaft oder unvollstaendig.');
        });

        // Onboarding-Hinweise
        $('hint-ok').addEventListener('click', hideHint);
        $('hint-off').addEventListener('click', () => {
            Engine.dismissAllHints();
            hideHint();
            log('Hinweise deaktiviert. Ueber die Statistik wieder einschaltbar.', 'neutral');
        });

        // Statistik-Panel
        $('stats-toggle').addEventListener('click', () => {
            renderStats();
            $('stats-panel').classList.toggle('hidden');
        });
        $('stats-close').addEventListener('click', () => $('stats-panel').classList.add('hidden'));
        $('hints-reset').addEventListener('click', () => {
            Engine.resetHints();
            log('Hinweise wieder aktiviert.', 'good');
        });

        // Achievements-Panel
        $('achievements-toggle').addEventListener('click', () => {
            renderAchievements();
            $('achievements-panel').classList.toggle('hidden');
        });

        // Modal
        $('modal-close').addEventListener('click', hideModal);
        $('modal').addEventListener('click', e => { if (e.target === $('modal')) hideModal(); });

        // Tabs
        ['core', 'hardware', 'research'].forEach(t => {
            $('tab-' + t).addEventListener('click', () => { currentTab = t; setTab(t); });
        });
        window.addEventListener('resize', applyResponsiveTabs);
    }

    /* ------------------------------------------------------------
       ENGINE-EVENTS
       ------------------------------------------------------------ */
    function bindEngineEvents() {
        Engine.on('tick', updateAll);
        Engine.on('log', d => log(d.msg, d.type));
        Engine.on('milestone', d => toast(d.title, d.text, d.icon, 'amber'));
        Engine.on('achievement', a => {
            toast('Erfolg: ' + a.name, a.lore, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l2.4 5.3 5.6.6-4.2 3.9 1.2 5.7L12 15.8 6.9 18.5l1.2-5.7L4 8.9l5.6-.6z"/></svg>', 'purple');
            log('Erfolg freigeschaltet: ' + a.name, 'good');
            renderAchievements();
        });
        Engine.on('spawnsun', spawnGoldenSun);
        Engine.on('buffs', renderBuffs);
        Engine.on('hint', showHint);
        Engine.on('gridchange', renderGrid);
        Engine.on('era', () => { renderBuildings(); renderGrid(); });
    }

    /* ------------------------------------------------------------
       INIT
       ------------------------------------------------------------ */
    function init() {
        bindEngineEvents();
        const res = Engine.init();

        renderBuildings();
        renderSkills();
        renderMetaSkills();
        renderSunSkills();
        renderGrid();
        renderAchievements();
        bindListeners();
        applyResponsiveTabs();
        updateAll();

        log('System initialisiert.', 'neutral');

        if (res && res.offline) {
            const o = res.offline;
            showModal('Willkommen zurueck',
                '<p class="text-slate-300 text-sm leading-relaxed">Dein Netz hat waehrend deiner Abwesenheit weitergearbeitet.</p>' +
                '<p class="text-emerald-400 text-lg font-bold mt-3">+' + fmt(o.gained) + ' Wh</p>' +
                '<p class="text-[11px] text-slate-500 mt-1">' + o.minutes + ' Minuten angerechnet' +
                (o.capped ? ' (Limit erreicht – hoehere Offline-Level speichern laenger).' : '.') + '</p>');
            log('Offline-Ertrag: +' + fmt(o.gained) + ' Wh', 'good');
        }
    }

    return { init: init };
})();

document.addEventListener('DOMContentLoaded', UI.init);
