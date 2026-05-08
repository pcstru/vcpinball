// What: Local high-score storage for browser play mode.
// Why: Each named table needs its own small leaderboard without requiring a server.
(function initHighScores(Pin) {
    const STORAGE_PREFIX = "pin.highScores.v1.";
    const GENERIC_HIGH_SCORE_KEY = "pinball.generic.highscore";
    const MAX_ENTRIES = 5;

    function slugify(value) {
        /* What: Convert user/table identifiers into stable localStorage key parts.
         * Why: Browser storage keys should be readable, deterministic, and safe for
         *      table names that include spaces or punctuation.
         */
        const slug = String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        return slug || "untitled-table";
    }

    function tableKey(table) {
        /* What: Resolve the high-score namespace for a table.
         * Why: Custom table keys should remain honored, while the built-in default
         *      must not make unrelated named tables share one leaderboard.
         */
        const rules = table && table.rules ? table.rules : {};
        const explicit = typeof rules.highScoreKey === "string" ? rules.highScoreKey.trim() : "";
        if (explicit && explicit !== GENERIC_HIGH_SCORE_KEY) return STORAGE_PREFIX + slugify(explicit);
        return STORAGE_PREFIX + slugify(table && table.name ? table.name : "Untitled Table");
    }

    function normalizeInitials(value) {
        /* What: Normalize player-entered initials.
         * Why: Leaderboard rows should remain compact and consistent.
         */
        return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
    }

    function normalizeEntries(entries) {
        /* What: Sanitize, sort, and cap saved high-score rows.
         * Why: localStorage can be edited or corrupted, so reads must be defensive.
         */
        if (!Array.isArray(entries)) return [];
        return entries.map(function map(entry) {
            const score = Number(entry && entry.score);
            const initials = normalizeInitials(entry && entry.initials);
            if (!initials || initials.length !== 3 || !Number.isFinite(score) || score <= 0) return null;
            return {
                initials: initials,
                score: Math.floor(score),
                at: typeof (entry && entry.at) === "string" ? entry.at : ""
            };
        }).filter(Boolean).sort(function sort(a, b) {
            return b.score - a.score;
        }).slice(0, MAX_ENTRIES);
    }

    function load(table) {
        /* What: Load the leaderboard for one table.
         * Why: Play mode needs a current score list before and after each game.
         */
        if (typeof localStorage === "undefined") return [];
        const key = tableKey(table);
        try {
            return normalizeEntries(JSON.parse(localStorage.getItem(key) || "[]"));
        } catch (err) {
            console.warn("Ignoring corrupt high-score storage for " + key + ".", err);
            return [];
        }
    }

    function save(table, entries) {
        /* What: Persist a normalized leaderboard for one table.
         * Why: Browser-local scores should survive refreshes without changing table JSON.
         */
        const normalized = normalizeEntries(entries);
        if (typeof localStorage !== "undefined") {
            localStorage.setItem(tableKey(table), JSON.stringify(normalized));
        }
        return normalized;
    }

    function qualifies(table, score) {
        /* What: Decide whether a finished score belongs on the table.
         * Why: The play overlay should only ask for initials when the score can be saved.
         */
        const value = Math.floor(Number(score) || 0);
        if (value <= 0) return false;
        const entries = load(table);
        if (entries.length < MAX_ENTRIES) return true;
        return value > entries[entries.length - 1].score;
    }

    function add(table, initials, score) {
        /* What: Add one finished game result and persist the capped leaderboard.
         * Why: Initial entry, sorting, and trimming should be owned by one storage API.
         */
        const cleanInitials = normalizeInitials(initials);
        const value = Math.floor(Number(score) || 0);
        if (cleanInitials.length !== 3 || value <= 0) return load(table);
        const entries = load(table);
        entries.push({ initials: cleanInitials, score: value, at: new Date().toISOString() });
        return save(table, entries);
    }

    Pin.highScores = {
        MAX_ENTRIES: MAX_ENTRIES,
        keyForTable: tableKey,
        load: load,
        save: save,
        add: add,
        qualifies: qualifies,
        normalizeInitials: normalizeInitials
    };
})(window.Pin);
