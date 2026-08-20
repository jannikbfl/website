/* ============================================================
   Erzgrund - erzgrund-data.js
   Reine Datenstrukturen und Balancing-Konstanten des zweiten
   Spiels. Keine Spiellogik, kein DOM.

   Die Welt wird nicht als riesiges Zeichengitter gepflegt,
   sondern aus einer kleinen Beschreibungs-Sprache erzeugt
   (Rechtecke, Streuungen, Wege, Einzelfelder). Das haelt die
   Datei lesbar und macht Layout-Aenderungen zu Einzeilern.
   Der Zufall darin ist bewusst deterministisch: gleiche Saat =
   gleiche Welt, sonst wuerden gespeicherte Rohstoff-Felder nach
   einem Reload an anderer Stelle liegen.

   Umlaute werden wie im uebrigen Projekt als ue/ae/oe
   geschrieben, damit die Konsole ueberall gleich aussieht.
   ============================================================ */

const EG_CONFIG = {
    tile: 32,                    // Kantenlaenge eines Feldes in Pixeln
    speed: 2.7,                  // Bewegung in Pixeln pro Frame (60 fps)
    reachTiles: 1.5,             // Reichweite fuer "E"
    actionMs: 230,               // Mindestabstand zwischen zwei Schlaegen

    saveKey: 'erzgrundSave',
    saveVersion: 1,
    autosaveMs: 15000,

    // Zeit: eine echte Sekunde sind 1.5 Ingame-Minuten. Ein Tag laeuft
    // von 6:00 bis 2:00 nachts, also 20 Ingame-Stunden = 13:20 Minuten
    // echte Spielzeit. Alles (Pflanzen, Maschinen) haengt an dieser Uhr.
    minutesPerSecond: 1.5,
    dayStart: 6 * 60,
    dayEnd: 26 * 60,
    offlineCapHours: 10,         // so viel Ingame-Zeit wird beim Laden nachgeholt

    staminaMax: 100,
    sleepStamina: 100,           // Schlafen fuellt komplett auf
    startTaler: 60,

    plotPrice: 120,              // Preis fuer ein neues Beet, steigt je Beet
    plotPriceFactor: 1.35
};

/* ------------------------------------------------------------
   GEGENSTAENDE
   price = Verkaufspreis in Talern an der Verkaufskiste.
   ------------------------------------------------------------ */
const EG_ITEMS = {
    holz:           { name: 'Holz',            icon: '🪵', price: 4 },
    stein:          { name: 'Stein',           icon: '🪨', price: 4 },
    kohle:          { name: 'Kohle',           icon: '🌑', price: 11 },
    kupfererz:      { name: 'Kupfererz',       icon: '🟤', price: 20 },
    eisenerz:       { name: 'Eisenerz',        icon: '⛓️', price: 38 },
    golderz:        { name: 'Golderz',         icon: '🟡', price: 90 },
    diamant:        { name: 'Rohdiamant',      icon: '💎', price: 240 },
    faser:          { name: 'Pflanzenfaser',   icon: '🌿', price: 3 },

    brett:          { name: 'Brett',           icon: '🪚', price: 18 },
    ziegel:         { name: 'Steinziegel',     icon: '🧱', price: 18 },
    kupferbarren:   { name: 'Kupferbarren',    icon: '🟠', price: 75 },
    eisenbarren:    { name: 'Eisenbarren',     icon: '🔩', price: 140 },
    goldbarren:     { name: 'Goldbarren',      icon: '🏅', price: 330 },
    stahl:          { name: 'Stahlbarren',     icon: '🔗', price: 520 },
    schliffdiamant: { name: 'Schliffdiamant',  icon: '💠', price: 1250 },
    mehl:           { name: 'Mehl',            icon: '🌾', price: 46 },

    karotte:        { name: 'Karotte',         icon: '🥕', price: 16,  food: 10 },
    kartoffel:      { name: 'Kartoffel',       icon: '🥔', price: 27,  food: 14 },
    weizen:         { name: 'Weizen',          icon: '🌾', price: 11,  food: 5 },
    kuerbis:        { name: 'Kuerbis',         icon: '🎃', price: 155, food: 30 },

    brot:           { name: 'Brot',            icon: '🍞', price: 120, food: 45 },
    eintopf:        { name: 'Eintopf',         icon: '🍲', price: 260, food: 90 },
    kuerbissuppe:   { name: 'Kuerbissuppe',    icon: '🥣', price: 620, food: 100 },

    gleisjoch:      { name: 'Gleisjoch',       icon: '🛤️', price: 0 },
    radsatz:        { name: 'Radsatz',         icon: '⚙️', price: 0 },
    kessel:         { name: 'Dampfkessel',     icon: '🫖', price: 0 },
    signalmast:     { name: 'Signalmast',      icon: '🚦', price: 0 }
};

/* ------------------------------------------------------------
   PFLANZEN
   growHours = Ingame-Stunden bis zur Ernte.
   ------------------------------------------------------------ */
const EG_CROPS = [
    {
        id: 'karotte', name: 'Karotte', icon: '🥕', color: '#f97316',
        seedName: 'Karottensamen', seedPrice: 12, growHours: 4, yield: [1, 2]
    },
    {
        id: 'weizen', name: 'Weizen', icon: '🌾', color: '#facc15',
        seedName: 'Weizensaat', seedPrice: 9, growHours: 3, yield: [2, 3]
    },
    {
        id: 'kartoffel', name: 'Kartoffel', icon: '🥔', color: '#a3a35c',
        seedName: 'Saatkartoffel', seedPrice: 22, growHours: 7, yield: [1, 3]
    },
    {
        id: 'kuerbis', name: 'Kuerbis', icon: '🎃', color: '#fb923c',
        seedName: 'Kuerbiskern', seedPrice: 130, growHours: 15, yield: [1, 1],
        // Erst wenn der Hof laeuft - sonst steht der teure Kern von Tag eins an im Laden
        unlock: s => s.stats.harvested >= 15
    }
];

/* ------------------------------------------------------------
   WERKZEUGE
   power  = wie viel Haerte ein Schlag abtraegt
   stamina= Ausdauerkosten pro Schlag
   level  = welche Rohstoff-Felder ueberhaupt abbaubar sind
   ------------------------------------------------------------ */
const EG_TOOLS = {
    axt: {
        name: 'Axt', icon: '🪓', verb: 'faellen',
        tiers: [
            { name: 'Blosse Haende', power: 1, stamina: 1.5, level: 1, manual: 10, manualYield: 1, cost: null },
            { name: 'Holzaxt',     power: 1,  stamina: 3.5, level: 1, manual: 1, cost: { holz: 1, stein: 1 } },
            { name: 'Steinaxt',    power: 2,  stamina: 3.5, level: 2, cost: { taler: 90,    holz: 25, stein: 20 } },
            { name: 'Kupferaxt',   power: 3,  stamina: 3,   level: 3, cost: { taler: 420,   brett: 20, kupferbarren: 6 } },
            { name: 'Eisenaxt',    power: 5,  stamina: 2.5, level: 4, cost: { taler: 1600,  brett: 40, eisenbarren: 10 } },
            { name: 'Stahlaxt',    power: 8,  stamina: 2,   level: 5, cost: { taler: 6000,  stahl: 12, ziegel: 40 } },
            { name: 'Diamantaxt',  power: 13, stamina: 1.5, level: 6, cost: { taler: 22000, schliffdiamant: 6, stahl: 20 } }
        ]
    },
    spitzhacke: {
        name: 'Spitzhacke', icon: '⛏️', verb: 'abbauen',
        tiers: [
            { name: 'Blosse Haende', power: 1, stamina: 1.5, level: 1, manual: 10, manualYield: 1, cost: null },
            { name: 'Holzspitzhacke',    power: 1,  stamina: 3.5, level: 1, manual: 1, cost: { holz: 1, stein: 1 } },
            { name: 'Steinspitzhacke',   power: 2,  stamina: 3.5, level: 2, cost: { taler: 90,    holz: 20, stein: 25 } },
            { name: 'Kupferspitzhacke',  power: 3,  stamina: 3,   level: 3, cost: { taler: 420,   ziegel: 20, kupferbarren: 6 } },
            { name: 'Eisenspitzhacke',   power: 5,  stamina: 2.5, level: 4, cost: { taler: 1600,  ziegel: 40, eisenbarren: 10 } },
            { name: 'Stahlspitzhacke',   power: 8,  stamina: 2,   level: 5, cost: { taler: 6000,  stahl: 12, brett: 40 } },
            { name: 'Diamantspitzhacke', power: 13, stamina: 1.5, level: 6, cost: { taler: 22000, schliffdiamant: 6, stahl: 20 } }
        ]
    }
};

/* ------------------------------------------------------------
   ROHSTOFF-FELDER
   hardness   = Summe der Schlagkraft, die zum Abbau noetig ist
   level      = Mindest-Werkzeugstufe
   respawnMin = Ingame-Minuten bis das Feld nachwaechst
   ------------------------------------------------------------ */
const EG_NODES = {
    T: {
        id: 'baum', name: 'Baum', tool: 'axt', hardness: 3, level: 1, respawnMin: 240,
        drops: [{ item: 'holz', min: 2, max: 4 }, { item: 'faser', min: 0, max: 2 }]
    },
    R: {
        id: 'fels', name: 'Felsbrocken', tool: 'spitzhacke', hardness: 3, level: 1, respawnMin: 240,
        drops: [{ item: 'stein', min: 2, max: 4 }]
    },
    C: {
        id: 'kohle', name: 'Kohlefloez', tool: 'spitzhacke', hardness: 5, level: 1, respawnMin: 420,
        drops: [{ item: 'kohle', min: 1, max: 3 }, { item: 'stein', min: 1, max: 2 }]
    },
    K: {
        id: 'kupfer', name: 'Kupferader', tool: 'spitzhacke', hardness: 8, level: 2, respawnMin: 480,
        drops: [{ item: 'kupfererz', min: 2, max: 3 }, { item: 'stein', min: 0, max: 2 }]
    },
    I: {
        id: 'eisen', name: 'Eisenader', tool: 'spitzhacke', hardness: 14, level: 3, respawnMin: 600,
        drops: [{ item: 'eisenerz', min: 2, max: 3 }, { item: 'kohle', min: 0, max: 1 }]
    },
    G: {
        id: 'gold', name: 'Goldader', tool: 'spitzhacke', hardness: 22, level: 4, respawnMin: 720,
        drops: [{ item: 'golderz', min: 1, max: 2 }]
    },
    X: {
        id: 'diamant', name: 'Diamantader', tool: 'spitzhacke', hardness: 34, level: 5, respawnMin: 900,
        drops: [{ item: 'diamant', min: 1, max: 2 }]
    }
};

/* ------------------------------------------------------------
   MASCHINEN
   Jede Maschine steht auf einem Bauplatz und arbeitet eine
   Warteschlange ab. minutes = Ingame-Minuten pro Durchlauf.
   ------------------------------------------------------------ */
const EG_MACHINES = [
    {
        id: 'saegewerk', name: 'Saegewerk', icon: '🪚', color: '#a16207',
        desc: 'Macht aus Rundholz saubere Bretter.',
        cost: { taler: 150, holz: 40, stein: 20 },
        recipes: [
            { out: { brett: 1 }, in: { holz: 3 }, minutes: 45 }
        ]
    },
    {
        id: 'steinsaege', name: 'Steinsaege', icon: '🧱', color: '#78716c',
        desc: 'Schneidet Bruchstein zu Ziegeln.',
        cost: { taler: 180, stein: 40, holz: 20 },
        recipes: [
            { out: { ziegel: 1 }, in: { stein: 3 }, minutes: 45 }
        ]
    },
    {
        id: 'schmelzofen', name: 'Schmelzofen', icon: '🔥', color: '#b45309',
        desc: 'Erz und Kohle rein, Barren raus.',
        cost: { taler: 600, ziegel: 25, holz: 30 },
        recipes: [
            { out: { kupferbarren: 1 }, in: { kupfererz: 3, kohle: 1 }, minutes: 70 },
            { out: { eisenbarren: 1 },  in: { eisenerz: 3, kohle: 2 },  minutes: 120, unlock: 'eisen' },
            { out: { goldbarren: 1 },   in: { golderz: 3, kohle: 3 },   minutes: 190, unlock: 'gold' }
        ]
    },
    {
        id: 'muehle', name: 'Muehle', icon: '🌾', color: '#ca8a04',
        desc: 'Mahlt Weizen zu Mehl.',
        cost: { taler: 700, brett: 25, stein: 30 },
        recipes: [
            { out: { mehl: 1 }, in: { weizen: 4 }, minutes: 60 }
        ]
    },
    {
        id: 'kueche', name: 'Feldkueche', icon: '🍲', color: '#dc2626',
        desc: 'Kocht Ausdauer in essbarer Form.',
        cost: { taler: 1400, brett: 30, ziegel: 25 },
        recipes: [
            { out: { brot: 1 },         in: { mehl: 2 },                              minutes: 80 },
            { out: { eintopf: 1 },      in: { karotte: 3, kartoffel: 3, mehl: 1 },     minutes: 150 },
            { out: { kuerbissuppe: 1 }, in: { kuerbis: 1, mehl: 2, karotte: 2 },       minutes: 240, unlock: 'kuerbis' }
        ]
    },
    {
        id: 'legierofen', name: 'Legierofen', icon: '⚗️', color: '#0e7490',
        desc: 'Verschmilzt Eisen und Kupfer zu Stahl.',
        cost: { taler: 5000, ziegel: 50, eisenbarren: 15 },
        recipes: [
            { out: { stahl: 1 }, in: { eisenbarren: 3, kupferbarren: 1, kohle: 4 }, minutes: 280 }
        ]
    },
    {
        id: 'schleiferei', name: 'Schleiferei', icon: '💠', color: '#6366f1',
        desc: 'Schleift Rohdiamanten auf Maschinenqualitaet.',
        cost: { taler: 14000, stahl: 10, brett: 60 },
        recipes: [
            { out: { schliffdiamant: 1 }, in: { diamant: 2, stahl: 1 }, minutes: 340 }
        ]
    },
    {
        id: 'montagehalle', name: 'Montagehalle', icon: '🏗️', color: '#334155',
        desc: 'Baut die schweren Teile fuer die Erzbahn.',
        cost: { taler: 30000, stahl: 25, ziegel: 80, brett: 80 },
        recipes: [
            { out: { gleisjoch: 1 },  in: { eisenbarren: 4, brett: 6 },                   minutes: 200 },
            { out: { radsatz: 1 },    in: { stahl: 2, eisenbarren: 4 },                   minutes: 320 },
            { out: { kessel: 1 },     in: { stahl: 4, kupferbarren: 6, ziegel: 10 },      minutes: 460 },
            { out: { signalmast: 1 }, in: { stahl: 3, schliffdiamant: 1, goldbarren: 2 }, minutes: 520 }
        ]
    }
];

/* ------------------------------------------------------------
   MASCHINEN-STUFEN
   Gelten fuer jede Maschine gleich. Zwei Achsen, damit ein Ausbau
   sofort lesbar ist: Tempo (Faktor auf die Rezeptdauer) und Groesse
   der Warteschlange.

   costFactor rechnet gegen die Baukosten der jeweiligen Maschine -
   ein Ausbau des Saegewerks kostet also weniger als einer der
   Montagehalle. extra kommt als Materialsperre obendrauf, damit
   Stufen nicht vor der passenden Spielphase erreichbar sind.
   ------------------------------------------------------------ */
const EG_MACHINE_LEVELS = [
    { speed: 1.00, queue: 3, cost: null },
    { speed: 0.82, queue: 4, cost: { costFactor: 1.4, extra: { brett: 10, ziegel: 10 } } },
    { speed: 0.68, queue: 5, cost: { costFactor: 2.6, extra: { eisenbarren: 4 } } },
    { speed: 0.56, queue: 7, cost: { costFactor: 5.0, extra: { stahl: 3 } } },
    { speed: 0.45, queue: 9, cost: { costFactor: 9.0, extra: { stahl: 6, schliffdiamant: 1 } } }
];

/* ------------------------------------------------------------
   ERZBAHN - das Endziel
   Vier Bauabschnitte an der alten Station. Ist der letzte fertig,
   faehrt die Bahn wieder und das Spiel bekommt seinen Abspann.
   ------------------------------------------------------------ */
const EG_RAILWAY = [
    {
        id: 'gleise', name: 'Gleisstrecke',
        text: 'Zweihundert Meter Schotter, Schwellen und Schiene den Hang hinauf.',
        need: { gleisjoch: 10, ziegel: 40 }
    },
    {
        id: 'waggon', name: 'Erzwaggon',
        text: 'Ein Kastenwagen mit vier Achsen. Rostig, aber der Rahmen traegt noch.',
        need: { radsatz: 6, brett: 60, eisenbarren: 20 }
    },
    {
        id: 'antrieb', name: 'Maschinenhaus',
        text: 'Kessel, Seilwinde, Bremse. Ab hier zieht nicht mehr die Schwerkraft.',
        need: { kessel: 3, stahl: 20, kupferbarren: 25 }
    },
    {
        id: 'signal', name: 'Signalanlage',
        text: 'Ohne Signale faehrt hier niemand. Auch nicht du.',
        need: { signalmast: 4, schliffdiamant: 6, goldbarren: 10 }
    }
];

/* ------------------------------------------------------------
   ZIELE - geben dem Spiel Richtung, ohne Questlog-Buerokratie.
   check(state, api) wird von der Engine ausgewertet.
   ------------------------------------------------------------ */
const EG_GOALS = [
    {
        id: 'g_holz', name: 'Erstes Holz', reward: 40,
        desc: 'Schlag dir 10 Holz aus dem Wald westlich vom Hof.',
        check: s => (s.stats.gathered.holz || 0) >= 10
    },
    {
        id: 'g_pflanz', name: 'Erste Aussaat', reward: 40,
        desc: 'Pflanze etwas auf ein Beet.',
        check: s => s.stats.planted >= 1
    },
    {
        id: 'g_ernte', name: 'Erste Ernte', reward: 60,
        desc: 'Ernte deine erste ausgewachsene Pflanze.',
        check: s => s.stats.harvested >= 1
    },
    {
        id: 'g_verkauf', name: 'Der erste Taler', reward: 60,
        desc: 'Verkaufe etwas an der Verkaufskiste.',
        check: s => s.stats.sold >= 1
    },
    {
        id: 'g_werkzeug', name: 'Erstes Werkzeug', reward: 80,
        desc: 'Schnitz dir aus einem Holz und einem Stein die erste Axt oder Spitzhacke.',
        check: s => s.tools.axt >= 1 || s.tools.spitzhacke >= 1
    },
    {
        id: 'g_stein', name: 'Steinzeit', reward: 120,
        desc: 'Ruest Axt und Spitzhacke auf Stein hoch - danach faellt das Schlagen von Hand weg.',
        check: s => s.tools.axt >= 2 && s.tools.spitzhacke >= 2
    },
    {
        id: 'g_mine', name: 'Unter Tage', reward: 150,
        desc: 'Steig in den Stollen oestlich vom Hof hinab.',
        check: s => s.stats.deepestMine >= 1
    },
    {
        id: 'g_maschine', name: 'Erste Maschine', reward: 200,
        desc: 'Stell eine Maschine auf einen Bauplatz.',
        check: s => Object.keys(s.machines).length >= 1
    },
    {
        id: 'g_barren', name: 'Erster Barren', reward: 300,
        desc: 'Schmelze Kupfererz zu einem Barren.',
        check: s => (s.stats.produced.kupferbarren || 0) >= 1
    },
    {
        id: 'g_eisen', name: 'Eisenzeit', reward: 600,
        desc: 'Bau Eisen ab - dafuer brauchst du eine Kupferspitzhacke.',
        check: s => (s.stats.gathered.eisenerz || 0) >= 1
    },
    {
        id: 'g_kueche', name: 'Warme Mahlzeit', reward: 500,
        desc: 'Koch dir einen Eintopf.',
        check: s => (s.stats.produced.eintopf || 0) >= 1
    },
    {
        id: 'g_tief', name: 'Tiefe Sohle', reward: 1200,
        desc: 'Erreiche die vierte Sohle der Mine.',
        check: s => s.stats.deepestMine >= 4
    },
    {
        id: 'g_diamant', name: 'Der erste Stein', reward: 2000,
        desc: 'Brich einen Rohdiamanten aus dem Fels.',
        check: s => (s.stats.gathered.diamant || 0) >= 1
    },
    {
        id: 'g_stahl', name: 'Stahlzeit', reward: 3000,
        desc: 'Giess deinen ersten Stahlbarren.',
        check: s => (s.stats.produced.stahl || 0) >= 1
    },
    {
        id: 'g_bahn', name: 'Erster Bauabschnitt', reward: 5000,
        desc: 'Stell einen Abschnitt der Erzbahn fertig.',
        check: s => s.railway.length >= 1
    }
];

/* ------------------------------------------------------------
   HINWEISE - erscheinen kontextabhaengig genau einmal.
   ------------------------------------------------------------ */
const EG_HINTS = [
    {
        id: 'h_move', title: 'Willkommen im Erzgrund',
        text: 'Lauf mit WASD oder den Pfeiltasten. Steh vor etwas und druecke E - Baeume, Felsen, Beete, Tueren, alles laeuft ueber diese eine Taste. Werkzeug hast du noch keins: die ersten Baeume und Steine gehen nur mit blossen Haenden.',
        check: () => true
    },
    {
        id: 'h_stamina', title: 'Ausdauer',
        text: 'Jeder Schlag kostet Kraft. Ist der Balken leer, hilft nur Essen oder Schlafen. Das Bett steht im Haus - Schlafen speichert und bringt dich auf den naechsten Morgen.',
        check: s => s.stamina < 55
    },
    {
        id: 'h_sell', title: 'Verkaufskiste',
        text: 'Alles, was du in die Kiste neben dem Haus legst, wird sofort zu Talern. Samen und Werkzeuge kaufst du am Laden daneben.',
        check: s => (s.stats.gathered.holz || 0) >= 5
    },
    {
        id: 'h_craft', title: 'Erstes Werkzeug',
        text: 'Ein Holz und ein Stein reichen fuer eine Axt oder eine Spitzhacke. Beides gibt es im Laden neben dem Haus - danach brauchst du pro Baum nur noch einen Schlag statt zehn.',
        check: s => (s.inv.holz || 0) >= 1 && (s.inv.stein || 0) >= 1 && s.tools.axt === 0 && s.tools.spitzhacke === 0
    },
    {
        id: 'h_plot', title: 'Beete',
        text: 'Waehle unten dein Saatgut aus und druecke auf einem freien Beet E. Pflanzen wachsen in Echtzeit weiter - auch waehrend du in der Mine bist.',
        check: s => s.stats.planted === 0 && s.taler >= 20
    },
    {
        id: 'h_mine', title: 'Der Stollen',
        text: 'Oestlich vom Hof geht es unter Tage. Jede Sohle braucht eine bessere Spitzhacke als die davor - und haelt dafuer besseres Erz bereit.',
        check: s => s.tools.spitzhacke >= 1
    },
    {
        id: 'h_machine', title: 'Maschinen',
        text: 'Auf den Bauplaetzen am Hof stellst du Maschinen auf. Die arbeiten ihre Warteschlange auch dann ab, wenn du woanders bist - wie ein zweiter Arbeiter.',
        check: s => (s.inv.holz || 0) >= 30
    },
    {
        id: 'h_rail', title: 'Die alte Erzbahn',
        text: 'Suedoestlich steht die Station der stillgelegten Erzbahn. Sie wieder zum Laufen zu bringen ist das Ziel dieses Spiels - und ein langer Weg.',
        check: s => s.stats.deepestMine >= 1
    }
];

/* ------------------------------------------------------------
   WELT
   Kleine Beschreibungs-Sprache, aus der die Engine das Gitter
   baut. Reihenfolge zaehlt: spaetere Eintraege ueberschreiben
   fruehere.

     fill    Rechteck komplett fuellen
     scatter Feld mit Wahrscheinlichkeit p streuen
     path    Weg (waagerecht/senkrecht)
     set     einzelnes Feld
     pond    Ellipse (Wasser)

   Zeichen:
     .  Gras / Hoehlenboden      ,  Weg
     #  Fels (fest)              ~  Wasser (fest)
     b  Beet                     f  Zaun
     T  Baum   R  Fels   C  Kohle   K  Kupfer
     I  Eisen  G  Gold   X  Diamant
     H  Haus (Bett)    S  Laden    V  Verkaufskiste
     M  Bauplatz       D  Stolleneingang
     N  Leiter abwaerts   U  Leiter aufwaerts
     E  Erzbahn-Station
   ------------------------------------------------------------ */
const EG_MAPS = {
    tal: {
        name: 'Erzgrund-Tal', w: 44, h: 30, base: '.', seed: 1337,
        outdoor: true,
        build: [
            { op: 'fill', x: 0, y: 0, w: 44, h: 30, tile: '#', border: true },

            // Wald im Westen
            { op: 'scatter', x: 1, y: 1, w: 13, h: 28, tile: 'T', p: 0.34 },
            { op: 'scatter', x: 1, y: 1, w: 13, h: 28, tile: 'R', p: 0.04 },

            // Steinfeld und Halde im Osten
            { op: 'scatter', x: 30, y: 1, w: 13, h: 17, tile: 'R', p: 0.3 },
            { op: 'scatter', x: 30, y: 1, w: 13, h: 17, tile: 'C', p: 0.07 },
            { op: 'scatter', x: 31, y: 2, w: 11, h: 8, tile: 'T', p: 0.05 },

            // Teich im Suedwesten
            { op: 'pond', x: 3, y: 22, w: 9, h: 6 },

            // Hofflaeche freiraeumen
            { op: 'fill', x: 14, y: 3, w: 16, h: 24, tile: '.' },

            // Wege
            { op: 'path', x: 14, y: 14, len: 30, dir: 'h' },
            { op: 'path', x: 21, y: 4, len: 23, dir: 'v' },
            { op: 'path', x: 22, y: 4, len: 23, dir: 'v' },
            { op: 'path', x: 8, y: 14, len: 7, dir: 'h' },

            // Gebaeude noerdlich des Wegs
            { op: 'set', x: 18, y: 6, tile: 'H' },
            { op: 'set', x: 19, y: 6, tile: 'H' },
            { op: 'set', x: 18, y: 5, tile: 'H' },
            { op: 'set', x: 19, y: 5, tile: 'H' },
            { op: 'set', x: 25, y: 6, tile: 'S' },
            { op: 'set', x: 26, y: 6, tile: 'S' },
            { op: 'set', x: 24, y: 9, tile: 'V' },

            // Beete: vier zum Start, der Rest wird im Laden freigeschaltet
            { op: 'fill', x: 15, y: 10, w: 5, h: 3, tile: 'b' },
            { op: 'fill', x: 24, y: 11, w: 4, h: 2, tile: 'b' },

            // Bauplaetze fuer Maschinen suedlich des Wegs
            { op: 'fill', x: 15, y: 17, w: 1, h: 1, tile: 'M' },
            { op: 'set', x: 17, y: 17, tile: 'M' },
            { op: 'set', x: 19, y: 17, tile: 'M' },
            { op: 'set', x: 24, y: 17, tile: 'M' },
            { op: 'set', x: 26, y: 17, tile: 'M' },
            { op: 'set', x: 28, y: 17, tile: 'M' },
            { op: 'set', x: 15, y: 20, tile: 'M' },
            { op: 'set', x: 17, y: 20, tile: 'M' },
            { op: 'set', x: 19, y: 20, tile: 'M' },
            { op: 'set', x: 24, y: 20, tile: 'M' },
            { op: 'set', x: 26, y: 20, tile: 'M' },
            { op: 'set', x: 28, y: 20, tile: 'M' },

            // Stollen im Osten, Bahnstation im Suedosten
            { op: 'fill', x: 34, y: 12, w: 5, h: 5, tile: '.' },
            { op: 'path', x: 30, y: 14, len: 6, dir: 'h' },
            { op: 'set', x: 36, y: 14, tile: 'D' },
            { op: 'fill', x: 30, y: 21, w: 12, h: 7, tile: '.' },
            { op: 'path', x: 22, y: 25, len: 12, dir: 'h' },
            { op: 'set', x: 34, y: 24, tile: 'E' },
            { op: 'set', x: 35, y: 24, tile: 'E' },
            { op: 'set', x: 36, y: 24, tile: 'E' },
            { op: 'scatter', x: 30, y: 26, w: 12, h: 2, tile: 'R', p: 0.2 },

            // Zaun um den Hof, mit Durchlaessen an den Wegen
            { op: 'fence', x: 14, y: 3, w: 16, h: 24 }
        ],
        spawn: { x: 21, y: 9 }
    },

    /* Die Sohlen teilen sich zwei Grundrisse; unterschiedlich ist,
       was in den Waenden steckt. Sohle 1 ist Kohle und Kupfer,
       Sohle 4 gehoert den Diamanten. */
    mine1: {
        name: 'Stollen - 1. Sohle', w: 32, h: 22, base: '#', seed: 21, depth: 1,
        build: [
            { op: 'caves', x: 1, y: 1, w: 30, h: 20, rooms: 7, seed: 21 },
            { op: 'scatter', x: 1, y: 1, w: 30, h: 20, tile: 'R', p: 0.1, onlyFloor: true },
            { op: 'scatter', x: 1, y: 1, w: 30, h: 20, tile: 'C', p: 0.09, onlyFloor: true },
            { op: 'scatter', x: 1, y: 1, w: 30, h: 20, tile: 'K', p: 0.05, onlyFloor: true },
            { op: 'set', x: 4, y: 4, tile: 'U' },
            { op: 'set', x: 27, y: 17, tile: 'N' }
        ],
        spawn: { x: 5, y: 4 }, up: 'tal', down: 'mine2'
    },
    mine2: {
        name: 'Stollen - 2. Sohle', w: 32, h: 22, base: '#', seed: 44, depth: 2,
        build: [
            { op: 'caves', x: 1, y: 1, w: 30, h: 20, rooms: 8, seed: 44 },
            { op: 'scatter', x: 1, y: 1, w: 30, h: 20, tile: 'R', p: 0.08, onlyFloor: true },
            { op: 'scatter', x: 1, y: 1, w: 30, h: 20, tile: 'C', p: 0.07, onlyFloor: true },
            { op: 'scatter', x: 1, y: 1, w: 30, h: 20, tile: 'K', p: 0.05, onlyFloor: true },
            { op: 'scatter', x: 1, y: 1, w: 30, h: 20, tile: 'I', p: 0.07, onlyFloor: true },
            { op: 'set', x: 4, y: 4, tile: 'U' },
            { op: 'set', x: 27, y: 17, tile: 'N' }
        ],
        spawn: { x: 5, y: 4 }, up: 'mine1', down: 'mine3', needLevel: 3
    },
    mine3: {
        name: 'Stollen - 3. Sohle', w: 32, h: 22, base: '#', seed: 77, depth: 3,
        build: [
            { op: 'caves', x: 1, y: 1, w: 30, h: 20, rooms: 8, seed: 77 },
            { op: 'scatter', x: 1, y: 1, w: 30, h: 20, tile: 'C', p: 0.06, onlyFloor: true },
            { op: 'scatter', x: 1, y: 1, w: 30, h: 20, tile: 'I', p: 0.08, onlyFloor: true },
            { op: 'scatter', x: 1, y: 1, w: 30, h: 20, tile: 'G', p: 0.05, onlyFloor: true },
            { op: 'set', x: 4, y: 4, tile: 'U' },
            { op: 'set', x: 27, y: 17, tile: 'N' }
        ],
        spawn: { x: 5, y: 4 }, up: 'mine2', down: 'mine4', needLevel: 4
    },
    mine4: {
        name: 'Stollen - 4. Sohle', w: 32, h: 22, base: '#', seed: 91, depth: 4,
        build: [
            { op: 'caves', x: 1, y: 1, w: 30, h: 20, rooms: 9, seed: 91 },
            { op: 'scatter', x: 1, y: 1, w: 30, h: 20, tile: 'C', p: 0.05, onlyFloor: true },
            { op: 'scatter', x: 1, y: 1, w: 30, h: 20, tile: 'I', p: 0.05, onlyFloor: true },
            { op: 'scatter', x: 1, y: 1, w: 30, h: 20, tile: 'G', p: 0.06, onlyFloor: true },
            { op: 'scatter', x: 1, y: 1, w: 30, h: 20, tile: 'X', p: 0.05, onlyFloor: true },
            { op: 'set', x: 4, y: 4, tile: 'U' }
        ],
        spawn: { x: 5, y: 4 }, up: 'mine3'
    }
};

/* Flaechen, auf denen im Laden gekaufte Beete entstehen. Die Engine
   nimmt das jeweils erste noch freie Grasfeld in dieser Reihenfolge. */
const EG_PLOT_AREAS = [
    { x: 15, y: 7,  w: 6, h: 3 },
    { x: 25, y: 8,  w: 4, h: 3 },
    { x: 15, y: 22, w: 6, h: 4 },
    { x: 24, y: 22, w: 5, h: 4 }
];

/* Der Abspann. Wird gezeigt, wenn der letzte Bauabschnitt steht. */
const EG_ENDING = {
    title: 'Die Erzbahn faehrt wieder',
    lines: [
        'Der Kessel steht unter Druck, die Winde greift, und mit einem Ruck, der dir durch die Stiefel faehrt, setzt sich der Waggon in Bewegung.',
        'Er nimmt den Hang, den vor dir zuletzt jemand vor vierzig Jahren genommen hat. Oben am Grat wird er sichtbar, klein und schwarz vor dem Abendlicht, und verschwindet dann hinter der Kante Richtung Tal.',
        'Was du hier ausgegraben hast, faehrt jetzt von allein hinunter. Was du hier angebaut hast, faehrt mit.',
        'Der Erzgrund ist kein vergessenes Loch mehr. Er ist ein Ort mit Anschluss.'
    ],
    outro: 'Der Hof bleibt offen - Beete, Maschinen und Stollen laufen weiter. Ab hier spielst du fuer dich selbst.'
};
