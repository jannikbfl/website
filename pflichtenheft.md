Game Design Document (GDD) – Energy Grid Tycoon
1. Projektübersicht
"Energy Grid Tycoon" (ehemals Balkonkraftwerk Idle) ist ein browserbasiertes Incremental/Idle-Game im Setting von Hardware-Entwicklung, Smart Home und Energiemanagement. Der Spieler startet mit einem einfachen Balkon-Solarpanel und skaliert hoch bis zu automatisiertem Stromhandel und KI-gesteuerten Stromnetzen.

Technologie-Stack: HTML5, Tailwind CSS (via CDN), Vanilla JavaScript, LocalStorage für Savegames.

Aktueller Zustand: Ein funktionierender Prototyp als Monolith (game.html), der Kern-Loops, Upgrades, Prestige und Random Events enthält.

2. Ziel-Architektur (Refactoring-Auftrag)
Aktuelles Problem: UI, Styling und Logik liegen in einer einzigen, unübersichtlichen HTML-Datei.
Ziel: Saubere Trennung nach dem Model-View-Controller (MVC) bzw. einer modularen Struktur. Der Coding-Agent soll den Monolithen in folgende Dateien aufteilen:

game.html (Nur noch das HTML-Gerüst, Einbindung von Tailwind und den Scripts).

style.css (Für Keyframe-Animationen wie float-up, pulse-glow, Custom Scrollbars).

data.js (Reine Datenstruktur: Arrays für BUILDINGS_DB, SKILLS_DB, EVENTS).

engine.js (Die Kernlogik: Game-Loop, Klick-Event, Event-Spawner, Save/Load).

ui.js (Sämtliche DOM-Manipulationen, Update-Funktionen und UI-Listener).

3. Kernmechaniken & Formeln
Ressourcen
Energie (Wh): Die Standard-Währung zum Kauf von Hardware.

Lebensenergie (Lifetime Energy): Versteckte Metrik. Zählt alle je generierten Wh über alle Durchläufe hinweg. Dient als Basis für FP.

Forschungspunkte (FP): Die Prestige-Währung, generiert durch einen System-Reboot (Ascension).

Skalierung & Mathematik
Gebäude-Kosten:
Kosten = BaseCost * (1.15 ^ AnzahlBisherGekauft)

Skill-Kosten:
Kosten = BaseCost * (CostFactor ^ aktuellesLevel) (CostFactor variiert je nach Skill, z.B. 1.5 oder 2.0)

Prestige-Punkte (FP) Berechnung beim Reboot:
Verfügbare FP = Math.floor(Math.sqrt(LifetimeEnergy / 50000)) - BisherVerdienteUndAusgegebeneFP

Passive Produktion (EPS - Energy Per Second):
EPS = (Summe_aller_Gebäude_Produktion) * (1 + (PassiveSkillLevel * 0.20)) * AktuellerEventMultiplikator

Klick-Stärke:
Klick = (1 + (EPS * 0.05)) * (1 + (ClickSkillLevel * 1.0)) * AktuellerEventMultiplikator

4. Aktueller Content (Status Quo)
Gebäude (Hardware):

Balkon-Panel (Kosten: 15, Prod: 1)

Wechselrichter (Kosten: 150, Prod: 8)

Smart Meter API (Kosten: 1800, Prod: 60)

Heimspeicher-Rack (Kosten: 24.000, Prod: 500)

FPGA Grid-Steuerung (Kosten: 350.000, Prod: 4.500)

RISC-V Coprozessor (Kosten: 5.000.000, Prod: 40.000)

Python Stromhandel (Kosten: 75.000.000, Prod: 350.000)

Skills (Forschung):

Hyper-Klicks (+100% Klickstärke)

Netz-Effizienz (+20% passive Produktion)

Quanten-Glück (Erhöht Spawn-Rate von Events und Minigames)

Events & Minigames:

Buffs (Firmware-Update, Sonneneruption) & Debuffs (Wolkig, Nachbarschaftsbeschwerde).

"Goldene Sonne" (Minispiel): Spawnt zufällig auf dem Screen, gibt beim Klicken 60 Sekunden der aktuellen Produktion (min. 100 Wh) als Sofort-Bonus.

5. Inhalts-Roadmap (Neue Features für spätere Sprints)
Der Agent soll die Architektur so vorbereiten, dass folgende Features später leicht über die data.js oder kleine Module hinzugefügt werden können:

Neue Gebäude (Late-Game):

Virtuelles Kraftwerk (VPP)

Fusions-Testreaktor

Dyson-Schwarm (Satelliten-Netzwerk)

Neue Skills (Prestige-Tree erweitern):

Offline-Produktion: Generiert Strom weiter, wenn der Tab geschlossen ist (bis zu X Stunden).

Auto-Klicker: Simuliert X Klicks pro Sekunde.

Golden Grid: Erhöht den Multiplikator von Goldenen Sonnen auf 120 Sekunden.

Neue Random Events:

Positiv: "Staatliche Subvention" (+10% Rabat auf Gebäude für 60s).

Negativ: "Hardware-Defekt / Hackerangriff" (Produktion sinkt massiv, man muss mehrfach auf einen Button hämmern, um das System zu rebooten).

6. Arbeitsanweisung für den KI-Agenten (Prompt)
(Diesen Block liest der Agent, um zu wissen, was er als Erstes tun soll)

Aktueller Auftrag (Sprint 1: Architektur-Refactoring):

Lies die bestehende game.html aus dem Verzeichnis ein.

Erstelle die Dateien engine.js, ui.js, data.js und style.css.

Extrahiere den Code ohne Änderungen der Spiellogik in diese neuen Dateien.

Passe die game.html an, sodass sie die externen Dateien korrekt verknüpft (<link> für CSS, <script src="..."> für JS). Achte auf die korrekte Lade-Reihenfolge (erst data, dann engine, dann ui).

Optimiere den Code beim Extrahieren leicht (z.B. sauberes State-Management, Vermeidung von globalen Variablen wo möglich), aber behalte das exakte Balancing und die Funktionalität bei.