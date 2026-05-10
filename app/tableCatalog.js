/*
 * Bundled table catalog.
 * What: Lists table JSON files that the static selector can offer.
 * Why: Browsers cannot enumerate the tables directory from a static page, so
 * this manifest is the app's explicit source of truth for bundled tables.
 */
(function initTableCatalog(Pin) {
    Pin.tableCatalog = {
        tables: [
            { ref: "tables/DefTable.json" },
            { ref: "tables/ABC.json" },
            { ref: "tables/Cobra.json" },
            { ref: "tables/cyberpin.json" },
            { ref: "tables/Doodle.json" },
            { ref: "tables/Egypt.json" },
            { ref: "tables/hi-tl.json" },
            { ref: "tables/hitl_sequence_columns.pin.json" },
            { ref: "tables/Kitten.json" },
            { ref: "tables/mtpb.json" },
            { ref: "tables/PB-V2.json" },
            { ref: "tables/VC-2.pin.json" },
            { ref: "tables/empty.json" }
        ]
    };
})(window.Pin);
