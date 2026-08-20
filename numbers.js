/* ============================================================
   Energy Grid Tycoon – numbers.js
   Zahlen-Engine. Formatiert die Werte, die im Spiel schnell
   jede Vorstellungskraft verlassen, in eine kurze, eindeutige
   Schreibweise. Keine Spiellogik, keine DOM-Zugriffe.

   SUFFIX-LEITER (immer in Dreierschritten des Exponenten):

     < 1.000        keine Einheit, ganze Zahl
     1e3  .. 1e30   k, M, B, T, Qa, Qi, Sx, Sp, Oc, No
     1e33 .. 1e105  a, b, c, ... z   (ohne 'k', siehe unten)
     1e108 ..       aa, ab, ... zz, danach aaa, aab, ...

   Die Buchstabenleiter ist bijektive Basis 26 (wie Spalten in
   einer Tabellenkalkulation) und damit praktisch unbegrenzt –
   sie laeuft dem Wertebereich von JavaScript-Zahlen (Ende bei
   ~1.8e308, dort steht dann '∞') um Groessenordnungen davon.

   Einzige Ausnahme in der Leiter: das einzelne 'k' wird
   uebersprungen, weil es schon fuer Tausend vergeben ist. Zwei
   um 60 Nullen verschiedene Werte duerfen nicht gleich aussehen
   (das Buchstaben-k waere 1e63 gewesen).
   ============================================================ */

const Num = (function () {
    'use strict';

    const SHORT = ['', 'k', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No'];
    const RESERVED = ['k'];                // schon in SHORT vergeben
    const cache = SHORT.slice();
    let nextLetter = 0;                    // Position in der Buchstabenfolge

    /** Bijektive Basis 26: 0 -> a, 25 -> z, 26 -> aa, 701 -> zz, 702 -> aaa */
    function letters(index) {
        let out = '';
        let n = index + 1;
        while (n > 0) {
            n--;
            out = String.fromCharCode(97 + (n % 26)) + out;
            n = Math.floor(n / 26);
        }
        return out;
    }

    /** Suffix fuer die n-te Dreiergruppe (0 = Einer, 1 = Tausend, ...). */
    function suffix(group) {
        if (group < 0) return '';
        while (cache.length <= group) {
            const s = letters(nextLetter++);
            if (RESERVED.indexOf(s) === -1) cache.push(s);
        }
        return cache[group];
    }

    /**
     * Kurzschreibweise mit drei bis vier signifikanten Stellen:
     * 999, 1.23k, 12.3k, 123.4k, 1.23M ...
     */
    function format(num) {
        if (typeof num !== 'number' || isNaN(num)) return '0';
        if (num < 0) return '-' + format(-num);
        if (!isFinite(num)) return '∞';
        if (num < 1000) return Math.floor(num).toString();

        let group = 0;
        let n = num;
        while (n >= 1000) { n /= 1000; group++; }

        // Rundung kann die Gruppe kippen: 999.999k darf nicht '1000.0k' werden
        let digits = n < 10 ? 2 : 1;
        if (parseFloat(n.toFixed(digits)) >= 1000) { n /= 1000; group++; digits = 2; }

        return n.toFixed(digits) + suffix(group);
    }

    /**
     * Multiplikatoren: klein genauer (x1.25), gross kompakt (x12.3k).
     * Eigene Regel, weil hier die zweite Nachkommastelle den
     * Unterschied macht, solange der Faktor noch klein ist.
     */
    function mult(m) {
        if (typeof m !== 'number' || isNaN(m)) return '1.00';
        if (!isFinite(m)) return '∞';
        return m < 1000 ? m.toFixed(2) : format(m);
    }

    /** Volle Stellenzahl mit Tausenderpunkten – fuer Tooltips und Statistik. */
    function exact(num) {
        if (typeof num !== 'number' || isNaN(num)) return '0';
        if (!isFinite(num)) return '∞';
        if (Math.abs(num) >= 1e21) return num.toExponential(3);
        return Math.floor(num).toLocaleString('de-DE');
    }

    return {
        format: format,
        mult: mult,
        exact: exact,
        suffix: suffix
    };
})();
