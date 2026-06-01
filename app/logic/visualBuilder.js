/* What: Render the LogicVisualBuilder projection over current table JSON structures.
 * Why: Designers need an expressive workspace while table.logicDocument/features remain source of truth.
 */
(function initLogicVisualBuilder(Pin) {
    function mount(container, options) {
        /* What: Mount and manage the visual-builder UI.
         * Why: Keep projection rendering and safe edits isolated from route-level logic page plumbing.
         */
        options = options || {};
        var table = options.table || {};
        var doc = options.doc || (table && table.logicDocument) || Pin.logicTypes.createEmptyLogicDocument();
        var assets = options.assets || { switchCandidates: [], lampCandidates: [] };
        var tableAssetBaseHref = typeof options.tableAssetBaseHref === "string" ? options.tableAssetBaseHref : "";

        var selected = { kind: "", id: "" };
        var bottomTab = "json";
        var zoom = "100%";
        var workspaceSection = String(options.workspaceSection || options.activeNavId || "logic");
        var showPlayfieldObjects = true;
        var showPlayfieldLamps = true;
        var buildRole = "";
        var buildDraft = {
            featureName: "",
            triggerSwitchId: "",
            lampId: "",
            targetSwitchIds: [],
            collectSwitchId: "",
            drainSwitchId: "",
            triggerScore: 0,
            targetHitScore: 0,
            collectAward: 0,
            resetOnCollect: true,
            genericRuleName: "",
            genericRuleTrigger: "",
            genericRuleCondition: "",
            genericRuleEnabled: true,
            genericEffectType: "set",
            genericEffectTarget: "",
            genericEffectValue: "true",
            error: ""
        };

        var model = null;
        var validation = null;
        var index = null;

        function navActiveId() {
            /* What: Resolve active left-rail item id for the current host page context.
             * Why: PinLogic rail should reflect real workspace state, not a hard-coded highlight.
             */
            return workspaceSection || "logic";
        }

        function routeFromRail(itemId) {
            /* What: Route left-rail clicks to host page navigation callbacks.
             * Why: The visual builder is embedded by the logic route and must delegate top-level navigation.
             */
            var id = String(itemId || "");
            if (!id) return;
            if (id === "play" || id === "design") {
                if (typeof options.onNavigateMode === "function") options.onNavigateMode(id);
                return;
            }
            if (id === "simulator") {
                /* What: Delegate simulator rail item to host simulator workspace.
                 * Why: Simulator runs in legacy section renderer; avoid visual-shell placeholder branches.
                 */
                if (typeof options.onNavigateSection === "function") options.onNavigateSection(id);
                return;
            }
            workspaceSection = id;
            if (typeof options.onNavigateSection === "function") options.onNavigateSection(id);
            render();
        }

        function rerun() {
            model = Pin.logicVisualProjection.buildVisualModel(table, doc, assets);
            validation = Pin.logicVisualProjection.validateVisualModel(table, doc, assets);
            index = buildIndex(doc, table);
        }

        function buildIndex(currentDoc, currentTable) {
            /* What: Build stable lookups for the current projection.
             * Why: Inspector and flow cards need fast cross-references while rendering.
             */
            var out = {
                switchById: {},
                stateById: {},
                computedById: {},
                ruleById: {},
                elementById: {},
                lampExprByLampId: {}
            };
            (currentDoc.switchRegistry || []).forEach(function each(row) { if (row && row.id) out.switchById[row.id] = row; });
            (currentDoc.stateTable || []).forEach(function each(row) { if (row && row.id) out.stateById[row.id] = row; });
            (currentDoc.computedState || []).forEach(function each(row) { if (row && row.id) out.computedById[row.id] = row; });
            (currentDoc.actionRules || []).forEach(function each(row) { if (row && row.id) out.ruleById[row.id] = row; });
            (currentTable.elements || []).forEach(function each(row) { if (row && row.id) out.elementById[row.id] = row; });
            (currentDoc.lampBindings || []).forEach(function each(row) {
                if (row && row.lampId) out.lampExprByLampId[row.lampId] = row.expr || "";
            });
            return out;
        }

        function commit() {
            /* What: Commit one user-authored edit into upstream route state.
             * Why: Route-level logic page handles persistence/validation and must remain authoritative.
             */
            if (typeof options.onCommit === "function") options.onCommit();
            if (typeof options.onChange === "function") options.onChange(Pin.logicTypes.clone(table));
        }

        function selectEntity(kind, id) {
            maybeAssignBuildRole(kind, id);
            selected.kind = kind || "";
            selected.id = id || "";
            render();
        }

        function maybeAssignBuildRole(kind, id) {
            /* What: Assign clicked entities into active builder roles.
             * Why: Designers should build logic directly from playfield/canvas clicks.
             */
            if (!buildRole) return;
            var resolved = resolveAssignable(kind, id);
            if (!resolved) return;
            buildDraft.error = "";
            if (buildRole === "trigger" && resolved.switchId) buildDraft.triggerSwitchId = resolved.switchId;
            if (buildRole === "collect" && resolved.switchId) buildDraft.collectSwitchId = resolved.switchId;
            if (buildRole === "drain" && resolved.switchId) buildDraft.drainSwitchId = resolved.switchId;
            if (buildRole === "lamp" && resolved.lampId) buildDraft.lampId = resolved.lampId;
            if (buildRole === "target" && resolved.switchId && buildDraft.targetSwitchIds.indexOf(resolved.switchId) < 0) {
                buildDraft.targetSwitchIds.push(resolved.switchId);
            }
        }

        function resolveAssignable(kind, id) {
            var entityKind = String(kind || "");
            var entityId = String(id || "");
            if (!entityId) return null;
            if (entityKind === "switch") return { switchId: entityId };
            if (entityKind === "lamp") return { lampId: entityId };
            if (entityKind !== "object") return null;
            return {
                switchId: switchIdForElement(entityId),
                lampId: lampIdForElement(entityId)
            };
        }

        function escapeHtml(value) {
            return String(value == null ? "" : value)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
        }

        function firstEffectTarget(rule) {
            var effects = Array.isArray(rule && rule.effects) ? rule.effects : [];
            var effect = effects.find(function find(e) { return e && typeof e.target === "string" && !!e.target; }) || null;
            return effect ? String(effect.target || "") : "";
        }

        function primaryStateTarget(rule) {
            var effects = Array.isArray(rule && rule.effects) ? rule.effects : [];
            var preferred = effects.find(function find(effect) {
                return effect && effect.type === "set" && index.stateById[effect.target];
            }) || effects.find(function find(effect) {
                return effect && (effect.type === "add" || effect.type === "reset") && index.stateById[effect.target];
            }) || null;
            return preferred ? String(preferred.target || "") : "";
        }

        function groupRuleIds(group) {
            var ids = [];
            if (!group) return ids;
            if (Array.isArray(group.ruleIds)) ids = ids.concat(group.ruleIds);
            if (Array.isArray(group.feederRuleIds)) ids = ids.concat(group.feederRuleIds);
            if (Array.isArray(group.completionRuleIds)) ids = ids.concat(group.completionRuleIds);
            if (Array.isArray(group.resetRuleIds)) ids = ids.concat(group.resetRuleIds);
            if (group.ruleId) ids.push(group.ruleId);
            if (Array.isArray(group.transitions)) ids = ids.concat(group.transitions.map(function map(row) { return row.ruleId; }));
            var seen = {};
            return ids.filter(function filter(id) {
                if (!id || seen[id]) return false;
                seen[id] = true;
                return true;
            });
        }

        function findFeatureBySelected() {
            if (selected.kind !== "feature") return null;
            return (table.features || []).find(function find(row) { return row && row.id === selected.id; }) || null;
        }

        function findRuleBySelected() {
            if (selected.kind !== "rule") return null;
            return index.ruleById[selected.id] || null;
        }

        function selectedObject() {
            if (selected.kind !== "object") return null;
            return index.elementById[selected.id] || null;
        }

        function selectedLampBinding() {
            if (selected.kind !== "lamp") return null;
            return (doc.lampBindings || []).find(function find(row) { return row && row.lampId === selected.id; }) || null;
        }

        function featureGroupMatch(group, feature) {
            if (!feature || !group) return true;
            var featureRules = Array.isArray(feature.rules) ? feature.rules : [];
            var featureStates = Array.isArray(feature.states) ? feature.states : [];
            var ids = groupRuleIds(group);
            if (ids.some(function some(id) { return featureRules.indexOf(id) >= 0; })) return true;
            if (group.stateIds && group.stateIds.some(function some(id) { return featureStates.indexOf(id) >= 0; })) return true;
            if (group.computedStateId && featureStates.indexOf(group.computedStateId) >= 0) return true;
            if (group.sourceFeatureId && group.sourceFeatureId === feature.id) return true;
            return false;
        }

        function groupedView() {
            var feature = findFeatureBySelected();
            return (model.groups || []).map(function map(group) {
                return {
                    group: group,
                    muted: !!feature && !featureGroupMatch(group, feature)
                };
            });
        }

        function objectIdsForRuleId(ruleId) {
            var rule = index.ruleById[ruleId];
            if (!rule) return [];
            return relatedObjectsForRule(rule);
        }

        function ruleIdsForStateLike(stateId) {
            var ids = [];
            (doc.actionRules || []).forEach(function each(rule) {
                if (!rule) return;
                var cond = String(rule.condition || "");
                var effects = Array.isArray(rule.effects) ? rule.effects : [];
                var hitsEffect = effects.some(function some(effect) {
                    return effect && typeof effect.target === "string" && effect.target === stateId;
                });
                if (cond.indexOf(stateId) >= 0 || hitsEffect) ids.push(rule.id);
            });
            return ids;
        }

        function highlightedObjectIds() {
            /* What: Resolve playfield objects related to current selection.
             * Why: Canvas/inspector selection should also orient the user in playfield reference.
             */
            var out = {};
            if (!selected.kind || !selected.id) return out;
            if (selected.kind === "object") {
                out[selected.id] = "selected";
                return out;
            }
            if (selected.kind === "lamp") {
                out[selected.id] = "related";
                return out;
            }
            if (selected.kind === "rule") {
                relatedObjectsForRule(findRuleBySelected() || {}).forEach(function each(id) { out[id] = "related"; });
                return out;
            }
            if (selected.kind === "switch") {
                var sw = index.switchById[selected.id];
                if (sw && sw.sourceElementId) out[sw.sourceElementId] = "related";
                return out;
            }
            if (selected.kind === "state" || selected.kind === "computed") {
                ruleIdsForStateLike(selected.id).forEach(function each(id) {
                    objectIdsForRuleId(id).forEach(function eachObj(objId) { out[objId] = "related"; });
                });
                return out;
            }
            if (selected.kind === "feature") {
                var feature = findFeatureBySelected();
                if (!feature) return out;
                (Array.isArray(feature.objects) ? feature.objects : []).forEach(function each(id) { out[id] = "related"; });
                (Array.isArray(feature.rules) ? feature.rules : []).forEach(function each(ruleId) {
                    objectIdsForRuleId(ruleId).forEach(function eachObj(objId) { if (!out[objId]) out[objId] = "related"; });
                });
                return out;
            }
            if (selected.kind === "group") {
                var group = (model.groups || []).find(function find(row) { return row && row.id === selected.id; }) || null;
                groupRuleIds(group).forEach(function each(ruleId) {
                    objectIdsForRuleId(ruleId).forEach(function eachObj(objId) { out[objId] = "related"; });
                });
                return out;
            }
            return out;
        }

        function elementTypeForSwitch(switchRow) {
            if (!switchRow) return "";
            var sourceId = String(switchRow.sourceElementId || "");
            var element = index.elementById[sourceId];
            return element && element.type ? element.type : "";
        }

        function elementTypeForRule(rule) {
            var objects = relatedObjectsForRule(rule);
            if (!objects.length) return "";
            var element = index.elementById[objects[0]];
            return element && element.type ? element.type : "";
        }

        function relatedStatesForRule(rule) {
            var out = {};
            var tokens = Pin.logicVisualProjection.parseIdentifiers(rule && rule.condition || "");
            tokens.forEach(function each(name) {
                if (index.stateById[name] || index.computedById[name]) out[name] = true;
            });
            (rule && Array.isArray(rule.effects) ? rule.effects : []).forEach(function each(effect) {
                if (effect && typeof effect.target === "string" && (index.stateById[effect.target] || index.computedById[effect.target])) {
                    out[effect.target] = true;
                }
            });
            return Object.keys(out);
        }

        function relatedObjectsForRule(rule) {
            var out = {};
            var sw = rule && index.switchById[rule.trigger];
            if (sw && sw.sourceElementId) out[sw.sourceElementId] = true;
            (rule && Array.isArray(rule.effects) ? rule.effects : []).forEach(function each(effect) {
                if (!effect || typeof effect.target !== "string") return;
                if (effect.target.indexOf(".") >= 0) out[effect.target.split(".")[0]] = true;
            });
            return Object.keys(out);
        }

        function relatedLampsForRule(rule) {
            var out = {};
            var states = relatedStatesForRule(rule);
            Object.keys(index.lampExprByLampId).forEach(function each(lampId) {
                var expr = String(index.lampExprByLampId[lampId] || "");
                if (states.some(function some(stateId) { return expr.indexOf(stateId) >= 0; })) out[lampId] = true;
            });
            return Object.keys(out);
        }

        function renderToolbar(shell) {
            var bar = make("div", "logic-vb-toolbar");
            var left = make("div", "logic-vb-toolbar-left");
            left.innerHTML = "<span class='logic-vb-brand'>PINLOGIC</span> <span class='logic-vb-breadcrumb'>Workspace > " + escapeHtml(table.name || "Untitled Table") + "</span>";
            bar.appendChild(left);

            var middle = make("div", "logic-vb-toolbar-mid", "PINBALL LOGIC EDITOR");
            bar.appendChild(middle);

            var right = make("div", "logic-vb-toolbar-right");
            right.appendChild(make("span", "logic-vb-pill", "Auto-saved"));
            right.appendChild(iconButton("undo", "Undo"));
            right.appendChild(iconButton("redo", "Redo"));
            var validate = make("button", "logic-vb-btn logic-vb-btn-success", "Validate");
            validate.type = "button";
            validate.onclick = function onclick() { bottomTab = "validation"; render(); };
            right.appendChild(validate);
            var sim = make("button", "logic-vb-btn", "Test in Simulator");
            sim.type = "button";
            sim.onclick = function onclick() { routeFromRail("simulator"); };
            right.appendChild(sim);
            var zoomSel = make("select", "logic-vb-select");
            ["80%", "90%", "100%", "110%", "125%"].forEach(function each(value) {
                var opt = make("option", "", value);
                opt.value = value;
                if (value === zoom) opt.selected = true;
                zoomSel.appendChild(opt);
            });
            zoomSel.onchange = function onchange() { zoom = zoomSel.value; render(); };
            right.appendChild(zoomSel);
            right.appendChild(iconButton("settings", "Settings"));
            bar.appendChild(right);
            shell.appendChild(bar);
        }

        function iconButton(type, title) {
            var map = { undo: "↶", redo: "↷", settings: "⚙" };
            var b = make("button", "logic-vb-icon-btn", map[type] || "•");
            b.type = "button";
            b.title = title || type;
            return b;
        }

        function renderNavRail(panel) {
            var rail = make("div", "logic-vb-nav-rail");
            var activeId = navActiveId();
            var items = [
                { id: "play", label: "Play", icon: "▶" },
                { id: "design", label: "Design", icon: "✎" },
                { id: "logic", label: "Logic", icon: "◉" },
                { id: "features", label: "Features", icon: "★" },
                { id: "rules", label: "Rules", icon: "≡" },
                { id: "state", label: "State", icon: "◌" },
                { id: "feedback", label: "Feedback", icon: "◍" },
                { id: "simulator", label: "Simulator", icon: "⌁" },
                { id: "diagnostics", label: "Diagnostics", icon: "∿" }
            ];
            items.forEach(function each(item) {
                var row = make("button", "logic-vb-nav-item" + (item.id === activeId ? " active" : ""));
                row.type = "button";
                row.innerHTML = "<span class='logic-vb-nav-icon'>" + item.icon + "</span><span>" + item.label + "</span>";
                row.onclick = function onclick() { routeFromRail(item.id); };
                rail.appendChild(row);
            });
            panel.appendChild(rail);
        }

        function renderFeatureTree(panel) {
            var card = make("section", "logic-vb-card logic-vb-tree-card");
            card.appendChild(make("div", "logic-vb-title", "Feature Tree"));
            var root = make("div", "logic-vb-tree-root", "Game");
            card.appendChild(root);

            (table.features || []).forEach(function each(feature) {
                var name = feature && (feature.name || feature.id) || "Feature";
                var row = make("button", "logic-vb-tree-item" + (selected.kind === "feature" && selected.id === feature.id ? " active" : ""), name);
                row.type = "button";
                row.onclick = function onclick() { selectEntity("feature", feature.id); };
                card.appendChild(row);
            });

            (model.groups || []).forEach(function each(group) {
                if (!group || (group.kind !== "drainBehaviour" && group.kind !== "multiplierLadder")) return;
                var row = make("button", "logic-vb-tree-item synthetic" + (selected.kind === "group" && selected.id === group.id ? " active" : ""), group.label);
                row.type = "button";
                row.onclick = function onclick() { selectEntity("group", group.id); };
                card.appendChild(row);
            });
            panel.appendChild(card);
        }

        function renderCanvas(panel) {
            var card = make("section", "logic-vb-card logic-vb-canvas-card");
            var head = make("div", "logic-vb-canvas-head");
            head.appendChild(make("div", "logic-vb-title", "Logic Canvas"));
            var controls = make("div", "logic-vb-canvas-tools");
            ["Group", "Comment", "Arrange"].forEach(function each(label) {
                var b = make("button", "logic-vb-icon-btn", label);
                b.type = "button";
                controls.appendChild(b);
            });
            head.appendChild(controls);
            card.appendChild(head);
            if (workspaceSection === "logic" || workspaceSection === "rules" || workspaceSection === "state") {
                renderBuildPanel(card);
            }

            if (workspaceSection === "features") {
                renderFeatureCanvas(card);
                panel.appendChild(card);
                return;
            }
            if (workspaceSection === "rules") {
                renderRulesCanvas(card);
                panel.appendChild(card);
                return;
            }
            if (workspaceSection === "state") {
                renderStateCanvas(card);
                panel.appendChild(card);
                return;
            }
            if (workspaceSection === "feedback") {
                renderFeedbackCanvas(card);
                panel.appendChild(card);
                return;
            }
            if (workspaceSection === "diagnostics") {
                renderDiagnosticsCanvas(card);
                panel.appendChild(card);
                return;
            }

            groupedView().forEach(function each(entry, idx) {
                var group = entry.group;
                var kindClass = String(group.kind || "generic").replace(/[^a-zA-Z0-9_-]/g, "");
                var section = make("div", "logic-vb-group logic-vb-group-" + kindClass + (entry.muted ? " muted" : ""));
                var title = make("button", "logic-vb-group-title", String(idx + 1) + ". " + group.label);
                title.type = "button";
                title.onclick = function onclick() { selectEntity("group", group.id); };
                section.appendChild(title);

                if (group.kind === "completionGroup") renderCompletionGroup(section, group);
                else if (group.kind === "claimGroup") renderClaimGroup(section, group);
                else if (group.kind === "drainBehaviour") renderDrainGroup(section, group);
                else if (group.kind === "multiplierLadder") renderLadderGroup(section, group);
                else renderGenericGroup(section, group);

                card.appendChild(section);
            });

            panel.appendChild(card);
        }

        function renderBuildPanel(card) {
            /* What: Render guided creation controls for authoring table logic.
             * Why: Visual builder must create schema-backed rows, not only inspect them.
             */
            var panel = make("div", "logic-vb-build-panel");
            panel.appendChild(make("div", "logic-vb-subtitle", "Build Logic"));
            var roleRow = make("div", "logic-vb-role-row");
            [
                { id: "trigger", label: "Trigger" },
                { id: "target", label: "Target" },
                { id: "collect", label: "Collect" },
                { id: "drain", label: "Drain" },
                { id: "lamp", label: "Lamp" }
            ].forEach(function each(role) {
                var chip = make("button", "logic-vb-chip" + (buildRole === role.id ? " on" : ""), role.label);
                chip.type = "button";
                chip.onclick = function onclick() {
                    buildRole = buildRole === role.id ? "" : role.id;
                    buildDraft.error = "";
                    render();
                };
                roleRow.appendChild(chip);
            });
            var clearTargets = make("button", "logic-vb-chip", "Clear Targets");
            clearTargets.type = "button";
            clearTargets.onclick = function onclick() {
                buildDraft.targetSwitchIds = [];
                buildDraft.error = "";
                render();
            };
            roleRow.appendChild(clearTargets);
            panel.appendChild(roleRow);
            panel.appendChild(make("div", "logic-vb-small", buildRole ? ("Role mode active: click playfield/canvas for " + buildRole + ".") : "Pick a role, then click playfield/canvas items."));

            panel.appendChild(field("Feature Name", buildDraft.featureName || "", function onChange(v) { buildDraft.featureName = v; }));
            panel.appendChild(field("Trigger Score", String(buildDraft.triggerScore || 0), function onChange(v) { buildDraft.triggerScore = Number(v || 0); }));
            panel.appendChild(field("Target Hit Score", String(buildDraft.targetHitScore || 0), function onChange(v) { buildDraft.targetHitScore = Number(v || 0); }));
            panel.appendChild(field("Collect Award", String(buildDraft.collectAward || 0), function onChange(v) { buildDraft.collectAward = Number(v || 0); }));
            panel.appendChild(boolField("Reset targets on collect", buildDraft.resetOnCollect !== false, function onChange(v) { buildDraft.resetOnCollect = !!v; }));
            panel.appendChild(renderBuildSummary());

            var actions = make("div", "logic-vb-build-actions");
            var switchLamp = make("button", "logic-vb-btn", "Create Switch -> Lamp");
            switchLamp.type = "button";
            switchLamp.onclick = function onclick() { createSwitchLampFlow(); };
            actions.appendChild(switchLamp);
            var bank = make("button", "logic-vb-btn", "Create Target Bank + Collect");
            bank.type = "button";
            bank.onclick = function onclick() { createTargetBankCollectFlow(); };
            actions.appendChild(bank);
            var drain = make("button", "logic-vb-btn", "Create Drain Reset");
            drain.type = "button";
            drain.onclick = function onclick() { createDrainResetFlow(); };
            actions.appendChild(drain);
            panel.appendChild(actions);

            panel.appendChild(make("div", "logic-vb-subtitle", "New Rule"));
            panel.appendChild(field("Name", buildDraft.genericRuleName || "", function onChange(v) { buildDraft.genericRuleName = v; }));
            panel.appendChild(selectField("Trigger", buildDraft.genericRuleTrigger || "", switchOptions(), function onChange(v) { buildDraft.genericRuleTrigger = v; }));
            panel.appendChild(textField("Condition", buildDraft.genericRuleCondition || "", function onChange(v) { buildDraft.genericRuleCondition = v; }));
            panel.appendChild(boolField("Enabled", buildDraft.genericRuleEnabled !== false, function onChange(v) { buildDraft.genericRuleEnabled = !!v; }));
            panel.appendChild(selectField("Effect Type", buildDraft.genericEffectType || "set", [
                { value: "set", label: "set" },
                { value: "add", label: "add" },
                { value: "score", label: "score" },
                { value: "setElementProperty", label: "setElementProperty" },
                { value: "clearElementProperty", label: "clearElementProperty" }
            ], function onChange(v) { buildDraft.genericEffectType = v; }));
            panel.appendChild(field("Effect Target", buildDraft.genericEffectTarget || "", function onChange(v) { buildDraft.genericEffectTarget = v; }));
            panel.appendChild(field("Effect Value", String(buildDraft.genericEffectValue == null ? "" : buildDraft.genericEffectValue), function onChange(v) { buildDraft.genericEffectValue = v; }));
            var addRule = make("button", "logic-vb-btn logic-vb-btn-success", "Add Rule");
            addRule.type = "button";
            addRule.onclick = function onclick() { createGenericRule(); };
            panel.appendChild(addRule);

            if (buildDraft.error) panel.appendChild(make("div", "logic-vb-mini-note logic-vb-build-error", buildDraft.error));
            card.appendChild(panel);
        }

        function renderBuildSummary() {
            var row = make("div", "logic-vb-build-summary");
            row.appendChild(make("div", "logic-vb-small", "Trigger: " + (labelForSwitchId(buildDraft.triggerSwitchId) || "None")));
            row.appendChild(make("div", "logic-vb-small", "Lamp: " + (labelForLampId(buildDraft.lampId) || "None")));
            row.appendChild(make("div", "logic-vb-small", "Targets: " + (buildDraft.targetSwitchIds.length ? buildDraft.targetSwitchIds.map(labelForSwitchId).join(", ") : "None")));
            row.appendChild(make("div", "logic-vb-small", "Collect: " + (labelForSwitchId(buildDraft.collectSwitchId) || "None")));
            row.appendChild(make("div", "logic-vb-small", "Drain: " + (labelForSwitchId(buildDraft.drainSwitchId) || "None")));
            return row;
        }

        function renderFeatureCanvas(card) {
            /* What: Render a compact feature-centric section inside PinLogic shell.
             * Why: Rail navigation should stay in one workspace while still exposing feature metadata.
             */
            var list = Array.isArray(table.features) ? table.features : [];
            if (!list.length) {
                card.appendChild(make("div", "logic-vb-mini-note", "No features defined. Create one from feature tools or add rule/state links."));
                return;
            }
            var grid = make("div", "logic-vb-rule-grid");
            list.forEach(function each(feature) {
                var title = feature && (feature.name || feature.id) || "Feature";
                var count = "rules " + String(((feature && feature.rules) || []).length) + ", states " + String(((feature && feature.states) || []).length);
                var b = make("button", "logic-vb-rule-card", title + "  |  " + count);
                b.type = "button";
                b.onclick = function onclick() { if (feature && feature.id) selectEntity("feature", feature.id); };
                grid.appendChild(b);
            });
            card.appendChild(grid);
        }

        function renderRulesCanvas(card) {
            /* What: Render all action rules in one dense list view.
             * Why: Rules rail section should prioritize fast scan/edit entry from the same shell.
             */
            var rules = Array.isArray(doc.actionRules) ? doc.actionRules : [];
            if (!rules.length) {
                card.appendChild(make("div", "logic-vb-mini-note", "No action rules defined."));
                return;
            }
            var grid = make("div", "logic-vb-rule-grid");
            rules.forEach(function each(rule) {
                if (!rule) return;
                var b = make("button", "logic-vb-rule-card", (rule.name || rule.id || "(unnamed)") + "  |  trigger: " + (rule.trigger || "(none)"));
                b.type = "button";
                b.onclick = function onclick() { if (rule.id) selectEntity("rule", rule.id); };
                grid.appendChild(b);
            });
            card.appendChild(grid);
        }

        function renderStateCanvas(card) {
            /* What: Render stored + computed state cards in one grid.
             * Why: State rail section should emphasize state inventory over rule flow.
             */
            var list = [];
            (doc.stateTable || []).forEach(function each(row) {
                if (!row || !row.id) return;
                list.push({ kind: "state", id: row.id, title: row.name || row.id, sub: "LATCH STATE", icon: "switch", onClick: function onClick() { selectEntity("state", row.id); } });
            });
            (doc.computedState || []).forEach(function each(row) {
                if (!row || !row.id) return;
                list.push({ kind: "computed", id: row.id, title: row.name || row.id, sub: "COMPUTED STATE", icon: "scoreZone", onClick: function onClick() { selectEntity("computed", row.id); } });
            });
            if (!list.length) {
                card.appendChild(make("div", "logic-vb-mini-note", "No state rows defined."));
                return;
            }
            var grid = make("div", "logic-vb-state-grid");
            list.forEach(function each(item) {
                grid.appendChild(nodeCard(item.kind, item.title, item.sub, item.icon, item.onClick));
            });
            card.appendChild(grid);
        }

        function renderFeedbackCanvas(card) {
            /* What: Render lamp bindings as output cards.
             * Why: Feedback rail section should expose output expressions directly.
             */
            var rows = Array.isArray(doc.lampBindings) ? doc.lampBindings : [];
            if (!rows.length) {
                card.appendChild(make("div", "logic-vb-mini-note", "No lamp bindings defined."));
                return;
            }
            var grid = make("div", "logic-vb-rule-grid");
            rows.forEach(function each(row) {
                if (!row || !row.lampId) return;
                var b = make("button", "logic-vb-rule-card", row.lampId + "  |  " + String(row.expr || "false"));
                b.type = "button";
                b.onclick = function onclick() { selectEntity("lamp", row.lampId); };
                grid.appendChild(b);
            });
            card.appendChild(grid);
        }

        function renderDiagnosticsCanvas(card) {
            /* What: Render validation issues inside the canvas.
             * Why: Diagnostics rail section should surface problems without leaving PinLogic.
             */
            var issues = (validation && validation.errors || []).concat(validation && validation.issues || []);
            if (!issues.length) {
                card.appendChild(make("div", "logic-vb-mini-note", "Schema valid. No issues found."));
                return;
            }
            issues.forEach(function each(issue, idx) {
                var row = make("div", "logic-vb-readonly");
                row.appendChild(make("div", "logic-vb-small", String(idx + 1) + ". " + String(issue && issue.message || "Issue")));
                if (issue && issue.section) row.appendChild(make("div", "logic-vb-small", "Section: " + String(issue.section)));
                card.appendChild(row);
            });
        }

        function renderCompletionGroup(section, group) {
            var flow = make("div", "logic-vb-completion-layout");
            var feeders = make("div", "logic-vb-feeder-grid");
            var feederRules = (group.feederRuleIds || []).map(function map(id) { return index.ruleById[id]; }).filter(Boolean);
            feederRules.forEach(function each(rule) {
                var row = make("div", "logic-vb-row logic-vb-feeder-row");
                var sw = index.switchById[rule.trigger];
                row.appendChild(nodeCard("switch", (sw && (sw.name || sw.id)) || rule.trigger || "switch", "SWITCH", elementTypeForSwitch(sw), function onclick() {
                    if (sw && sw.id) selectEntity("switch", sw.id);
                }));
                row.appendChild(make("div", "logic-vb-arrow", "→"));
                var target = primaryStateTarget(rule) || firstEffectTarget(rule) || "state";
                var state = index.stateById[target];
                row.appendChild(nodeCard("state", (state && (state.name || state.id)) || target, "LATCH STATE", elementTypeForRule(rule), function onclick() {
                    if (state && state.id) selectEntity("state", state.id);
                }));
                feeders.appendChild(row);
            });
            flow.appendChild(feeders);

            var middle = make("div", "logic-vb-middle-stack");
            var computed = index.computedById[group.computedStateId] || null;
            middle.appendChild(nodeCard("computed", (computed && (computed.name || computed.id)) || group.computedStateId || "Computed", "COMPUTED STATE", "scoreZone", function onclick() {
                if (computed && computed.id) selectEntity("computed", computed.id);
            }));
            var completionRules = (group.completionRuleIds || []).map(function map(id) { return index.ruleById[id]; }).filter(Boolean);
            completionRules.forEach(function each(rule) {
                middle.appendChild(nodeCard("rule", rule.name || rule.id, "RULE", elementTypeForRule(rule), function onclick() { selectEntity("rule", rule.id); }));
            });
            flow.appendChild(middle);
            section.appendChild(flow);
        }

        function renderClaimGroup(section, group) {
            var row = make("div", "logic-vb-row logic-vb-claim-layout");
            var sw = index.switchById[group.trigger];
            row.appendChild(nodeCard("switch", (sw && (sw.name || sw.id)) || group.trigger || "collect", "TRIGGER", elementTypeForSwitch(sw), function onclick() {
                if (sw && sw.id) selectEntity("switch", sw.id);
            }));
            row.appendChild(make("div", "logic-vb-arrow", "→"));
            row.appendChild(nodeCard("condition", group.condition || "(condition)", "CONDITION", "scoreZone", function noop() {}));
            row.appendChild(make("div", "logic-vb-arrow", "→"));
            var rule = index.ruleById[group.ruleId];
            row.appendChild(nodeCard("rule", (rule && (rule.name || rule.id)) || group.ruleId, "CLAIM RULE", elementTypeForRule(rule), function onclick() {
                if (rule && rule.id) selectEntity("rule", rule.id);
            }));
            section.appendChild(row);
        }

        function renderDrainGroup(section, group) {
            var shell = make("div", "logic-vb-drain-shell");

            var engine = make("div", "logic-vb-subgroup");
            engine.appendChild(make("div", "logic-vb-subtitle", "Engine Flow"));
            var drainId = (group.drainSwitchIds || [])[0] || "drain";
            engine.appendChild(nodeCard("switch", drainId, "DRAIN SWITCH", "drain", function noop() {}));
            engine.appendChild(make("div", "logic-vb-mini-note", "Balls left? Yes -> Serve next ball | No -> Game over"));
            shell.appendChild(engine);

            var reset = make("div", "logic-vb-subgroup");
            reset.appendChild(make("div", "logic-vb-subtitle", "Table Reset"));
            (group.resetRuleIds || []).map(function map(id) { return index.ruleById[id]; }).filter(Boolean).forEach(function each(rule) {
                var card = nodeCard("rule", rule.name || rule.id, "RESET RULE", elementTypeForRule(rule), function onclick() { selectEntity("rule", rule.id); });
                reset.appendChild(card);
            });
            if (!(group.resetRuleIds || []).length) reset.appendChild(make("div", "logic-vb-mini-note", "No drain reset action rules detected."));
            shell.appendChild(reset);

            section.appendChild(shell);
        }

        function renderLadderGroup(section, group) {
            var ladder = make("div", "logic-vb-ladder-row");
            (group.transitions || []).forEach(function each(step) {
                var chip = make("button", "logic-vb-ladder-step", String(step.from) + "x");
                chip.type = "button";
                chip.onclick = function onclick() { if (step.ruleId) selectEntity("rule", step.ruleId); };
                ladder.appendChild(chip);
                ladder.appendChild(make("div", "logic-vb-arrow", "→"));
            });
            if (ladder.lastChild) ladder.removeChild(ladder.lastChild);
            section.appendChild(ladder);
        }

        function renderGenericGroup(section, group) {
            var rules = groupRuleIds(group).map(function map(id) { return index.ruleById[id]; }).filter(Boolean);
            if (!rules.length) {
                section.appendChild(make("div", "logic-vb-mini-note", "No explicit rules mapped."));
                return;
            }
            var grid = make("div", "logic-vb-rule-grid");
            rules.forEach(function each(rule) {
                var b = make("button", "logic-vb-rule-card", (rule.name || rule.id) + "  |  trigger: " + (rule.trigger || "(none)"));
                b.type = "button";
                b.onclick = function onclick() { selectEntity("rule", rule.id); };
                grid.appendChild(b);
            });
            section.appendChild(grid);
        }

        function nodeCard(kind, title, subtitle, iconType, onClick) {
            var card = make("button", "logic-vb-node-card " + kind);
            card.type = "button";
            var head = make("div", "logic-vb-node-head");
            var icon = make("span", "logic-vb-node-icon");
            icon.setAttribute("aria-hidden", "true");
            icon.innerHTML = designerPaletteSvgForType(iconType || "");
            head.appendChild(icon);
            var text = make("div", "logic-vb-node-text");
            text.appendChild(make("div", "logic-vb-node-title", title));
            text.appendChild(make("div", "logic-vb-node-sub", subtitle));
            head.appendChild(text);
            card.appendChild(head);
            card.onclick = function onclick() { if (typeof onClick === "function") onClick(); };
            return card;
        }

        function renderInspector(panel) {
            var card = make("section", "logic-vb-card logic-vb-inspector-card");
            var head = make("div", "logic-vb-inspector-head");
            head.appendChild(make("div", "logic-vb-title", "Inspector"));
            card.appendChild(head);

            if (selected.kind === "rule") renderRuleInspector(card, findRuleBySelected());
            else if (selected.kind === "feature") renderFeatureInspector(card, findFeatureBySelected());
            else if (selected.kind === "object") renderObjectInspector(card, selectedObject());
            else if (selected.kind === "state") renderStateInspector(card, index.stateById[selected.id] || null);
            else if (selected.kind === "computed") renderComputedInspector(card, index.computedById[selected.id] || null);
            else if (selected.kind === "switch") renderSwitchInspector(card, index.switchById[selected.id] || null);
            else if (selected.kind === "lamp") renderLampInspector(card, selectedLampBinding());
            else card.appendChild(make("div", "logic-vb-small", "Select a card from the canvas or tree."));

            panel.appendChild(card);
        }

        function renderRuleInspector(card, rule) {
            if (!rule) {
                card.appendChild(make("div", "logic-vb-small", "Rule not found."));
                return;
            }
            card.appendChild(field("Name", rule.name || "", function onChange(v) { rule.name = v; commit(); }));
            card.appendChild(field("ID", rule.id || "", null));
            card.appendChild(boolField("Enabled", rule.enabled !== false, function onChange(v) { rule.enabled = v; commit(); }));
            card.appendChild(selectField("Trigger", rule.trigger || "", (doc.switchRegistry || []).map(function map(sw) {
                return { value: sw.id, label: sw.name ? (sw.name + " (" + sw.id + ")") : sw.id };
            }), function onChange(v) { rule.trigger = v; commit(); }));
            card.appendChild(textField("Condition", rule.condition || "", function onChange(v) { rule.condition = v; commit(); }));

            var effects = Array.isArray(rule.effects) ? rule.effects : [];
            var effectHead = make("div", "logic-vb-subtitle", "Effects");
            card.appendChild(effectHead);
            effects.forEach(function each(effect, idx) {
                var row = make("div", "logic-vb-effect-row");
                row.appendChild(make("div", "logic-vb-small", String(idx + 1) + ". " + String(effect && effect.type || "unknown")));
                if (effect && (effect.type === "set" || effect.type === "add" || effect.type === "score" || effect.type === "setElementProperty")) {
                    var input = make("input", "logic-vb-inline-input");
                    input.value = String(effect.value == null ? "" : effect.value);
                    input.oninput = function oninput() { effect.value = input.value; commit(); };
                    row.appendChild(input);
                } else {
                    var raw = make("pre", "logic-vb-raw-json");
                    raw.textContent = JSON.stringify(effect, null, 2);
                    row.appendChild(raw);
                }
                var remove = make("button", "logic-vb-btn logic-vb-btn-ghost", "Remove");
                remove.type = "button";
                remove.onclick = function onclick() {
                    if (!Array.isArray(rule.effects)) return;
                    rule.effects.splice(idx, 1);
                    commit();
                    render();
                };
                row.appendChild(remove);
                card.appendChild(row);
            });

            var add = make("button", "logic-vb-btn logic-vb-btn-ghost", "+ Add Effect");
            add.type = "button";
            add.onclick = function onclick() {
                rule.effects = Array.isArray(rule.effects) ? rule.effects : [];
                rule.effects.push({ type: "set", target: "", value: true });
                commit();
                render();
            };
            card.appendChild(add);

            chipLine(card, "Related objects", relatedObjectsForRule(rule));
            chipLine(card, "Related states", relatedStatesForRule(rule));
            chipLine(card, "Related lamps", relatedLampsForRule(rule));
        }

        function renderFeatureInspector(card, feature) {
            if (!feature) {
                card.appendChild(make("div", "logic-vb-small", "Feature not found."));
                return;
            }
            card.appendChild(field("Name", feature.name || "", function onChange(v) { feature.name = v; commit(); }));
            card.appendChild(field("ID", feature.id || "", null));
            card.appendChild(textField("Goal", feature.goal || "", function onChange(v) { feature.goal = v; commit(); }));
            card.appendChild(textField("Description", feature.description || "", function onChange(v) { feature.description = v; commit(); }));
            card.appendChild(featureMembershipEditor(feature, "objects", (table.elements || []).map(function map(row) { return row.id; })));
            card.appendChild(featureMembershipEditor(feature, "states", (doc.stateTable || []).map(function map(row) { return row.id; })));
            card.appendChild(featureMembershipEditor(feature, "rules", (doc.actionRules || []).map(function map(row) { return row.id; })));
            card.appendChild(featureMembershipEditor(feature, "lamps", (doc.lampBindings || []).map(function map(row) { return row.lampId; })));
        }

        function renderObjectInspector(card, objectRow) {
            if (!objectRow) {
                card.appendChild(make("div", "logic-vb-small", "Object not found."));
                return;
            }
            card.appendChild(readOnly("ID", objectRow.id || ""));
            card.appendChild(readOnly("Type", objectRow.type || ""));
            card.appendChild(readOnly("Location", "x:" + Math.round(Number(objectRow.x) || 0) + "  y:" + Math.round(Number(objectRow.y) || 0)));
        }

        function renderStateInspector(card, row) {
            if (!row) {
                card.appendChild(make("div", "logic-vb-small", "State not found."));
                return;
            }
            card.appendChild(readOnly("ID", row.id || ""));
            card.appendChild(readOnly("Name", row.name || ""));
            card.appendChild(readOnly("Type", row.type || ""));
            card.appendChild(readOnly("Initial", row.initial == null ? "" : String(row.initial)));
        }

        function renderComputedInspector(card, row) {
            if (!row) {
                card.appendChild(make("div", "logic-vb-small", "Computed state not found."));
                return;
            }
            card.appendChild(readOnly("ID", row.id || ""));
            card.appendChild(readOnly("Name", row.name || ""));
            card.appendChild(readOnly("Expr", row.expr || ""));
        }

        function renderSwitchInspector(card, row) {
            if (!row) {
                card.appendChild(make("div", "logic-vb-small", "Switch not found."));
                return;
            }
            card.appendChild(readOnly("ID", row.id || ""));
            card.appendChild(readOnly("Name", row.name || ""));
            card.appendChild(readOnly("Kind", row.kind || "switch"));
            card.appendChild(readOnly("Source", row.sourceElementId || ""));
        }

        function renderLampInspector(card, row) {
            if (!row) {
                card.appendChild(make("div", "logic-vb-small", "Lamp binding not found."));
                return;
            }
            card.appendChild(readOnly("Lamp ID", row.lampId || ""));
            card.appendChild(textField("Expression", row.expr || "", function onChange(v) { row.expr = v; commit(); }));
        }

        function renderPlayfieldPanel(panel) {
            var card = make("section", "logic-vb-card logic-vb-playfield-card");
            card.appendChild(make("div", "logic-vb-title", "Playfield Reference"));

            var controls = make("div", "logic-vb-toggle-row");
            controls.appendChild(boolField("Objects", showPlayfieldObjects, function onChange(v) {
                showPlayfieldObjects = v;
                render();
            }));
            controls.appendChild(boolField("Lamps", showPlayfieldLamps, function onChange(v) {
                showPlayfieldLamps = v;
                render();
            }));
            card.appendChild(controls);

            var map = make("div", "logic-vb-playfield-map");
            var pfWidth = Number(table && table.playfield && table.playfield.width) || 500;
            var pfHeight = Number(table && table.playfield && table.playfield.height) || 880;
            if (pfWidth > 0 && pfHeight > 0) map.style.aspectRatio = String(pfWidth) + " / " + String(pfHeight);
            var bg = resolvePlayfieldImageUrl(table, tableAssetBaseHref);
            if (bg) {
                map.style.backgroundImage = "url('" + escapeCssUrl(bg) + "')";
                map.classList.add("has-image");
            }
            var highlighted = highlightedObjectIds();
            (table.elements || []).slice(0, 160).forEach(function each(el, idx) {
                if (!el || typeof el.id !== "string") return;
                if (!Number.isFinite(el.x) || !Number.isFinite(el.y)) return;
                var isLamp = !!el.lampId || el.type === "light" || el.type === "arrowLight" || el.type === "boxLight";
                if (isLamp && !showPlayfieldLamps) return;
                if (!isLamp && !showPlayfieldObjects) return;
                var markerClass = "logic-vb-dot " + (isLamp ? "lamp" : "object");
                if (highlighted[el.id] === "selected") markerClass += " active";
                else if (highlighted[el.id] === "related") markerClass += " involved";
                var marker = make("button", markerClass);
                marker.type = "button";
                marker.title = el.id;
                marker.style.left = Math.max(2, Math.min(98, (Number(el.x) / Math.max(1, pfWidth)) * 100)) + "%";
                marker.style.top = Math.max(2, Math.min(98, (Number(el.y) / Math.max(1, pfHeight)) * 100)) + "%";
                marker.onclick = function onclick() { selectEntity("object", el.id); };
                marker.textContent = String(idx + 1);
                map.appendChild(marker);
            });
            card.appendChild(map);

            var info = make("div", "logic-vb-object-info");
            var obj = selectedObject();
            info.appendChild(make("div", "logic-vb-subtitle", "Playfield Object Info"));
            if (obj) {
                info.appendChild(make("div", "logic-vb-small", obj.id + " (" + (obj.type || "object") + ")"));
                info.appendChild(make("div", "logic-vb-small", "x:" + Math.round(Number(obj.x) || 0) + " y:" + Math.round(Number(obj.y) || 0)));
            } else {
                info.appendChild(make("div", "logic-vb-small", "Select an object marker."));
            }
            card.appendChild(info);
            panel.appendChild(card);
        }

        function renderBottom(shell) {
            var wrap = make("section", "logic-vb-bottom");
            var tabs = make("div", "logic-vb-tabs");
            [
                { id: "json", label: "JSON Preview" },
                { id: "schema", label: "Generated Schema" },
                { id: "validation", label: "Validation" }
            ].forEach(function each(tab) {
                var b = make("button", "logic-vb-tab" + (bottomTab === tab.id ? " active" : ""), tab.label);
                b.type = "button";
                b.onclick = function onclick() { bottomTab = tab.id; render(); };
                tabs.appendChild(b);
            });
            wrap.appendChild(tabs);

            var body = make("div", "logic-vb-bottom-body");
            var pre = make("pre", "logic-vb-json");
            if (bottomTab === "json") pre.textContent = JSON.stringify(selectedJson(), null, 2);
            if (bottomTab === "schema") pre.textContent = JSON.stringify(doc, null, 2);
            if (bottomTab === "validation") pre.textContent = JSON.stringify(validation.issues || [], null, 2);
            body.appendChild(pre);

            var status = make("div", "logic-vb-validation-summary");
            status.appendChild(make("div", "logic-vb-validation-title", validation.ok ? "Schema valid" : "Schema issues"));
            status.appendChild(make("div", "logic-vb-small", validation.ok ? "No issues found." : String((validation.errors || []).length) + " error(s), " + String((validation.issues || []).length) + " issue(s)."));
            body.appendChild(status);
            wrap.appendChild(body);
            shell.appendChild(wrap);
        }

        function selectedJson() {
            if (selected.kind === "rule") return findRuleBySelected() || {};
            if (selected.kind === "feature") return findFeatureBySelected() || {};
            if (selected.kind === "object") return selectedObject() || {};
            if (selected.kind === "state") return index.stateById[selected.id] || {};
            if (selected.kind === "switch") return index.switchById[selected.id] || {};
            if (selected.kind === "computed") return index.computedById[selected.id] || {};
            if (selected.kind === "group") {
                var group = (model.groups || []).find(function find(row) { return row && row.id === selected.id; }) || null;
                return group || {};
            }
            return { selected: selected, groups: model.groups };
        }

        function field(label, value, onChange) {
            var row = make("div", "logic-vb-field");
            row.appendChild(make("label", "", label));
            var input = make("input", "logic-vb-input");
            input.value = String(value == null ? "" : value);
            if (typeof onChange !== "function") input.disabled = true;
            input.oninput = function oninput() { if (onChange) onChange(input.value); };
            row.appendChild(input);
            return row;
        }

        function textField(label, value, onChange) {
            var row = make("div", "logic-vb-field");
            row.appendChild(make("label", "", label));
            var area = make("textarea", "logic-vb-textarea");
            area.value = String(value == null ? "" : value);
            area.oninput = function oninput() { if (onChange) onChange(area.value); };
            row.appendChild(area);
            return row;
        }

        function readOnly(label, value) {
            var row = make("div", "logic-vb-readonly");
            row.appendChild(make("div", "logic-vb-small", label));
            row.appendChild(make("div", "", String(value == null ? "" : value)));
            return row;
        }

        function boolField(label, value, onChange) {
            var row = make("label", "logic-vb-checkbox-row");
            var input = make("input", "");
            input.type = "checkbox";
            input.checked = !!value;
            input.onchange = function onchange() { if (onChange) onChange(input.checked); };
            row.appendChild(input);
            row.appendChild(make("span", "", label));
            return row;
        }

        function selectField(label, value, items, onChange) {
            var row = make("div", "logic-vb-field");
            row.appendChild(make("label", "", label));
            var select = make("select", "logic-vb-select");
            items.forEach(function each(item) {
                var option = make("option", "", item.label);
                option.value = item.value;
                if (String(item.value) === String(value)) option.selected = true;
                select.appendChild(option);
            });
            select.onchange = function onchange() { if (onChange) onChange(select.value); };
            row.appendChild(select);
            return row;
        }

        function chipLine(card, title, ids) {
            var list = Array.isArray(ids) ? ids : [];
            var row = make("div", "logic-vb-chip-line");
            row.appendChild(make("div", "logic-vb-small", title));
            var chips = make("div", "logic-vb-chip-wrap");
            list.forEach(function each(id) { chips.appendChild(make("span", "logic-vb-chip static", id)); });
            if (!list.length) chips.appendChild(make("span", "logic-vb-small", "(none)"));
            row.appendChild(chips);
            card.appendChild(row);
        }

        function featureMembershipEditor(feature, key, candidates) {
            var row = make("div", "logic-vb-field");
            row.appendChild(make("label", "", "Feature " + key));
            var wrap = make("div", "logic-vb-chip-wrap");
            var values = Array.isArray(feature[key]) ? feature[key] : [];
            feature[key] = values;
            candidates.slice(0, 60).forEach(function each(id) {
                if (!id) return;
                var chip = make("button", "logic-vb-chip" + (values.indexOf(id) >= 0 ? " on" : ""), id);
                chip.type = "button";
                chip.onclick = function onclick() {
                    var idx = values.indexOf(id);
                    if (idx >= 0) values.splice(idx, 1);
                    else values.push(id);
                    commit();
                    render();
                };
                wrap.appendChild(chip);
            });
            row.appendChild(wrap);
            return row;
        }

        function resolvePlayfieldImageUrl(tableValue, baseHref) {
            var images = Array.isArray(tableValue && tableValue.images) ? tableValue.images : [];
            var candidate = images.find(function find(layer) {
                if (!layer || typeof layer.src !== "string" || !layer.src) return false;
                var mode = String(layer.mode || "both").toLowerCase();
                return mode === "both" || mode === "play";
            }) || images.find(function findAny(layer) {
                return layer && typeof layer.src === "string" && !!layer.src;
            }) || null;
            if (!candidate) return "";
            var src = String(candidate.src || "");
            if (!src) return "";
            if (/^(https?:|data:|blob:)/i.test(src)) return src;
            if (!baseHref) return src;
            return String(baseHref).replace(/\/+$/, "") + "/" + src.replace(/^\/+/, "");
        }

        function escapeCssUrl(value) {
            return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        }

        function designerPaletteSvgForType(type) {
            /* What: Reuse the same SVG vocabulary used by the designer palette.
             * Why: Logic canvas and designer should speak the same visual language.
             */
            var art = {
                leftFlipper: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="12" cy="31" r="4.5" fill="#f3f7ff"/><path d="M12 31 L36 21" stroke="#00ddff" stroke-width="8" stroke-linecap="round"/><path d="M12 31 L36 21" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round"/></svg>',
                rightFlipper: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="36" cy="31" r="4.5" fill="#f3f7ff"/><path d="M36 31 L12 21" stroke="#ff4466" stroke-width="8" stroke-linecap="round"/><path d="M36 31 L12 21" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round"/></svg>',
                launcher: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="21" y="6" width="6" height="26" rx="2" fill="#7ea1ff"/><rect x="18" y="33" width="12" height="7" rx="3.5" fill="#ee4444"/><rect x="17" y="5" width="14" height="37" rx="4" fill="none" stroke="rgba(214,228,255,0.45)" stroke-width="1.5"/></svg>',
                spinner: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="3" fill="#f3f7ff"/><path d="M10 24 H38" stroke="#ffdd00" stroke-width="5" stroke-linecap="round"/><path d="M24 10 V38" stroke="rgba(255,255,255,0.55)" stroke-width="2" stroke-linecap="round"/></svg>',
                gate: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="14" cy="24" r="3" fill="#f3f7ff"/><path d="M14 24 L35 17" stroke="#99ffcc" stroke-width="4" stroke-linecap="round"/></svg>',
                kicker: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="10" fill="rgba(136,255,204,0.18)" stroke="#88ffcc" stroke-width="3"/><circle cx="24" cy="24" r="4" fill="#dffbf1"/></svg>',
                trough: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="14" fill="#08101f" stroke="#88aaff" stroke-width="3"/><circle cx="20" cy="20" r="5" fill="rgba(255,255,255,0.18)"/><circle cx="24" cy="24" r="6" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2"/></svg>',
                bumper: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="12" fill="#ff3377"/><circle cx="24" cy="24" r="6" fill="#ffd6e6"/><circle cx="24" cy="24" r="16" fill="none" stroke="rgba(255,51,119,0.45)" stroke-width="3"/></svg>',
                dropTarget: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="18" y="8" width="12" height="24" rx="3" fill="#ffcc00"/><rect x="18" y="33" width="12" height="4" rx="2" fill="rgba(255,255,255,0.35)"/></svg>',
                lane: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="16" width="28" height="14" rx="4" fill="none" stroke="#33dd88" stroke-width="3"/><path d="M16 23 H32" stroke="rgba(51,221,136,0.55)" stroke-width="2" stroke-linecap="round"/></svg>',
                scoreZone: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="12" fill="none" stroke="#ffee55" stroke-width="3" stroke-dasharray="4 3"/><circle cx="24" cy="24" r="4" fill="#ffee55"/></svg>',
                light: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="10" fill="#ffee55"/><circle cx="24" cy="24" r="15" fill="none" stroke="rgba(255,238,85,0.35)" stroke-width="4"/></svg>',
                arrowLight: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M7 18 H27 V11 L42 24 L27 37 V30 H7 Z" fill="#66ddff"/><path d="M10 21 H27" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.65"/></svg>',
                boxLight: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="14" width="32" height="20" rx="6" fill="#8fe36a"/><rect x="12" y="18" width="24" height="6" rx="3" fill="rgba(255,255,255,0.35)"/></svg>',
                path: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 31 C17 12, 31 12, 40 24" fill="none" stroke="#a8b5ea" stroke-width="4" stroke-linecap="round"/></svg>',
                ramp: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M9 31 C17 14, 30 14, 39 22" fill="none" stroke="#88aaff" stroke-width="4" stroke-linecap="round"/><path d="M9 35 C17 18, 30 18, 39 26" fill="none" stroke="rgba(136,170,255,0.55)" stroke-width="3" stroke-linecap="round"/></svg>',
                drain: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="20" width="28" height="10" rx="4" fill="rgba(255,68,102,0.16)" stroke="#ff4466" stroke-width="3"/><path d="M18 18 L24 31 L30 18" fill="none" stroke="#ff95aa" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            };
            return art[type] || '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="10" width="28" height="28" rx="7" fill="rgba(143,168,255,0.16)" stroke="rgba(143,168,255,0.55)" stroke-width="2"/></svg>';
        }

        function switchOptions() {
            return (doc.switchRegistry || []).map(function map(sw) {
                if (!sw || !sw.id) return null;
                return { value: sw.id, label: sw.name ? (sw.name + " (" + sw.id + ")") : sw.id };
            }).filter(Boolean);
        }

        function labelForSwitchId(id) {
            if (!id) return "";
            var row = index.switchById[id];
            return row ? (row.name || row.id) : String(id);
        }

        function labelForLampId(id) {
            if (!id) return "";
            return String(id);
        }

        function sourceElementIdForSwitchId(switchId) {
            var row = index.switchById[switchId];
            return row && row.sourceElementId ? String(row.sourceElementId) : "";
        }

        function lampIdForSwitchId(switchId) {
            var sourceId = sourceElementIdForSwitchId(switchId);
            return sourceId ? lampIdForElement(sourceId) : "";
        }

        function switchIdForElement(elementId) {
            if (!elementId) return "";
            var existing = (doc.switchRegistry || []).find(function find(row) {
                return row && (row.sourceElementId === elementId || row.id === elementId);
            });
            if (existing && existing.id) return existing.id;
            var candidate = (assets.switchCandidates || []).find(function find(row) {
                return row && (row.sourceElementId === elementId || row.id === elementId);
            });
            if (!candidate || !candidate.id) return "";
            (doc.switchRegistry || []).push({
                id: candidate.id,
                name: candidate.name || candidate.id,
                kind: candidate.kind || "switch",
                sourceElementId: candidate.sourceElementId || elementId
            });
            return candidate.id;
        }

        function lampIdForElement(elementId) {
            var element = index.elementById[elementId];
            if (element && element.lampId) return String(element.lampId);
            var candidate = (assets.lampCandidates || []).find(function find(row) {
                return row && row.sourceElementId === elementId;
            });
            return candidate && candidate.id ? candidate.id : "";
        }

        function slugify(text) {
            return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        }

        function uniqueLogicId(base) {
            var stem = slugify(base || "logic") || "logic";
            var seen = {};
            ["switchRegistry", "stateTable", "computedState", "actionRules", "resetRules"].forEach(function each(key) {
                (doc[key] || []).forEach(function eachRow(row) {
                    if (row && row.id) seen[row.id] = true;
                });
            });
            var id = stem;
            var n = 2;
            while (seen[id]) {
                id = stem + "_" + String(n);
                n += 1;
            }
            return id;
        }

        function setBuildError(message) {
            buildDraft.error = String(message || "Unable to create logic.");
            render();
        }

        function createSwitchLampFlow() {
            if (!buildDraft.triggerSwitchId) return setBuildError("Choose a trigger.");
            if (!buildDraft.lampId) return setBuildError("Choose a lamp.");
            var name = String(buildDraft.featureName || "").trim() || "Visual Feature";
            var base = slugify(name) || "visual_feature";
            var stateId = uniqueLogicId(base + "_lit");
            var ruleId = uniqueLogicId("A_" + base + "_trigger");
            (doc.stateTable || []).push({ id: stateId, name: name + " Lit", type: "bool", initial: false, volatile: true });
            var effects = [{ type: "set", target: stateId, value: true }];
            if (Number(buildDraft.triggerScore || 0) > 0) effects.push({ type: "score", value: Number(buildDraft.triggerScore || 0) });
            (doc.actionRules || []).push({
                id: ruleId,
                name: "Light " + buildDraft.lampId,
                trigger: buildDraft.triggerSwitchId,
                condition: "!" + stateId,
                effects: effects,
                enabled: true
            });
            var binding = (doc.lampBindings || []).find(function find(row) { return row && row.lampId === buildDraft.lampId; });
            if (binding) binding.expr = stateId;
            else (doc.lampBindings || []).push({ lampId: buildDraft.lampId, expr: stateId });
            var triggerObjectId = sourceElementIdForSwitchId(buildDraft.triggerSwitchId);
            var lampObject = (table.elements || []).find(function find(el) { return el && el.lampId === buildDraft.lampId; });
            var featureObjects = [triggerObjectId, lampObject && lampObject.id].filter(Boolean);
            table.features = Array.isArray(table.features) ? table.features : [];
            table.features.push({
                id: uniqueLogicId(base + "_feature"),
                name: name,
                goal: "Hit trigger to light lamp.",
                description: "Generated from PinLogic visual builder.",
                objects: featureObjects,
                states: [stateId],
                rules: [ruleId],
                lamps: [buildDraft.lampId]
            });
            buildDraft.error = "";
            selected = { kind: "rule", id: ruleId };
            commit();
            render();
        }

        function createTargetBankCollectFlow() {
            if (!buildDraft.targetSwitchIds.length) return setBuildError("Choose one or more targets.");
            if (!buildDraft.collectSwitchId) return setBuildError("Choose a collect switch.");
            var name = String(buildDraft.featureName || "").trim() || "Target Bank";
            var base = slugify(name) || "target_bank";
            var stateIds = [];
            buildDraft.targetSwitchIds.forEach(function each(switchId, idx) {
                var stateId = uniqueLogicId(base + "_target_" + String(idx + 1) + "_lit");
                stateIds.push(stateId);
                (doc.stateTable || []).push({ id: stateId, name: labelForSwitchId(switchId) + " Lit", type: "bool", initial: false, volatile: true });
                var effects = [{ type: "set", target: stateId, value: true }];
                if (Number(buildDraft.targetHitScore || 0) > 0) effects.push({ type: "score", value: Number(buildDraft.targetHitScore || 0) });
                (doc.actionRules || []).push({
                    id: uniqueLogicId("A_" + base + "_hit_" + String(idx + 1)),
                    name: "Light " + labelForSwitchId(switchId),
                    trigger: switchId,
                    condition: "!" + stateId,
                    effects: effects,
                    enabled: true
                });
            });
            var readyId = uniqueLogicId(base + "_ready");
            (doc.computedState || []).push({ id: readyId, name: name + " Complete", type: "bool", expr: stateIds.join(" && ") });
            var collectEffects = [];
            if (Number(buildDraft.collectAward || 0) > 0) collectEffects.push({ type: "score", value: Number(buildDraft.collectAward || 0) });
            if (buildDraft.resetOnCollect !== false) {
                stateIds.forEach(function eachState(stateId) { collectEffects.push({ type: "set", target: stateId, value: false }); });
            }
            var collectRuleId = uniqueLogicId("A_" + base + "_collect");
            (doc.actionRules || []).push({
                id: collectRuleId,
                name: "Collect " + name,
                trigger: buildDraft.collectSwitchId,
                condition: readyId,
                effects: collectEffects,
                enabled: true
            });
            var featureObjectIds = [];
            var featureLampIds = [];
            buildDraft.targetSwitchIds.concat([buildDraft.collectSwitchId]).forEach(function each(swId) {
                var sourceId = sourceElementIdForSwitchId(swId);
                if (sourceId && featureObjectIds.indexOf(sourceId) < 0) featureObjectIds.push(sourceId);
                var lampId = lampIdForSwitchId(swId);
                if (lampId && featureLampIds.indexOf(lampId) < 0) featureLampIds.push(lampId);
            });
            table.features = Array.isArray(table.features) ? table.features : [];
            table.features.push({
                id: uniqueLogicId(base + "_feature"),
                name: name,
                goal: "Complete targets then collect.",
                description: "Generated from PinLogic visual builder.",
                objects: featureObjectIds,
                states: stateIds.concat([readyId]),
                rules: [collectRuleId],
                lamps: featureLampIds
            });
            buildDraft.error = "";
            selected = { kind: "rule", id: collectRuleId };
            commit();
            render();
        }

        function createDrainResetFlow() {
            if (!buildDraft.drainSwitchId) return setBuildError("Choose a drain switch.");
            if (!buildDraft.targetSwitchIds.length) return setBuildError("Choose target switches to reset.");
            var stateTargets = [];
            buildDraft.targetSwitchIds.forEach(function eachSwitch(switchId) {
                (doc.actionRules || []).forEach(function eachRule(rule) {
                    if (!rule || rule.trigger !== switchId) return;
                    (rule.effects || []).forEach(function eachEffect(effect) {
                        if (!effect || effect.type !== "set" || effect.value !== true) return;
                        if (!index.stateById[effect.target]) return;
                        if (stateTargets.indexOf(effect.target) < 0) stateTargets.push(effect.target);
                    });
                });
            });
            if (!stateTargets.length) return setBuildError("No target states found for selected targets.");
            var resetRuleId = uniqueLogicId("R_" + slugify(buildDraft.featureName || "drain_reset"));
            (doc.resetRules || []).push({
                id: resetRuleId,
                name: String(buildDraft.featureName || "Drain Reset"),
                trigger: buildDraft.drainSwitchId,
                scope: "volatile",
                resets: stateTargets
            });
            var resetObjects = [];
            var drainObjectId = sourceElementIdForSwitchId(buildDraft.drainSwitchId);
            if (drainObjectId) resetObjects.push(drainObjectId);
            buildDraft.targetSwitchIds.forEach(function each(swId) {
                var sourceId = sourceElementIdForSwitchId(swId);
                if (sourceId && resetObjects.indexOf(sourceId) < 0) resetObjects.push(sourceId);
            });
            table.features = Array.isArray(table.features) ? table.features : [];
            table.features.push({
                id: uniqueLogicId("feature_" + slugify(buildDraft.featureName || "drain_reset")),
                name: String(buildDraft.featureName || "Drain Reset"),
                goal: "Reset selected progression on drain.",
                description: "Generated from PinLogic visual builder.",
                objects: resetObjects,
                states: stateTargets.slice(0),
                rules: [resetRuleId],
                lamps: []
            });
            buildDraft.error = "";
            commit();
            render();
        }

        function parseEffectValue(value) {
            var raw = String(value == null ? "" : value).trim();
            if (!raw) return "";
            if (raw === "true") return true;
            if (raw === "false") return false;
            if (!isNaN(Number(raw))) return Number(raw);
            return raw;
        }

        function createGenericRule() {
            if (!buildDraft.genericRuleTrigger) return setBuildError("New rule needs a trigger.");
            var name = String(buildDraft.genericRuleName || "").trim() || "New Rule";
            var type = String(buildDraft.genericEffectType || "set");
            var effect = { type: type };
            if (type === "set" || type === "add" || type === "setElementProperty" || type === "clearElementProperty") {
                effect.target = String(buildDraft.genericEffectTarget || "");
                if (!effect.target) return setBuildError("Effect target required for " + type + ".");
            }
            if (type !== "clearElementProperty") effect.value = parseEffectValue(buildDraft.genericEffectValue);
            var ruleId = uniqueLogicId("A_" + slugify(name));
            (doc.actionRules || []).push({
                id: ruleId,
                name: name,
                trigger: buildDraft.genericRuleTrigger,
                condition: String(buildDraft.genericRuleCondition || ""),
                effects: [effect],
                enabled: buildDraft.genericRuleEnabled !== false
            });
            buildDraft.error = "";
            selected = { kind: "rule", id: ruleId };
            commit();
            render();
        }

        function make(tag, className, text) {
            var node = document.createElement(tag);
            if (className) node.className = className;
            if (text != null) node.textContent = text;
            return node;
        }

        function render() {
            rerun();
            container.innerHTML = "";
            var shell = make("div", "logic-vb-shell");
            shell.style.fontSize = zoom === "100%" ? "" : "calc(" + zoom + " * 0.01rem + 0.625rem)";
            container.appendChild(shell);

            renderToolbar(shell);

            var grid = make("div", "logic-vb-grid");
            var navCol = make("div", "logic-vb-col");
            var treeCol = make("div", "logic-vb-col");
            var canvasCol = make("div", "logic-vb-col");
            /* What: Mark the right-side column as a sticky rail host.
             * Why: Selecting deep canvas items should keep Inspector visible without scrolling back to top.
             */
            var rightCol = make("div", "logic-vb-col logic-vb-col-right");
            grid.appendChild(navCol);
            grid.appendChild(treeCol);
            grid.appendChild(canvasCol);
            grid.appendChild(rightCol);

            renderNavRail(navCol);
            renderFeatureTree(treeCol);
            renderCanvas(canvasCol);
            renderInspector(rightCol);
            renderPlayfieldPanel(rightCol);

            shell.appendChild(grid);
            renderBottom(shell);
        }

        render();
        return { refresh: render, select: selectEntity };
    }

    Pin.logicVisualBuilder = {
        mount: mount
    };
})(window.Pin);
