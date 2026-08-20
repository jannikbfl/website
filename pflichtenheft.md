# Energy Grid Tycoon – Game Design & Technik

**Stand:** August 2026 · **Live:** [biefel.de/game.html](https://biefel.de/game.html)

Dieses Dokument beschreibt den *tatsächlichen* Stand des Spiels, nicht einen Plan.
Wenn eine Zahl hier und im Code auseinanderlaufen, gilt der Code – und dieses
Dokument gehört korrigiert.

---

## 1. Überblick

Browserbasiertes Incremental/Idle-Game im Setting Hardware-Entwicklung, Smart Home
und Energiemanagement. Der Spieler startet mit einem Balkon-Solarpanel und skaliert
über 18 Hardware-Stufen bis zum Stern-Heber, der Energie direkt aus der Sonnenkorona
abschöpft.

**Technik:** HTML5, Tailwind CSS (CDN), Vanilla JavaScript (keine Build-Kette, keine
Abhängigkeiten), LocalStorage für den Spielstand. Die Seite ist statisch und läuft
auf GitHub Pages.

**Drei ineinandergreifende Schleifen:**

1. **Hardware kaufen** – Energie erzeugen, in teurere Hardware investieren.
2. **System-Reboot (Prestige)** – setzt Energie und Hardware zurück, gibt
   Forschungspunkte (FP). FP schalten Skills frei *und* erhöhen dauerhaft die
   Produktion.
3. **Dyson-Kollaps (Meta-Prestige)** – setzt zusätzlich die FP zurück, gibt
   Dyson-Kerne (DK) mit Boni, die jeden Reboot überdauern.

Daneben laufen zwei Nebensysteme: zufällige **Events** (Buffs, Debuffs, kritische
Ausfälle mit Reparatur-Minispiel) und **Sonnen**, die man anklickt – sie sind die
einzige Quelle für Sonnenfragmente (SF) und speisen einen eigenen Skilltree.

---

## 2. Architektur

Der frühere Monolith ist aufgeteilt; jede Datei hat genau eine Zuständigkeit.
Die Ladereihenfolge in `game.html` ist zwingend:

| Datei | Zuständigkeit |
|---|---|
| `numbers.js` | `Num` – Zahlenformatierung. Keine Spiellogik. |
| `data.js` | Alle Datenstrukturen, `CONFIG` und die abgeleiteten Kurven. Keine Logik, kein DOM. |
| `engine.js` | `Engine` – State, Game-Loop, Berechnungen, Save/Load. Kein DOM. |
| `scene.js` | `Scene` – die gezeichnete Hintergrund-Illustration (100 Ausbaustufen, per Formel). |
| `ui.js` | `UI` – sämtliche DOM-Manipulation, Rendering, Listener. |
| `game.html` | Nur HTML-Gerüst und Script-Einbindung. |
| `style.css` | Keyframe-Animationen, Custom Scrollbars. |

**Regeln:**

- Neue Inhalte (Hardware, Skills, Events, Sonnen, Erfolge, Hinweise) kommen
  ausschließlich in `data.js` dazu – Engine und UI iterieren generisch darüber.
- Die Engine kennt kein DOM. Die Kommunikation zur UI läuft über einen kleinen
  Event-Bus mit den Ereignissen *tick, log, milestone, achievement, spawnsun, buffs,
  hint, gridchange, era, purchase*.
- Der State liegt gekapselt in `engine.js`, nicht global.

**Entwickler-Werkzeuge** (nicht Teil des Spiels, nicht verlinkt): `simrun.html` und
`balance-sim.js` – siehe Abschnitt 7.

---

## 3. Ressourcen

| Währung | Herkunft | Zurückgesetzt durch |
|---|---|---|
| **Energie (Wh)** | Produktion und Klicks | Reboot, Kollaps |
| **Lebensenergie** | Summe aller je erzeugten Wh | nur Kollaps |
| **Forschungspunkte (FP)** | Reboot | Kollaps (teilweise, siehe Kern-Echo) |
| **Sonnenfragmente (SF)** | ausschließlich gefangene Sonnen | nie |
| **Dyson-Kerne (DK)** | Kollaps | nie |

---

## 4. Formeln

### Hardware-Kosten

    Kosten(n-tes Stueck) = floor(baseCost * costFactor^n * Rabatt)

`costFactor` liegt je nach Stufe zwischen 1.15 und 1.18. Der Rabatt kommt aus Events
oder dem Sonnen-Buff *Netz-Überladung* (mindestens 5 % Restkosten bleiben).

Mengenkäufe (x10, x100, Max) rechnet die Engine bis 50 Stück exakt Stück für Stück –
die Rundung pro Stück zählt –, darüber über die geometrische Reihe. Die maximal
bezahlbare Menge kommt aus der geschlossenen Form
`k = log_f(1 + Budget * (f - 1) / Erstpreis)`, anschließend gegen die echten Kosten
nach unten korrigiert.

### Mengen-Meilensteine

Pro Hardware-Typ multiplizieren erreichte Stückzahlen dessen Produktion, kumulativ:

| Stück | 5 | 10 | 25 | 50 | 100 | 500 | 1000 |
|---|---|---|---|---|---|---|---|
| Faktor | ×2 | ×2 | ×2 | ×3 | ×3 | ×5 | ×10 |
| kumulativ | ×2 | ×4 | ×8 | ×24 | ×72 | ×360 | ×3600 |

Das ist der Grund, warum sich auch billige Frühhardware im Lategame noch lohnt: der
Sprung auf die nächste Schwelle zieht den gesamten Bestand mit hoch.

### Produktion

    BasisEPS = Summe(Anzahl * baseProd * Meilenstein-Faktor)

    Multiplikator = (1 + Netz-Effizienz * 0.20)
                  * metaOutputPerLevel ^ Kern-Resonanz     // Standard: 2 pro Level
                  * FP-Multiplikator
                  * Sonnen-Buffs
                  * Event-Multiplikator

    EPS = BasisEPS * Multiplikator

### FP-Multiplikator

    FP-Multiplikator = 1 + (verdiente FP * 0.01)     // +1 % je verdientem FP

Bewusst **linear**: der FP-Ertrag hängt selbst an der Produktion, ein exponentieller
Bonus würde die Kurve aufschaukeln. Er wirkt auf passive Produktion *und*
Klickstärke.

### Klickstärke

    Klick = (1 + BasisEPS * 0.05)
          * (1 + Hyper-Klicks * 1.0)
          * metaOutputPerLevel ^ Kern-Resonanz
          * FP-Multiplikator
          * Klick-Buffs * Event-Multiplikator

### Forschungspunkte beim Reboot

    Gesamt    = floor(1.5 * Lebensenergie^0.14) * (1 + Forschungs-Katalysator * 0.50)
    Verfuegbar = Gesamt - bereits verdiente FP

Ein **Potenzgesetz statt Wurzel**, weil die Energie über das ganze Spiel rund 37
Zehnerpotenzen durchläuft – eine Wurzel würde daraus achtstellige FP-Zahlen machen.

### Reboot-Empfehlung

Das Spiel nennt eine konkrete Zahl, statt den Spieler raten zu lassen:

- **vor dem ersten Reboot:** feste Schwelle `firstPrestigeFP` = 25 FP
- **danach:** sobald der Reboot die verdienten FP um 50 % hebt

Ist die Empfehlung erfüllt, färbt sich die Zeile im Reboot-Panel grün und der Button
bekommt einen Ring.

### Dyson-Kerne

    Gesamt    = floor(sqrt(verdiente FP / 250))
    Verfuegbar = Gesamt - bereits erhaltene DK

Sichtbar ab 3.000 je verdienten FP. Der Kollaps setzt Energie, Lebensenergie,
Hardware, Forschungs-Skills und FP zurück – **Kern-Echo** rettet 15 % der FP pro
Level und damit auch deren Produktionsbonus über den Schnitt.

### Ären

An die insgesamt verdienten FP gekoppelt, nicht an die Anzahl der Reboots – sonst
wäre die Story nach sechs Reboots erzählt:

| Ära | FP | Name |
|---|---|---|
| 0 | 0 | Balkon-Bastler |
| 1 | 25 | Kleinunternehmer |
| 2 | 150 | Regionaler Netzbetreiber |
| 3 | 800 | Netz-Architekt |
| 4 | 4.000 | Fusions-Pionier |
| 5 | 20.000 | Schwarm-Operator |
| 6 | 90.000 | Stellarer Verwalter |

### Offline-Produktion

Nur mit dem Skill *Offline-Produktion*: 2 h Kappung pro Level, 50 % der normalen
Rate. Der laufende Tick ist delta-basiert und nicht Tick-Zähler-basiert, damit die
Produktion auch in gedrosselten Hintergrund-Tabs korrekt weiterläuft; Ausreißer
werden bei 6 h gekappt.

### Sonnen

Spawn-Chance pro Sekunde:
`0.01 + Quanten-Glück * 0.0015 + Sonnen-Radar * 0.0015 + Reboots * 0.0005`,
mit 12 s Abklingzeit zwischen zwei Sonnen. Jede gefangene Sonne gibt
`3 + Fragment-Ausbeute` SF. Die goldene Sonne zahlt 60 s Produktion aus (+30 s pro
Golden-Grid-Level, mindestens 100 Wh), die übrigen Typen geben Buffs oder Fragmente.
Wirkung und Dauer skalieren mit *Prismen-Fokus* und *Nachleuchten*.

---

## 5. Content-Stand

### Hardware – 18 Stufen

Nur die erste Stufe trägt eigene Zahlen. Alles darüber wird beim Laden aus zwei
Regeln in `data.js` berechnet:

1. **Produktion:** ein Stück einer neuen Stufe erzeugt so viel wie zehn Stück der
   Vorstufe *inklusive deren Meilensteine bei 5 und 10* – Faktor 40 pro Stufe.
2. **Kosten:** Faktor `TIER_COST_RATIO` = 150 pro Stufe, auf drei signifikante
   Stellen gerundet.

Die folgende Tabelle ist damit eine **Momentaufnahme** – sie ändert sich, sobald
jemand an einer der beiden Regeln dreht:

| # | Name | Basiskosten | Produktion/Stück | costFactor | Ära |
|---|---|---|---|---|---|
| 1 | Balkon-Panel | 60 | 1 | 1.15 | 0 |
| 2 | Wechselrichter | 9.00k | 40 | 1.15 | 0 |
| 3 | Mini-Windrad | 1.35M | 1.60k | 1.15 | 0 |
| 4 | Smart Meter API | 203.0M | 64.0k | 1.155 | 1 |
| 5 | Heimspeicher-Rack | 30.5B | 2.56M | 1.155 | 1 |
| 6 | Dachflächen-Verbund | 4.58T | 102.4M | 1.155 | 1 |
| 7 | FPGA Grid-Steuerung | 687.0T | 4.10B | 1.16 | 2 |
| 8 | Ortsnetz-Station | 103.0Qa | 163.8B | 1.16 | 2 |
| 9 | RISC-V Coprozessor | 15.5Qi | 6.55T | 1.16 | 2 |
| 10 | Python Stromhandel | 2.33Sx | 262.1T | 1.165 | 3 |
| 11 | HGÜ-Trasse | 350.0Sx | 10.5Qa | 1.165 | 3 |
| 12 | Virtuelles Kraftwerk | 52.5Sp | 419.4Qa | 1.165 | 3 |
| 13 | Tiefengeothermie | 7.87Oc | 16.8Qi | 1.17 | 4 |
| 14 | Fusions-Testreaktor | 1.18No | 671.1Qi | 1.17 | 4 |
| 15 | Fusions-Serienpark | 177.0No | 26.8Sx | 1.17 | 4 |
| 16 | Orbital-Solarsegel | 26.6a | 1.07Sp | 1.175 | 5 |
| 17 | Dyson-Schwarm | 3.99b | 42.9Sp | 1.175 | 5 |
| 18 | Stern-Heber | 598.0b | 1.72Oc | 1.18 | 6 |

Eine Stufe wird sichtbar, sobald die vorherige mindestens einmal gebaut wurde –
bewusst *nicht* an die Ära gekoppelt, sonst sieht man Hardware nicht, die man sich
längst leisten könnte.

### Skilltrees

**Forschung (FP)** – Hyper-Klicks (max. 25), Netz-Effizienz (25), Quanten-Glück (15),
Offline-Produktion (12), Auto-Klicker (20), Golden Grid (10).

**Solar (SF)** – Langzeit-Belichtung, Sonnen-Radar, Fragment-Ausbeute,
Spektral-Analyse *(schaltet Produktions-Rausch, Klick-Sturm und Fragment-Regen
frei)*, Ketten-Reaktion, Lastspitzen-Kopplung *(Netz-Überladung)*, Prismen-Fokus,
Koronale Resonanz *(Schwarze Sonne)*, Nachleuchten.

**Dyson-Kerne (DK)**

| Skill | Wirkung | Max |
|---|---|---|
| Kern-Resonanz | ×2 Gesamtproduktion pro Level | 12 |
| Forschungs-Katalysator | +50 % FP pro Level | 10 |
| Kern-Echo | behält 15 % der FP pro Level über den Kollaps | 5 |
| Notfall-Backup | startet mit 25 Stück der ersten *N* Stufen | 8 |

### Weiteres

- **6 Sonnen-Typen**, gewichtet gezogen; alle außer der goldenen werden über den
  Solar-Zweig freigeschaltet.
- **9 Events** mit Lore-Text: Wolkig, Sonneneruption, Firmware-Update,
  Nachbarschaftsbeschwerde, Staatliche Subvention (Rabatt statt Multiplikator),
  Netz-Engpass, Hitzewelle sowie Hardware-Defekt und Hackerangriff – die beiden
  letzten sind kritisch und brechen die Produktion ein, bis der Spieler den
  Reparatur-Balken leergeklickt hat.
- **NPCs** (`NPCS` in `data.js`): Herr Küppers, der Netzbetreiber und die GRID-KI
  melden sich im Log. Die ersten beiden hängen an je einem Event und wählen ihre
  Zeile nach der Anzahl der Reboots; die GRID-KI meldet sich ab der FPGA-Steuerung
  alle 45 s mit 15 % Wahrscheinlichkeit und wählt nach gebauter Hardware. Der Ton
  aller drei verändert sich also mit dem Fortschritt.
- **16 Erfolge** und **12 kontextabhängige Onboarding-Hinweise** (jeder feuert genau
  einmal, höchstens einer gleichzeitig).
- **Hintergrund-Szene** mit 100 Ausbaustufen, per Formel aus Hardwarebestand mal
  Techlevel (Ära + Dyson-Kerne) berechnet.

---

## 6. Balancing

### Zielkurve

Ein aktiver Spieler soll rund **eine Woche** brauchen, um alle Stufen und die letzte
Ära zu erreichen. Gemessen mit `simrun.html` (168 h, 3 Klicks/s, durchgehend aktiv):

| Meilenstein | Zeit |
|---|---|
| Erster Reboot (25 FP) | 1,1 h |
| Heimspeicher-Rack | 2,9 h |
| FPGA Grid-Steuerung | 13,8 h |
| RISC-V Coprozessor | 30 h |
| Erster Dyson-Kollaps | 50 h |
| Fusions-Testreaktor | 86 h |
| Letzte Ära | 92 h |
| Stern-Heber (letzte Hardware) | 124 h |

Über mehrere Läufe schwankt das Ende zwischen 120 h und über 200 h, je nachdem wie
gut die Prestige-Schleife anläuft. Ein realer Spieler, der nicht 168 Stunden am
Stück klickt, landet entsprechend eher am oberen Ende.

### Stellschrauben

Alles Tempo-relevante sitzt an wenigen Stellen:

| Schraube | Ort | Wirkung |
|---|---|---|
| `TIER_COST_RATIO` | `data.js` | **die** Tempo-Schraube. 40 bedeutet keine Bremse, größer ist langsamer. Sehr empfindlich: 148 ergibt 127 h, 155 ergibt über 168 h. |
| `TIER_PROD_RATIO_UNITS` | `data.js` | die Regel „ein Stück = *n* Stück der Vorstufe" |
| `BUILDING_MILESTONES` | `data.js` | wie viel es bringt, auf einer Stufe zu bleiben |
| `fpScale`, `fpExponent` | `CONFIG` | wie schnell die FP wachsen |
| `fpProductionPerPoint` | `CONFIG` | Stärke der Prestige-Schleife |
| `metaOutputPerLevel` | `CONFIG` | Stärke der Dyson-Ebene |
| `costFactor` je Stufe | `data.js` | wie lange man auf einer Stufe bleibt |

Faustregel: die Zeit pro Stufe wächst mit `TIER_COST_RATIO / 40` und schrumpft mit
dem Tempo, in dem der globale Multiplikator wächst (FP-Bonus, Kern-Resonanz). Diese
beiden Größen gegeneinander sind das gesamte Balancing.

---

## 7. Werkzeuge

### simrun.html (Browser)

Lädt die echte Engine und spielt sie beschleunigt durch – getestet wird also die
Spiellogik selbst, keine Nachbildung. Aufruf im Browser:

    simrun.html?h=168&cps=3

`h` sind die simulierten Stunden, `cps` die Klicks pro Sekunde. Balancing-Werte
lassen sich per Query überschreiben, ohne eine Datei anzufassen: `tcr`
(TIER_COST_RATIO), `cf` (costFactor für alle Stufen), `fps`, `fpe`, `fpp`, `co`,
`md`, `mu`, `ms`. Beispiel:

    simrun.html?h=200&tcr=180&fpp=0.005

Ausgabe: Zeitpunkt jeder ersten Hardware, Ären, Kollapse und der Endstand. Denselben
Text hält `window.SIM_RESULT`, die Rohdaten `window.SIM_DATA`. Die Seite trägt
`noindex` und ist nirgends verlinkt.

### balance-sim.js (Node)

Dasselbe Prinzip auf der Kommandozeile: `node balance-sim.js 168 aktiv 3`. Gehört
nicht auf den Webserver. Braucht eine Node-Installation – wo keine da ist, tut
`simrun.html` denselben Dienst.

Beide Simulatoren benutzen dieselbe Kaufheuristik – bester Produktionszuwachs pro
Wh, Meilensteine eingerechnet – und folgen der Reboot-Empfehlung des Spiels. Das ist
eine Heuristik und kein echter Spieler: sie zeigt die Form der Kurve, nicht die
exakte Spielzeit.

---

## 8. Spielstand

`localStorage`, Key `gridTycoonSave`, Format `{ v: 2, state: {...} }`. Autosave alle
10 s plus beim Schließen des Tabs. Beim Laden füllt `mergeState` fehlende Felder aus
Alt-Saves auf (v1 lag flach im Objekt), neue Hardware und Skills werden mit 0
ergänzt – ein Spielstand überlebt also das Hinzufügen von Inhalten.

Was ein Spielstand **nicht** überlebt: Änderungen an den Balancing-Formeln. Wer die
FP-Formel oder `TIER_COST_RATIO` anfasst, sollte den eigenen Stand wipen, sonst
steht er mit Werten aus einer anderen Wirtschaft da.

Export und Import laufen über Base64 im Optionen-Panel.

---

## 9. Erweitern

- **Neue Hardware:** Objekt in `BUILDINGS_DB` (die Position bestimmt die
  Reihenfolge), Icon in `ICONS`. `baseProd` und `baseCost` **nicht** setzen – beide
  werden abgeleitet.
- **Neuer Skill, Sonnen-Skill oder Meta-Skill:** Eintrag in der jeweiligen DB. Die
  Wirkung muss zusätzlich in der Engine ausgewertet werden; Skills sind keine reinen
  Daten-Effekte.
- **Neues Event, neue Sonne, neuer Erfolg, neuer Hinweis:** rein additiv in
  `data.js`, kein Eingriff in die Engine nötig.
- **Neue Größenordnung bei den Zahlen:** nichts zu tun. `Num` steigt von k…No auf
  a…z (ohne das schon vergebene „k") und danach auf aa…zz um. Die Leiter ist
  bijektive Basis 26 und damit nach oben offen – sie deckt den kompletten
  JavaScript-Zahlenbereich (Ende bei rund 1.8e308) um Größenordnungen ab.
- Nach jeder Balance-Änderung `simrun.html` laufen lassen und die Zeiten mit
  Abschnitt 6 vergleichen.

---

## 10. Offene Punkte

- Gerechnet wird mit normalen JavaScript-Zahlen, Ende bei rund 1.8e308. Die aktuelle
  Kurve bleibt weit darunter; für ein echtes Endlos-Endgame bräuchte es
  Mantisse/Exponent-Arithmetik quer durch Engine und Spielstand.
- Die Hintergrund-Szene bildet ihren Fortschritts-Score über alle Hardware-Stufen.
  Mit 18 statt 10 Stufen erreicht sie die letzten der 100 Ausbaustufen etwas früher
  als ursprünglich ausgelegt – kosmetisch, aber irgendwann einen Blick wert.
- Die Simulatoren streuen stark, weil die Prestige-Heuristik viel entscheidet.
  Mehrere Läufe mitteln, bevor man an einer Schraube dreht.
