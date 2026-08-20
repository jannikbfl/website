# Erzgrund – Game Design & Technik

**Stand:** August 2026 · **Live:** [biefel.de/erzgrund.html](https://biefel.de/erzgrund.html)

Zweites Spiel der Seite. Das erste (Energy Grid Tycoon) ist in
[pflichtenheft.md](pflichtenheft.md) beschrieben; geteilt wird nur `numbers.js`.

---

## 1. Überblick

Ein Farm- und Minenspiel in der Draufsicht. Man steuert eine Figur mit WASD über
ein Tal, schlägt Holz, baut Erz ab, bepflanzt Beete, stellt Maschinen auf, die nach
Rezepten weiterverarbeiten – und setzt am Ende die stillgelegte Erzbahn wieder in
Betrieb. Vorbilder: Stardew Valley (Tagesrhythmus, Ausdauer, Beete), Hypixel
Skyblock (Werkzeugstufen, Sohlen), Hay Day (Maschinen mit Warteschlange).

**Technik:** HTML5 Canvas, Vanilla JavaScript, Tailwind CSS (CDN), LocalStorage.
Keine Build-Kette, keine Bilddateien – alle Grafik wird mit Canvas-Primitiven
gezeichnet.

**Die Schleife:**

1. **Sammeln** – Bäume, Felsen und Erzadern abbauen. Kostet Ausdauer.
2. **Anbauen** – Saatgut kaufen, Beete bepflanzen, in Echtzeit wachsen lassen.
3. **Verarbeiten** – Maschinen bauen, Rezepte einreihen; sie arbeiten weiter,
   während man woanders ist.
4. **Aufrüsten** – bessere Werkzeuge schlagen schneller, kosten weniger Kraft und
   schalten härtere Rohstoffe frei.
5. **Absteigen** – vier Sohlen, jede braucht die nächste Spitzhackenstufe.
6. **Bauen** – vier Abschnitte der Erzbahn. Danach Abspann und freies Spiel.

---

## 2. Architektur

| Datei | Zuständigkeit |
|---|---|
| `erzgrund-data.js` | Gegenstände, Pflanzen, Werkzeuge, Rohstoff-Felder, Maschinen, Ziele, Hinweise, Weltbeschreibung, `EG_CONFIG`. Keine Logik. |
| `erzgrund-engine.js` | `EG` – Welt bauen, Bewegung, Interaktion, Wirtschaft, Zeit, Speicherstand. Kein DOM. |
| `erzgrund-render.js` | `EGRender` – zeichnet Welt, Figur, Licht und Effekte aufs Canvas. |
| `erzgrund-ui.js` | `EGUI` – Eingabe, Spielschleife, HUD, Panels, Touch-Steuerung. |
| `erzgrund.html` | Gerüst, HUD-Elemente, Panel- und Abspann-Container. |
| `erzgrund.css` | Was Tailwind nicht sinnvoll abdeckt: Canvas, Steuerkreuz, Panel-Zeilen, Meldungen. |
| `numbers.js` | Wird mit dem ersten Spiel geteilt (Zahlformatierung). |

Die Engine meldet Ereignisse über `EG.on(...)`: *log, inventory, open, gathered,
hit, collected, goal, hint, machineDone, map, slept, exhausted, finished*.

---

## 3. Welt

Die Karten werden nicht als Zeichengitter gepflegt, sondern aus einer kleinen
Beschreibungs-Sprache erzeugt (`EG_MAPS`). Verfügbare Operationen: `fill`,
`scatter`, `path`, `set`, `pond`, `fence`, `caves`. Der Zufall darin ist
deterministisch (Mulberry32 mit fester Saat) – sonst lägen gespeicherte
Rohstoff-Felder nach einem Reload woanders.

**Zeichen:** `.` Boden · `,` Weg · `#` Fels · `~` Wasser · `b` Beet · `f` Zaun ·
`T` Baum · `R` Fels · `C` Kohle · `K` Kupfer · `I` Eisen · `G` Gold · `X` Diamant ·
`H` Haus · `S` Laden · `V` Verkaufskiste · `M` Bauplatz · `D` Stolleneingang ·
`N`/`U` Leitern · `E` Erzbahn-Station.

**Karten:** das Tal (44×30) mit Wald im Westen, Steinfeld im Osten, Hof in der
Mitte und Station im Südosten; darunter vier Sohlen (32×22) mit unterschiedlicher
Erzmischung.

### Erreichbarkeits-Reparatur

Höhlen werden gewürfelt und danach mit Erz bestreut – dabei kann ein Gang zuwachsen
oder eine Leiter in der Wand landen. Statt das über vorsichtigere
Wahrscheinlichkeiten zu umgehen (was nie ganz sicher wäre), prüft `repairMap()` die
fertige Karte per Flutfüllung und gräbt fehlende Verbindungen nach: erst zu allen
Leitern, dann zu abgeschnittenen Kammern ab zwölf Feldern. Ohne diesen Pass war in
den ersten Tests die Leiter nach unten auf zwei von vier Sohlen unerreichbar.

---

## 4. Regeln und Formeln

### Zeit

`state.clock` zählt Ingame-Minuten. Eine echte Sekunde sind 1,5 Ingame-Minuten, ein
Tag läuft von 6:00 bis 2:00 – also gut 13 echte Minuten. Pflanzen, Maschinen,
Tageslicht und Offline-Nachlauf hängen alle an dieser einen Uhr. Nach 2:00 kippt die
Figur um und wacht am nächsten Morgen auf.

Beim Laden werden bis zu zehn Ingame-Stunden nachgeholt: Felder sind gewachsen,
Maschinen haben produziert.

### Abbau

    Schläge = aufgerundet(Härte des Feldes / Kraft des Werkzeugs)

Jeder Schlag kostet die Ausdauer der Werkzeugstufe. Liegt die Werkzeugstufe unter
`level` des Feldes, geht gar nichts. Abgebaute Felder wachsen nach `respawnMin`
Ingame-Minuten nach.

| Feld | Härte | ab Stufe | Nachwuchs |
|---|---|---|---|
| Baum | 3 | 1 | 240 min |
| Felsbrocken | 3 | 1 | 240 min |
| Kohleflöz | 5 | 1 | 420 min |
| Kupferader | 8 | 2 | 480 min |
| Eisenader | 14 | 3 | 600 min |
| Goldader | 22 | 4 | 720 min |
| Diamantader | 34 | 5 | 900 min |

### Werkzeuge

Sechs Stufen je Axt und Spitzhacke: Holz, Stein, Kupfer, Eisen, Stahl, Diamant.
Kraft 1 → 13, Ausdauerkosten 3,5 → 1,5. Geschmiedet wird im Laden gegen Taler und
Material.

### Ausdauer

100 Punkte, kein passives Nachwachsen. Auffüllen über Essen (rohes Gemüse gibt
wenig, Gekochtes viel) oder Schlafen (voll). Das ist der Grund, warum sich der
eigene Acker früh lohnt: eine Karotte ist 16 Taler oder 10 Ausdauer wert.

### Pflanzen

Saatgut kaufen, auf einem freien Beet E drücken, nach `growHours` ernten. Beete
lassen sich im Laden dazukaufen, der Preis steigt um 35 % je Beet.

| Pflanze | Wachszeit | Ertrag | Verkauf |
|---|---|---|---|
| Weizen | 3 h | 2–3 | 11 T |
| Karotte | 4 h | 1–2 | 16 T |
| Kartoffel | 7 h | 1–3 | 27 T |
| Kürbis | 15 h | 1 | 155 T |

Kürbiskerne stehen erst ab 15 Ernten im Laden – vorher wäre der teure Kern nur eine
Falle.

### Maschinen

Acht Stück, jede auf einem Bauplatz am Hof, jede mit Warteschlange (max. 5
Aufträge). Sie laufen unabhängig vom Aufenthaltsort weiter.

| Maschine | macht aus … | … |
|---|---|---|
| Sägewerk | 3 Holz | 1 Brett |
| Steinsäge | 3 Stein | 1 Ziegel |
| Schmelzofen | Erz + Kohle | Kupfer-, Eisen-, Goldbarren |
| Mühle | 4 Weizen | 1 Mehl |
| Feldküche | Mehl, Gemüse | Brot, Eintopf, Kürbissuppe |
| Legierofen | Eisen + Kupfer + Kohle | Stahl |
| Schleiferei | Diamant + Stahl | Schliffdiamant |
| Montagehalle | Barren, Bretter, Stahl | die vier Erzbahn-Teile |

Rezepte mit `unlock` erscheinen erst, wenn der Rohstoff einmal im Beutel war – der
Schmelzofen zeigt Eisen also erst, wenn Eisenerz gefunden wurde.

### Ende

Vier Bauabschnitte an der Station, nacheinander freigeschaltet: Gleisstrecke,
Erzwaggon, Maschinenhaus, Signalanlage. Der letzte löst den Abspann aus
(`EG_ENDING`), setzt `state.finished` und lässt fortan einen Zug an der Station
stehen. Danach läuft der Hof normal weiter – kein Reset, kein zweiter Durchgang.

### Ziele

14 Etappenziele mit Talerprämie (`EG_GOALS`), von „Fälle 10 Holz" bis „Stell einen
Abschnitt der Erzbahn fertig". Sie ersetzen ein Questlog: Richtung ohne Bürokratie.
Dazu sieben Hinweise (`EG_HINTS`), die kontextabhängig genau einmal erscheinen.

---

## 5. Steuerung

| Eingabe | Wirkung |
|---|---|
| WASD / Pfeiltasten | laufen |
| E / Leertaste | benutzen (gedrückt halten schlägt weiter) |
| 1–4 | Saatgut wählen |
| I / Z / H | Beutel / Ziele / Steuerung |
| Esc | Panel schließen |
| Steuerkreuz + großer Knopf | dasselbe auf Touch-Geräten |

Das Zielfeld ist das Feld vor der Figur; steht dort nichts Benutzbares, zählt das
Feld darunter. **Ausnahme:** Leitern gewinnen immer gegen das Feld davor – sonst
blockiert eine Erzader neben der Leiter den Abstieg.

---

## 6. Balancing

Zielgröße ist ein Durchspielen in wenigen Stunden aktiver Spielzeit, verteilt über
mehrere Sitzungen (Maschinen und Wachstum laufen zwischendurch weiter). Die Kurve
ist von Hand gesetzt, nicht simuliert – anders als beim ersten Spiel gibt es hier
keinen Simulator, weil zu viel an der Bewegung der Figur hängt.

Die Stellschrauben sitzen alle in `erzgrund-data.js`:

| Schraube | Wirkung |
|---|---|
| `EG_CONFIG.minutesPerSecond` | Tempo der gesamten Welt (Tage, Wachstum, Maschinen) |
| `EG_CONFIG.staminaMax` und die `stamina`-Werte der Werkzeuge | wie viel pro Tag geht |
| `hardness` / `power` | wie zäh sich Abbau anfühlt |
| `growHours` und Verkaufspreise | ob sich der Acker gegen den Stollen lohnt |
| `minutes` der Rezepte | wie stark Maschinen die Handarbeit ersetzen |
| Kosten der Werkzeugstufen und Maschinen | Länge der Aufrüst-Kette |

---

## 7. Spielstand

`localStorage`, Key `erzgrundSave`, Format `{ v: 1, t: Zeitstempel, state: {...} }`.
Autosave alle 15 Sekunden plus beim Schließen des Tabs; Schlafen speichert
ebenfalls. Der Zeitstempel dient dem Offline-Nachlauf.

Beim Löschen wird das Speichern zuerst stillgelegt – sonst schreibt der
`beforeunload`-Haken beim Neuladen den alten Stand direkt wieder hin. Export und
Import laufen über Base64 im Optionen-Panel.

---

## 8. Erweitern

- **Neuer Gegenstand:** Eintrag in `EG_ITEMS` (mit `price` für die Verkaufskiste,
  mit `food` wenn essbar). Mehr braucht es nicht.
- **Neue Pflanze:** Eintrag in `EG_CROPS`; optional `unlock: state => …`.
- **Neue Maschine oder neues Rezept:** Eintrag in `EG_MACHINES`. Rezepte sind reine
  Daten, die Engine kennt keine Sonderfälle.
- **Neues Rohstoff-Feld:** Zeichen in `EG_NODES`, dann in `EG_MAPS` streuen und in
  `SOLID` (Engine) sowie im Renderer eine Farbe ergänzen.
- **Neue Karte:** Eintrag in `EG_MAPS` mit `up`/`down` und optional `needLevel`.
  Die Erreichbarkeits-Reparatur läuft automatisch mit.

---

## 9. Offene Punkte

- Kein Simulator: die Kurve ist geschätzt, nicht gemessen. Wer das Tempo
  ernsthaft prüfen will, müsste einen Bot über die Karte laufen lassen.
- Der Zufall beim Abbau (`Math.random` für Mengen) ist bewusst nicht
  deterministisch – nur die Weltform ist es.
- Es gibt keine Jahreszeiten, kein Wetter und keine NPCs. Alles drei wäre ein
  natürlicher nächster Schritt, wenn das Spiel größer werden soll.
