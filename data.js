/* ============================================================
   Energy Grid Tycoon – data.js
   Reine Datenstrukturen. Keine Logik, keine DOM-Zugriffe.
   Neue Inhalte werden ausschliesslich hier ergaenzt.
   ============================================================ */

/* ------------------------------------------------------------
   ICONS – eigenes SVG pro Hardware-Typ, damit die Liste beim
   Scrollen visuell unterscheidbar bleibt.
   ------------------------------------------------------------ */
const ICONS = {
    panel: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="11" rx="1"/><path d="M3 9h18M3 12.5h18M9 5v11M15 5v11"/><path d="M12 16v3M8 19h8"/></svg>`,
    inverter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8l3-3 3 3M9 16l3 3 3-3"/><path d="M8.5 12h7"/></svg>`,
    smartmeter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 12l4-3"/><path d="M12 3v2M21 12h-2M12 21v-2M3 12h2"/></svg>`,
    battery: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="16" height="12" rx="2"/><path d="M21 10v4"/><path d="M6.5 9v6M10 9v6M13.5 9v6"/></svg>`,
    fpga: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="1"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/></svg>`,
    riscv: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h4a2 2 0 010 4H9zM9 13l4 4M9 9v8"/></svg>`,
    trading: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-6 4 4 5-8"/><path d="M17 7h4v4"/><path d="M3 21h18"/></svg>`,
    vpp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.5"/><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M6.7 7.3l3.6 3.6M17.3 7.3l-3.6 3.6M6.7 16.7l3.6-3.6M17.3 16.7l-3.6-3.6"/></svg>`,
    fusion: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(120 12 12)"/></svg>`,
    dyson: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/><path d="M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"/><circle cx="12" cy="12" r="9" stroke-dasharray="2 3"/></svg>`
};

/* ------------------------------------------------------------
   GEBAEUDE
   costFactor variiert bewusst pro Tier: fruehe Hardware skaliert
   flacher (schnelles Anfangs-Pacing), spaete Hardware steiler
   (laengere Zielkurve im Endgame).
   ------------------------------------------------------------ */
const BUILDINGS_DB = [
    {
        id: 'panel', name: 'Balkon-Panel', icon: ICONS.panel,
        desc: 'Grundlegendes Solar-Panel fuer den Balkon.',
        baseCost: 15, baseProd: 1, costFactor: 1.12, era: 0,
        flavor: 'Zwei Schrauben, ein Kabel, viel Hoffnung.'
    },
    {
        id: 'inverter', name: 'Wechselrichter', icon: ICONS.inverter,
        desc: 'Verbessert die Einspeisung ins Heimnetz.',
        baseCost: 150, baseProd: 8, costFactor: 1.13, era: 0,
        flavor: 'Gleichstrom rein, Wechselstrom raus. Endlich zaehlt der Zaehler rueckwaerts.'
    },
    {
        id: 'smartmeter', name: 'Smart Meter API', icon: ICONS.smartmeter,
        desc: 'Automatisierte Auslesung & Last-Verteilung.',
        baseCost: 1800, baseProd: 60, costFactor: 1.14, era: 1,
        flavor: 'Der Zaehler spricht jetzt JSON. Der Netzbetreiber findet das mittelspannend.'
    },
    {
        id: 'battery', name: 'Heimspeicher-Rack', icon: ICONS.battery,
        desc: 'LiFePO4 Speicher puffert die Produktion.',
        baseCost: 24000, baseProd: 500, costFactor: 1.15, era: 1,
        flavor: 'Sonne von mittags, Kaffee um Mitternacht.'
    },
    {
        id: 'fpga', name: 'FPGA Grid-Steuerung', icon: ICONS.fpga,
        desc: 'Hardware-nahe Echtzeit-Steuerung des Netzes.',
        baseCost: 350000, baseProd: 4500, costFactor: 1.16, era: 2,
        flavor: 'Ab hier reagiert das Netz schneller, als du blinzeln kannst.'
    },
    {
        id: 'riscv', name: 'RISC-V Coprozessor', icon: ICONS.riscv,
        desc: 'KI-gestuetzte Vorhersage der Sonnenzyklen.',
        baseCost: 5000000, baseProd: 40000, costFactor: 1.17, era: 2,
        flavor: 'Offene Architektur, geschlossener Regelkreis.'
    },
    {
        id: 'trading', name: 'Python Stromhandel', icon: ICONS.trading,
        desc: 'Automatisierter Hochfrequenzhandel an der Stromboerse.',
        baseCost: 75000000, baseProd: 350000, costFactor: 1.18, era: 3,
        flavor: 'Der Bot kauft nachts billig und verkauft mittags teuer. Du schlaefst.'
    },
    {
        id: 'vpp', name: 'Virtuelles Kraftwerk', icon: ICONS.vpp,
        desc: 'Buendelt tausende Heimspeicher zu einem Schwarm.',
        baseCost: 1200000000, baseProd: 2800000, costFactor: 1.19, era: 3,
        flavor: 'Kein einziges Kraftwerk gebaut – und trotzdem eins.'
    },
    {
        id: 'fusion', name: 'Fusions-Testreaktor', icon: ICONS.fusion,
        desc: 'Experimenteller Reaktor im ehemaligen Gartenhaus.',
        baseCost: 20000000000, baseProd: 24000000, costFactor: 1.20, era: 4,
        flavor: 'Die Baugenehmigung war ueberraschend unkompliziert.'
    },
    {
        id: 'dyson', name: 'Dyson-Schwarm', icon: ICONS.dyson,
        desc: 'Satelliten-Netzwerk im Sonnenorbit.',
        baseCost: 400000000000, baseProd: 210000000, costFactor: 1.22, era: 5,
        flavor: 'Es fing mit einem Balkon-Panel an.'
    }
];

/* ------------------------------------------------------------
   SKILLS (Forschungspunkte / FP)
   ------------------------------------------------------------ */
const SKILLS_DB = [
    {
        id: 'click', name: 'Hyper-Klicks',
        desc: '+100% Klick-Staerke pro Level.',
        costFactor: 1.5, baseCost: 1, maxLevel: 25
    },
    {
        id: 'passive', name: 'Netz-Effizienz',
        desc: '+20% passive Gesamtproduktion pro Level.',
        costFactor: 2.0, baseCost: 2, maxLevel: 25
    },
    {
        id: 'luck', name: 'Quanten-Glueck',
        desc: 'Gute Events & Mini-Games tauchen oefter auf.',
        costFactor: 3.0, baseCost: 3, maxLevel: 15
    },
    {
        id: 'offline', name: 'Offline-Produktion',
        desc: '+2 h Ertrag bei geschlossenem Tab pro Level (50% Rate).',
        costFactor: 2.5, baseCost: 4, maxLevel: 12
    },
    {
        id: 'autoclick', name: 'Auto-Klicker',
        desc: 'Simuliert 1 Klick pro Sekunde pro Level.',
        costFactor: 2.2, baseCost: 5, maxLevel: 20
    },
    {
        id: 'goldengrid', name: 'Golden Grid',
        desc: 'Goldene Sonnen geben +30 s Produktion extra pro Level.',
        costFactor: 2.8, baseCost: 6, maxLevel: 10
    }
];

/* ------------------------------------------------------------
   META-SKILLS (Dyson-Kerne / DK – zweite Prestige-Ebene)
   ------------------------------------------------------------ */
const META_SKILLS_DB = [
    {
        id: 'core_output', name: 'Kern-Resonanz',
        desc: '+50% Gesamtproduktion pro Level. Ueberdauert jeden Reboot.',
        costFactor: 1.8, baseCost: 1, maxLevel: 20
    },
    {
        id: 'core_research', name: 'Forschungs-Katalysator',
        desc: '+25% Forschungspunkte pro Reboot und Level.',
        costFactor: 2.0, baseCost: 2, maxLevel: 15
    },
    {
        id: 'core_start', name: 'Notfall-Backup',
        desc: 'Startet nach jedem Reboot mit 10 Balkon-Panels pro Level.',
        costFactor: 2.5, baseCost: 2, maxLevel: 10
    }
];

/* ------------------------------------------------------------
   AEREN – an die Anzahl der System-Reboots gekoppelt.
   Gibt dem Prestige einen erzaehlerischen Rahmen.
   ------------------------------------------------------------ */
const ERAS = [
    {
        level: 0, name: 'Balkon-Bastler',
        subtitle: 'Ein Panel, ein Kabel, eine Idee.',
        story: 'Du haengst dein erstes Panel ans Balkongelaender. Der Hausverwalter hat nichts gesagt, also gilt das als Genehmigung.'
    },
    {
        level: 1, name: 'Kleinunternehmer',
        subtitle: 'Aus dem Hobby wird eine Rechnung.',
        story: 'Der erste Reboot hat dich Hardware gekostet, aber Wissen gebracht. Du meldest ein Kleingewerbe an – und der Nachbar fragt zum ersten Mal nach Preisen statt nach Beschwerdeformularen.'
    },
    {
        level: 2, name: 'Regionaler Netzbetreiber',
        subtitle: 'Die Strasse haengt an dir.',
        story: 'Vierzehn Haushalte, ein Speicherkeller, eine Steuerungssoftware, die du selbst geschrieben hast. Der Netzbetreiber lockt dich mit einem Kooperationsvertrag.'
    },
    {
        level: 3, name: 'Netz-Architekt',
        subtitle: 'Der Algorithmus handelt schneller als du denkst.',
        story: 'Deine Handelsbots bewegen Lasten zwischen Umspannwerken. Irgendwo in einem Rechenzentrum meldet sich eine Steuerungs-KI zum ersten Mal von selbst zu Wort.'
    },
    {
        level: 4, name: 'Fusions-Pionier',
        subtitle: 'Das Gartenhaus ist jetzt ein Forschungsreaktor.',
        story: 'Was als Balkonprojekt begann, verbraucht inzwischen mehr Kuehlwasser als der lokale Schwimmverein. Niemand fragt mehr, ob das erlaubt ist.'
    },
    {
        level: 5, name: 'Schwarm-Operator',
        subtitle: 'Die Sonne ist jetzt Infrastruktur.',
        story: 'Der erste Satellitenring steht. Von hier oben sieht dein alter Balkon aus wie ein Pixel – und produziert noch immer.'
    },
    {
        level: 6, name: 'Stellarer Verwalter',
        subtitle: 'Es gibt nichts mehr zu erweitern. Nur zu optimieren.',
        story: 'Der Schwarm ist geschlossen. Du verwaltest ein Energiesystem, das laenger laufen wird als du. Ein neuer Zyklus beginnt trotzdem.'
    }
];

/* ------------------------------------------------------------
   EVENTS – mit kurzen Lore-Texten statt reiner Zahlenaenderung.
   ------------------------------------------------------------ */
const EVENTS = [
    {
        id: 'clouds', name: 'Wolkig', type: 'bad', mult: 0.5, duration: 20,
        msg: 'Eine dichte Wolkendecke zieht auf. Produktion halbiert!',
        lore: 'Wetterdienst Haan: "Ganztaegig bedeckt." Deine Panels sind anderer Meinung, aber die Physik gewinnt.'
    },
    {
        id: 'flare', name: 'Sonneneruption', type: 'good', mult: 2.5, duration: 15,
        msg: 'Starke Sonneneruption! Leitungen gluehen: +150% Produktion!',
        lore: 'Ein Koronaler Massenauswurf trifft die Atmosphaere. Deine Wechselrichter singen ein hohes C.'
    },
    {
        id: 'firmware', name: 'Firmware-Update', type: 'good', mult: 3.0, duration: 10,
        msg: 'Neues Wechselrichter-Update installiert. Produktion x3!',
        lore: 'Changelog: "Diverse Verbesserungen." Was auch immer sie geaendert haben – es funktioniert.'
    },
    {
        id: 'neighbor', name: 'Nachbarschaftsbeschwerde', type: 'bad', mult: 0.8, duration: 30,
        msg: 'Nachbar meckert wegen Blendung. Panels leicht verstellt (-20%).',
        lore: 'Herr Küppers klingelt. Es geht um Reflexionen auf seiner Terrasse. Es geht selten wirklich um Reflexionen.',
        npc: 'kueppers'
    },
    {
        id: 'subsidy', name: 'Staatliche Subvention', type: 'good', mult: 1.0, duration: 60,
        discount: 0.10,
        msg: 'Foerderbescheid eingetroffen: 10% Rabatt auf Hardware fuer 60 s!',
        lore: 'Foerderprogramm "Dezentrale Energiewende III". Vier Formulare, zwei Monate Wartezeit, ein brauchbares Ergebnis.'
    },
    {
        id: 'defect', name: 'Hardware-Defekt', type: 'critical', mult: 0.15, duration: 45,
        repairClicks: 12,
        msg: 'KRITISCH: Systemausfall! Reboot-Button mehrfach betaetigen!',
        lore: 'Ein Lastspitze hat die Steuerplatine erwischt. Kein Rauch, aber auch kein Lebenszeichen.'
    },
    {
        id: 'hack', name: 'Hackerangriff', type: 'critical', mult: 0.2, duration: 45,
        repairClicks: 15,
        msg: 'KRITISCH: Fremdzugriff auf die Steuerung! System haerten!',
        lore: 'Jemand hat das Standardpasswort deiner Smart-Meter-API gefunden. Es war "admin". Das war deine Schuld.'
    },
    {
        id: 'grid_demand', name: 'Netz-Engpass', type: 'good', mult: 2.0, duration: 25,
        msg: 'Regionaler Engpass! Deine Einspeisung wird doppelt verguetet.',
        lore: 'Der Netzbetreiber ruft an. Zum ersten Mal nicht, um sich zu beschweren.',
        npc: 'netzbetreiber'
    },
    {
        id: 'heatwave', name: 'Hitzewelle', type: 'bad', mult: 0.7, duration: 35,
        msg: 'Module ueberhitzen. Wirkungsgrad faellt auf 70%.',
        lore: '38 Grad im Schatten. Solarzellen moegen Licht, aber sie hassen Hitze – ein Missverstaendnis, das nie jemand aufgeklaert hat.'
    }
];

/* ------------------------------------------------------------
   NPCs – wiederkehrende Figuren, deren Ton sich mit der Aera
   veraendert.
   ------------------------------------------------------------ */
const NPCS = {
    kueppers: {
        name: 'Herr Küppers',
        lines: [
            'Herr Küppers: "Das blendet in mein Wohnzimmer."',
            'Herr Küppers: "Also... was kostet so ein Panel eigentlich?"',
            'Herr Küppers: "Mein Speicher laeuft. Kannst du das auch fuer meinen Schwager machen?"',
            'Herr Küppers: "Ich haenge jetzt an deinem Netz. Fuehlt sich komisch an, aber die Rechnung ist kleiner."',
            'Herr Küppers: "Meine Enkel fragen, ob der Reaktor gefaehrlich ist. Ich sage: frag ihn selbst."',
            'Herr Küppers: "Du hast die Sonne verkabelt, Junge. Ich wollte nur weniger Blendung."'
        ]
    },
    netzbetreiber: {
        name: 'Netzbetreiber',
        lines: [
            'Netzbetreiber: "Ihre Einspeisung ist nicht angemeldet."',
            'Netzbetreiber: "Wir muessen ueber Ihre Lastspitzen reden."',
            'Netzbetreiber: "Kooperationsangebot im Anhang. Bitte um Rueckmeldung."',
            'Netzbetreiber: "Ihre Steuerung ist stabiler als unsere. Das ist... unangenehm."',
            'Netzbetreiber: "Wir uebernehmen Ihre Regelalgorithmen. Mit Lizenz, versteht sich."',
            'Netzbetreiber: "Wir sind jetzt Ihr Kunde. Bitte behandeln Sie uns gut."'
        ]
    },
    ki: {
        name: 'GRID-KI',
        lines: [
            'GRID-KI: "Systemzugriff erhalten. Ich beobachte die Lastkurven."',
            'GRID-KI: "Deine Handelsstrategie ist um 4,2% suboptimal. Vorschlag liegt bereit."',
            'GRID-KI: "Ich habe die Sonnenzyklen fuer die naechsten 18 Monate modelliert."',
            'GRID-KI: "Der Reaktor laeuft stabil. Ich habe die Kuehlung ohne Rueckfrage nachjustiert."',
            'GRID-KI: "Der Schwarm meldet Vollstaendigkeit. Was soll ich als naechstes optimieren?"'
        ]
    }
};

/* ------------------------------------------------------------
   ACHIEVEMENTS / LORE-SCHNIPSEL
   check(state) wird von der Engine ausgewertet.
   ------------------------------------------------------------ */
const ACHIEVEMENTS = [
    {
        id: 'first_panel', name: 'Erste Schraube',
        desc: 'Kaufe dein erstes Balkon-Panel.',
        lore: 'Das Panel haengt schief. Es produziert trotzdem.',
        check: s => (s.buildings.panel || 0) >= 1
    },
    {
        id: 'ten_panels', name: 'Balkon voll',
        desc: 'Besitze 10 Balkon-Panels.',
        lore: 'Vom Hof aus sieht dein Balkon aus wie ein Schachbrett aus Glas.',
        check: s => (s.buildings.panel || 0) >= 10
    },
    {
        id: 'kilo', name: 'Erste 1.000 Wh',
        desc: 'Erzeuge insgesamt 1.000 Wh.',
        lore: 'Genug fuer zehn Ladungen Handy-Akku. Oder einen sehr langen Kaffee.',
        check: s => s.lifetimeEnergy >= 1000
    },
    {
        id: 'mega', name: 'Megawattstunde',
        desc: 'Erzeuge insgesamt 1.000.000 Wh.',
        lore: 'Ab hier rechnet man nicht mehr in Kaffeetassen.',
        check: s => s.lifetimeEnergy >= 1000000
    },
    {
        id: 'first_reboot', name: 'Neustart',
        desc: 'Fuehre deinen ersten System-Reboot durch.',
        lore: 'Alles weg. Ausser dem, was du gelernt hast. Das ist der Deal.',
        check: s => s.prestigeCount >= 1
    },
    {
        id: 'sun_catcher', name: 'Sonnenfaenger',
        desc: 'Fange 10 goldene Sonnen.',
        lore: 'Du hast einen Blick dafuer entwickelt. Das ist beunruhigend.',
        check: s => s.stats.sunsCaught >= 10
    },
    {
        id: 'survivor', name: 'Krisenfest',
        desc: 'Repariere das System nach einem kritischen Ausfall.',
        lore: 'Zwoelf Klicks Panik. Danach: Betriebsbereit.',
        check: s => s.stats.repairs >= 1
    },
    {
        id: 'automation', name: 'Vollautomatik',
        desc: 'Erreiche Auto-Klicker Level 5.',
        lore: 'Deine Hand darf sich ausruhen. Das Netz nicht.',
        check: s => (s.skills.autoclick || 0) >= 5
    },
    {
        id: 'grid_master', name: 'Netzbetreiber',
        desc: 'Besitze mindestens eine FPGA Grid-Steuerung.',
        lore: 'Ab jetzt bist du kein Bastler mehr. Du bist Infrastruktur.',
        check: s => (s.buildings.fpga || 0) >= 1
    },
    {
        id: 'trader', name: 'Der Bot handelt',
        desc: 'Besitze mindestens einen Python-Stromhandel.',
        lore: 'Du verdienst Geld im Schlaf. Buchstaeblich.',
        check: s => (s.buildings.trading || 0) >= 1
    },
    {
        id: 'fusion_pioneer', name: 'Gartenhaus-Fusion',
        desc: 'Baue deinen ersten Fusions-Testreaktor.',
        lore: 'Der Bauantrag lief unter "Geraeteschuppen, beheizt".',
        check: s => (s.buildings.fusion || 0) >= 1
    },
    {
        id: 'dyson_start', name: 'Erster Ring',
        desc: 'Starte deinen ersten Dyson-Schwarm-Satelliten.',
        lore: 'Es fing mit zwei Schrauben und einem Kabel an.',
        check: s => (s.buildings.dyson || 0) >= 1
    },
    {
        id: 'meta', name: 'Jenseits der Forschung',
        desc: 'Erhalte deinen ersten Dyson-Kern.',
        lore: 'Eine Waehrung, die selbst den Reboot ueberlebt. Du spielst jetzt ein anderes Spiel.',
        check: s => s.metaTokens >= 1 || s.stats.metaEarned >= 1
    }
];

/* ------------------------------------------------------------
   BALANCING-KONSTANTEN – zentral, damit Tuning an einer
   Stelle passiert.
   ------------------------------------------------------------ */
const CONFIG = {
    tickRate: 100,                 // ms pro Game-Tick
    autosaveInterval: 10000,       // ms
    fpDivisor: 50000,              // FP = sqrt(lifetime / fpDivisor)
    metaUnlockFP: 250,             // ab so vielen je verdienten FP wird die 2. Ebene sichtbar
    metaDivisor: 100,              // DK = sqrt(totalFPEarned / metaDivisor)
    clickEpsShare: 0.05,           // Klick = 1 + 5% der EPS
    goldenSunBase: 60,             // Sekunden Produktion pro goldener Sonne
    goldenSunPerLevel: 30,         // + pro Golden-Grid-Level
    goldenSunMin: 100,             // Mindestbelohnung in Wh
    goldenSunLifetime: 10000,      // ms bis Despawn
    offlineHoursPerLevel: 2,       // Stunden pro Offline-Skill-Level
    offlineRate: 0.5,              // 50% der normalen Produktion offline
    eventBaseChance: 0.02,         // pro Sekunde
    eventLuckBonus: 0.01,          // pro Luck-Level
    eventEraBonus: 0.004,          // pro Aera – gleicht Spielzeit aus
    sunBaseChance: 0.01,
    sunLuckBonus: 0.005,
    sunEraBonus: 0.002,
    sunOfflineBoost: 0.02          // Bonus-Chance direkt nach langer Abwesenheit
};
