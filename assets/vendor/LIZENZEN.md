# Fremde Bibliotheken (selbst gehostet)

Diese Dateien liegen bewusst im eigenen Repository statt auf einem CDN.
So wird beim Aufruf der Seite keine IP-Adresse an Dritte übertragen und es
ist keine Einwilligung nach § 25 TDDDG nötig.

Beide Bibliotheken stehen unter der MIT-Lizenz, die das Weiterverbreiten
ausdrücklich erlaubt, solange der Lizenz- und Urheberrechtshinweis erhalten
bleibt.

## tailwind.js

- Tailwind CSS – Play CDN (Browser-Build)
- Bezogen von: https://cdn.tailwindcss.com
- Projekt: https://tailwindcss.com
- Lizenz: MIT, Copyright (c) Tailwind Labs, Inc.
- Lizenztext: https://github.com/tailwindlabs/tailwindcss/blob/main/LICENSE

Hinweis: Der Play-Build übersetzt die Utility-Klassen zur Laufzeit im
Browser. Ein vorab gebautes, ausgedünntes CSS wäre deutlich kleiner,
setzt aber eine Node-Werkzeugkette voraus.

## mqtt.min.js

- MQTT.js 5.10.1 (Browser-Bundle)
- Bezogen von: https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js
- Projekt: https://github.com/mqttjs/MQTT.js
- Lizenz: MIT, Copyright (c) 2015-2024 MQTT.js contributors
- Lizenztext: https://github.com/mqttjs/MQTT.js/blob/main/LICENSE.md

## Aktualisieren

    curl -sSL -A "Mozilla/5.0" -o assets/vendor/tailwind.js https://cdn.tailwindcss.com
    curl -sSL -o assets/vendor/mqtt.min.js https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js

Nach einem Update kurz prüfen, dass die Seiten weiterhin ohne externe
Requests auskommen (Netzwerk-Tab der Entwicklerwerkzeuge).
