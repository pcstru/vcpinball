/* What: Standalone #logic authoring endpoint UI.
 * Why: Logic design should be isolated from playfield/table geometry editing and presented in gameplay terms.
 */
(function initLogicPage(Pin) {
    var BUILTIN_TIMER_SWITCHES = [
        { id: "timer_100ms", name: "Timer 100ms", kind: "timer", sourceElementId: "timer_100ms", intervalMs: 100 },
        { id: "timer_1s", name: "Timer 1s", kind: "timer", sourceElementId: "timer_1s", intervalMs: 1000 }
    ];

    function mount(root, options) {
        /* What: Mount the logic-focused editor workspace.
         * Why: Users need to read, edit, test, and export logic without thinking in raw runtime JSON first.
         */
        options = options || {};
        /*
         * Keep logic-mode refreshes anchored to local editor state.
         * Why: a stale #logic&t=... token can override autosave on Ctrl+Refresh.
         */
        if (window.history && window.history.replaceState && /^#logic(&|$)/.test(location.hash || "")) {
            window.history.replaceState(null, "", location.pathname + location.search + "#logic");
        }
        if (typeof root._pinballCleanup === "function") root._pinballCleanup();
        root.innerHTML = "";

        var table = Pin.table.cloneTable(options.table || Pin.table.createEmptyTable());
        var assets = Pin.logicAssets.extractAssets(table);
        var doc = Pin.logicCompile.extractFromTable(table);
        var selected = { collection: "", index: -1 };
        var selectedFeatureId = "";
        var activeSection = "features";
        var featureDraft = null;

        hydrateSwitchRegistry();
        ensureBuiltInTimerSwitches();
        var runtime = Pin.logicSim.createRuntime(doc);
        persistLogicDocument();

        var layout = document.createElement("div");
        layout.className = "logic-workbench logic-workbench-human";
        var nav = document.createElement("div");
        nav.className = "logic-nav";
        var main = document.createElement("div");
        main.className = "logic-main";
        var inspector = document.createElement("div");
        inspector.className = "logic-inspector";
        layout.appendChild(nav);
        layout.appendChild(main);
        layout.appendChild(inspector);
        root.appendChild(layout);

        function rerunValidation() {
            /* What: Validate the current logic document against extracted table assets.
             * Why: Every editor view needs the same source of truth for errors and warnings.
             */
            return Pin.logicValidate.validateDocument(doc, assets);
        }

        function rerunRuntime() {
            /* What: Rebuild the pure logic simulation runtime.
             * Why: State definitions, computed values, and lamp expressions can change during editing.
             */
            runtime = Pin.logicSim.createRuntime(doc);
        }

        function persistLogicDocument() {
            /* What: Persist current logic source into the working table and autosave.
             * Why: Route changes/reloads should not discard logic naming or rule edits.
             */
            table = Pin.logicCompile.applyToTable(table, doc);
            Pin.storage.local.save("autosave", table);
        }

        function clearAllLogic() {
            /* What: Reset all authored logic and feature metadata for the current table.
             * Why: Designers need a single action to start over without touching playfield geometry.
             */
            var sure = window.confirm("Are you sure you want to clear all logic and feature data for this table?");
            if (!sure) return;
            doc = Pin.logicTypes.normalizeLogicDocument({
                logicVersion: "v1",
                switchRegistry: [],
                stateTable: [],
                computedState: [],
                lampBindings: [],
                actionRules: [],
                resetRules: []
            });
            ensureBuiltInTimerSwitches();
            table.features = [];
            selected = { collection: "", index: -1 };
            selectedFeatureId = "";
            featureDraft = null;
            rerunRuntime();
            persistLogicDocument();
            render();
        }

        function commitDocChange(options) {
            /* What: Apply one intentional document mutation.
             * Why: Rendering should not rewrite the table; only user edits should compile/autosave.
             */
            options = options || {};
            if (options.runtime !== false) rerunRuntime();
            persistLogicDocument();
            if (options.render) render();
        }

        function sections() {
            /* What: List the human-facing navigation sections.
             * Why: The editor should start from gameplay tasks, not internal JSON table names.
             */
            return [
                { id: "features", label: "Features" },
                { id: "rules", label: "Rules" },
                { id: "state", label: "State" },
                { id: "feedback", label: "Feedback" },
                { id: "simulator", label: "Simulator" },
                { id: "diagnostics", label: "Diagnostics" }
            ];
        }

        function countSwitchRuleUsage(switchId) {
            /* What: Count rules/resets triggered by a switch.
             * Why: Signal browser badges should show where imported switches are used.
             */
            var actionHits = doc.actionRules.filter(function filter(rule) { return rule && rule.trigger === switchId; }).length;
            var resetHits = doc.resetRules.filter(function filter(rule) { return rule && rule.trigger === switchId; }).length;
            return actionHits + resetHits;
        }

        function countStateRuleUsage(stateId) {
            /* What: Count action rules that write to a state variable.
             * Why: State impact helps explain downstream consequences in the browser.
             */
            return doc.actionRules.filter(function filter(rule) {
                var effects = (rule && Array.isArray(rule.effects)) ? rule.effects : [];
                return effects.some(function some(effect) { return effect && effect.target === stateId; });
            }).length;
        }

        function renderSignalBrowser(validation) {
            /* What: Render left-pane imported signal/device browser.
             * Why: Logic editing should start from table signals and usage, not raw storage tables.
             */
            var card = document.createElement("div");
            card.className = "logic-card compact";
            card.appendChild(cardTitle("Table References", table.name || "Untitled Table"));

            var switchWrap = document.createElement("div");
            switchWrap.className = "logic-check-list";
            switchWrap.appendChild(metaLine("Switches", String(assets.switchCandidates.length)));
            assets.switchCandidates.forEach(function each(sw) {
                var row = document.createElement("div");
                row.className = "logic-check-row";
                var name = document.createElement("span");
                name.textContent = (sw.name || sw.id) + " (" + sw.type + ")";
                var badge = document.createElement("strong");
                var usage = countSwitchRuleUsage(sw.id);
                badge.textContent = usage ? "used by " + usage + " rule(s)" : "unused";
                row.appendChild(name);
                row.appendChild(badge);
                switchWrap.appendChild(row);
            });
            card.appendChild(switchWrap);

            var lampWrap = document.createElement("div");
            lampWrap.className = "logic-check-list";
            lampWrap.appendChild(metaLine("Lamps", String(assets.lampCandidates.length)));
            assets.lampCandidates.forEach(function each(lamp) {
                var row = document.createElement("div");
                row.className = "logic-check-row";
                var name = document.createElement("span");
                name.textContent = (lamp.name || lamp.id) + " (" + lamp.type + ")";
                var badge = document.createElement("strong");
                var bound = doc.lampBindings.some(function some(binding) { return binding && binding.lampId === lamp.id; });
                badge.textContent = bound ? "bound" : "unbound";
                row.appendChild(name);
                row.appendChild(badge);
                lampWrap.appendChild(row);
            });
            card.appendChild(lampWrap);

            var stateWrap = document.createElement("div");
            stateWrap.className = "logic-check-list";
            stateWrap.appendChild(metaLine("State", String(doc.stateTable.length + doc.computedState.length)));
            doc.stateTable.forEach(function each(stateRow) {
                var row = document.createElement("div");
                row.className = "logic-check-row";
                var name = document.createElement("span");
                name.textContent = labelForState(stateRow.id);
                var badge = document.createElement("strong");
                badge.textContent = countStateRuleUsage(stateRow.id) + " writer(s)";
                row.appendChild(name);
                row.appendChild(badge);
                stateWrap.appendChild(row);
            });
            card.appendChild(stateWrap);

            var validationRow = document.createElement("div");
            validationRow.className = "logic-validation " + (validation.ok ? "ok" : "error");
            validationRow.textContent = validation.ok ? "No validation errors" : validation.errors.length + " validation error(s)";
            card.appendChild(validationRow);
            nav.appendChild(card);
        }

        function featureList() {
            /* What: Return a mutable feature metadata list on the current table.
             * Why: Feature authoring is a human semantic layer independent of runtime rule execution.
             */
            if (!Array.isArray(table.features)) table.features = [];
            return table.features;
        }

        function selectedFeature() {
            /* What: Resolve the currently focused feature card.
             * Why: Center-pane work should scope to one gameplay feature by default.
             */
            if (!selectedFeatureId) return null;
            return featureList().find(function find(feature) { return feature && feature.id === selectedFeatureId; }) || null;
        }

        function setSelectedFeature(id) {
            /* What: Set the active feature focus.
             * Why: Rules/state/feedback views should pivot around a feature, not whole-table noise.
             */
            selectedFeatureId = id || "";
        }

        function isRuleInFeature(rule, feature) {
            if (!rule) return false;
            var ids = (feature && Array.isArray(feature.rules)) ? feature.rules : [];
            return ids.indexOf(rule.id) >= 0;
        }

        function isStateInFeature(stateId, feature) {
            var ids = (feature && Array.isArray(feature.states)) ? feature.states : [];
            return ids.indexOf(stateId) >= 0;
        }

        function isLampInFeature(lampId, feature) {
            var ids = (feature && Array.isArray(feature.lamps)) ? feature.lamps : [];
            return ids.indexOf(lampId) >= 0;
        }

        function createFeatureId(name) {
            /* What: Generate a unique feature id.
             * Why: Features need stable references for editor workflows and later linking.
             */
            var base = slugify(name || "feature") || "feature";
            var ids = {};
            featureList().forEach(function each(feature) {
                if (feature && feature.id) ids[String(feature.id)] = true;
            });
            var id = base;
            var suffix = 2;
            while (ids[id]) {
                id = base + "_" + String(suffix);
                suffix += 1;
            }
            return id;
        }

        function parseCsvList(value) {
            /* What: Parse a comma/newline-separated list into unique ids.
             * Why: Feature editing should stay lightweight without requiring complex token widgets yet.
             */
            var seen = {};
            return String(value || "")
                .split(/[\n,]/)
                .map(function map(item) { return item.trim(); })
                .filter(function keep(item) {
                    if (!item || seen[item]) return false;
                    seen[item] = true;
                    return true;
                });
        }

        function featureChecklist(title, options, selectedIds, onToggle) {
            /* What: Render a checkbox picker for feature-linked ids.
             * Why: Feature authoring should link semantic parts without manual id typing.
             */
            var wrap = document.createElement("div");
            wrap.className = "logic-check-list";
            var label = document.createElement("div");
            label.className = "logic-group-label";
            label.textContent = title;
            wrap.appendChild(label);
            if (!options.length) {
                wrap.appendChild(emptyText("No matching items available."));
                return wrap;
            }
            options.forEach(function each(option) {
                var row = document.createElement("label");
                row.className = "logic-check-row";
                var input = document.createElement("input");
                input.type = "checkbox";
                input.checked = selectedIds.indexOf(option.id) >= 0;
                input.onchange = function onchange() { onToggle(option.id, input.checked); };
                var text = document.createElement("span");
                text.textContent = option.label;
                row.appendChild(input);
                row.appendChild(text);
                wrap.appendChild(row);
            });
            return wrap;
        }

        function featureObjectOptions() {
            /* What: Return all playfield objects as feature-link choices.
             * Why: Features should point at concrete table parts, not only logic ids.
             */
            return (table.elements || []).map(function map(element) {
                var id = String(element && element.id || "");
                var label = (labelForElement(id) || id) + " (" + id + ")";
                return { id: id, label: label };
            }).filter(function keep(item) { return !!item.id; });
        }

        function featureStateOptions() {
            /* What: Return stored and computed state as feature-link choices.
             * Why: Features should expose relevant progression/state ids directly.
             */
            var out = [];
            doc.stateTable.forEach(function each(row) {
                if (!row || !row.id) return;
                out.push({ id: row.id, label: labelForState(row.id) + " (" + row.id + ")" });
            });
            doc.computedState.forEach(function each(row) {
                if (!row || !row.id) return;
                out.push({ id: row.id, label: labelForComputed(row.id) + " (" + row.id + ")" });
            });
            return out;
        }

        function featureRuleOptions() {
            /* What: Return action rules as feature-link choices.
             * Why: Feature cards should link to concrete collectible/progression rule rows.
             */
            return doc.actionRules.map(function map(rule) {
                return { id: rule.id, label: labelForAction(rule) + " (" + rule.id + ")" };
            }).filter(function keep(item) { return !!item.id; });
        }

        function featureLampOptions() {
            /* What: Return lamp bindings as feature-link choices.
             * Why: Features should expose player-facing light outputs as first-class links.
             */
            return doc.lampBindings.map(function map(binding) {
                var id = String(binding && binding.lampId || "");
                return { id: id, label: labelForLamp(id) + " (" + id + ")" };
            }).filter(function keep(item) { return !!item.id; });
        }

        function toggleFeatureLink(feature, key, id, enabled) {
            /* What: Add/remove one id in a feature-linked list.
             * Why: All feature pickers should follow one consistent mutation path.
             */
            var list = Array.isArray(feature[key]) ? feature[key].slice() : [];
            if (enabled && list.indexOf(id) < 0) list.push(id);
            if (!enabled) list = list.filter(function filter(item) { return item !== id; });
            feature[key] = list;
        }

        function labelForRuleId(id) {
            /* What: Resolve a human rule label for a rule id.
             * Why: Feature cards should show meaning before internal identifiers.
             */
            var row = doc.actionRules.find(function find(rule) { return rule && rule.id === id; }) || null;
            if (!row) return id || "";
            return labelForAction(row) + " (" + row.id + ")";
        }

        function formatFeatureItems(ids, labelFn) {
            /* What: Render a compact readable list from feature id arrays.
             * Why: Feature cards should surface linked table parts without leaving the feature view.
             */
            if (!Array.isArray(ids) || !ids.length) return "None";
            return ids.map(function map(id) { return labelFn(id); }).join(", ");
        }

        function renderFeatures() {
            /* What: Render feature cards and a lightweight feature inspector.
             * Why: Designers author pinball as player-facing features, not raw logic tables.
             */
            main.innerHTML = "";
            main.appendChild(sectionHeader(
                "Features",
                "Organize gameplay into player-facing features linked to physical objects, state, rules, and lamps.",
                "Add Feature",
                function onAddFeature() {
                    var list = featureList();
                    var feature = {
                        id: createFeatureId("feature"),
                        name: "New Feature",
                        description: "",
                        goal: "",
                        objects: [],
                        states: [],
                        rules: [],
                        lamps: []
                    };
                    list.push(feature);
                    commitDocChange({ runtime: false, render: true });
                }
            ));
            var list = featureList();
            if (!list.length) {
                main.appendChild(emptyCard("No features yet. Add one to define the table story above raw rules."));
                return;
            }
            list.forEach(function eachFeature(feature, index) {
                if (!feature || typeof feature !== "object") return;
                var card = document.createElement("div");
                card.className = "logic-card" + (selectedFeatureId && selectedFeatureId === feature.id ? " active" : "");
                card.onclick = function onPickFeature() {
                    setSelectedFeature(feature.id || "");
                    render();
                };
                card.appendChild(cardTitle(feature.name || feature.id || "Feature", feature.id || ""));
                card.appendChild(metaLine("Goal", feature.goal || "No goal set"));
                card.appendChild(metaLine("Objects", formatFeatureItems(feature.objects || [], labelForElement)));
                card.appendChild(metaLine("States", formatFeatureItems(feature.states || [], labelForState)));
                card.appendChild(metaLine("Rules", formatFeatureItems(feature.rules || [], labelForRuleId)));
                card.appendChild(metaLine("Lamps", formatFeatureItems(feature.lamps || [], labelForLamp)));

                var fields = document.createElement("div");
                fields.className = "logic-two-column";
                fields.appendChild(inputField("Name", feature.name || "", function onName(next) { feature.name = next; }));
                fields.appendChild(inputField("ID", feature.id || "", function onId(next) { feature.id = next; }));
                fields.appendChild(inputField("Goal", feature.goal || "", function onGoal(next) { feature.goal = next; }));
                fields.appendChild(inputField("Description", feature.description || "", function onDesc(next) { feature.description = next; }));
                card.appendChild(fields);
                card.appendChild(featureChecklist("Objects", featureObjectOptions(), feature.objects || [], function onToggle(id, enabled) {
                    toggleFeatureLink(feature, "objects", id, enabled);
                }));
                card.appendChild(featureChecklist("States", featureStateOptions(), feature.states || [], function onToggle(id, enabled) {
                    toggleFeatureLink(feature, "states", id, enabled);
                }));
                card.appendChild(featureChecklist("Rules", featureRuleOptions(), feature.rules || [], function onToggle(id, enabled) {
                    toggleFeatureLink(feature, "rules", id, enabled);
                }));
                card.appendChild(featureChecklist("Lamps", featureLampOptions(), feature.lamps || [], function onToggle(id, enabled) {
                    toggleFeatureLink(feature, "lamps", id, enabled);
                }));

                var actions = document.createElement("div");
                actions.className = "logic-switch-grid";
                appendActionButton(actions, "Save Feature", function onSave(evt) {
                    if (evt && evt.stopPropagation) evt.stopPropagation();
                    if (!feature.id) feature.id = createFeatureId(feature.name || "feature");
                    setSelectedFeature(feature.id);
                    commitDocChange({ runtime: false, render: true });
                });
                appendActionButton(actions, "Delete Feature", function onDelete(evt) {
                    if (evt && evt.stopPropagation) evt.stopPropagation();
                    list.splice(index, 1);
                    if (selectedFeatureId === feature.id) setSelectedFeature("");
                    commitDocChange({ runtime: false, render: true });
                });
                card.appendChild(actions);
                main.appendChild(card);
            });
        }

        function listForCollection(collection) {
            /* What: Map editor selections to the real logic document arrays.
             * Why: The UI can be human-shaped while storage remains the six-table schema.
             */
            if (collection === "switchRegistry") return doc.switchRegistry;
            if (collection === "stateTable") return doc.stateTable;
            if (collection === "computedState") return doc.computedState;
            if (collection === "lampBindings") return doc.lampBindings;
            if (collection === "actionRules") return doc.actionRules;
            if (collection === "resetRules") return doc.resetRules;
            return [];
        }

        function selectItem(collection, index) {
            /* What: Select an editable logic row.
             * Why: The right inspector should edit the row chosen in the human-facing view.
             */
            selected = { collection: collection, index: index };
            render();
        }

        function selectedRow() {
            /* What: Resolve the current inspector row.
             * Why: Inspector rendering must be independent of the active visual section.
             */
            var list = listForCollection(selected.collection);
            if (selected.index < 0 || selected.index >= list.length) return null;
            return list[selected.index];
        }

        function setSection(section) {
            /* What: Change the active workspace section and clear row selection.
             * Why: Each section has its own human grouping and inspector context.
             */
            activeSection = section;
            selected = { collection: "", index: -1 };
            render();
        }

        function addRow(collection) {
            /* What: Add one default row to the selected logic table.
             * Why: Users need a direct way to extend logic without editing JSON.
             */
            var list = listForCollection(collection);
            if (collection === "switchRegistry") list.push({ id: Pin.logicTypes.nextId("sw"), name: "", sourceElementId: "", kind: "switch" });
            if (collection === "stateTable") list.push({ id: Pin.logicTypes.nextId("state"), name: "", type: "bool", initial: false, volatile: true });
            if (collection === "computedState") list.push({ id: Pin.logicTypes.nextId("cmp"), name: "", type: "bool", expr: "false" });
            if (collection === "lampBindings") list.push({ lampId: "", expr: "false" });
            if (collection === "actionRules") list.push({ id: Pin.logicTypes.nextId("A"), name: "", trigger: "", condition: "", effects: [], enabled: true });
            if (collection === "resetRules") list.push({ id: Pin.logicTypes.nextId("R"), name: "", trigger: "", scope: "volatile", resets: [] });
            selected = { collection: collection, index: list.length - 1 };
            commitDocChange({ render: true });
        }

        function removeSelectedRow() {
            /* What: Delete the row currently shown in the inspector.
             * Why: Destructive edits should be scoped to an explicit selection.
             */
            var list = listForCollection(selected.collection);
            if (selected.index < 0 || selected.index >= list.length) return;
            list.splice(selected.index, 1);
            selected = { collection: "", index: -1 };
            commitDocChange({ render: true });
        }

        function upsertSwitchFromAsset(asset) {
            /* What: Create or refresh a logical switch from a physical table element.
             * Why: Users should pick named playfield objects instead of typing element IDs.
             */
            if (!asset || !asset.id) return;
            var existing = doc.switchRegistry.find(function find(row) { return row.id === asset.id; });
            if (existing) {
                if (!existing.name && asset.name) existing.name = asset.name;
                if (!existing.sourceElementId) existing.sourceElementId = asset.sourceElementId || asset.id;
                return;
            }
            doc.switchRegistry.push({
                id: asset.id,
                name: asset.name || asset.id,
                sourceElementId: asset.sourceElementId || asset.id,
                kind: "switch"
            });
        }

        function upsertLampBindingFromAsset(asset) {
            /* What: Create a lamp binding shell for a physical lamp-capable object.
             * Why: Lamps and lit targets should be bound to state, not micromanaged in rules.
             */
            if (!asset || !asset.id) return;
            if (doc.lampBindings.some(function has(row) { return row.lampId === asset.id; })) return;
            doc.lampBindings.push({
                lampId: asset.id,
                expr: "false"
            });
        }

        function hydrateSwitchRegistry() {
            /* What: Bootstrap logical switches from table assets when no logic exists yet.
             * Why: A blank logic document should still be immediately testable and editable.
             */
            if (doc.switchRegistry.length) return;
            assets.switchCandidates.forEach(function each(asset) { upsertSwitchFromAsset(asset); });
            ensureBuiltInTimerSwitches();
        }

        function ensureBuiltInTimerSwitches() {
            /* What: Ensure built-in virtual timer switches are available in the logic registry.
             * Why: Timed rules (timeouts/flashing) should work without requiring physical timer elements.
             */
            BUILTIN_TIMER_SWITCHES.forEach(function each(timer) {
                var existing = doc.switchRegistry.find(function find(row) { return row && row.id === timer.id; });
                if (existing) {
                    if (!existing.kind) existing.kind = "timer";
                    if (!existing.name) existing.name = timer.name;
                    if (!existing.sourceElementId) existing.sourceElementId = timer.sourceElementId;
                    if (!existing.intervalMs) existing.intervalMs = timer.intervalMs;
                    return;
                }
                doc.switchRegistry.push(Pin.logicTypes.clone(timer));
            });
        }

        function renderNav(validation) {
            /* What: Render top-level route navigation and logic sections.
             * Why: #logic must be reachable beside play/design and understandable at a glance.
             */
            nav.innerHTML = "";
            var topNav = document.createElement("div");
            topNav.className = "logic-top-links";
            [
                { label: "Play", hash: "#play&t=" + Pin.storage.url.encode(table), active: false },
                { label: "Design", hash: "#design&t=" + Pin.storage.url.encode(table), active: false },
                { label: "Logic", hash: "#logic&t=" + Pin.storage.url.encode(table), active: true }
            ].forEach(function each(item) {
                var b = document.createElement("button");
                b.type = "button";
                b.className = "logic-nav-btn" + (item.active ? " active" : "");
                b.textContent = item.label;
                b.onclick = function onclick() { location.hash = item.hash; };
                topNav.appendChild(b);
            });
            nav.appendChild(topNav);

            var top = document.createElement("div");
            top.className = "logic-nav-top";
            var title = document.createElement("h3");
            title.textContent = "Logic Workspace";
            var subtitle = document.createElement("div");
            subtitle.className = "logic-small";
            subtitle.textContent = table.name || "Untitled Table";
            top.appendChild(title);
            top.appendChild(subtitle);
            nav.appendChild(top);

            sections().forEach(function each(section) {
                var b = document.createElement("button");
                b.type = "button";
                b.className = "logic-nav-btn" + (activeSection === section.id ? " active" : "");
                b.textContent = section.label;
                b.onclick = function onclick() { setSection(section.id); };
                nav.appendChild(b);
            });

            var status = document.createElement("button");
            status.type = "button";
            status.className = "logic-validation " + (validation.ok ? "ok" : "error");
            status.textContent = validation.ok ? "Ready: no validation errors" : validation.errors.length + " validation error(s)";
            status.onclick = function onclick() { setSection("diagnostics"); };
            nav.appendChild(status);

            var clear = document.createElement("button");
            clear.type = "button";
            clear.className = "logic-nav-btn";
            clear.textContent = "Clear All";
            clear.onclick = function onclick() { clearAllLogic(); };
            nav.appendChild(clear);
            renderSignalBrowser(validation);
        }

        function sectionForCollection(collection) {
            /* What: Map a logic data collection to its primary workspace section.
             * Why: Validation click-through should land in the view that owns that data.
             */
            if (collection === "switchRegistry" || collection === "actionRules" || collection === "resetRules") return "rules";
            if (collection === "stateTable" || collection === "computedState") return "state";
            if (collection === "lampBindings") return "feedback";
            return "diagnostics";
        }

        function parseRuleIndexFromFallbackId(id, prefix) {
            /* What: Parse fallback ids like "rule@3" or "reset@2" into numeric indices.
             * Why: Validator synthesizes ids for rows missing stable ids.
             */
            var text = String(id || "");
            if (text.indexOf(prefix) !== 0) return -1;
            var value = parseInt(text.slice(prefix.length), 10);
            return Number.isFinite(value) ? value : -1;
        }

        function issueTarget(issue) {
            /* What: Resolve a validation issue to a section and row selection.
             * Why: Users should click an error and jump straight to the relevant data.
             */
            var target = { section: "diagnostics", collection: "", index: -1 };
            if (!issue || !issue.section) return target;

            var id = String(issue.id || "");
            var section = String(issue.section);
            var list = listForCollection(section);
            target.section = sectionForCollection(section);
            target.collection = section;

            if (section === "actionRules") {
                target.index = list.findIndex(function find(row) { return row && row.id === id; });
                if (target.index < 0) target.index = parseRuleIndexFromFallbackId(id, "rule@");
                return target;
            }
            if (section === "resetRules") {
                target.index = list.findIndex(function find(row) { return row && row.id === id; });
                if (target.index < 0) target.index = parseRuleIndexFromFallbackId(id, "reset@");
                return target;
            }
            if (section === "lampBindings") {
                target.index = list.findIndex(function find(row) { return row && row.lampId === id; });
                return target;
            }
            target.index = list.findIndex(function find(row) { return row && row.id === id; });
            return target;
        }

        function jumpToIssue(issue) {
            /* What: Navigate to the data row associated with a validation issue.
             * Why: Validation must be actionable, not just a passive error count.
             */
            var target = issueTarget(issue);
            activeSection = target.section;
            selected = { collection: target.collection, index: target.index };
            render();
        }

        function renderGodView(validation) {
            /* What: Render one full-system matrix of switches, rules, state, computed values, lamps, and resets.
             * Why: Logic needs a single “state machine” canvas where the user can see cause and effect together.
             */
            main.innerHTML = "";
            main.appendChild(sectionHeader("God View", "One matrix for the whole machine: switch events, conditions, state writes, computed features, lamps, score, and resets.", "Reset Test State", function onReset() {
                rerunRuntime();
                render();
            }, "Test In Play", function onPlay() {
                var compiledTable = Pin.logicCompile.applyToTable(table, doc);
                location.hash = "#play&t=" + Pin.storage.url.encode(compiledTable);
            }));
            main.appendChild(godViewStats(validation));
            main.appendChild(validationPanel(validation));
            main.appendChild(godMatrixPanel());
            main.appendChild(godStateMachinePanel());
            main.appendChild(godLampPanel());
        }

        function godViewStats(validation) {
            /* What: Summarize the current machine health and runtime state.
             * Why: The God View should immediately say whether the system is coherent.
             */
            var card = document.createElement("div");
            card.className = "logic-card";
            var grid = document.createElement("div");
            grid.className = "logic-grid-4";
            [
                ["Switch events", doc.switchRegistry.length],
                ["Action rules", doc.actionRules.length],
                ["State nodes", doc.stateTable.length + doc.computedState.length],
                [validation.ok ? "Validation OK" : "Validation errors", validation.ok ? 0 : validation.errors.length]
            ].forEach(function each(item) {
                var stat = document.createElement("div");
                stat.className = "logic-stat" + (!validation.ok && item[0] === "Validation errors" ? " bad" : "");
                stat.innerHTML = "<strong>" + escapeHtml(item[1]) + "</strong><span>" + escapeHtml(item[0]) + "</span>";
                grid.appendChild(stat);
            });
            card.appendChild(grid);
            return card;
        }

        function godMatrixPanel() {
            /* What: Build the switch-to-state matrix.
             * Why: This is the central view of the authoring model: events drive state, state drives lights.
             */
            var card = document.createElement("div");
            card.className = "logic-card logic-god-card";
            var head = document.createElement("div");
            head.className = "logic-card-head";
            var h = document.createElement("h3");
            h.textContent = "Switch Event Matrix";
            head.appendChild(h);
            appendActionButton(head, "Fire Selected Row Buttons", function noop() {});
            head.lastChild.disabled = true;
            card.appendChild(head);
            var tableEl = document.createElement("div");
            tableEl.className = "logic-god-matrix";
            ["Switch", "Condition", "State Writes", "Computed / Feature", "Lights", "Score", "Reset"].forEach(function each(label) {
                var cell = document.createElement("div");
                cell.className = "logic-god-head";
                cell.textContent = label;
                tableEl.appendChild(cell);
            });
            godRows().forEach(function each(row) {
                appendGodMatrixRow(tableEl, row);
            });
            card.appendChild(tableEl);
            return card;
        }

        function appendGodMatrixRow(tableEl, row) {
            /* What: Append one switch event row to the God View matrix.
             * Why: Each row should read left-to-right as event, gate, mutation, derived output, lamp output, award, reset.
             */
            var switchCell = document.createElement("div");
            switchCell.className = "logic-god-cell logic-god-switch";
            switchCell.onclick = function onclick() { selectItem("switchRegistry", row.switchIndex); };
            switchCell.appendChild(cardTitle(row.switchLabel, row.switchId));
            switchCell.appendChild(metaLine("Type", row.type));
            appendActionButton(switchCell, "Fire", function fire(e) {
                e.stopPropagation();
                Pin.logicSim.fireSwitch(runtime, row.switchId);
                render();
            });
            tableEl.appendChild(switchCell);
            tableEl.appendChild(godCell(row.conditions.length ? row.conditions : ["Always"], "condition"));
            tableEl.appendChild(godCell(row.stateWrites.length ? row.stateWrites : ["No state writes"], "state"));
            tableEl.appendChild(godCell(row.computed.length ? row.computed : ["No computed impact"], "computed"));
            tableEl.appendChild(godCell(row.lamps.length ? row.lamps : ["No lamps"], "lamp"));
            tableEl.appendChild(godCell(row.scores.length ? row.scores : ["No score"], "score"));
            tableEl.appendChild(godCell(row.resets.length ? row.resets : ["No reset"], "reset"));
        }

        function godCell(items, kind) {
            /* What: Render a matrix cell as stacked pills.
             * Why: Dense state-machine data needs visual grouping instead of raw comma-separated strings.
             */
            var cell = document.createElement("div");
            cell.className = "logic-god-cell logic-god-" + kind;
            items.forEach(function each(item) {
                cell.appendChild(godPill(item, kind));
            });
            return cell;
        }

        function godPill(item, kind) {
            /* What: Render one matrix token.
             * Why: Pills make conditions, states, and lights scannable in a dense grid.
             */
            var pill = document.createElement(item.collection ? "button" : "span");
            if (item.collection) pill.type = "button";
            pill.className = "logic-god-pill " + kind + (item.on ? " on" : "") + (item.off ? " off" : "");
            pill.textContent = item.label || String(item);
            if (item.collection) {
                pill.onclick = function onclick(e) {
                    e.stopPropagation();
                    selectItem(item.collection, item.index);
                };
            }
            return pill;
        }

        function godStateMachinePanel() {
            /* What: Render state nodes with writers and downstream dependencies.
             * Why: A state machine is understandable when every state shows who writes it and what it controls.
             */
            var card = document.createElement("div");
            card.className = "logic-card";
            var h = document.createElement("h3");
            h.textContent = "State Machine Lens";
            card.appendChild(h);
            var grid = document.createElement("div");
            grid.className = "logic-state-machine-grid";
            doc.stateTable.forEach(function each(row, index) {
                grid.appendChild(stateMachineNode(row, index));
            });
            doc.computedState.forEach(function each(row, index) {
                grid.appendChild(computedMachineNode(row, index));
            });
            if (!grid.children.length) grid.appendChild(emptyText("No state nodes yet."));
            card.appendChild(grid);
            return card;
        }

        function stateMachineNode(row, index) {
            /* What: Render one stored state node.
             * Why: Stored state is the mutable core of the logic machine.
             */
            var node = document.createElement("button");
            node.type = "button";
            node.className = "logic-machine-node" + (runtime.values[row.id] ? " on" : "");
            node.onclick = function onclick() { selectItem("stateTable", index); };
            node.appendChild(cardTitle(labelForState(row.id), row.id));
            node.appendChild(metaLine("Now", String(runtime.values[row.id])));
            node.appendChild(metaLine("Written by", writersForState(row.id).join(", ") || "Nothing"));
            node.appendChild(metaLine("Feeds", downstreamForId(row.id).join(", ") || "Nothing"));
            return node;
        }

        function computedMachineNode(row, index) {
            /* What: Render one computed state node.
             * Why: Computed state is where raw switch memory becomes features and availability.
             */
            var node = document.createElement("button");
            node.type = "button";
            node.className = "logic-machine-node computed" + (runtime.computed[row.id] ? " on" : "");
            node.onclick = function onclick() { selectItem("computedState", index); };
            node.appendChild(cardTitle(labelForComputed(row.id), row.id));
            node.appendChild(metaLine("When", humanExpression(row.expr || "false")));
            node.appendChild(metaLine("Now", runtime.computed[row.id] ? "TRUE" : "false"));
            node.appendChild(metaLine("Drives", downstreamForId(row.id).join(", ") || "Nothing"));
            return node;
        }

        function godLampPanel() {
            /* What: Render current lamp outputs as the final state-machine surface.
             * Why: Lamps are the player-facing projection of the state machine.
             */
            var card = document.createElement("div");
            card.className = "logic-card";
            var h = document.createElement("h3");
            h.textContent = "Player-Facing Outputs";
            card.appendChild(h);
            card.appendChild(chipSet("Lamps / Lit Targets", doc.lampBindings.map(function map(row) {
                return {
                    label: labelForLamp(row.lampId) + " <= " + humanExpression(row.expr || "false"),
                    value: runtime.lamps[row.lampId] ? "ON" : "off",
                    on: !!runtime.lamps[row.lampId]
                };
            })));
            return card;
        }

        function renderOverview(validation) {
            /* What: Render the human playbook summary.
             * Why: Users should first see what the game logic means, not its storage tables.
             */
            main.innerHTML = "";
            main.appendChild(summaryHero(validation));
            main.appendChild(featurePanel());
            main.appendChild(ruleFlowPanel());
            main.appendChild(validationPanel(validation));
        }

        function summaryHero(validation) {
            /* What: Build high-level counters and editor guidance.
             * Why: The overview needs to orient a user before they inspect individual rules.
             */
            var card = document.createElement("div");
            card.className = "logic-card logic-hero";
            var h = document.createElement("h2");
            h.textContent = "Game Logic Playbook";
            var p = document.createElement("p");
            p.textContent = "Author logic as switches, state, lights, rules, resets, and tests. Runtime JSON is compiled for play mode.";
            card.appendChild(h);
            card.appendChild(p);
            var grid = document.createElement("div");
            grid.className = "logic-grid-4";
            [
                ["Switches", doc.switchRegistry.length],
                ["Lights / lit targets", doc.lampBindings.length],
                ["State values", doc.stateTable.length + doc.computedState.length],
                ["Rules", doc.actionRules.length + doc.resetRules.length]
            ].forEach(function each(item) {
                var stat = document.createElement("div");
                stat.className = "logic-stat";
                stat.innerHTML = "<strong>" + escapeHtml(item[1]) + "</strong><span>" + escapeHtml(item[0]) + "</span>";
                grid.appendChild(stat);
            });
            card.appendChild(grid);
            if (!validation.ok) {
                var warning = document.createElement("div");
                warning.className = "logic-issue error";
                warning.textContent = "Fix validation errors before relying on export or play testing.";
                card.appendChild(warning);
            }
            return card;
        }

        function featurePanel() {
            /* What: Infer gameplay feature cards from computed state and lamp/rule references.
             * Why: This gives users a readable playbook without inventing a new persisted feature model.
             */
            var card = document.createElement("div");
            card.className = "logic-card";
            var head = document.createElement("div");
            head.className = "logic-card-head";
            var h = document.createElement("h3");
            h.textContent = "Features";
            head.appendChild(h);
            appendActionButton(head, featureDraft ? "Cancel Feature" : "Add Feature", function onclick() {
                featureDraft = featureDraft ? null : defaultFeatureDraft();
                render();
            });
            card.appendChild(head);
            if (featureDraft) card.appendChild(featureBuilder());
            var features = inferredFeatures();
            if (!features.length) {
                card.appendChild(emptyText("No computed features yet. Add computed state such as bonus_ready or lane_complete."));
                return card;
            }
            var list = document.createElement("div");
            list.className = "logic-feature-grid";
            features.forEach(function each(feature) {
                var item = document.createElement("button");
                item.type = "button";
                item.className = "logic-feature-card";
                item.onclick = function onclick() { selectItem("computedState", feature.index); };
                item.appendChild(cardTitle(feature.title, feature.id));
                item.appendChild(metaLine("When", humanExpression(feature.expr)));
                item.appendChild(metaLine("Lights", feature.lamps.length ? feature.lamps.join(", ") : "Nothing yet"));
                item.appendChild(metaLine("Enables", feature.rules.length ? feature.rules.join(", ") : "No rules yet"));
                list.appendChild(item);
            });
            card.appendChild(list);
            return card;
        }

        function defaultFeatureDraft() {
            /* What: Build the default Add Feature form state.
             * Why: Feature creation should start from the most common pinball workflow: light targets, then collect.
             */
            return {
                type: "targetBank",
                name: "New Bonus",
                targetSwitchIds: firstSwitchIdsByType("dropTarget", 3),
                collectSwitchId: firstSwitchIdsByType("lane", 1)[0] || "",
                targetScore: 250,
                collectAward: 1000,
                resetOnCollect: true,
                expression: "false",
                error: ""
            };
        }

        function featureBuilder() {
            /* What: Render the feature creation form.
             * Why: Users should add gameplay features directly instead of manually creating six low-level rows.
             */
            var box = document.createElement("div");
            box.className = "logic-feature-builder";
            box.appendChild(selectField("Feature Type", featureDraft.type, [
                { value: "targetBank", label: "Target Bank + Collect" },
                { value: "computed", label: "Computed Feature" }
            ], function set(v) {
                featureDraft.type = v;
                featureDraft.error = "";
                render();
            }));
            box.appendChild(inputField("Feature Name", featureDraft.name, function set(v) {
                featureDraft.name = v;
                featureDraft.error = "";
            }));
            if (featureDraft.type === "computed") {
                box.appendChild(inputField("Expression", featureDraft.expression, function set(v) {
                    featureDraft.expression = v;
                    featureDraft.error = "";
                }));
                box.appendChild(emptyText("Creates one computed state feature. Use State for stored values and Lights to bind lamps to it."));
            } else {
                box.appendChild(targetSwitchChecklist());
                box.appendChild(selectField("Collect Switch", featureDraft.collectSwitchId, switchOptions(), function set(v) {
                    featureDraft.collectSwitchId = v;
                    featureDraft.error = "";
                }));
                box.appendChild(inputField("Target Hit Score", featureDraft.targetScore, function set(v) {
                    featureDraft.targetScore = Number(v || 0);
                    featureDraft.error = "";
                }));
                box.appendChild(inputField("Collect Award", featureDraft.collectAward, function set(v) {
                    featureDraft.collectAward = Number(v || 0);
                    featureDraft.error = "";
                }));
                box.appendChild(boolField("Clear target lights after collect", featureDraft.resetOnCollect, function set(v) {
                    featureDraft.resetOnCollect = !!v;
                    featureDraft.error = "";
                }));
                box.appendChild(emptyText("Creates target-lit state, a ready condition, target hit rules, a collect rule, and lamp bindings for matching lit targets."));
            }
            if (featureDraft.error) {
                var error = document.createElement("div");
                error.className = "logic-issue error";
                error.textContent = featureDraft.error;
                box.appendChild(error);
            }
            appendActionButton(box, "Create Feature", function onclick() {
                createFeatureFromDraft();
            });
            return box;
        }

        function targetSwitchChecklist() {
            /* What: Render a checkbox list of logical switches for a target bank.
             * Why: Multi-target features need a simple picker without exposing arrays.
             */
            var wrap = document.createElement("div");
            wrap.className = "logic-check-list";
            var label = document.createElement("div");
            label.className = "logic-group-label";
            label.textContent = "Targets to light";
            wrap.appendChild(label);
            doc.switchRegistry.forEach(function each(sw) {
                var row = document.createElement("label");
                row.className = "logic-check-row";
                var input = document.createElement("input");
                input.type = "checkbox";
                input.checked = featureDraft.targetSwitchIds.indexOf(sw.id) >= 0;
                input.onchange = function onchange() {
                    if (input.checked && featureDraft.targetSwitchIds.indexOf(sw.id) < 0) featureDraft.targetSwitchIds.push(sw.id);
                    if (!input.checked) featureDraft.targetSwitchIds = featureDraft.targetSwitchIds.filter(function filter(id) { return id !== sw.id; });
                    featureDraft.error = "";
                };
                var text = document.createElement("span");
                text.textContent = labelForSwitch(sw.id) + " (" + sw.id + ")";
                row.appendChild(input);
                row.appendChild(text);
                wrap.appendChild(row);
            });
            return wrap;
        }

        function createFeatureFromDraft() {
            /* What: Compile the Add Feature form into the six-table logic document.
             * Why: Feature authoring should create the underlying state/rules/lights consistently.
             */
            if (!featureDraft) return;
            var name = String(featureDraft.name || "").trim();
            if (!name) return rejectFeatureDraft("Feature name is required.");
            if (featureDraft.type === "computed") {
                createComputedFeature(name, featureDraft.expression || "false");
                return;
            }
            if (!featureDraft.targetSwitchIds.length) return rejectFeatureDraft("Choose at least one target switch.");
            if (!featureDraft.collectSwitchId) return rejectFeatureDraft("Choose a collect switch.");
            createTargetBankFeature(name);
        }

        function rejectFeatureDraft(message) {
            /* What: Show a validation message inside the Add Feature form.
             * Why: Form mistakes should not create partial logic rows.
             */
            featureDraft.error = message;
            render();
        }

        function createComputedFeature(name, expression) {
            /* What: Add a computed feature row.
             * Why: Some gameplay concepts are just named conditions over existing state.
             */
            var id = uniqueLogicId(slugify(name) || "feature");
            doc.computedState.push({ id: id, name: name, type: "bool", expr: expression || "false" });
            featureDraft = null;
            selected = { collection: "computedState", index: doc.computedState.length - 1 };
            commitDocChange({ render: true });
        }

        function createTargetBankFeature(name) {
            /* What: Add a target-bank collect feature.
             * Why: This is the common pinball pattern of lighting a set, enabling a collect, then clearing the set.
             */
            var base = uniqueLogicId(slugify(name) || "feature");
            var stateIds = [];
            featureDraft.targetSwitchIds.forEach(function eachTarget(switchId, index) {
                var stateId = uniqueLogicId(base + "_target_" + String(index + 1) + "_lit");
                stateIds.push(stateId);
                doc.stateTable.push({
                    id: stateId,
                    name: labelForSwitch(switchId) + " Lit",
                    type: "bool",
                    initial: false,
                    volatile: true
                });
                doc.actionRules.push({
                    id: uniqueLogicId("A_" + base + "_target_" + String(index + 1)),
                    name: "Light " + labelForSwitch(switchId),
                    trigger: switchId,
                    condition: "!" + stateId,
                    effects: targetHitEffects(stateId),
                    enabled: true
                });
                bindLampForSwitch(switchId, stateId);
            });
            var readyId = uniqueLogicId(base + "_ready");
            doc.computedState.push({
                id: readyId,
                name: name + " Ready",
                type: "bool",
                expr: stateIds.join(" && ")
            });
            bindLampForSwitch(featureDraft.collectSwitchId, readyId);
            doc.actionRules.push({
                id: uniqueLogicId("A_" + base + "_collect"),
                name: "Collect " + name,
                trigger: featureDraft.collectSwitchId,
                condition: readyId,
                effects: collectEffects(stateIds),
                enabled: true
            });
            featureDraft = null;
            selected = { collection: "computedState", index: doc.computedState.length - 1 };
            commitDocChange({ render: true });
        }

        function targetHitEffects(stateId) {
            /* What: Build effects for a target hit in a target bank.
             * Why: Target bank creation should consistently light state and optionally score hits.
             */
            var effects = [{ type: "set", target: stateId, value: true }];
            if (Number(featureDraft.targetScore || 0) > 0) effects.push({ type: "score", value: Number(featureDraft.targetScore || 0) });
            return effects;
        }

        function collectEffects(stateIds) {
            /* What: Build effects for collecting a completed target bank.
             * Why: Collect rules should award points and optionally clear the lit targets.
             */
            var effects = [];
            if (Number(featureDraft.collectAward || 0) > 0) effects.push({ type: "score", value: Number(featureDraft.collectAward || 0) });
            if (featureDraft.resetOnCollect) {
                stateIds.forEach(function each(stateId) {
                    effects.push({ type: "set", target: stateId, value: false });
                });
            }
            return effects;
        }

        function ruleFlowPanel() {
            /* What: Show the action rules grouped by switch trigger.
             * Why: Gameplay is easiest to reason about as switch events and consequences.
             */
            var card = document.createElement("div");
            card.className = "logic-card";
            var h = document.createElement("h3");
            h.textContent = "Switch Rule Flow";
            card.appendChild(h);
            var groups = groupedActionRules();
            if (!groups.length) {
                card.appendChild(emptyText("No action rules yet. Add a rule to say what happens when a switch is hit."));
                return card;
            }
            groups.slice(0, 8).forEach(function each(group) {
                card.appendChild(ruleGroupBlock(group));
            });
            if (groups.length > 8) card.appendChild(emptyText("Open Rules to inspect " + (groups.length - 8) + " more switch group(s)."));
            return card;
        }

        function validationPanel(validation) {
            /* What: Render validation messages in one readable panel.
             * Why: Broken references and bad expressions should be visible without opening export.
             */
            var card = document.createElement("div");
            card.className = "logic-card";
            var h = document.createElement("h3");
            h.textContent = "Validation";
            card.appendChild(h);
            var note = document.createElement("div");
            note.className = "logic-small";
            note.textContent = validation.ok ? "No blocking issues." : "Click an issue to jump to the relevant rule, state, switch, or lamp.";
            card.appendChild(note);
            (validation.issues.length ? validation.issues : [{ severity: "info", section: "logic", message: "No issues." }]).forEach(function each(issue) {
                var row = document.createElement(issue && issue.section ? "button" : "div");
                if (row.tagName === "BUTTON") row.type = "button";
                row.className = "logic-issue " + issue.severity;
                row.textContent = humanIssue(issue);
                if (row.tagName === "BUTTON") row.onclick = function onclick() { jumpToIssue(issue); };
                card.appendChild(row);
            });
            return card;
        }

        function renderSwitches() {
            /* What: Render logical switches as named table objects.
             * Why: Users should choose playfield objects, not memorize sourceElementId strings.
             */
            main.innerHTML = "";
            main.appendChild(sectionHeader("Switches", "Named switch events that rules can listen to.", "Import Table Switches", function onImport() {
                assets.switchCandidates.forEach(function each(asset) { upsertSwitchFromAsset(asset); });
                commitDocChange({ render: true });
            }, "Add Switch", function onAdd() { addRow("switchRegistry"); }));
            var groups = groupSwitchesByType();
            if (!groups.length) {
                main.appendChild(emptyCard("No switches found. Add lanes, targets, bumpers, drains, or gates in the designer."));
                return;
            }
            groups.forEach(function each(group) {
                var card = document.createElement("div");
                card.className = "logic-card";
                var h = document.createElement("h3");
                h.textContent = group.label;
                card.appendChild(h);
                var list = document.createElement("div");
                list.className = "logic-card-list";
                group.items.forEach(function eachSwitch(item) {
                    var row = document.createElement("button");
                    row.type = "button";
                    row.className = selectableClass("switchRegistry", item.index);
                    row.onclick = function onclick() { selectItem("switchRegistry", item.index); };
                    row.appendChild(cardTitle(labelForSwitch(item.row.id), item.row.id));
                    row.appendChild(metaLine("Physical object", labelForElement(item.row.sourceElementId)));
                    row.appendChild(metaLine("Rules", countRulesForSwitch(item.row.id) + " action, " + countResetsForSwitch(item.row.id) + " reset"));
                    list.appendChild(row);
                });
                card.appendChild(list);
                main.appendChild(card);
            });
        }

        function renderLights() {
            /* What: Render lamp bindings as named lit table objects.
             * Why: Lamps should follow state and be inspectable without reading raw expressions first.
             */
            main.innerHTML = "";
            var scopedFeature = selectedFeature();
            main.appendChild(sectionHeader("Lights & Lit Targets", "Bind lamps, arrows, and lit targets to state expressions.", "Import Table Lights", function onImport() {
                assets.lampCandidates.forEach(function each(asset) { upsertLampBindingFromAsset(asset); });
                commitDocChange({ render: true });
            }, "Add Light Binding", function onAdd() { addRow("lampBindings"); }));
            main.appendChild(featureScopeControlCard());
            if (scopedFeature) main.appendChild(emptyCard("Scoped to feature: " + (scopedFeature.name || scopedFeature.id)));
            var bound = {};
            var list = document.createElement("div");
            list.className = "logic-feature-grid";
            doc.lampBindings.forEach(function each(row, index) {
                if (scopedFeature && !isLampInFeature(row.lampId, scopedFeature)) return;
                bound[row.lampId] = true;
                var item = document.createElement("button");
                item.type = "button";
                item.className = selectableClass("lampBindings", index) + (runtime.lamps[row.lampId] ? " is-on" : "");
                item.onclick = function onclick() { selectItem("lampBindings", index); };
                item.appendChild(cardTitle(labelForLamp(row.lampId), row.lampId));
                item.appendChild(metaLine("Follows", humanExpression(row.expr || "false")));
                item.appendChild(metaLine("Now", runtime.lamps[row.lampId] ? "ON" : "off"));
                list.appendChild(item);
            });
            assets.lampCandidates.forEach(function each(asset) {
                if (bound[asset.id]) return;
                var item = document.createElement("button");
                item.type = "button";
                item.className = "logic-feature-card muted";
                item.onclick = function onclick() {
                    upsertLampBindingFromAsset(asset);
                    selected = { collection: "lampBindings", index: doc.lampBindings.length - 1 };
                    commitDocChange({ render: true });
                };
                item.appendChild(cardTitle(asset.name || asset.id, asset.id));
                item.appendChild(metaLine("Status", "Unbound. Click to bind this light."));
                list.appendChild(item);
            });
            if (!list.children.length) {
                main.appendChild(emptyCard("No lamp-capable objects found."));
                return;
            }
            var card = document.createElement("div");
            card.className = "logic-card";
            card.appendChild(list);
            main.appendChild(card);
        }

        function renderState() {
            /* What: Render persistent and computed state together.
             * Why: Designers think about values and derived conditions as one state model.
             */
            main.innerHTML = "";
            var scopedFeature = selectedFeature();
            main.appendChild(sectionHeader("State", "Stored values and computed conditions that drive lights and rules.", "Add Stored State", function onState() {
                addRow("stateTable");
            }, "Add Computed State", function onComputed() {
                addRow("computedState");
            }));
            main.appendChild(featureScopeControlCard());
            if (scopedFeature) main.appendChild(emptyCard("Scoped to feature: " + (scopedFeature.name || scopedFeature.id)));
            var grid = document.createElement("div");
            grid.className = "logic-two-column";
            grid.appendChild(stateCard(scopedFeature));
            grid.appendChild(computedCard(scopedFeature));
            main.appendChild(grid);
        }

        function stateCard(scopedFeature) {
            /* What: Build the stored state panel.
             * Why: Stored values are the memory of the pinball logic.
             */
            var card = document.createElement("div");
            card.className = "logic-card";
            var h = document.createElement("h3");
            h.textContent = "Stored State";
            card.appendChild(h);
            if (!doc.stateTable.length) card.appendChild(emptyText("No stored state yet."));
            doc.stateTable.forEach(function each(row, index) {
                if (scopedFeature && !isStateInFeature(row.id, scopedFeature)) return;
                var item = document.createElement("button");
                item.type = "button";
                item.className = selectableClass("stateTable", index);
                item.onclick = function onclick() { selectItem("stateTable", index); };
                item.appendChild(cardTitle(labelForState(row.id), row.id));
                item.appendChild(metaLine("Initial", String(row.initial)));
                item.appendChild(metaLine("Now", String(runtime.values[row.id])));
                item.appendChild(metaLine("Type", row.type || "bool"));
                card.appendChild(item);
            });
            return card;
        }

        function computedCard(scopedFeature) {
            /* What: Build the computed state panel.
             * Why: Derived conditions explain bonuses, completions, and lamp availability.
             */
            var card = document.createElement("div");
            card.className = "logic-card";
            var h = document.createElement("h3");
            h.textContent = "Computed State";
            card.appendChild(h);
            if (!doc.computedState.length) card.appendChild(emptyText("No computed state yet."));
            doc.computedState.forEach(function each(row, index) {
                if (scopedFeature && !isStateInFeature(row.id, scopedFeature)) return;
                var item = document.createElement("button");
                item.type = "button";
                item.className = selectableClass("computedState", index) + (runtime.computed[row.id] ? " is-on" : "");
                item.onclick = function onclick() { selectItem("computedState", index); };
                item.appendChild(cardTitle(labelForComputed(row.id), row.id));
                item.appendChild(metaLine("When", humanExpression(row.expr || "false")));
                item.appendChild(metaLine("Now", runtime.computed[row.id] ? "TRUE" : "false"));
                card.appendChild(item);
            });
            return card;
        }

        function renderRules() {
            /* What: Render action rules grouped by their trigger switch.
             * Why: A human needs to see “when this is hit, this happens.”
             */
            main.innerHTML = "";
            var scopedFeature = selectedFeature();
            main.appendChild(sectionHeader("Rules", "What happens when a named switch fires.", "Add Rule", function onAdd() {
                addRow("actionRules");
            }));
            main.appendChild(featureScopeControlCard());
            if (scopedFeature) main.appendChild(emptyCard("Scoped to feature: " + (scopedFeature.name || scopedFeature.id)));
            var groups = groupedActionRules();
            if (!groups.length) {
                main.appendChild(emptyCard("No action rules yet."));
                return;
            }
            groups.forEach(function each(group) {
                if (scopedFeature) {
                    var filtered = {
                        label: group.label,
                        trigger: group.trigger,
                        rules: group.rules.filter(function filter(item) { return isRuleInFeature(item.rule, scopedFeature); })
                    };
                    if (!filtered.rules.length) return;
                    main.appendChild(ruleGroupBlock(filtered));
                    return;
                }
                main.appendChild(ruleGroupBlock(group));
            });
        }

        function featureScopeControlCard() {
            /* What: Render a shared feature scope selector for center-pane views.
             * Why: Designers should switch between all-rules and one-feature focus without leaving the view.
             */
            var card = document.createElement("div");
            card.className = "logic-card compact";
            var options = [{ value: "", label: "All Features" }];
            featureList().forEach(function each(feature) {
                if (!feature || !feature.id) return;
                options.push({ value: feature.id, label: feature.name || feature.id });
            });
            card.appendChild(selectField("Scope", selectedFeatureId || "", options, function onScope(v) {
                setSelectedFeature(v || "");
                render();
            }));
            return card;
        }

        function renderResets() {
            /* What: Render reset rules as clear drain/collect behavior.
             * Why: Reset behavior should be explicit and easy to audit.
             */
            main.innerHTML = "";
            main.appendChild(sectionHeader("Resets", "Explicit state clearing rules, usually on drain.", "Add Reset", function onAdd() {
                addRow("resetRules");
            }));
            if (!doc.resetRules.length) {
                main.appendChild(emptyCard("No reset rules yet."));
                return;
            }
            var card = document.createElement("div");
            card.className = "logic-card";
            doc.resetRules.forEach(function each(row, index) {
                var item = document.createElement("button");
                item.type = "button";
                item.className = selectableClass("resetRules", index);
                item.onclick = function onclick() { selectItem("resetRules", index); };
                item.appendChild(cardTitle(labelForReset(row), row.id));
                item.appendChild(metaLine("When", labelForSwitch(row.trigger)));
                item.appendChild(metaLine("Clears", resetTargetsSummary(row)));
                card.appendChild(item);
            });
            main.appendChild(card);
        }

        function renderTest() {
            /* What: Render pure logic simulation controls and state.
             * Why: Users need to prove logic without launching physics play mode.
             */
            main.innerHTML = "";
            var header = sectionHeader("Test Logic", "Fire named switches and inspect score, state, lights, and matched rules.", "Reset Test", function onReset() {
                rerunRuntime();
                render();
            }, "Test In Play", function onPlay() {
                var compiledTable = Pin.logicCompile.applyToTable(table, doc);
                location.hash = "#play&t=" + Pin.storage.url.encode(compiledTable);
            });
            main.appendChild(header);
            main.appendChild(testScenarioPanel());
            main.appendChild(testSwitchPanel());
            main.appendChild(testSnapshotPanel());
            main.appendChild(testLogPanel());
        }

        function testScenarioPanel() {
            /* What: Build quick scenario buttons from named switches.
             * Why: Common bonus flows should be testable without manually finding every target.
             */
            var card = document.createElement("div");
            card.className = "logic-card";
            var h = document.createElement("h3");
            h.textContent = "Quick Scenarios";
            card.appendChild(h);
            var scenarios = inferredScenarios();
            if (!scenarios.length) {
                card.appendChild(emptyText("No obvious scenarios found. Use the switch buttons below."));
                return card;
            }
            var buttons = document.createElement("div");
            buttons.className = "logic-switch-grid";
            scenarios.forEach(function each(scenario) {
                var b = document.createElement("button");
                b.type = "button";
                b.textContent = scenario.label;
                b.onclick = function onclick() {
                    scenario.switches.forEach(function eachSwitch(id) { Pin.logicSim.fireSwitch(runtime, id); });
                    render();
                };
                buttons.appendChild(b);
            });
            card.appendChild(buttons);
            return card;
        }

        function testSwitchPanel() {
            /* What: Build switch fire buttons grouped by physical object type.
             * Why: Manual testing is faster when controls are grouped like table assets.
             */
            var card = document.createElement("div");
            card.className = "logic-card";
            var h = document.createElement("h3");
            h.textContent = "Fire Switch";
            card.appendChild(h);
            var groups = groupSwitchesByType();
            groups.forEach(function each(group) {
                var label = document.createElement("div");
                label.className = "logic-group-label";
                label.textContent = group.label;
                card.appendChild(label);
                var buttons = document.createElement("div");
                buttons.className = "logic-switch-grid";
                group.items.forEach(function eachSwitch(item) {
                    var b = document.createElement("button");
                    b.type = "button";
                    b.textContent = labelForSwitch(item.row.id);
                    b.onclick = function onclick() {
                        Pin.logicSim.fireSwitch(runtime, item.row.id);
                        render();
                    };
                    buttons.appendChild(b);
                });
                card.appendChild(buttons);
            });
            return card;
        }

        function testSnapshotPanel() {
            /* What: Show the current simulated score, state, computed state, and lamp output.
             * Why: A switch test needs immediate visible feedback without raw JSON dumps.
             */
            var card = document.createElement("div");
            card.className = "logic-card";
            var h = document.createElement("h3");
            h.textContent = "Current Test State";
            card.appendChild(h);
            var score = document.createElement("div");
            score.className = "logic-score";
            score.textContent = "Score " + String(runtime.score);
            card.appendChild(score);
            card.appendChild(chipSet("Stored", doc.stateTable.map(function map(row) {
                return { label: labelForState(row.id), value: String(runtime.values[row.id]), on: !!runtime.values[row.id] };
            })));
            card.appendChild(chipSet("Computed", doc.computedState.map(function map(row) {
                return { label: labelForComputed(row.id), value: runtime.computed[row.id] ? "TRUE" : "false", on: !!runtime.computed[row.id] };
            })));
            card.appendChild(chipSet("Lights", doc.lampBindings.map(function map(row) {
                return { label: labelForLamp(row.lampId), value: runtime.lamps[row.lampId] ? "ON" : "off", on: !!runtime.lamps[row.lampId] };
            })));
            return card;
        }

        function testLogPanel() {
            /* What: Render event log entries with friendly names substituted for IDs.
             * Why: The simulator should explain rule execution in language users recognize.
             */
            var card = document.createElement("div");
            card.className = "logic-card";
            var h = document.createElement("h3");
            h.textContent = "Event Log";
            card.appendChild(h);
            if (!runtime.log.length) {
                card.appendChild(emptyText("Fire a switch to see rule matches, state changes, score, and lamp changes."));
                return card;
            }
            runtime.log.forEach(function each(line) {
                var p = document.createElement("pre");
                p.textContent = friendlyLog(line);
                card.appendChild(p);
            });
            return card;
        }

        function renderExport(validation) {
            /* What: Render export actions for source logic and full table JSON.
             * Why: Authoring and runtime now share the same logic document.
             */
            main.innerHTML = "";
            var card = document.createElement("div");
            card.className = "logic-card";
            var h = document.createElement("h2");
            h.textContent = "Export";
            var p = document.createElement("p");
            p.textContent = "The table stores this logic document directly as table.logicDocument.";
            card.appendChild(h);
            card.appendChild(p);
            var actions = document.createElement("div");
            actions.className = "logic-switch-grid";
            appendActionButton(actions, "Export Logic Document", function onclick() {
                exportBlob((table.name || "table") + ".logic.json", doc);
            });
            appendActionButton(actions, "Export Full Table", function onclick() {
                Pin.storage.file.export(Pin.logicCompile.applyToTable(table, doc));
            });
            appendActionButton(actions, "Apply To Autosave", function onclick() {
                persistLogicDocument();
                render();
            });
            appendActionButton(actions, "Test In Play", function onclick() {
                var compiledTable = Pin.logicCompile.applyToTable(table, doc);
                location.hash = "#play&t=" + Pin.storage.url.encode(compiledTable);
            });
            appendActionButton(actions, "Import Table JSON", function onclick() {
                Pin.storage.file.import().then(function onImport(nextTable) {
                    table = Pin.table.normalizeTable(nextTable);
                    assets = Pin.logicAssets.extractAssets(table);
                    doc = Pin.logicCompile.extractFromTable(table);
                    hydrateSwitchRegistry();
                    rerunRuntime();
                    persistLogicDocument();
                    selected = { collection: "", index: -1 };
                    render();
                }).catch(function noop() {});
            });
            card.appendChild(actions);
            var msg = document.createElement("div");
            msg.className = "logic-validation " + (validation.ok ? "ok" : "error");
            msg.textContent = validation.ok ? "Export ready." : "Fix validation errors before export.";
            card.appendChild(msg);
            main.appendChild(card);
        }

        function renderInspector() {
            /* What: Render advanced editing fields for the selected row.
             * Why: The main workspace is human-readable, while the inspector preserves precise control.
             */
            inspector.innerHTML = "";
            var title = document.createElement("h3");
            title.textContent = "Inspector";
            inspector.appendChild(title);
            var row = selectedRow();
            if (!row) {
                inspector.appendChild(emptyText("Select a switch, light, state value, rule, or reset to edit details."));
                return;
            }
            inspector.appendChild(inspectorTitle(row));
            if (selected.collection === "switchRegistry") renderSwitchInspector(row);
            if (selected.collection === "stateTable") renderStoredStateInspector(row);
            if (selected.collection === "computedState") renderComputedInspector(row);
            if (selected.collection === "lampBindings") renderLampInspector(row);
            if (selected.collection === "actionRules") renderActionInspector(row);
            if (selected.collection === "resetRules") renderResetInspector(row);
            var remove = document.createElement("button");
            remove.type = "button";
            remove.className = "danger";
            remove.textContent = "Delete";
            remove.onclick = removeSelectedRow;
            inspector.appendChild(remove);
        }

        function renderSwitchInspector(row) {
            /* What: Edit a logical switch registry row.
             * Why: Logical switch names bridge physical table elements and rule triggers.
             */
            inspector.appendChild(inputField("Name", row.name || "", function set(v) {
                row.name = v;
                commitDocChange({ runtime: false });
            }));
            inspector.appendChild(inputField("Logic ID", row.id, function set(v) {
                row.id = v;
                commitDocChange();
            }));
            inspector.appendChild(selectField("Physical Object", row.sourceElementId, switchAssetOptions(), function set(v) {
                row.sourceElementId = v;
                var asset = assetBySwitchSource(v);
                if (asset && !row.name) row.name = asset.name || "";
                commitDocChange({ render: true });
            }));
            inspector.appendChild(selectField("Kind", row.kind || "switch", [
                { value: "switch", label: "switch" }
            ], function set(v) {
                row.kind = v;
                commitDocChange({ runtime: false });
            }));
        }

        function renderStoredStateInspector(row) {
            /* What: Edit a stored state variable.
             * Why: Stored state is the memory that rules mutate and resets clear.
             */
            inspector.appendChild(inputField("Name", row.name || "", function set(v) {
                row.name = v;
                commitDocChange({ runtime: false });
            }));
            inspector.appendChild(inputField("Logic ID", row.id, function set(v) {
                row.id = v;
                commitDocChange();
            }));
            inspector.appendChild(selectField("Type", row.type || "bool", [
                { value: "bool", label: "bool" },
                { value: "int", label: "int" }
            ], function set(v) {
                row.type = v === "int" ? "int" : "bool";
                row.initial = parseValueForState(row, row.initial);
                commitDocChange({ render: true });
            }));
            inspector.appendChild(inputField("Initial Value", row.initial, function set(v) {
                row.initial = parseValueForState(row, v);
                commitDocChange();
            }));
            inspector.appendChild(boolField("Reset on volatile clears", row.volatile !== false, function set(v) {
                row.volatile = !!v;
                commitDocChange({ runtime: false });
            }));
        }

        function renderComputedInspector(row) {
            /* What: Edit a computed state expression.
             * Why: Computed state describes completions, availability, and multipliers.
             */
            inspector.appendChild(inputField("Name", row.name || "", function set(v) {
                row.name = v;
                commitDocChange({ runtime: false });
            }));
            inspector.appendChild(inputField("Logic ID", row.id, function set(v) {
                row.id = v;
                commitDocChange();
            }));
            inspector.appendChild(inputField("Expression", row.expr, function set(v) {
                row.expr = v;
                commitDocChange();
            }));
            inspector.appendChild(readOnlyLine("Reads as", humanExpression(row.expr || "false")));
        }

        function renderLampInspector(row) {
            /* What: Edit a lamp binding row.
             * Why: Lamps and lit targets should be declarative outputs from state.
             */
            inspector.appendChild(selectField("Light / Target", row.lampId, lampOptions(), function set(v) {
                row.lampId = v;
                commitDocChange({ render: true });
            }));
            inspector.appendChild(inputField("Expression", row.expr, function set(v) {
                row.expr = v;
                commitDocChange();
            }));
            inspector.appendChild(readOnlyLine("Reads as", humanExpression(row.expr || "false")));
            inspector.appendChild(readOnlyLine("Current test state", runtime.lamps[row.lampId] ? "ON" : "off"));
        }

        function renderActionInspector(row) {
            /* What: Edit an action rule.
             * Why: Action rules define what a switch hit changes or awards.
             */
            inspector.appendChild(inputField("Name", row.name || "", function set(v) {
                row.name = v;
                commitDocChange({ runtime: false });
            }));
            inspector.appendChild(inputField("Rule ID", row.id, function set(v) {
                row.id = v;
                commitDocChange({ runtime: false });
            }));
            inspector.appendChild(selectField("When Switch Fires", row.trigger || "", switchOptions(), function set(v) {
                row.trigger = v;
                commitDocChange();
            }));
            inspector.appendChild(inputField("Only If", row.condition || "", function set(v) {
                row.condition = v;
                commitDocChange();
            }));
            inspector.appendChild(boolField("Enabled", row.enabled !== false, function set(v) {
                row.enabled = !!v;
                commitDocChange();
            }));
            inspector.appendChild(readOnlyLine("Reads as", actionSummary(row)));
            inspector.appendChild(readOnlyLine("Affects Lamps", affectedLampList(row)));
            inspector.appendChild(readOnlyLine("Affects Computed State", affectedComputedList(row)));
            inspector.appendChild(readOnlyLine("Affects Features", affectedFeatureList(row)));
            if (!Array.isArray(row.effects)) row.effects = [];
            var effectsCard = document.createElement("div");
            effectsCard.className = "logic-card";
            var effectsHead = document.createElement("h4");
            effectsHead.textContent = "Effects";
            effectsCard.appendChild(effectsHead);
            row.effects.forEach(function eachEffect(effect, effectIndex) {
                effectsCard.appendChild(effectEditor(row, effect || {}, effectIndex));
            });
            appendActionButton(effectsCard, "Add Effect", function onclick() {
                row.effects.push({ type: "set", target: firstStateId(), value: false });
                commitDocChange({ render: true });
            });
            inspector.appendChild(effectsCard);
        }

        function affectedLampList(rule) {
            /* What: List lamps that depend on state written by a rule.
             * Why: Rule inspection should expose player-facing lamp consequences.
             */
            var stateTargets = (rule.effects || []).map(function map(effect) { return effect && effect.target ? effect.target : ""; }).filter(Boolean);
            var lamps = doc.lampBindings.filter(function filter(binding) {
                var expr = String(binding && binding.expr || "");
                return stateTargets.some(function some(id) { return expressionReferences(expr, id); });
            }).map(function map(binding) { return labelForLamp(binding.lampId); });
            return lamps.length ? lamps.join(", ") : "None";
        }

        function affectedComputedList(rule) {
            /* What: List computed state rows affected by state writes in a rule.
             * Why: Designers need downstream consequence visibility for readiness logic.
             */
            var stateTargets = (rule.effects || []).map(function map(effect) { return effect && effect.target ? effect.target : ""; }).filter(Boolean);
            var computed = doc.computedState.filter(function filter(row) {
                var expr = String(row && row.expr || "");
                return stateTargets.some(function some(id) { return expressionReferences(expr, id); });
            }).map(function map(row) { return labelForComputed(row.id); });
            return computed.length ? computed.join(", ") : "None";
        }

        function affectedFeatureList(rule) {
            /* What: List features that include this rule id.
             * Why: Rule edits should reveal feature-level ownership immediately.
             */
            var features = featureList().filter(function filter(feature) {
                var ids = (feature && Array.isArray(feature.rules)) ? feature.rules : [];
                return ids.indexOf(rule.id) >= 0;
            }).map(function map(feature) { return feature.name || feature.id; });
            return features.length ? features.join(", ") : "None";
        }

        function renderResetInspector(row) {
            /* What: Edit reset behavior.
             * Why: Resets should be explicit and reviewable, especially on drain.
             */
            inspector.appendChild(inputField("Name", row.name || "", function set(v) {
                row.name = v;
                commitDocChange({ runtime: false });
            }));
            inspector.appendChild(inputField("Reset ID", row.id, function set(v) {
                row.id = v;
                commitDocChange({ runtime: false });
            }));
            inspector.appendChild(selectField("When Switch Fires", row.trigger || "", switchOptions(), function set(v) {
                row.trigger = v;
                commitDocChange();
            }));
            inspector.appendChild(selectField("Scope", row.scope || "volatile", [
                { value: "volatile", label: "volatile" },
                { value: "all", label: "all" }
            ], function set(v) {
                row.scope = v;
                commitDocChange({ runtime: false });
            }));
            inspector.appendChild(readOnlyLine("Reads as", resetSummary(row)));
            if (!Array.isArray(row.resets)) row.resets = [];
            var resetsCard = document.createElement("div");
            resetsCard.className = "logic-card";
            var resetsTitle = document.createElement("h4");
            resetsTitle.textContent = "Reset Targets";
            resetsCard.appendChild(resetsTitle);
            row.resets.forEach(function eachReset(targetId, resetIndex) {
                var resetRow = document.createElement("div");
                resetRow.className = "logic-reset-row";
                resetRow.appendChild(selectField("State", targetId || "", stateOptions(), function setState(v) {
                    row.resets[resetIndex] = v;
                    commitDocChange();
                }));
                appendDangerButton(resetRow, "Delete Target", function onclick() {
                    row.resets.splice(resetIndex, 1);
                    commitDocChange({ render: true });
                });
                resetsCard.appendChild(resetRow);
            });
            appendActionButton(resetsCard, "Add Reset Target", function onclick() {
                var target = firstStateId();
                if (!target) return;
                row.resets.push(target);
                commitDocChange({ render: true });
            });
            inspector.appendChild(resetsCard);
        }

        function effectEditor(rule, effect, effectIndex) {
            /* What: Render one editable effect block.
             * Why: Effects need structured controls so users avoid malformed JSON.
             */
            function elementPropertyOptions() {
                var out = [{ value: "", label: "(select element property)" }];
                (table.elements || []).forEach(function each(el) {
                    if (!el || !el.id) return;
                    if (el.type === "gate") {
                        out.push({ value: el.id + ".open", label: labelForElement(el.id) + " (" + el.id + ").open" });
                        out.push({ value: el.id + ".locked", label: labelForElement(el.id) + " (" + el.id + ").locked" });
                    }
                });
                return out;
            }

            var effectBox = document.createElement("div");
            effectBox.className = "logic-effect-row";
            var effectType = effect.type || "set";
            effectBox.appendChild(selectField("Effect", effectType, [
                { value: "set", label: "set state" },
                { value: "add", label: "add to state" },
                { value: "score", label: "award score" },
                { value: "reset", label: "reset state" },
                { value: "setElementProperty", label: "set element property" },
                { value: "clearElementProperty", label: "clear element property" }
            ], function set(nextType) {
                effect.type = nextType;
                if (nextType === "score") {
                    delete effect.target;
                    effect.value = Number(effect.value || 0);
                } else if (nextType === "setElementProperty" || nextType === "clearElementProperty") {
                    if (!effect.target) effect.target = elementPropertyOptions()[1] ? elementPropertyOptions()[1].value : "";
                    if (nextType === "setElementProperty" && effect.value == null) effect.value = true;
                } else {
                    if (!effect.target) effect.target = firstStateId();
                    if (nextType === "add") effect.value = Number(effect.value || 1);
                    if (nextType === "reset") effect.value = 0;
                }
                rule.effects[effectIndex] = effect;
                commitDocChange({ render: true });
            }));
            if (effectType === "set" || effectType === "add" || effectType === "reset") {
                effectBox.appendChild(selectField("State", effect.target || "", stateOptions(), function setTarget(v) {
                    effect.target = v;
                    commitDocChange();
                }));
            } else if (effectType === "setElementProperty" || effectType === "clearElementProperty") {
                effectBox.appendChild(selectField("Property", effect.target || "", elementPropertyOptions(), function setTarget(v) {
                    effect.target = v;
                    commitDocChange();
                }));
            }
            if (effectType === "set") {
                effectBox.appendChild(inputField("Value", effect.value, function setValue(v) {
                    effect.value = parseValueForState(stateById(effect.target), v);
                    commitDocChange();
                }));
            } else if (effectType === "add") {
                effectBox.appendChild(inputField("Amount", effect.value == null ? 1 : effect.value, function setValue(v) {
                    effect.value = Number(v || 0);
                    commitDocChange();
                }));
            } else if (effectType === "score") {
                effectBox.appendChild(inputField("Points", effect.value == null ? 0 : effect.value, function setValue(v) {
                    effect.value = Number(v || 0);
                    commitDocChange();
                }));
            } else if (effectType === "setElementProperty") {
                effectBox.appendChild(inputField("Value", effect.value, function setValue(v) {
                    if (v === "true") effect.value = true;
                    else if (v === "false") effect.value = false;
                    else effect.value = v;
                    commitDocChange();
                }));
            }
            effectBox.appendChild(readOnlyLine("Reads as", effectSummary(effect)));
            appendDangerButton(effectBox, "Delete Effect", function onclick() {
                rule.effects.splice(effectIndex, 1);
                commitDocChange({ render: true });
            });
            return effectBox;
        }

        function sectionHeader(title, description, primaryLabel, primaryAction, secondaryLabel, secondaryAction) {
            /* What: Build a consistent section header with action buttons.
             * Why: Every workspace should explain its purpose before listing rows.
             */
            var header = document.createElement("div");
            header.className = "logic-main-header logic-human-header";
            var copy = document.createElement("div");
            var h = document.createElement("h2");
            h.textContent = title;
            var p = document.createElement("p");
            p.textContent = description;
            copy.appendChild(h);
            copy.appendChild(p);
            header.appendChild(copy);
            var actions = document.createElement("div");
            actions.className = "logic-switch-grid";
            if (primaryLabel && primaryAction) appendActionButton(actions, primaryLabel, primaryAction);
            if (secondaryLabel && secondaryAction) appendActionButton(actions, secondaryLabel, secondaryAction);
            header.appendChild(actions);
            return header;
        }

        function cardTitle(label, id) {
            /* What: Render a primary human label with secondary technical ID.
             * Why: IDs remain visible for precision, but should not be the first thing users read.
             */
            var wrap = document.createElement("div");
            wrap.className = "logic-card-title-line";
            var strong = document.createElement("strong");
            strong.textContent = label || id || "Unnamed";
            var small = document.createElement("small");
            small.textContent = id && id !== label ? id : "";
            wrap.appendChild(strong);
            if (small.textContent) wrap.appendChild(small);
            return wrap;
        }

        function metaLine(label, value) {
            /* What: Render one short fact line.
             * Why: Cards should be skimmable without dense tables.
             */
            var line = document.createElement("div");
            line.className = "logic-meta-line";
            var name = document.createElement("span");
            name.textContent = label;
            var text = document.createElement("strong");
            text.textContent = value == null || value === "" ? "None" : String(value);
            line.appendChild(name);
            line.appendChild(text);
            return line;
        }

        function readOnlyLine(label, value) {
            /* What: Render an inspector-only read-only explanation.
             * Why: Advanced fields need immediate human feedback.
             */
            var row = document.createElement("div");
            row.className = "logic-readonly";
            row.appendChild(metaLine(label, value));
            return row;
        }

        function inputField(label, value, onChange) {
            /* What: Build a text input field for the inspector.
             * Why: Text editing should compile/save through one mutation path.
             */
            var row = document.createElement("label");
            row.className = "logic-field";
            var span = document.createElement("span");
            span.textContent = label;
            var input = document.createElement("input");
            input.type = "text";
            input.value = value == null ? "" : String(value);
            input.oninput = function oninput() { onChange(input.value); };
            row.appendChild(span);
            row.appendChild(input);
            return row;
        }

        function selectField(label, value, options, onChange) {
            /* What: Build a select input field for the inspector.
             * Why: Reference fields should be chosen from valid named objects where possible.
             */
            var row = document.createElement("label");
            row.className = "logic-field";
            var span = document.createElement("span");
            span.textContent = label;
            var select = document.createElement("select");
            select.className = "logic-select";
            (options || []).forEach(function each(opt) {
                var option = document.createElement("option");
                option.value = String(opt.value);
                option.textContent = String(opt.label);
                if (String(value == null ? "" : value) === String(opt.value)) option.selected = true;
                select.appendChild(option);
            });
            select.onchange = function onchange() { onChange(select.value); };
            row.appendChild(span);
            row.appendChild(select);
            return row;
        }

        function boolField(label, value, onChange) {
            /* What: Build a checkbox field for boolean settings.
             * Why: Boolean authoring should not require typing true/false strings.
             */
            var row = document.createElement("label");
            row.className = "logic-field logic-field-bool";
            var span = document.createElement("span");
            span.textContent = label;
            var input = document.createElement("input");
            input.type = "checkbox";
            input.checked = !!value;
            input.onchange = function onchange() { onChange(input.checked); };
            row.appendChild(span);
            row.appendChild(input);
            return row;
        }

        function appendActionButton(parent, label, onclick) {
            /* What: Append a normal button.
             * Why: Repeated button creation should stay small and consistent.
             */
            var button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            button.onclick = onclick;
            parent.appendChild(button);
            return button;
        }

        function appendDangerButton(parent, label, onclick) {
            /* What: Append a destructive button.
             * Why: Delete actions should be visually distinct.
             */
            var button = appendActionButton(parent, label, onclick);
            button.className = "danger";
            return button;
        }

        function emptyText(text) {
            /* What: Render muted empty-state text.
             * Why: Empty sections should explain what to do next.
             */
            var div = document.createElement("div");
            div.className = "logic-small";
            div.textContent = text;
            return div;
        }

        function emptyCard(text) {
            /* What: Render an empty-state card.
             * Why: Main sections need visible guidance when no rows exist.
             */
            var card = document.createElement("div");
            card.className = "logic-card";
            card.appendChild(emptyText(text));
            return card;
        }

        function inspectorTitle(row) {
            /* What: Render the current inspector subject.
             * Why: Users need to know exactly what row is being edited.
             */
            var card = document.createElement("div");
            card.className = "logic-card compact";
            card.appendChild(cardTitle(displaySelectedTitle(row), displaySelectedId(row)));
            return card;
        }

        function selectableClass(collection, index) {
            /* What: Return the card class for selectable rows.
             * Why: Selected row highlighting must work across all human sections.
             */
            return "logic-feature-card" + (selected.collection === collection && selected.index === index ? " active" : "");
        }

        function ruleGroupBlock(group) {
            /* What: Render one trigger group with all matching action rules.
             * Why: Grouping by switch makes cause and effect obvious.
             */
            var card = document.createElement("div");
            card.className = "logic-card";
            card.appendChild(cardTitle(group.label, group.trigger || "No trigger"));
            group.rules.forEach(function eachRule(item) {
                var row = document.createElement("button");
                row.type = "button";
                row.className = selectableClass("actionRules", item.index) + (item.rule.enabled === false ? " muted" : "");
                row.onclick = function onclick() { selectItem("actionRules", item.index); };
                row.appendChild(cardTitle(labelForAction(item.rule), item.rule.id));
                row.appendChild(metaLine("If", item.rule.condition ? humanExpression(item.rule.condition) : "Always"));
                row.appendChild(metaLine("Then", effectsSummary(item.rule.effects)));
                card.appendChild(row);
            });
            return card;
        }

        function chipSet(title, items) {
            /* What: Render compact state chips.
             * Why: Test results should be quickly scannable.
             */
            var wrap = document.createElement("div");
            wrap.className = "logic-chip-section";
            var h = document.createElement("h4");
            h.textContent = title;
            wrap.appendChild(h);
            var chips = document.createElement("div");
            chips.className = "logic-chip-grid";
            (items || []).forEach(function each(item) {
                var chip = document.createElement("div");
                chip.className = "logic-chip" + (item.on ? " on" : "");
                chip.textContent = item.label + ": " + item.value;
                chips.appendChild(chip);
            });
            wrap.appendChild(chips);
            return wrap;
        }

        function inferredFeatures() {
            /* What: Build feature summaries from computed state references.
             * Why: The playbook can be meaningful without adding another persisted model.
             */
            return doc.computedState.map(function map(row, index) {
                var lamps = doc.lampBindings.filter(function filter(binding) {
                    return expressionReferences(binding.expr, row.id);
                }).map(function mapLamp(binding) {
                    return labelForLamp(binding.lampId);
                });
                var rules = doc.actionRules.filter(function filter(rule) {
                    return expressionReferences(rule.condition || "", row.id);
                }).map(function mapRule(rule) {
                    return labelForSwitch(rule.trigger);
                });
                return {
                    id: row.id,
                    index: index,
                    title: labelForComputed(row.id),
                    expr: row.expr || "false",
                    lamps: lamps,
                    rules: rules
                };
            });
        }

        function godRows() {
            /* What: Create the event-matrix rows for every registered switch.
             * Why: God View needs one normalized data shape covering actions, resets, state, lights, and score.
             */
            return doc.switchRegistry.map(function map(sw, switchIndex) {
                var actions = [];
                var resets = [];
                var stateIds = {};
                var scoreItems = [];
                doc.actionRules.forEach(function each(rule, index) {
                    if (rule.trigger !== sw.id) return;
                    actions.push({ rule: rule, index: index });
                    (Array.isArray(rule.effects) ? rule.effects : []).forEach(function eachEffect(effect) {
                        if (!effect) return;
                        if ((effect.type === "set" || effect.type === "add" || effect.type === "reset") && effect.target) stateIds[effect.target] = true;
                        if (effect.type === "score") scoreItems.push({
                            label: "+" + String(effect.value || 0) + " points",
                            collection: "actionRules",
                            index: index
                        });
                    });
                });
                doc.resetRules.forEach(function each(rule, index) {
                    if (rule.trigger !== sw.id) return;
                    resets.push({ rule: rule, index: index });
                    (Array.isArray(rule.resets) ? rule.resets : []).forEach(function eachReset(id) {
                        if (id) stateIds[id] = true;
                    });
                });
                var touched = Object.keys(stateIds);
                var computed = computedImpactedBy(touched.concat(actions.map(function mapAction(item) { return item.rule.condition || ""; }).join(" ").split(/\s+/)));
                var lampRefs = touched.concat(computed.map(function mapComputed(item) { return item.id; }));
                var asset = assetBySwitchSource(sw.sourceElementId) || assetBySwitchId(sw.id) || {};
                return {
                    switchId: sw.id,
                    switchIndex: switchIndex,
                    switchLabel: labelForSwitch(sw.id),
                    type: titleCase(asset.type || "switch"),
                    conditions: conditionItems(actions),
                    stateWrites: stateWriteItems(actions, resets),
                    computed: computed.map(function mapComputed(item) {
                        return { label: item.label, collection: "computedState", index: item.index, on: item.on };
                    }),
                    lamps: lampItemsForRefs(lampRefs),
                    scores: scoreItems,
                    resets: resetItems(resets)
                };
            });
        }

        function conditionItems(actions) {
            /* What: Convert action rule conditions into matrix pills.
             * Why: Conditions are the gate between switch events and state changes.
             */
            var out = [];
            actions.forEach(function each(item) {
                out.push({
                    label: item.rule.condition ? humanExpression(item.rule.condition) : "Always",
                    collection: "actionRules",
                    index: item.index,
                    off: item.rule.enabled === false
                });
            });
            return out;
        }

        function stateWriteItems(actions, resets) {
            /* What: Convert rule effects and reset targets into state-write pills.
             * Why: The matrix should expose every mutation caused by a switch.
             */
            var out = [];
            actions.forEach(function each(item) {
                (Array.isArray(item.rule.effects) ? item.rule.effects : []).forEach(function eachEffect(effect) {
                    if (!effect || effect.type === "score") return;
                    out.push({
                        label: effectSummary(effect),
                        collection: "actionRules",
                        index: item.index,
                        on: effect.type === "set" && effect.value === true
                    });
                });
            });
            resets.forEach(function each(item) {
                (Array.isArray(item.rule.resets) ? item.rule.resets : []).forEach(function eachReset(id) {
                    out.push({
                        label: "reset " + labelForState(id),
                        collection: "resetRules",
                        index: item.index
                    });
                });
            });
            return out;
        }

        function computedImpactedBy(tokens) {
            /* What: Find computed states that reference any touched state or condition token.
             * Why: God View should show downstream feature consequences from state writes.
             */
            var lookup = {};
            (tokens || []).forEach(function each(token) {
                var clean = String(token || "").replace(/[^A-Za-z0-9_]/g, "");
                if (clean) lookup[clean] = true;
            });
            return doc.computedState.map(function map(row, index) {
                return { row: row, index: index };
            }).filter(function filter(item) {
                return Object.keys(lookup).some(function some(id) {
                    return expressionReferences(item.row.expr || "", id) || item.row.id === id;
                });
            }).map(function map(item) {
                return {
                    id: item.row.id,
                    label: labelForComputed(item.row.id),
                    index: item.index,
                    on: !!runtime.computed[item.row.id]
                };
            });
        }

        function lampItemsForRefs(refs) {
            /* What: Find lamp bindings that follow a touched state/computed value.
             * Why: The matrix should connect internal state to player-facing light output.
             */
            var lookup = {};
            (refs || []).forEach(function each(ref) { if (ref) lookup[ref] = true; });
            return doc.lampBindings.map(function map(row, index) {
                return { row: row, index: index };
            }).filter(function filter(item) {
                return Object.keys(lookup).some(function some(id) {
                    return expressionReferences(item.row.expr || "", id);
                });
            }).map(function map(item) {
                return {
                    label: labelForLamp(item.row.lampId),
                    collection: "lampBindings",
                    index: item.index,
                    on: !!runtime.lamps[item.row.lampId]
                };
            });
        }

        function resetItems(resets) {
            /* What: Convert reset rules into matrix pills.
             * Why: Reset behavior should sit beside action behavior for the same switch.
             */
            var out = [];
            resets.forEach(function each(item) {
                out.push({
                    label: resetTargetsSummary(item.rule),
                    collection: "resetRules",
                    index: item.index
                });
            });
            return out;
        }

        function writersForState(stateId) {
            /* What: List switch/rule writers for one stored state.
             * Why: State-machine nodes need incoming edges explained in text.
             */
            var out = [];
            doc.actionRules.forEach(function each(rule) {
                (Array.isArray(rule.effects) ? rule.effects : []).forEach(function eachEffect(effect) {
                    if (effect && effect.target === stateId) out.push(labelForSwitch(rule.trigger));
                });
            });
            doc.resetRules.forEach(function each(rule) {
                if ((Array.isArray(rule.resets) ? rule.resets : []).indexOf(stateId) >= 0) out.push(labelForSwitch(rule.trigger));
            });
            return uniqueLabels(out);
        }

        function downstreamForId(id) {
            /* What: List computed states, rules, and lamps that reference one state/computed ID.
             * Why: State-machine nodes need outgoing edges explained in text.
             */
            var out = [];
            doc.computedState.forEach(function each(row) {
                if (expressionReferences(row.expr || "", id)) out.push(labelForComputed(row.id));
            });
            doc.actionRules.forEach(function each(rule) {
                if (expressionReferences(rule.condition || "", id)) out.push(labelForAction(rule));
            });
            doc.lampBindings.forEach(function each(row) {
                if (expressionReferences(row.expr || "", id)) out.push(labelForLamp(row.lampId));
            });
            return uniqueLabels(out);
        }

        function uniqueLabels(items) {
            /* What: Deduplicate display labels while preserving order.
             * Why: State-machine summaries should be compact and readable.
             */
            var seen = {};
            var out = [];
            (items || []).forEach(function each(item) {
                if (!item || seen[item]) return;
                seen[item] = true;
                out.push(item);
            });
            return out;
        }

        function groupedActionRules() {
            /* What: Group action rules by trigger ID.
             * Why: Trigger grouping is the clearest authoring view for switch logic.
             */
            var groups = {};
            doc.actionRules.forEach(function each(rule, index) {
                var key = rule.trigger || "";
                if (!groups[key]) groups[key] = { trigger: key, label: key ? labelForSwitch(key) : "No trigger selected", rules: [] };
                groups[key].rules.push({ rule: rule, index: index });
            });
            return Object.keys(groups).map(function map(key) { return groups[key]; }).sort(function sort(a, b) {
                return a.label.localeCompare(b.label);
            });
        }

        function groupSwitchesByType() {
            /* What: Group switches by physical asset type.
             * Why: Users scan “targets”, “lanes”, and “drains” more easily than a flat list.
             */
            var groups = {};
            doc.switchRegistry.forEach(function each(row, index) {
                var asset = assetBySwitchSource(row.sourceElementId) || assetBySwitchId(row.id) || {};
                var key = asset.type || "switch";
                var label = titleCase(key);
                if (!groups[key]) groups[key] = { label: label, items: [] };
                groups[key].items.push({ row: row, index: index });
            });
            return Object.keys(groups).map(function map(key) { return groups[key]; }).sort(function sort(a, b) {
                return a.label.localeCompare(b.label);
            });
        }

        function inferredScenarios() {
            /* What: Infer common bonus-flow test sequences from names and IDs.
             * Why: ABC-style tables should be testable quickly without hardcoding the table.
             */
            var lhsTargets = switchesMatching(["lhs", "targ"]);
            var rhsTargets = switchesMatching(["rhs", "targ"]);
            var lhsBonus = firstSwitchMatching(["lhs", "bonus"]);
            var rhsBonus = firstSwitchMatching(["rhs", "bonus"]);
            var mega = firstSwitchMatching(["mega"]);
            var out = [];
            if (lhsTargets.length) out.push({ label: "Complete LHS Targets", switches: lhsTargets });
            if (rhsTargets.length) out.push({ label: "Complete RHS Targets", switches: rhsTargets });
            if (lhsBonus) out.push({ label: "Collect LHS Bonus", switches: [lhsBonus] });
            if (rhsBonus) out.push({ label: "Collect RHS Bonus", switches: [rhsBonus] });
            if (mega) out.push({ label: "Collect Mega Bonus", switches: [mega] });
            return out;
        }

        function switchesMatching(parts) {
            /* What: Find switches whose IDs or names contain all requested words.
             * Why: Scenario detection should adapt to existing table naming.
             */
            return doc.switchRegistry.filter(function filter(sw) {
                var haystack = normalizedLookupText(sw.id + " " + (sw.name || "") + " " + labelForElement(sw.sourceElementId));
                return parts.every(function every(part) { return haystack.indexOf(part) >= 0; });
            }).map(function map(sw) { return sw.id; });
        }

        function firstSwitchMatching(parts) {
            /* What: Return the first switch that matches a scenario pattern.
             * Why: Bonus collect scenarios fire one obvious collect target or lane.
             */
            return switchesMatching(parts)[0] || "";
        }

        function normalizedLookupText(value) {
            /* What: Normalize labels for loose scenario matching.
             * Why: Existing tables use mixed casing and compact names.
             */
            return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
        }

        function firstSwitchIdsByType(type, count) {
            /* What: Return the first logical switches backed by a physical element type.
             * Why: Feature templates need useful defaults without hardcoding table IDs.
             */
            var out = [];
            doc.switchRegistry.forEach(function each(sw) {
                var asset = assetBySwitchSource(sw.sourceElementId) || assetBySwitchId(sw.id);
                if (asset && asset.type === type && out.length < count) out.push(sw.id);
            });
            return out;
        }

        function bindLampForSwitch(switchId, expr) {
            /* What: Bind a matching lamp-capable object to a generated state/expression when one exists.
             * Why: Target bank creation should light physical targets/lanes without manual lamp setup.
             */
            var sw = doc.switchRegistry.find(function find(row) { return row.id === switchId; });
            if (!sw) return;
            var lamp = assets.lampCandidates.find(function find(asset) {
                return asset.id === sw.sourceElementId || asset.sourceElementId === sw.sourceElementId || asset.id === sw.id;
            });
            if (!lamp || !lamp.id) return;
            var existing = doc.lampBindings.find(function find(binding) { return binding.lampId === lamp.id; });
            if (existing) {
                if (!existing.expr || existing.expr === "false") existing.expr = expr;
                return;
            }
            doc.lampBindings.push({ lampId: lamp.id, expr: expr });
        }

        function uniqueLogicId(seed) {
            /* What: Create a stable ID that does not collide with current logic rows.
             * Why: Feature templates generate several rows at once and must remain valid.
             */
            var base = slugify(seed) || "logic";
            var used = allLogicIdMap();
            var candidate = base;
            var index = 2;
            while (used[candidate]) {
                candidate = base + "_" + String(index);
                index += 1;
            }
            used[candidate] = true;
            return candidate;
        }

        function allLogicIdMap() {
            /* What: Collect every ID namespace used by generated logic rows.
             * Why: Generated feature IDs should not collide across state, computed state, switches, or rules.
             */
            var used = {};
            doc.switchRegistry.forEach(function each(row) { if (row.id) used[row.id] = true; });
            doc.stateTable.forEach(function each(row) { if (row.id) used[row.id] = true; });
            doc.computedState.forEach(function each(row) { if (row.id) used[row.id] = true; });
            doc.actionRules.forEach(function each(row) { if (row.id) used[row.id] = true; });
            doc.resetRules.forEach(function each(row) { if (row.id) used[row.id] = true; });
            return used;
        }

        function slugify(value) {
            /* What: Convert a human feature name into a logic-safe identifier.
             * Why: Generated rows need predictable IDs usable in expressions.
             */
            var slug = String(value || "")
                .trim()
                .replace(/([a-z])([A-Z])/g, "$1_$2")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "_")
                .replace(/^_+|_+$/g, "");
            if (/^[0-9]/.test(slug)) slug = "f_" + slug;
            return slug;
        }

        function switchAssetOptions() {
            /* What: Build select options for physical switch-capable assets.
             * Why: A logical switch should reference a real table element.
             */
            var out = [{ value: "", label: "(select physical object)" }];
            assets.switchCandidates.forEach(function each(asset) {
                out.push({ value: asset.sourceElementId || asset.id, label: (asset.name || asset.id) + " (" + asset.id + ")" });
            });
            return out;
        }

        function switchOptions() {
            /* What: Build select options for logical switches.
             * Why: Rules and resets should use friendly switch names.
             */
            var out = [{ value: "", label: "(select switch)" }];
            doc.switchRegistry.forEach(function each(sw) {
                out.push({ value: sw.id, label: labelForSwitch(sw.id) + " (" + sw.id + ")" });
            });
            return out;
        }

        function lampOptions() {
            /* What: Build select options for lamp-capable table assets.
             * Why: Lamp bindings should point to known lamps, arrows, and lit targets.
             */
            var out = [{ value: "", label: "(select light or lit target)" }];
            assets.lampCandidates.forEach(function each(lamp) {
                out.push({ value: lamp.id, label: (lamp.name || lamp.id) + " (" + lamp.id + ")" });
            });
            return out;
        }

        function stateOptions() {
            /* What: Build select options for stored state.
             * Why: Effects and resets can only mutate stored state, not computed state.
             */
            var out = [{ value: "", label: "(select state)" }];
            doc.stateTable.forEach(function each(st) {
                out.push({ value: st.id, label: labelForState(st.id) + " (" + st.id + ")" });
            });
            return out;
        }

        function firstStateId() {
            /* What: Return the first stored state ID.
             * Why: New effects need a safe default target when state exists.
             */
            return doc.stateTable.length ? doc.stateTable[0].id : "";
        }

        function stateById(id) {
            /* What: Find a stored state definition by ID.
             * Why: Effect values need type-aware parsing.
             */
            return doc.stateTable.find(function find(st) { return st.id === id; }) || null;
        }

        function parseValueForState(state, input) {
            /* What: Parse user input according to a state variable type.
             * Why: Bool and int values should persist in the expected JSON shape.
             */
            if (!state) return input;
            if (state.type === "int") return Number(input || 0);
            if (state.type === "bool") return String(input).toLowerCase() === "true";
            return input;
        }

        function assetBySwitchId(id) {
            /* What: Find a switch asset by logical/physical ID.
             * Why: Labels should fall back to table object names.
             */
            return assets.switchCandidates.find(function find(asset) { return asset.id === id; }) || null;
        }

        function assetBySwitchSource(sourceElementId) {
            /* What: Find a switch asset by source element ID.
             * Why: Logical switch rows store sourceElementId separately from their logical ID.
             */
            return assets.switchCandidates.find(function find(asset) { return asset.sourceElementId === sourceElementId || asset.id === sourceElementId; }) || null;
        }

        function assetByLampId(id) {
            /* What: Find a lamp-capable asset by lamp ID.
             * Why: Lamp cards should display object names.
             */
            return assets.lampCandidates.find(function find(asset) { return asset.id === id; }) || null;
        }

        function labelForSwitch(id) {
            /* What: Return the best human label for a logical switch.
             * Why: Switches are the primary language of the editor.
             */
            var row = doc.switchRegistry.find(function find(sw) { return sw.id === id; });
            if (row && row.name) return row.name;
            if (row) return labelForElement(row.sourceElementId) || row.id;
            var asset = assetBySwitchId(id);
            return asset ? asset.name : (id || "No switch");
        }

        function labelForElement(id) {
            /* What: Return the table asset name for a physical element ID.
             * Why: Physical IDs should be secondary to user-authored names.
             */
            var sw = assetBySwitchSource(id);
            if (sw && sw.name) return sw.name;
            var lamp = assets.lampCandidates.find(function find(asset) { return asset.sourceElementId === id || asset.id === id; });
            if (lamp && lamp.name) return lamp.name;
            return id || "";
        }

        function labelForLamp(id) {
            /* What: Return the best human label for a lamp binding.
             * Why: Light outputs are gameplay objects, not raw lamp IDs.
             */
            var asset = assetByLampId(id);
            return asset && asset.name ? asset.name : (id || "No light");
        }

        function labelForState(id) {
            /* What: Return the best human label for stored state.
             * Why: State chips and effects need readable names.
             */
            var row = doc.stateTable.find(function find(st) { return st.id === id; });
            return row && row.name ? row.name : titleFromId(id);
        }

        function labelForComputed(id) {
            /* What: Return the best human label for computed state.
             * Why: Computed values represent gameplay features.
             */
            var row = doc.computedState.find(function find(st) { return st.id === id; });
            return row && row.name ? row.name : titleFromId(id);
        }

        function labelForAction(rule) {
            /* What: Return a concise rule title.
             * Why: Rule cards should be identifiable before opening the inspector.
             */
            if (!rule) return "Rule";
            if (rule.name) return rule.name;
            return "When " + labelForSwitch(rule.trigger);
        }

        function labelForReset(rule) {
            /* What: Return a concise reset title.
             * Why: Reset cards should communicate their trigger.
             */
            if (!rule) return "Reset";
            if (rule.name) return rule.name;
            return "Reset on " + labelForSwitch(rule.trigger);
        }

        function displaySelectedTitle(row) {
            /* What: Return the selected row's human title.
             * Why: The inspector header should match what the user clicked.
             */
            if (selected.collection === "switchRegistry") return labelForSwitch(row.id);
            if (selected.collection === "stateTable") return labelForState(row.id);
            if (selected.collection === "computedState") return labelForComputed(row.id);
            if (selected.collection === "lampBindings") return labelForLamp(row.lampId);
            if (selected.collection === "actionRules") return labelForAction(row);
            if (selected.collection === "resetRules") return labelForReset(row);
            return "Selected Row";
        }

        function displaySelectedId(row) {
            /* What: Return the selected row's technical ID.
             * Why: IDs remain important for debugging and expressions.
             */
            return row.id || row.lampId || "";
        }

        function titleFromId(id) {
            /* What: Turn a snake/camel-ish ID into a readable title.
             * Why: Existing logic docs may not have explicit names yet.
             */
            return titleCase(String(id || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " "));
        }

        function titleCase(value) {
            /* What: Convert words to title case.
             * Why: Fallback labels should be readable without authoring names.
             */
            return String(value || "").replace(/\w\S*/g, function word(text) {
                return text.charAt(0).toUpperCase() + text.slice(1);
            });
        }

        function humanExpression(expr) {
            /* What: Replace known IDs in an expression with human labels.
             * Why: Conditions should be understandable while preserving the original expression in the inspector.
             */
            return String(expr || "").replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, function replace(token) {
                if (token === "true" || token === "false") return token;
                if (stateById(token)) return labelForState(token);
                if (doc.computedState.some(function some(row) { return row.id === token; })) return labelForComputed(token);
                return token;
            });
        }

        function expressionReferences(expr, id) {
            /* What: Test whether an expression references an identifier.
             * Why: Feature cards need to show which lamps and rules follow computed state.
             */
            var refs = {};
            String(expr || "").replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, function collect(token) {
                refs[token] = true;
                return token;
            });
            return !!refs[id];
        }

        function actionSummary(rule) {
            /* What: Summarize one action rule in plain English.
             * Why: Users should not need to mentally execute condition/effect JSON.
             */
            if (!rule) return "";
            var condition = rule.condition ? " if " + humanExpression(rule.condition) : "";
            return "When " + labelForSwitch(rule.trigger) + " fires" + condition + ", " + effectsSummary(rule.effects) + ".";
        }

        function effectsSummary(effects) {
            /* What: Summarize a list of effects.
             * Why: Rule cards need a compact “then” clause.
             */
            var list = Array.isArray(effects) ? effects : [];
            if (!list.length) return "do nothing";
            return list.map(effectSummary).join("; ");
        }

        function effectSummary(effect) {
            /* What: Summarize one effect.
             * Why: Effects should be readable in cards, inspector, and logs.
             */
            if (!effect || !effect.type) return "invalid effect";
            if (effect.type === "set") return "set " + labelForState(effect.target) + " to " + String(effect.value);
            if (effect.type === "add") return "add " + String(effect.value || 0) + " to " + labelForState(effect.target);
            if (effect.type === "score") return "award " + String(effect.value || 0) + " points";
            if (effect.type === "reset") return "reset " + labelForState(effect.target);
            if (effect.type === "setElementProperty") return "set " + String(effect.target || "") + " to " + String(effect.value);
            if (effect.type === "clearElementProperty") return "clear " + String(effect.target || "");
            return effect.type;
        }

        function resetSummary(rule) {
            /* What: Summarize one reset rule.
             * Why: Reset behavior needs to be auditable without reading arrays.
             */
            return "When " + labelForSwitch(rule.trigger) + " fires, reset " + resetTargetsSummary(rule) + ".";
        }

        function resetTargetsSummary(rule) {
            /* What: Summarize reset target IDs.
             * Why: Reset cards need readable target names.
             */
            var resets = Array.isArray(rule.resets) ? rule.resets : [];
            if (!resets.length) return "nothing";
            return resets.map(labelForState).join(", ");
        }

        function countRulesForSwitch(id) {
            /* What: Count action rules for one switch.
             * Why: Switch cards should show whether the switch does anything.
             */
            return doc.actionRules.filter(function filter(rule) { return rule.trigger === id; }).length;
        }

        function countResetsForSwitch(id) {
            /* What: Count reset rules for one switch.
             * Why: Switch cards should show reset behavior alongside actions.
             */
            return doc.resetRules.filter(function filter(rule) { return rule.trigger === id; }).length;
        }

        function humanIssue(issue) {
            /* What: Convert a validation issue into a readable line.
             * Why: Raw validation sections are useful but should not be cryptic.
             */
            if (!issue) return "";
            return "[" + readableSection(issue.section) + "] " + friendlyLog(issue.message || "");
        }

        function readableSection(section) {
            /* What: Convert validation section IDs to human labels.
             * Why: Validation should match the new navigation labels.
             */
            if (section === "switchRegistry") return "Switches";
            if (section === "stateTable") return "State";
            if (section === "computedState") return "Computed State";
            if (section === "lampBindings") return "Lights";
            if (section === "actionRules") return "Rules";
            if (section === "resetRules") return "Resets";
            return section || "Logic";
        }

        function friendlyLog(line) {
            /* What: Substitute known IDs in simulator/validation lines with human labels.
             * Why: Logs should explain gameplay behavior, not only internal identifiers.
             */
            var out = String(line || "");
            allKnownIds().forEach(function each(item) {
                if (!item.id || !item.label || item.id === item.label) return;
                out = out.replace(new RegExp("\\b" + escapeRegExp(item.id) + "\\b", "g"), item.label + " (" + item.id + ")");
            });
            return out;
        }

        function allKnownIds() {
            /* What: Build the ID-to-label dictionary for expression/log rendering.
             * Why: Multiple editor views need consistent human substitution.
             */
            var out = [];
            doc.switchRegistry.forEach(function each(sw) { out.push({ id: sw.id, label: labelForSwitch(sw.id) }); });
            doc.stateTable.forEach(function each(st) { out.push({ id: st.id, label: labelForState(st.id) }); });
            doc.computedState.forEach(function each(st) { out.push({ id: st.id, label: labelForComputed(st.id) }); });
            doc.lampBindings.forEach(function each(lamp) { out.push({ id: lamp.lampId, label: labelForLamp(lamp.lampId) }); });
            return out.sort(function sort(a, b) { return b.id.length - a.id.length; });
        }

        function escapeRegExp(value) {
            /* What: Escape a string for use in a RegExp.
             * Why: IDs can contain characters that are special in regular expressions.
             */
            return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        }

        function exportBlob(name, data) {
            /* What: Download a JSON blob.
             * Why: Users need to export source logic and compiled runtime rules.
             */
            var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            var a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = name;
            a.click();
            URL.revokeObjectURL(a.href);
        }

        function render() {
            /* What: Render the active logic workspace.
             * Why: The route is a single static page without a framework.
             */
            var validation = rerunValidation();
            renderNav(validation);
            if (activeSection === "features") renderFeatures();
            else if (activeSection === "rules") renderRules();
            else if (activeSection === "state") renderState();
            else if (activeSection === "feedback") renderLights();
            else if (activeSection === "simulator") renderTest();
            else if (activeSection === "diagnostics") renderGodView(validation);
            else renderFeatures();
            renderInspector();
        }

        function onHashChange() {
            /* What: Re-render when the current route is still #logic.
             * Why: Encoded table state in the hash can change after navigation actions.
             */
            if (!/^#logic\b/.test(location.hash || "")) return;
            render();
        }

        window.addEventListener("hashchange", onHashChange);
        root._pinballCleanup = function cleanupLogic() {
            window.removeEventListener("hashchange", onHashChange);
        };

        render();
    }

    function escapeHtml(value) {
        /* What: Escape text for safe HTML snippets.
         * Why: A few compact stat blocks use innerHTML for simple static markup.
         */
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    Pin.logicPage = { mount: mount };
})(window.Pin);
