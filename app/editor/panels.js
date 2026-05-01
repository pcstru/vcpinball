(function initEditorPanels(Pin) {
    function isAngleField(labelText) {
        return /(^|\.)(restAngle|activeAngle|angle|maxAngle|swingStartAngle|swingEndAngle)$/i.test(labelText) ||
            /^(swing start angle|swing end angle|swing limit)$/i.test(labelText);
    }

    function isColorField(labelText) {
        return /(^|\.)(color|glowColor|pinColor)$/i.test(labelText);
    }

    function isSecretField(labelText) {
        return /(^|\.)(apiKey|token|secret|password)$/i.test(labelText);
    }

    function defaultStepForField(labelText, value) {
        if (typeof value !== "number") return "any";
        if (isAngleField(labelText)) return "1";
        if (/(\.|^)(gravity|friction|restitution|opacity|scale|surfaceRestitution|surfaceFriction|tipRestitution|tipFriction|strikeBoost|tipStrikeBoost)$/i.test(labelText)) return "0.01";
        if (/(\.|^)(flipSpeed|flipAccel|returnSpeed|returnAccel|maxPower|maxRetract|pullSpeed|springStrength|windowSeconds|awardPoints|balls|width|height|radius|length|thickness|bandThickness|x|y|offsetX|offsetY|top|bottom)$/i.test(labelText)) return "1";
        return "0.1";
    }

    function appendField(container, labelText, value, onChange, options) {
        const row = document.createElement("label");
        row.className = "field-row";
        const label = document.createElement("span");
        label.className = "field-label";
        label.textContent = labelText;
        let input;
        if (options && options.length) {
            input = document.createElement("select");
            options.forEach(function each(opt) {
                const option = document.createElement("option");
                option.value = opt.value;
                option.textContent = opt.label || opt.value || "(none)";
                input.appendChild(option);
            });
            input.value = value == null ? "" : String(value);
            input.onchange = function patchSelect() { onChange(input.value); };
        } else if (typeof value === "boolean") {
            input = document.createElement("input");
            input.type = "checkbox";
            input.checked = value;
            input.onchange = function patchBool() { onChange(input.checked); };
            row.classList.add("checkbox-row");
        } else if (typeof value === "number") {
            const numberInput = document.createElement("input");
            numberInput.type = "number";
            numberInput.step = defaultStepForField(labelText, value);
            numberInput.value = isAngleField(labelText) ? String((value * 180) / Math.PI) : String(value);
            numberInput.onchange = function patchNum() { onChange(Number(numberInput.value)); };
            if (isAngleField(labelText)) {
                const suffix = document.createElement("span");
                suffix.className = "field-suffix";
                suffix.textContent = "deg";
                const inputWrap = document.createElement("div");
                inputWrap.className = "field-input-wrap";
                numberInput.onchange = function patchAngle() { onChange(Number(numberInput.value) * Math.PI / 180); };
                inputWrap.appendChild(numberInput);
                inputWrap.appendChild(suffix);
                input = inputWrap;
            } else {
                input = numberInput;
            }
        } else if (isColorField(labelText) || (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value))) {
            const wrap = document.createElement("div");
            wrap.className = "field-color-wrap";
            const colorInput = document.createElement("input");
            const normalizedColor = typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff";
            colorInput.type = "color";
            colorInput.value = normalizedColor;
            const textInput = document.createElement("input");
            textInput.type = "text";
            textInput.value = value == null ? "" : String(value);
            colorInput.oninput = function patchColorPicker() {
                textInput.value = colorInput.value;
                onChange(colorInput.value);
            };
            textInput.onchange = function patchColorText() {
                if (/^#[0-9a-f]{6}$/i.test(textInput.value)) colorInput.value = textInput.value;
                onChange(textInput.value);
            };
            wrap.appendChild(colorInput);
            wrap.appendChild(textInput);
            input = wrap;
        } else {
            input = document.createElement("input");
            input.type = isSecretField(labelText) ? "password" : "text";
            if (isSecretField(labelText)) input.autocomplete = "off";
            input.value = value == null ? "" : String(value);
            input.oninput = function patchTextInput() { onChange(input.value); };
            input.onchange = function patchText() { onChange(input.value); };
        }
        row.appendChild(label);
        row.appendChild(input);
        container.appendChild(row);
    }

    function optionList(values, includeBlank) {
        const out = includeBlank ? [{ value: "", label: "(none)" }] : [];
        values.forEach(function each(value) {
            if (!value) return;
            const entry = typeof value === "object" ? value : { value: value, label: value };
            const normalizedValue = entry.value == null ? "" : String(entry.value);
            if (!normalizedValue) return;
            if (out.some(function has(opt) { return String(opt.value) === normalizedValue; })) return;
            out.push({
                value: normalizedValue,
                label: entry.label != null ? entry.label : normalizedValue
            });
        });
        return out;
    }

    function elementDisplayName(element) {
        if (!element) return "";
        const custom = element.name || element.label || "";
        if (custom) return custom + " (" + element.id + ")";
        return labelForType(element.type) + " " + element.id;
    }

    function elementLabelOnly(element) {
        if (!element) return "";
        return element.name || element.label || labelForType(element.type) + " " + element.id;
    }

    function findElementById(table, id) {
        return ((table && table.elements) || []).find(function find(el) { return el && el.id === id; }) || null;
    }

    function findElementByLampId(table, lampId) {
        return ((table && table.elements) || []).find(function find(el) {
            return el && (el.type === "light" || el.type === "arrowLight" || el.type === "boxLight") && ((el.lampId || el.id) === lampId);
        }) || null;
    }

    function displaySwitchRef(table, switchId) {
        if (!switchId) return "Unassigned switch";
        const element = findElementById(table, switchId);
        return element ? elementDisplayName(element) : switchId;
    }

    function displayLampRef(table, lampId) {
        if (!lampId) return "No lamp";
        const element = findElementByLampId(table, lampId) || findElementById(table, lampId);
        return element ? elementDisplayName(element) : lampId;
    }

    function relationText(relation) {
        if (!relation) return "";
        return relation.ruleName + " - " + relation.role;
    }

    function appendChoiceList(container, titleText, currentText, choices, activeValue, onChoose) {
        const section = document.createElement("div");
        section.className = "anchor-card";
        const title = document.createElement("div");
        title.className = "field-label";
        title.textContent = titleText;
        section.appendChild(title);
        const current = document.createElement("p");
        current.className = "small";
        current.textContent = currentText;
        section.appendChild(current);
        if (!choices.length) {
            appendSmallText(section, "No matching objects available");
        } else {
            const list = document.createElement("div");
            list.className = "choice-list";
            choices.forEach(function each(choice) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "choice-pill" + ((activeValue || "") === (choice.value || "") ? " active" : "");
                button.textContent = choice.label;
                button.onclick = function choose() { onChoose(choice.value); };
                list.appendChild(button);
            });
            section.appendChild(list);
        }
        container.appendChild(section);
    }

    function appendCardTitle(container, titleText, subtitleText) {
        const head = document.createElement("div");
        head.className = "card-head";
        const title = document.createElement("h4");
        title.textContent = titleText;
        head.appendChild(title);
        if (subtitleText) {
            const subtitle = document.createElement("p");
            subtitle.className = "small";
            subtitle.textContent = subtitleText;
            head.appendChild(subtitle);
        }
        container.appendChild(head);
    }

    function propertyTabForField(path) {
        if (path === "name" || path === "level" || path === "side" || path === "control" || path === "role" || path === "direction" || path === "valve" || path === "capacity" || path === "closed") {
            return "meta";
        }
        if (/(^|\.)(color|glowColor|pinColor|label|lampId|bandThickness)$/.test(path)) {
            return "visual";
        }
        if (/(^|\.)(surfaceRestitution|surfaceFriction|tipRestitution|tipFriction|strikeBoost|tipStrikeBoost|thickness)$/.test(path)) {
            return "contact";
        }
        if (/(^|\.)(flipSpeed|flipAccel|returnSpeed|returnAccel|maxPower|maxRetract|pullSpeed|springStrength|returnStrength|returnDamping|power|kickPower|score|damping|windowSeconds|awardPoints|restitution|holdSeconds|reactivateDelay|ejectPower)$/.test(path)) {
            return "physics";
        }
        return "layout";
    }

    function propertyTabLabel(tabId) {
        const labels = {
            layout: "Layout",
            physics: "Physics",
            contact: "Contact",
            visual: "Visual",
            meta: "Meta"
        };
        return labels[tabId] || tabId;
    }

    /*
     * What: Defines higher-quality inspector field ordering for selected mechanism types.
     * Why: Generic field dumps make flippers and launchers hard to tune because related values
     *      are scattered and noisy. This keeps the existing draft/save path but presents the
     *      important controls in a tighter, mechanism-specific order.
     * Correctness: The config only changes field presentation. It still reads and writes the same
     *              underlying element paths through the existing draft machinery.
     */
    function customInspectorFieldConfig(type) {
        const configs = {
            flipper: [
                { path: "pivot.x", label: "pivot x", groupKey: "Setup" },
                { path: "pivot.y", label: "pivot y", groupKey: "Setup" },
                { path: "length", label: "length", groupKey: "Blade" },
                { path: "thickness", label: "thickness", groupKey: "Blade" },
                { path: "restAngle", label: "rest angle", groupKey: "Blade" },
                { path: "activeAngle", label: "active angle", groupKey: "Blade" },
                { path: "flipSpeed", label: "flip speed", groupKey: "Stroke" },
                { path: "flipAccel", label: "flip accel", groupKey: "Stroke" },
                { path: "returnSpeed", label: "return speed", groupKey: "Stroke" },
                { path: "returnAccel", label: "return accel", groupKey: "Stroke" },
                { path: "strikeBoost", label: "strike boost", groupKey: "Contact" },
                { path: "tipStrikeBoost", label: "tip strike boost", groupKey: "Tip" },
                { path: "surfaceRestitution", label: "surface restitution", groupKey: "Contact" },
                { path: "surfaceFriction", label: "surface friction", groupKey: "Contact" },
                { path: "tipRestitution", label: "tip restitution", groupKey: "Tip" },
                { path: "tipFriction", label: "tip friction", groupKey: "Tip" },
                { path: "color", label: "body color", groupKey: "Appearance" },
                { path: "glowColor", label: "glow color", groupKey: "Appearance" },
                { path: "side", label: "side", groupKey: "Setup" },
                { path: "control", label: "control", groupKey: "Setup" }
            ],
            launcher: [
                { path: "x", label: "x", groupKey: "Lane" },
                { path: "y", label: "y", groupKey: "Lane" },
                { path: "top", label: "top", groupKey: "Lane" },
                { path: "bottom", label: "bottom", groupKey: "Lane" },
                { path: "width", label: "width", groupKey: "Lane" },
                { path: "maxPower", label: "max power", groupKey: "Spring" },
                { path: "maxRetract", label: "max retract", groupKey: "Spring" },
                { path: "pullSpeed", label: "pull speed", groupKey: "Spring" },
                { path: "returnSpeed", label: "return speed", groupKey: "Spring" },
                { path: "valve", label: "valve", groupKey: "Setup" }
            ],
            path: [
                { path: "role", label: "role", groupKey: "Shape" },
                { path: "closed", label: "closed", groupKey: "Shape" },
                { path: "thickness", label: "thickness", groupKey: "Shape" },
                { path: "restitution", label: "restitution", groupKey: "Physics" },
                { path: "color", label: "color", groupKey: "Appearance" }
            ],
            bumper: [
                { path: "radius", label: "radius", groupKey: "Shape" },
                { path: "power", label: "power", groupKey: "Physics" },
                { path: "restitution", label: "restitution", groupKey: "Physics" },
                { path: "score", label: "score", groupKey: "Physics" },
                { path: "color", label: "color", groupKey: "Appearance" }
            ],
            kicker: [
                { path: "radius", label: "radius", groupKey: "Shape" },
                { path: "closed", label: "closed", groupKey: "Shape" },
                { path: "kickPower", label: "kick power", groupKey: "Physics" },
                { path: "restitution", label: "restitution", groupKey: "Physics" },
                { path: "score", label: "score", groupKey: "Physics" },
                { path: "bandThickness", label: "band thickness", groupKey: "Appearance" },
                { path: "color", label: "color", groupKey: "Appearance" }
            ],
            scoreZone: [
                { path: "radius", label: "radius", groupKey: "Shape" },
                { path: "restitution", label: "restitution", groupKey: "Physics" },
                { path: "score", label: "score", groupKey: "Physics" },
                { path: "color", label: "color", groupKey: "Appearance" }
            ],
            light: [
                { path: "radius", label: "radius", groupKey: "Shape" },
                { path: "lampId", label: "lamp id", groupKey: "Logic" },
                { path: "text", label: "text", groupKey: "Text" },
                { path: "label", label: "legacy label", groupKey: "Text" },
                { path: "color", label: "color", groupKey: "Appearance" }
            ],
            arrowLight: [
                { path: "w", label: "width", groupKey: "Shape" },
                { path: "h", label: "height", groupKey: "Shape" },
                { path: "angle", label: "angle", groupKey: "Shape" },
                { path: "lampId", label: "lamp id", groupKey: "Logic" },
                { path: "text", label: "text", groupKey: "Text" },
                { path: "label", label: "legacy label", groupKey: "Text" },
                { path: "color", label: "color", groupKey: "Appearance" }
            ],
            boxLight: [
                { path: "w", label: "width", groupKey: "Shape" },
                { path: "h", label: "height", groupKey: "Shape" },
                { path: "angle", label: "angle", groupKey: "Shape" },
                { path: "cornerRadius", label: "corner radius", groupKey: "Shape" },
                { path: "lampId", label: "lamp id", groupKey: "Logic" },
                { path: "text", label: "text", groupKey: "Text" },
                { path: "label", label: "legacy label", groupKey: "Text" },
                { path: "color", label: "color", groupKey: "Appearance" }
            ],
            dropTarget: [
                { path: "w", label: "width", groupKey: "Shape" },
                { path: "h", label: "height", groupKey: "Shape" },
                { path: "angle", label: "angle", groupKey: "Shape" },
                { path: "restitution", label: "restitution", groupKey: "Physics" },
                { path: "score", label: "score", groupKey: "Physics" },
                { path: "color", label: "color", groupKey: "Appearance" }
            ],
            gate: [
                { path: "x", label: "x", groupKey: "Shape" },
                { path: "y", label: "y", groupKey: "Shape" },
                { path: "length", label: "length", groupKey: "Shape" },
                { path: "angle", label: "angle", groupKey: "Shape" },
                { path: "locked", label: "locked", groupKey: "Setup" },
                { path: "direction", label: "direction", groupKey: "Setup", options: [{ value: "forward", label: "Forward" }, { value: "reverse", label: "Reverse" }] },
                { path: "twoWay", label: "two way", groupKey: "Setup" },
                { path: "swingStartAngle", label: "swing start angle", groupKey: "Hinge" },
                { path: "swingEndAngle", label: "swing end angle", groupKey: "Hinge" },
                { path: "returnStrength", label: "return spring", groupKey: "Hinge" },
                { path: "returnDamping", label: "return damping", groupKey: "Hinge" },
                { path: "thickness", label: "thickness", groupKey: "Shape" },
                { path: "restitution", label: "restitution", groupKey: "Contact" },
                { path: "color", label: "color", groupKey: "Appearance" },
                { path: "pinColor", label: "pin color", groupKey: "Appearance" }
            ],
            trough: [
                { path: "x", label: "x", groupKey: "Shape" },
                { path: "y", label: "y", groupKey: "Shape" },
                { path: "radius", label: "radius", groupKey: "Shape" },
                { path: "holdSeconds", label: "hold seconds", groupKey: "Timing" },
                { path: "reactivateDelay", label: "reactivate delay", groupKey: "Timing" },
                { path: "ejectPower", label: "eject power", groupKey: "Eject" },
                { path: "ejectAngle", label: "eject angle", groupKey: "Eject" },
                { path: "color", label: "rim color", groupKey: "Appearance" },
                { path: "pitColor", label: "pit color", groupKey: "Appearance" }
            ]
        };
        return configs[type] || null;
    }

    function hiddenLegacyInspectorFields(type) {
        const hidden = {
            gate: {
                maxAngle: true
            },
            flipper: {
                impulse: true,
                trapDamping: true,
                tangentialDamping: true,
                pivotRollPreserve: true,
                outwardSlipPreserve: true,
                passiveSettleBias: true,
                drivenSettleBias: true
            }
        };
        return hidden[type] || null;
    }

    function pickPaths(source, paths) {
        const draft = {};
        (paths || []).forEach(function each(path) {
            Pin.editorTools.setByPath(draft, path, Pin.editorTools.getByPath(source, path));
        });
        return draft;
    }

    function getDraftState(model, key, source) {
        if (!model.getCardDraft) return { value: Pin.editorTools.clone(source || {}), dirty: false };
        return model.getCardDraft(key, source || {});
    }

    function patchDraftValue(model, key, path, value) {
        if (model.onPatchCardDraft) model.onPatchCardDraft(key, path, value);
    }

    function appendDraftActions(container, draftKey, dirty, onSave, onReset) {
        if (draftKey) container.dataset.draftKey = draftKey;
        const row = document.createElement("div");
        row.className = "action-row draft-actions";
        const save = document.createElement("button");
        save.type = "button";
        save.className = "draft-save";
        save.textContent = "Save";
        save.disabled = !dirty;
        save.onclick = onSave;
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "draft-reset";
        reset.textContent = "Reset";
        reset.disabled = !dirty;
        reset.onclick = onReset;
        row.appendChild(save);
        row.appendChild(reset);
        container.appendChild(row);
    }

    function collectElementRelations(table, element) {
        const relations = [];
        if (!table || !element) return relations;
        (((table.rulesEngine || {}).logicGraphs) || []).forEach(function each(graph) {
            const ruleName = graph.name || graph.sourceRuleId || graph.id || "Logic";
            (graph.nodes || []).forEach(function eachNode(node) {
                if (!node) return;
                if ((node.type === "switchStep" || node.type === "timedTarget") && node.switchId === element.id) {
                    relations.push({ ruleName: ruleName, role: node.type === "switchStep" ? "trigger step" : "target trigger" });
                }
                if (node.type === "event" && node.sourceId === element.id) {
                    relations.push({ ruleName: ruleName, role: "event source" });
                }
                if (node.type === "action" && node.targetId === element.id) {
                    relations.push({ ruleName: ruleName, role: "action target" });
                }
                if ((element.type === "light" || element.type === "arrowLight" || element.type === "boxLight") && (node.lampId === (element.lampId || element.id))) {
                    if (node.type === "lamp") relations.push({ ruleName: ruleName, role: "state lamp" });
                    if (node.type === "switchStep") relations.push({ ruleName: ruleName, role: "step lamp" });
                    if (node.type === "timedTarget") relations.push({ ruleName: ruleName, role: "target lamp" });
                }
            });
        });
        (((table.rulesEngine || {}).switchMap) || []).forEach(function each(map) {
            if (!map) return;
            if (map.sourceId === element.id) relations.push({ ruleName: "Switch Map", role: "emits " + (map.switchId || "switch") });
            if (map.switchId === element.id) relations.push({ ruleName: "Switch Map", role: "switch id target" });
        });
        return relations;
    }

    function appendSection(container, title) {
        const section = document.createElement("section");
        section.className = "sidebar-section";
        const heading = document.createElement("h3");
        heading.textContent = title;
        section.appendChild(heading);
        container.appendChild(section);
        return section;
    }

    function appendSmallText(container, text) {
        const p = document.createElement("p");
        p.className = "small";
        p.textContent = text;
        container.appendChild(p);
    }

    function appendActionRow(container, defs) {
        const row = document.createElement("div");
        row.className = "action-row";
        defs.forEach(function each(def) {
            const button = document.createElement("button");
            button.textContent = def.label;
            if (def.className) button.className = def.className;
            if (def.disabled) button.disabled = true;
            button.onclick = def.onClick;
            row.appendChild(button);
        });
        container.appendChild(row);
    }

    function appendAssistantLogDialog(container, assistantState, model) {
        const overlay = document.createElement("div");
        overlay.className = "assistant-log-overlay";
        overlay.onclick = function dismiss(event) {
            if (event.target === overlay && model.onCloseAssistantLog) model.onCloseAssistantLog();
        };
        const dialog = document.createElement("div");
        dialog.className = "assistant-log-dialog";
        const header = document.createElement("div");
        header.className = "assistant-log-header";
        const title = document.createElement("strong");
        title.textContent = "Assistant Log";
        const count = document.createElement("span");
        count.className = "small";
        count.textContent = String((assistantState.logs || []).length) + " entries";
        header.appendChild(title);
        header.appendChild(count);
        dialog.appendChild(header);
        appendActionRow(dialog, [
            { label: "Clear Log", onClick: model.onClearAssistantLog, disabled: !(assistantState.logs || []).length },
            { label: "Close", onClick: model.onCloseAssistantLog }
        ]);
        const body = document.createElement("div");
        body.className = "assistant-log-body";
        if (!(assistantState.logs || []).length) {
            appendSmallText(body, "No assistant log entries yet.");
        } else {
            (assistantState.logs || []).forEach(function each(entry) {
                const card = document.createElement("div");
                card.className = "assistant-log-entry";
                const meta = document.createElement("div");
                meta.className = "assistant-log-meta";
                meta.textContent = entry.at + " - " + entry.stage;
                const detail = document.createElement("pre");
                detail.className = "assistant-log-detail";
                detail.textContent = entry.detail || "";
                card.appendChild(meta);
                card.appendChild(detail);
                body.appendChild(card);
            });
        }
        dialog.appendChild(body);
        overlay.appendChild(dialog);
        container.appendChild(overlay);
    }

    function labelForType(type) {
        const labels = {
            leftFlipper: "Left Flipper",
            rightFlipper: "Right Flipper",
            dropTarget: "Drop Target",
            scoreZone: "Score Zone"
        };
        return labels[type] || type.replace(/([A-Z])/g, " $1").replace(/^./, function cap(ch) { return ch.toUpperCase(); });
    }

    function paletteSvgForType(type) {
        const art = {
            leftFlipper: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="12" cy="31" r="4.5" fill="#f3f7ff"/><path d="M12 31 L36 21" stroke="#00ddff" stroke-width="8" stroke-linecap="round"/><path d="M12 31 L36 21" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round"/></svg>',
            rightFlipper: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="36" cy="31" r="4.5" fill="#f3f7ff"/><path d="M36 31 L12 21" stroke="#ff4466" stroke-width="8" stroke-linecap="round"/><path d="M36 31 L12 21" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round"/></svg>',
            launcher: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="21" y="6" width="6" height="26" rx="2" fill="#7ea1ff"/><rect x="18" y="33" width="12" height="7" rx="3.5" fill="#ee4444"/><rect x="17" y="5" width="14" height="37" rx="4" fill="none" stroke="rgba(214,228,255,0.45)" stroke-width="1.5"/></svg>',
            spinner: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="3" fill="#f3f7ff"/><path d="M10 24 H38" stroke="#ffdd00" stroke-width="5" stroke-linecap="round"/><path d="M24 10 V38" stroke="rgba(255,255,255,0.55)" stroke-width="2" stroke-linecap="round"/></svg>',
            gate: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="14" cy="24" r="3" fill="#f3f7ff"/><path d="M14 24 L35 17" stroke="#99ffcc" stroke-width="4" stroke-linecap="round"/></svg>',
            valve: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="16" cy="24" r="3.5" fill="#f3f7ff"/><path d="M16 24 L34 18" stroke="#a8e4ff" stroke-width="4" stroke-linecap="round"/><path d="M34 18 L30 28" stroke="#a8e4ff" stroke-width="3" stroke-linecap="round"/></svg>',
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

    function makeElementIcon(type) {
        const icon = document.createElement("span");
        icon.className = "element-icon icon-" + type;
        icon.setAttribute("aria-hidden", "true");
        icon.innerHTML = paletteSvgForType(type);
        return icon;
    }

    function paletteSvgForTool(name) {
        const art = {
            select: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 8 L30 24 L22 26 L27 39 L22 41 L17 28 L10 33 Z" fill="#dfe9ff" stroke="rgba(223,233,255,0.25)" stroke-width="1.5" stroke-linejoin="round"/></svg>',
            pen: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M13 32 L30 15 L34 19 L17 36 L11 37 Z" fill="#9fc0ff"/><path d="M28 13 L32 9 L39 16 L35 20 Z" fill="#ffcc66"/><path d="M11 37 L17 36 L13 32 Z" fill="#ffd7a3"/></svg>'
        };
        return art[name] || '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="12" fill="#dfe9ff"/></svg>';
    }

    function appendPaletteIcon(button, type, label) {
        button.appendChild(makeElementIcon(type));
        button.title = label || labelForType(type);
        button.setAttribute("aria-label", label || labelForType(type));
    }

    function appendToolIcon(button, name, label) {
        const icon = document.createElement("span");
        icon.className = "element-icon tool-icon tool-" + name;
        icon.setAttribute("aria-hidden", "true");
        icon.innerHTML = paletteSvgForTool(name);
        button.appendChild(icon);
        button.title = label || name;
        button.setAttribute("aria-label", label || name);
    }

    function renderTabBar(container, activeTab, onSetTab, onPlay) {
        const tabs = document.createElement("div");
        tabs.className = "sidebar-tabs";
        [
            { id: "properties", label: "Properties" },
            { id: "layers", label: "Levels" },
            { id: "logic", label: "Logic" },
            { id: "assistant", label: "Assistant" },
            { id: "table", label: "Table" }
        ].forEach(function each(tab) {
            const button = document.createElement("button");
            button.textContent = tab.label;
            button.className = activeTab === tab.id ? "active" : "";
            button.onclick = function chooseTab() { onSetTab(tab.id); };
            tabs.appendChild(button);
        });
        if (onPlay) {
            const playButton = document.createElement("button");
            playButton.textContent = "Play";
            playButton.onclick = onPlay;
            tabs.appendChild(playButton);
        }
        container.appendChild(tabs);
    }

    function renderPalette(container, activeTool, onSetTool, onCreate, actions) {
        container.innerHTML = "";
        const toolSection = appendSection(container, "Tools");
        const toolGrid = document.createElement("div");
        toolGrid.className = "palette-icon-grid tool-icon-grid";
        ["select", "pen"].forEach(function each(name) {
            const b = document.createElement("button");
            b.className = "tool-button palette-icon-button" + (activeTool === name ? " active" : "");
            appendToolIcon(b, name, labelForType(name));
            b.onclick = function choose() { onSetTool(name); };
            toolGrid.appendChild(b);
        });
        toolSection.appendChild(toolGrid);
        if (actions && actions.tools && actions.tools.length) {
            appendActionRow(toolSection, actions.tools);
        }
        if (actions && actions.grid) {
            const gridSection = appendSection(container, "Grid");
            appendSmallText(gridSection, "Snap " + (actions.grid.enabled ? "on" : "off") + " / " + actions.grid.size + "px");
            appendActionRow(gridSection, [
                { label: actions.grid.enabled ? "Snap Off" : "Snap On", onClick: actions.grid.onToggle },
                { label: "5", onClick: function set5() { actions.grid.onSetSize(5); } },
                { label: "10", onClick: function set10() { actions.grid.onSetSize(10); } },
                { label: "20", onClick: function set20() { actions.grid.onSetSize(20); } },
                { label: "25", onClick: function set25() { actions.grid.onSetSize(25); } }
            ]);
        }

        const groups = [
            { title: "Mechanisms", items: ["leftFlipper", "rightFlipper", "launcher", "spinner", "gate", "kicker", "trough"] },
            { title: "Targets", items: ["bumper", "dropTarget", "lane", "scoreZone"] },
            { title: "Presentation", items: ["light", "arrowLight", "boxLight"] },
            { title: "Structure", items: ["path", "ramp", "drain"] }
        ];
        groups.forEach(function eachGroup(group) {
            const createSection = appendSection(container, group.title);
            createSection.classList.add("palette-group");
            const grid = document.createElement("div");
            grid.className = "palette-icon-grid";
            group.items.forEach(function each(name) {
                const b = document.createElement("button");
                b.className = "element-button palette-icon-button";
                appendPaletteIcon(b, name);
                b.onclick = function choose() { onCreate(name); };
                grid.appendChild(b);
            });
            createSection.appendChild(grid);
        });
        if (actions && actions.table && actions.table.length) {
            const tableSection = appendSection(container, "Table");
            appendActionRow(tableSection, actions.table);
        }
    }

    function renderInspector(container, model) {
        container.innerHTML = "";
        const activeTab = model.activeTab || "properties";
        renderTabBar(container, activeTab, model.onSetTab || function noop() {}, model.onTestPlay);

        function renderTableTab() {
        const tableSection = appendSection(container, "Table");
        const tablePaths = [
            "name",
            "playfield.width",
            "playfield.height",
            "playfield.ballRadius",
            "playfield.gravity",
            "playfield.friction",
            "playfield.restitution",
            "playfield.maxSpeed",
            "rules.balls"
        ];
        const tableDraftKey = "table:main";
        const tableDraftState = getDraftState(model, tableDraftKey, pickPaths(model.table, tablePaths));
        tablePaths.forEach(function each(path) {
            appendField(tableSection, path, Pin.editorTools.getByPath(tableDraftState.value, path), function changeField(value) {
                patchDraftValue(model, tableDraftKey, path, value);
            });
        });
        appendDraftActions(tableSection, tableDraftKey, tableDraftState.dirty, function saveTable() {
            if (model.onSaveTableDraft) model.onSaveTableDraft(tableDraftKey, tableDraftState.value);
        }, function resetTable() {
            if (model.onResetCardDraft) model.onResetCardDraft(tableDraftKey);
        });
        appendSmallText(tableSection, "Launcher tuning lives on the launcher element in Properties.");
        appendActionRow(tableSection, [
            { label: "Fit Table", onClick: model.onFrameTable },
            { label: "Save File", onClick: model.onSaveFile },
            { label: "Open File", onClick: model.onOpenFile },
            { label: "Load Autosave", onClick: model.onLoadAutosave },
            { label: "Load Slot1", onClick: model.onLoadSlot1 },
            { label: "Save Slot1", onClick: model.onSaveSlot1 }
        ]);

        const imagesSection = appendSection(container, "Images");
        appendSmallText(imagesSection, "Use images as playfield art or as a design overlay.");
        appendActionRow(imagesSection, [
            { label: "Add Image Layer", onClick: model.onAddImageLayer }
        ]);
        const imageLayers = (model.table && model.table.images) || [];
        if (!imageLayers.length) {
            appendSmallText(imagesSection, "No image layers yet");
        } else {
            imageLayers.forEach(function each(image, index) {
                const card = document.createElement("div");
                card.className = "anchor-card";
                const imageDraftKey = "image:" + index;
                const imageDraftState = getDraftState(model, imageDraftKey, {
                    src: image.src || "",
                    mode: image.mode || "design",
                    fit: image.fit || "contain",
                    opacity: typeof image.opacity === "number" ? image.opacity : 0.35,
                    scale: typeof image.scale === "number" ? image.scale : 1,
                    offsetX: image.offsetX || 0,
                    offsetY: image.offsetY || 0
                });
                const head = document.createElement("div");
                head.className = "list-row";
                const title = document.createElement("span");
                title.textContent = image.id || ("image_" + (index + 1));
                head.appendChild(title);
                const actions = document.createElement("div");
                actions.className = "mini-actions";
                [
                    { label: "\u2191", onClick: function up() { if (model.onMoveImageLayer) model.onMoveImageLayer(index, -1); } },
                    { label: "\u2193", onClick: function down() { if (model.onMoveImageLayer) model.onMoveImageLayer(index, 1); } },
                    { label: "\u2715", onClick: function remove() { if (model.onRemoveImageLayer) model.onRemoveImageLayer(index); }, className: "danger" }
                ].forEach(function eachAction(action) {
                    const button = document.createElement("button");
                    button.textContent = action.label;
                    if (action.className) button.className = action.className;
                    button.onclick = action.onClick;
                    actions.appendChild(button);
                });
                head.appendChild(actions);
                card.appendChild(head);

                appendField(card, "src", imageDraftState.value.src, function patch(value) { patchDraftValue(model, imageDraftKey, "src", value); });
                appendField(card, "mode", imageDraftState.value.mode, function patch(value) { patchDraftValue(model, imageDraftKey, "mode", value); }, optionList([{ value: "both", label: "Both" }, { value: "play", label: "Play" }, { value: "design", label: "Design" }], false));
                appendField(card, "fit", imageDraftState.value.fit, function patch(value) { patchDraftValue(model, imageDraftKey, "fit", value); }, optionList([{ value: "contain", label: "Contain" }, { value: "cover", label: "Cover" }, { value: "stretch", label: "Stretch" }, { value: "none", label: "None" }], false));
                appendField(card, "opacity", imageDraftState.value.opacity, function patch(value) { patchDraftValue(model, imageDraftKey, "opacity", value); });
                appendField(card, "scale", imageDraftState.value.scale, function patch(value) { patchDraftValue(model, imageDraftKey, "scale", value); });
                appendField(card, "offsetX", imageDraftState.value.offsetX, function patch(value) { patchDraftValue(model, imageDraftKey, "offsetX", value); });
                appendField(card, "offsetY", imageDraftState.value.offsetY, function patch(value) { patchDraftValue(model, imageDraftKey, "offsetY", value); });
                appendDraftActions(card, imageDraftKey, imageDraftState.dirty, function saveImage() {
                    if (model.onSaveImageLayerDraft) model.onSaveImageLayerDraft(imageDraftKey, index, imageDraftState.value);
                }, function resetImage() {
                    if (model.onResetCardDraft) model.onResetCardDraft(imageDraftKey);
                });
                imagesSection.appendChild(card);
            });
        }

        const validationSection = appendSection(container, "Table Validation");
        const issues = Pin.table && Pin.table.validatePlayability ? Pin.table.validatePlayability(model.table) : [];
        if (!issues.length) {
            appendSmallText(validationSection, "No table issues found");
        } else {
            issues.forEach(function each(issue) {
                const row = document.createElement("div");
                row.className = "validation-row " + (issue.severity || "warning");
                row.textContent = (issue.severity || "warning") + ": " + issue.message;
                validationSection.appendChild(row);
            });
        }
        }

        function renderAssistantTab() {
        const assistantSection = appendSection(container, "Assistant");
        appendSmallText(assistantSection, "Tool-based assistant for rule and logic authoring. It can inspect the table and propose structured patches, but changes are only applied when you explicitly accept them.");
        const assistantState = model.assistant || { settings: {}, messages: [], draft: "", busy: false, error: "", lastPatch: null };
        const assistantSubtabs = document.createElement("div");
        assistantSubtabs.className = "assistant-subtabs";
        [
            { id: "chat", label: "Chat" },
            { id: "provider", label: "Provider" }
        ].forEach(function each(tab) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = tab.label;
            button.className = (model.assistantSubtab || "chat") === tab.id ? "active" : "";
            button.onclick = function chooseAssistantSubtab() {
                if (model.onSetAssistantSubtab) model.onSetAssistantSubtab(tab.id);
            };
            assistantSubtabs.appendChild(button);
        });
        assistantSection.appendChild(assistantSubtabs);

        if ((model.assistantSubtab || "chat") === "provider") {
        const settingsSection = appendSection(container, "Provider");
        const settingsKey = "assistant:settings";
        const settingsDraftState = getDraftState(model, settingsKey, assistantState.settings || {});
        appendSmallText(settingsSection, "Status: " + (assistantState.connectionStatus || "Not tested"));
        appendField(settingsSection, "providerLabel", settingsDraftState.value.providerLabel || "", function patch(value) { patchDraftValue(model, settingsKey, "providerLabel", value); });
        appendField(settingsSection, "baseUrl", settingsDraftState.value.baseUrl || "", function patch(value) { patchDraftValue(model, settingsKey, "baseUrl", value); });
        appendField(settingsSection, "model", settingsDraftState.value.model || "", function patch(value) { patchDraftValue(model, settingsKey, "model", value); }, optionList((assistantState.availableModels || []).map(function map(item) {
            return { value: item.id, label: item.label || item.id };
        }), true));
        appendField(settingsSection, "apiKey", settingsDraftState.value.apiKey || "", function patch(value) { patchDraftValue(model, settingsKey, "apiKey", value); });
        appendField(settingsSection, "maxSteps", typeof settingsDraftState.value.maxSteps === "number" ? settingsDraftState.value.maxSteps : 4, function patch(value) { patchDraftValue(model, settingsKey, "maxSteps", value); });
        appendDraftActions(settingsSection, settingsKey, settingsDraftState.dirty, function saveSettings() {
            if (model.onSaveAssistantSettingsDraft) model.onSaveAssistantSettingsDraft(settingsKey, settingsDraftState.value);
        }, function resetSettings() {
            if (model.onResetCardDraft) model.onResetCardDraft(settingsKey);
        });
        appendActionRow(settingsSection, [
            { label: "Test Connection", onClick: model.onTestAssistantConnection, disabled: !!assistantState.busy },
            { label: "Load Models", onClick: model.onLoadAssistantModels, disabled: !!assistantState.busy }
        ]);
        return;
        }

        const conversationSection = appendSection(container, "Conversation");
        const status = document.createElement("div");
        status.className = "assistant-status";
        status.textContent =
            "Selection: " + (model.selected ? elementDisplayName(model.selected) : "none") +
            " | Objects: " + ((model.elements || []).length) +
            " | Rules: " + ((((model.table || {}).rulesEngine || {}).sequenceRules || []).length);
        conversationSection.appendChild(status);
        const transcript = document.createElement("div");
        transcript.className = "assistant-transcript";
        if (!(assistantState.messages || []).length) {
            appendSmallText(transcript, "No messages yet");
        } else {
            (assistantState.messages || []).forEach(function each(message) {
                const row = document.createElement("div");
                row.className = "assistant-message " + (message.role === "user" ? "user" : "assistant");
                const meta = document.createElement("div");
                meta.className = "assistant-message-role";
                meta.textContent = message.role === "user" ? "You" : "Assistant";
                const body = document.createElement("div");
                body.className = "assistant-message-body";
                body.textContent = message.content || "";
                row.appendChild(meta);
                row.appendChild(body);
                transcript.appendChild(row);
            });
        }
        conversationSection.appendChild(transcript);
        if (assistantState.error) {
            const error = document.createElement("div");
            error.className = "validation-row error";
            error.textContent = assistantState.error;
            conversationSection.appendChild(error);
        }
        const composer = document.createElement("textarea");
        composer.className = "assistant-composer";
        composer.placeholder = "Ask the assistant to change the table. It should work from the current table, selection, names, types, rules, and return an applyable patch.";
        composer.value = assistantState.draft || "";
        composer.oninput = function updateDraft() {
            if (model.onSetAssistantDraft) model.onSetAssistantDraft(composer.value);
        };
        conversationSection.appendChild(composer);
        appendActionRow(conversationSection, [
            { label: assistantState.busy ? "Working..." : "Send", onClick: model.onSendAssistantMessage, disabled: !!assistantState.busy },
            { label: "Clear", onClick: model.onClearAssistantConversation, disabled: !!assistantState.busy },
            { label: "Show Log", onClick: model.onOpenAssistantLog, disabled: false }
        ]);

        const patchSection = appendSection(container, "Proposed Patch");
        if (!assistantState.lastPatch) {
            appendSmallText(patchSection, "No unapplied patch");
        } else {
            appendSmallText(patchSection, assistantState.lastPatch.description || assistantState.lastPatch.type || "Assistant patch");
            const summary = assistantState.lastPatchSummary || [];
            if (summary.length) {
                const summaryCard = document.createElement("div");
                summaryCard.className = "assistant-patch-summary";
                summary.forEach(function each(line) {
                    const row = document.createElement("div");
                    row.className = line.indexOf("  ") === 0 ? "assistant-patch-detail" : "assistant-patch-line";
                    row.textContent = line.replace(/^  /, "");
                    summaryCard.appendChild(row);
                });
                patchSection.appendChild(summaryCard);
            }
            const pre = document.createElement("pre");
            pre.className = "assistant-patch";
            pre.textContent = JSON.stringify(assistantState.lastPatch, null, 2);
            patchSection.appendChild(pre);
            appendActionRow(patchSection, [
                { label: "Apply", onClick: model.onApplyAssistantPatch, disabled: !!assistantState.busy },
                { label: "Rollback", onClick: model.onUndo, disabled: !model.canUndo || !!assistantState.busy }
            ]);
        }
        if (assistantState.logOpen) appendAssistantLogDialog(container, assistantState, model);
        }

        function renderLayersTab() {
        const levelsSection = appendSection(container, "Levels");
        appendSmallText(levelsSection, "Levels control editor visibility and authoring context. They do not imply a gameplay draw order.");
        appendActionRow(levelsSection, [
            { label: "Add Level", onClick: function addRootLevel() { if (model.onAddLevel) model.onAddLevel(0); } },
            { label: "Show All", onClick: function showAll() { if (model.onShowAllLevels) model.onShowAllLevels(); } }
        ]);
        const levels = (model.levels || []).slice().sort(function sort(a, b) { return (a.level || 0) - (b.level || 0); });
        if (!levels.length) {
            appendSmallText(levelsSection, "No levels defined");
            return;
        }

        function levelDepth(levelValue) {
            let depth = 0;
            let guard = 0;
            let entry = levels.find(function find(item) { return item.level === levelValue; }) || null;
            while (entry && typeof entry.parentLevel === "number" && guard < 20) {
                depth += 1;
                entry = levels.find(function find(item) { return item.level === entry.parentLevel; }) || null;
                guard += 1;
            }
            return depth;
        }

        levels.forEach(function eachLevel(levelEntry) {
            const card = document.createElement("div");
            card.className = "anchor-card level-card";
            card.style.marginLeft = (levelDepth(levelEntry.level) * 16) + "px";

            const head = document.createElement("div");
            head.className = "list-row";
            const title = document.createElement("span");
            title.textContent = (levelEntry.name || ("Level " + levelEntry.level)) + "  L" + levelEntry.level;
            head.appendChild(title);
            const actions = document.createElement("div");
            actions.className = "mini-actions";
            [
                {
                    label: levelEntry.editorVisible === false ? "Show" : "Hide",
                    onClick: function toggleVisibility() {
                        if (model.onSetLevelVisibility) model.onSetLevelVisibility(levelEntry.level, levelEntry.editorVisible === false);
                    }
                },
                {
                    label: "Only",
                    onClick: function isolate() {
                        if (model.onIsolateLevel) model.onIsolateLevel(levelEntry.level);
                    }
                },
                {
                    label: "Assign",
                    disabled: !model.selected,
                    onClick: function assignSelected() {
                        if (model.onAssignSelectedToLevel) model.onAssignSelectedToLevel(levelEntry.level);
                    }
                },
                {
                    label: "+Child",
                    onClick: function addChild() {
                        if (model.onAddLevel) model.onAddLevel(levelEntry.level);
                    }
                },
                {
                    label: "\u2715",
                    className: "danger",
                    disabled: levelEntry.level === 0,
                    onClick: function removeLevel() {
                        if (model.onRemoveLevel) model.onRemoveLevel(levelEntry.level);
                    }
                }
            ].forEach(function eachAction(action) {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = action.label;
                if (action.className) button.className = action.className;
                if (action.disabled) button.disabled = true;
                button.onclick = action.onClick;
                actions.appendChild(button);
            });
            head.appendChild(actions);
            card.appendChild(head);

            const levelDraftKey = "level:" + levelEntry.level;
            const levelDraftState = getDraftState(model, levelDraftKey, {
                name: levelEntry.name || ("Level " + levelEntry.level),
                parentLevel: levelEntry.parentLevel == null ? "" : levelEntry.parentLevel,
                elevation: typeof levelEntry.elevation === "number" ? levelEntry.elevation : (levelEntry.level * 48)
            });
            appendField(card, "name", levelDraftState.value.name, function patchName(value) {
                patchDraftValue(model, levelDraftKey, "name", value);
            });
            appendField(card, "parentLevel", levelDraftState.value.parentLevel, function patchParent(value) {
                patchDraftValue(model, levelDraftKey, "parentLevel", value === "" ? null : value);
            }, optionList(levels.filter(function keep(entry) { return entry.level !== levelEntry.level; }).map(function map(entry) {
                return { value: String(entry.level), label: (entry.name || ("Level " + entry.level)) + " (L" + entry.level + ")" };
            }), true));
            appendField(card, "elevation", levelDraftState.value.elevation, function patchElevation(value) {
                patchDraftValue(model, levelDraftKey, "elevation", value);
            });
            appendDraftActions(card, levelDraftKey, levelDraftState.dirty, function saveLevel() {
                if (model.onSaveLevelDraft) model.onSaveLevelDraft(levelDraftKey, levelEntry.level, levelDraftState.value);
            }, function resetLevel() {
                if (model.onResetCardDraft) model.onResetCardDraft(levelDraftKey);
            });

            const members = (model.elements || []).filter(function keep(element) {
                const elementLevel = Pin.editorModel && Pin.editorModel.getElementLevel ? Pin.editorModel.getElementLevel(element) : (typeof element.level === "number" ? element.level : 0);
                return elementLevel === levelEntry.level;
            });
            if (!members.length) {
                appendSmallText(card, "No elements on this level");
            } else {
                members.forEach(function eachElement(element) {
                    const row = document.createElement("div");
                    row.className = "layer-row" + (model.selected && model.selected.id === element.id ? " active" : "");
                    const pick = document.createElement("button");
                    pick.className = "layer-pick";
                    let label = elementDisplayName(element);
                    if (element.type === "ramp" && typeof element.levelFrom === "number" && typeof element.levelTo === "number") {
                        label += "  " + element.levelFrom + "->" + element.levelTo;
                    }
                    appendIconLabel(pick, element.type, label);
                    pick.onclick = function selectElement() {
                        if (model.onSelectElement) model.onSelectElement(element.id);
                    };
                    const controls = document.createElement("div");
                    controls.className = "mini-actions";
                    const remove = document.createElement("button");
                    remove.type = "button";
                    remove.textContent = "\u2715";
                    remove.className = "danger";
                    remove.onclick = function removeElement() {
                        if (model.onDeleteElement) model.onDeleteElement(element.id);
                    };
                    controls.appendChild(remove);
                    row.appendChild(pick);
                    row.appendChild(controls);
                    card.appendChild(row);
                });
            }
            levelsSection.appendChild(card);
        });
        }

    function graphNodeRefKind(node) {
        if (!node) return "";
        if (node.type === "switchStep" || node.type === "timedTarget") return "switch";
        if (node.type === "lamp" || node.lampId) return "lamp";
        if (node.type === "event" && node.sourceId) return "switch";
        return "";
    }

        function appendLogicNode(container, node, model) {
            const button = document.createElement("button");
            button.className = "logic-node logic-" + node.type + (model.selectedGraphNodeId === node.id ? " active" : "");
            button.type = "button";
            const title = document.createElement("strong");
            title.textContent = node.title || node.type;
            const meta = document.createElement("span");
            meta.textContent = node.meta || "";
            button.appendChild(title);
            button.appendChild(meta);
            button.style.left = (node.x || 0) + "px";
            button.style.top = (node.y || 0) + "px";
            button.onclick = function chooseNode() {
                if (model.onSelectLogicNode) model.onSelectLogicNode(node);
            };
            container.appendChild(button);
        }

        function renderLogicTab() {
        const rulesEngine = model.table.rulesEngine || { switchMap: [], sequenceRules: [], logicGraphs: [] };
        const logicGraphs = model.logicGraphs || rulesEngine.logicGraphs || [];
        const rulesSection = appendSection(container, "Logic");
        appendSmallText(rulesSection, "Author sequences in table terms: triggers, progress lamps, targets, awards, resets, and property changes.");
        appendActionRow(rulesSection, [
            { label: "Add Sequence", onClick: model.onAddSequenceRule }
        ]);
        const logicSubtabs = [
            { id: "design", label: "Design" },
            { id: "outcomes", label: "Outcomes" },
            { id: "variables", label: "Variables" },
            { id: "timers", label: "Timers" },
            { id: "reset", label: "Reset" },
            { id: "check", label: "Check" },
            { id: "advanced", label: "Advanced" }
        ];
        const activeLogicSubtab = logicSubtabs.some(function some(tab) { return tab.id === model.logicSubtab; }) ? model.logicSubtab : "design";
        const subtabRow = document.createElement("div");
        subtabRow.className = "logic-subtabs";
        logicSubtabs.forEach(function each(tab) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = activeLogicSubtab === tab.id ? "active" : "";
            button.textContent = tab.label;
            button.onclick = function chooseLogicSubtab() {
                if (model.onSetLogicSubtab) model.onSetLogicSubtab(tab.id);
            };
            subtabRow.appendChild(button);
        });
        rulesSection.appendChild(subtabRow);
        if (activeLogicSubtab === "variables") {
            renderVariablesSubtab();
            return;
        }
        if (activeLogicSubtab === "timers") {
            renderTimersSubtab();
            return;
        }
        if (activeLogicSubtab === "check") {
            renderRuleValidationAndSwitchMap(container, model);
            return;
        }
        if (!logicGraphs.length) {
            appendSmallText(rulesSection, "No sequence rules yet");
            return;
        }

        function orderedNodes(graphModel) {
            const nodes = (graphModel && graphModel.nodes) || [];
            const edges = (graphModel && graphModel.edges) || [];
            const byId = {};
            const outgoing = {};
            nodes.forEach(function each(node) {
                if (!node || !node.id) return;
                byId[node.id] = node;
            });
            edges.forEach(function each(edge) {
                if (!edge || !edge.from || !edge.to) return;
                outgoing[edge.from] = outgoing[edge.from] || [];
                outgoing[edge.from].push(edge);
            });
            const start = nodes.find(function find(node) { return node.type === "start"; }) || nodes[0] || null;
            const out = [];
            const seen = {};
            let current = start;
            while (current && !seen[current.id]) {
                out.push(current);
                seen[current.id] = true;
                const nextEdge = (outgoing[current.id] || [])[0];
                current = nextEdge ? (byId[nextEdge.to] || null) : null;
            }
            return out;
        }

        function titleForNode(graphModel, node, index) {
            if (!node) return "Node";
            if (node.type === "start") return "Start";
            if (node.type === "switchStep") return "Step " + (index + 1);
            if (node.type === "timedTarget") return "Timed Target";
            if (node.type === "award") return "Award";
            if (node.type === "reset") return "Resets";
            if (node.type === "lamp") return "Lamp";
            if (node.label) return node.label;
            return node.type || "Node";
        }

        function metaForNode(graphModel, node) {
            if (!node) return "";
            if (node.type === "start") return graphModel && graphModel.ordered === false ? "unordered" : "ordered";
            if (node.type === "switchStep") return displaySwitchRef(model.table, node.switchId || "");
            if (node.type === "timedTarget") return displaySwitchRef(model.table, node.switchId || "") + " / " + (node.windowSeconds || 8) + "s";
            if (node.type === "award") return (node.awardPoints || 0) + " pts";
            if (node.type === "reset") return ((node.resetOnDrain !== false ? "drain " : "") + (node.resetOnComplete !== false ? "complete " : "") + (node.resetOnWrongOrder ? "wrong order" : "")).trim();
            if (node.type === "lamp") return displayLampRef(model.table, node.lampId || "");
            if (node.type === "event") return (node.eventType || "event") + ": " + displaySwitchRef(model.table, node.sourceId || "");
            if (node.type === "condition") return node.expression || ((node.variableId || "value") + " " + (node.operator || "eq") + " " + String(node.value));
            if (node.type === "action") {
                const actionType = node.actionType || "action";
                const target = displaySwitchRef(model.table, node.targetId || "");
                const property = node.property ? "." + node.property : "";
                const hasValue = node.value !== undefined && actionType !== "resetElementScore" && actionType !== "resetElementProperty";
                return actionType + ": " + target + property + (hasValue ? " -> " + String(node.value) : "");
            }
            if (node.type === "note") return node.text || "note";
            return node.label || node.type || "";
        }

        function selectGraphNode(node, refKind, refId) {
            if (!node || !model.onSelectLogicNode) return;
            model.onSelectLogicNode({
                id: node.id,
                graphId: selectedGraph.id,
                type: node.type,
                refKind: refKind != null ? refKind : graphNodeRefKind(node),
                refId: refId != null ? refId :
                    (node.type === "switchStep" || node.type === "timedTarget" ? (node.switchId || "") :
                        node.type === "lamp" ? (node.lampId || "") :
                            node.type === "event" ? (node.sourceId || "") : "")
            });
        }

        function describeActionNode(node) {
            if (!node) return "Action";
            const target = displaySwitchRef(model.table, node.targetId || "");
            if (node.actionType === "setElementScore") return "Set " + target + " score to " + (node.value || 0);
            if (node.actionType === "addElementScore") return "Add " + (node.value || 0) + " score to " + target;
            if (node.actionType === "resetElementScore") return "Reset score override for " + target;
            if (node.actionType === "setElementProperty" && node.property === "locked") return (node.value ? "Lock " : "Unlock ") + target;
            if (node.actionType === "resetElementProperty" && node.property === "locked") return "Reset lock state for " + target;
            if (node.actionType === "setElementProperty") return "Set " + target + "." + (node.property || "property") + " = " + String(node.value);
            if (node.actionType === "resetElementProperty") return "Reset " + target + "." + (node.property || "property");
            if (node.actionType === "setVariableProperty") return "Set " + (node.variableId || node.targetId || "variable") + "." + (node.property || "value") + " = " + String(node.value);
            if (node.actionType === "addVariableProperty") return "Add " + String(node.value || 0) + " to " + (node.variableId || node.targetId || "variable");
            if (node.actionType === "toggleVariableProperty") return "Toggle " + (node.variableId || node.targetId || "variable") + "." + (node.property || "value");
            if (node.actionType === "resetVariableProperty") return "Reset " + (node.variableId || node.targetId || "variable") + "." + (node.property || "value");
            if (node.actionType === "setLamp") return "Set lamp " + (node.lampId || node.targetId || "lamp");
            if (node.actionType === "clearLamp") return "Clear lamp " + (node.lampId || node.targetId || "lamp");
            if (node.actionType === "setLampFromVariable") return "Set lamp " + (node.lampId || node.targetId || "lamp") + " from " + (node.variableId || "variable");
            return metaForNode(selectedGraph, node);
        }

        function renderVariablesSubtab() {
            const variableSection = appendSection(container, "Variables");
            appendActionRow(variableSection, [
                { label: "Add Variable", onClick: model.onAddVariable }
            ]);
            const variables = rulesEngine.variables || [];
            if (!variables.length) {
                appendSmallText(variableSection, "No variables yet");
                return;
            }
            variables.forEach(function each(variable, index) {
                const card = document.createElement("div");
                card.className = "anchor-card";
                const key = "logicVariable:" + index;
                const draft = getDraftState(model, key, Pin.editorTools.clone(variable));
                draft.value.properties = draft.value.properties || { value: false };
                appendCardTitle(card, variable.name || variable.id || ("Variable " + (index + 1)), variable.id || "");
                appendField(card, "id", draft.value.id || "", function patch(value) { patchDraftValue(model, key, "id", value); });
                appendField(card, "name", draft.value.name || "", function patch(value) { patchDraftValue(model, key, "name", value); });
                appendField(card, "default value", Object.prototype.hasOwnProperty.call(draft.value.properties, "value") ? draft.value.properties.value : false, function patch(value) {
                    patchDraftValue(model, key, "properties.value", value);
                });
                appendDraftActions(card, key, draft.dirty, function saveVariable() {
                    if (model.onSaveVariableDraft) model.onSaveVariableDraft(key, index, draft.value);
                }, function resetVariable() {
                    if (model.onResetCardDraft) model.onResetCardDraft(key);
                });
                appendActionRow(card, [
                    { label: "Remove Variable", onClick: function remove() { if (model.onRemoveVariable) model.onRemoveVariable(index); }, className: "danger" }
                ]);
                variableSection.appendChild(card);
            });
        }

        function renderTimersSubtab() {
            const timerSection = appendSection(container, "Timers");
            appendActionRow(timerSection, [
                { label: "Add Timer", onClick: model.onAddTrigger }
            ]);
            const triggers = rulesEngine.triggers || [];
            if (!triggers.length) {
                appendSmallText(timerSection, "No timers yet");
                return;
            }
            triggers.forEach(function each(trigger, index) {
                const card = document.createElement("div");
                card.className = "anchor-card";
                const key = "logicTrigger:" + index;
                const draft = getDraftState(model, key, Pin.editorTools.clone(trigger));
                const usedBy = (rulesEngine.sequenceRules || []).filter(function filter(rule) {
                    return rule && trigger.switchId && ((rule.steps || []).indexOf(trigger.switchId) >= 0 || rule.targetSwitchId === trigger.switchId);
                }).map(function map(rule) { return rule.name || rule.id; });
                appendCardTitle(card, trigger.id || ("Timer " + (index + 1)), usedBy.length ? ("Used by: " + usedBy.join(", ")) : "Not used by a sequence");
                appendField(card, "enabled", draft.value.enabled !== false, function patch(value) { patchDraftValue(model, key, "enabled", value); });
                appendField(card, "id", draft.value.id || "", function patch(value) { patchDraftValue(model, key, "id", value); });
                appendField(card, "switchId", draft.value.switchId || "", function patch(value) { patchDraftValue(model, key, "switchId", value); });
                appendField(card, "everySeconds", typeof draft.value.everySeconds === "number" ? draft.value.everySeconds : 1, function patch(value) { patchDraftValue(model, key, "everySeconds", value); });
                appendField(card, "everyTicks", typeof draft.value.everyTicks === "number" ? draft.value.everyTicks : 0, function patch(value) { patchDraftValue(model, key, "everyTicks", value); });
                appendDraftActions(card, key, draft.dirty, function saveTrigger() {
                    if (model.onSaveTriggerDraft) model.onSaveTriggerDraft(key, index, draft.value);
                }, function resetTrigger() {
                    if (model.onResetCardDraft) model.onResetCardDraft(key);
                });
                appendActionRow(card, [
                    { label: "Remove Timer", onClick: function remove() { if (model.onRemoveTrigger) model.onRemoveTrigger(index); }, className: "danger" }
                ]);
                timerSection.appendChild(card);
            });
        }

        function appendSequenceSummary(section, stepNodes, targetNode) {
            const card = document.createElement("div");
            card.className = "sequence-preview";
            const order = document.createElement("div");
            order.className = "sequence-preview-row";
            const orderLabel = document.createElement("span");
            orderLabel.textContent = "Order";
            const orderValue = document.createElement("span");
            orderValue.textContent = selectedGraph.ordered === false ? "Any order" : "In listed order";
            order.appendChild(orderLabel);
            order.appendChild(orderValue);
            card.appendChild(order);
            const stepsRow = document.createElement("div");
            stepsRow.className = "sequence-preview-row";
            const stepsLabel = document.createElement("span");
            stepsLabel.textContent = "Progress";
            const stepsValue = document.createElement("span");
            stepsValue.textContent = stepNodes.length ? stepNodes.length + " trigger step" + (stepNodes.length === 1 ? "" : "s") : "No steps";
            stepsRow.appendChild(stepsLabel);
            stepsRow.appendChild(stepsValue);
            card.appendChild(stepsRow);
            const targetRow = document.createElement("div");
            targetRow.className = "sequence-preview-row";
            const targetLabel = document.createElement("span");
            targetLabel.textContent = "Completion";
            const targetValue = document.createElement("span");
            targetValue.textContent = targetNode ? (displaySwitchRef(model.table, targetNode.switchId || "") + " / " + (targetNode.windowSeconds || 8) + "s") : "Awards when steps complete";
            targetRow.appendChild(targetLabel);
            targetRow.appendChild(targetValue);
            card.appendChild(targetRow);
            section.appendChild(card);
        }

        const selectedGraph = logicGraphs.find(function find(graph) { return graph.id === model.selectedGraphId; }) || logicGraphs[0];
        const selectedRule = (((rulesEngine || {}).sequenceRules) || []).find(function find(rule) {
            return selectedGraph && rule.id === selectedGraph.sourceRuleId;
        }) || null;
        const pathNodes = selectedGraph ? orderedNodes(selectedGraph) : [];
        const stepNodes = pathNodes.filter(function keep(node) { return node.type === "switchStep"; });
        const targetNode = pathNodes.find(function find(node) { return node.type === "timedTarget"; }) ||
            ((selectedGraph && selectedGraph.nodes) || []).find(function find(node) { return node.type === "timedTarget"; }) || null;
        const awardNode = pathNodes.find(function find(node) { return node.type === "award"; }) ||
            ((selectedGraph && selectedGraph.nodes) || []).find(function find(node) { return node.type === "award"; }) || null;
        const actionNodes = pathNodes.filter(function keep(node) { return node.type === "action"; });

        const sequenceSection = appendSection(container, "Sequences");
        const sequenceList = document.createElement("div");
        sequenceList.className = "sequence-list";
        logicGraphs.forEach(function each(graphModel) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "sequence-pill" + (selectedGraph && selectedGraph.id === graphModel.id ? " active" : "");
            const stepCount = orderedNodes(graphModel).filter(function keep(node) { return node.type === "switchStep"; }).length;
            button.textContent = (graphModel.name || graphModel.id) + "  " + stepCount + " step" + (stepCount === 1 ? "" : "s");
            button.onclick = function selectRule() {
                if (model.onSelectRule) model.onSelectRule(graphModel.sourceRuleId || "");
            };
            sequenceList.appendChild(button);
        });
        sequenceSection.appendChild(sequenceList);
        if (selectedRule) {
            appendActionRow(sequenceSection, [
                { label: "Duplicate", onClick: function duplicateSequence() { if (model.onDuplicateRule) model.onDuplicateRule(selectedRule.id); } },
                { label: "Delete", onClick: function deleteSequence() { if (model.onDeleteRule) model.onDeleteRule(selectedGraph.id || selectedGraph.sourceRuleId || ""); }, className: "danger" }
            ]);
        }

        if (activeLogicSubtab === "design") {
            const flow = appendSection(container, "Flow");
            const flowStrip = document.createElement("div");
            flowStrip.className = "sequence-flow";
            pathNodes.forEach(function eachNode(node, index) {
                const chip = document.createElement("button");
                chip.type = "button";
                chip.className = "sequence-flow-node logic-" + node.type + (model.selectedGraphNodeId === node.id ? " active" : "");
                chip.textContent = titleForNode(selectedGraph, node, index);
                chip.onclick = function selectFlowNode() { selectGraphNode(node); };
                flowStrip.appendChild(chip);
                if (index < pathNodes.length - 1) {
                    const arrow = document.createElement("span");
                    arrow.className = "sequence-flow-arrow";
                    arrow.textContent = ">";
                    flowStrip.appendChild(arrow);
                }
            });
            flow.appendChild(flowStrip);
            appendSequenceSummary(flow, stepNodes, targetNode);

            const builder = appendSection(container, "Design");
            appendSmallText(builder, "Set up triggers and progress lights here. Use the current table selection to bind a step or lamp when it helps.");
            appendActionRow(builder, [
                { label: "Add Step", onClick: function addBuilderStep() { if (model.onAddLogicStep) model.onAddLogicStep(selectedGraph.id); } }
            ]);

            if (!stepNodes.length) {
                appendSmallText(builder, "No trigger steps yet");
            } else {
                const stepList = document.createElement("div");
                stepList.className = "logic-compact-list";
                stepNodes.forEach(function eachStep(node, index) {
                    const row = document.createElement("div");
                    row.className = "logic-compact-row" + (model.selectedGraphNodeId === node.id ? " active" : "");
                    const meta = document.createElement("div");
                    meta.className = "logic-compact-meta";
                    const title = document.createElement("strong");
                    title.textContent = "Step " + (index + 1);
                    const summary = document.createElement("span");
                    summary.textContent = displaySwitchRef(model.table, node.switchId || "") + "  /  " + displayLampRef(model.table, node.lampId || "");
                    meta.appendChild(title);
                    meta.appendChild(summary);
                    row.appendChild(meta);
                    appendActionRow(row, [
                        { label: "Edit", onClick: function editStep() { selectGraphNode(node, "switch", node.switchId || ""); } },
                        { label: "Use Selected", onClick: function useSelectedObject() { if (model.onAssignSelectedToLogicNode) model.onAssignSelectedToLogicNode({ id: node.id, graphId: selectedGraph.id }); } },
                        { label: "Light", onClick: function useSelectedLight() { if (model.selected && (model.selected.type === "light" || model.selected.type === "arrowLight" || model.selected.type === "boxLight") && model.onAssignSelectedToLogicNode) model.onAssignSelectedToLogicNode({ id: node.id, graphId: selectedGraph.id }); }, className: (!model.selected || (model.selected.type !== "light" && model.selected.type !== "arrowLight" && model.selected.type !== "boxLight")) ? "disabled-action" : "" }
                    ]);
                    stepList.appendChild(row);
                });
                builder.appendChild(stepList);
            }

            const targetSection = appendSection(container, "Completion");
            if (targetNode) {
                const targetCard = document.createElement("div");
                targetCard.className = "logic-compact-row logic-compact-feature" + (model.selectedGraphNodeId === targetNode.id ? " active" : "");
                const meta = document.createElement("div");
                meta.className = "logic-compact-meta";
                const title = document.createElement("strong");
                title.textContent = "Timed Target";
                const summary = document.createElement("span");
                summary.textContent = displaySwitchRef(model.table, targetNode.switchId || "") + "  /  " + displayLampRef(model.table, targetNode.lampId || "") + "  /  " + (targetNode.windowSeconds || 8) + "s";
                meta.appendChild(title);
                meta.appendChild(summary);
                targetCard.appendChild(meta);
                appendActionRow(targetCard, [
                    { label: "Edit", onClick: function editTarget() { selectGraphNode(targetNode, "switch", targetNode.switchId || ""); } },
                    { label: "Use Selected", onClick: function useSelectedTarget() { if (model.onAssignSelectedToLogicNode) model.onAssignSelectedToLogicNode({ id: targetNode.id, graphId: selectedGraph.id }); } },
                    { label: "Light", onClick: function useSelectedTargetLight() { if (model.selected && (model.selected.type === "light" || model.selected.type === "arrowLight" || model.selected.type === "boxLight") && model.onAssignSelectedToLogicNode) model.onAssignSelectedToLogicNode({ id: targetNode.id, graphId: selectedGraph.id }); }, className: (!model.selected || (model.selected.type !== "light" && model.selected.type !== "arrowLight" && model.selected.type !== "boxLight")) ? "disabled-action" : "" }
                ]);
                targetSection.appendChild(targetCard);
            } else {
                appendSmallText(targetSection, "No timed target. This sequence awards as soon as all steps complete.");
            }
        }

        if (activeLogicSubtab === "outcomes") {
            const outcomeSection = appendSection(container, "Outcomes");
            appendSmallText(outcomeSection, "Configure what the player gets when this sequence completes or qualifies a mode.");
            if (selectedRule) {
                const ruleDraftKey = "rule:" + selectedRule.id;
                const ruleDraftState = getDraftState(model, ruleDraftKey, Pin.editorTools.clone(selectedRule));
                const awardCard = document.createElement("div");
                awardCard.className = "anchor-card";
                appendCardTitle(awardCard, "Award", "Main award when the sequence completes.");
                appendField(awardCard, "awardPoints", ruleDraftState.value.awardPoints || 0, function patch(value) { patchDraftValue(model, ruleDraftKey, "awardPoints", value); });
                appendField(awardCard, "awardEvent", ruleDraftState.value.awardEvent || "ruleAwarded", function patch(value) { patchDraftValue(model, ruleDraftKey, "awardEvent", value); });
                appendDraftActions(awardCard, ruleDraftKey, ruleDraftState.dirty, function saveRule() {
                    if (model.onSaveRuleDraft) model.onSaveRuleDraft(ruleDraftKey, selectedRule.id, ruleDraftState.value);
                }, function resetRule() {
                    if (model.onResetCardDraft) model.onResetCardDraft(ruleDraftKey);
                });
                outcomeSection.appendChild(awardCard);
            }

            appendActionRow(outcomeSection, [
                { label: "Add Score Action", onClick: function addScoreAction() { if (model.onAddLogicNode) model.onAddLogicNode(selectedGraph.id, "action", { actionType: "setElementScore", targetId: "", value: 1000 }); } },
                { label: "Add Gate Lock", onClick: function addGateLock() { if (model.onAddLogicNode) model.onAddLogicNode(selectedGraph.id, "action", { actionType: "setElementProperty", targetId: "", property: "locked", value: true }); } },
                { label: "Add Variable Toggle", onClick: function addVariableToggle() { if (model.onAddLogicNode) model.onAddLogicNode(selectedGraph.id, "action", { actionType: "toggleVariableProperty", variableId: "", property: "value" }); } },
                { label: "Add Lamp Action", onClick: function addLampAction() { if (model.onAddLogicNode) model.onAddLogicNode(selectedGraph.id, "action", { actionType: "setLamp", lampId: "", value: true }); } },
                { label: "Add Generic Action", onClick: function addGenericAction() { if (model.onAddLogicNode) model.onAddLogicNode(selectedGraph.id, "action", { actionType: "setElementScore", targetId: "", value: 0 }); } }
            ]);

            if (!actionNodes.length) {
                appendSmallText(outcomeSection, "No extra outcome actions yet");
            } else {
                const actionList = document.createElement("div");
                actionList.className = "logic-compact-list";
                actionNodes.forEach(function eachAction(node) {
                    const row = document.createElement("div");
                    row.className = "logic-compact-row" + (model.selectedGraphNodeId === node.id ? " active" : "");
                    const meta = document.createElement("div");
                    meta.className = "logic-compact-meta";
                    const title = document.createElement("strong");
                    title.textContent = describeActionNode(node);
                    const summary = document.createElement("span");
                    summary.textContent = metaForNode(selectedGraph, node);
                    meta.appendChild(title);
                    meta.appendChild(summary);
                    row.appendChild(meta);
                    appendActionRow(row, [
                        { label: "Edit", onClick: function editAction() { selectGraphNode(node); } },
                        { label: "Use Selected", onClick: function bindActionTarget() { if (model.onAssignSelectedToLogicNode) model.onAssignSelectedToLogicNode({ id: node.id, graphId: selectedGraph.id }); } },
                        { label: "Delete", onClick: function removeAction() { if (model.onDeleteGraphNode) model.onDeleteGraphNode(selectedGraph.id, node.id); }, className: "danger" }
                    ]);
                    actionList.appendChild(row);
                });
                outcomeSection.appendChild(actionList);
            }
        }

        if (activeLogicSubtab === "reset" && selectedRule) {
            const resetSection = appendSection(container, "Reset");
            appendSmallText(resetSection, "Control order, reset conditions, and target timing from one place.");
            const ruleDraftKey = "rule:" + selectedRule.id;
            const ruleDraftState = getDraftState(model, ruleDraftKey, Pin.editorTools.clone(selectedRule));
            const resetCard = document.createElement("div");
            resetCard.className = "anchor-card";
            appendField(resetCard, "name", ruleDraftState.value.name || "", function patch(value) { patchDraftValue(model, ruleDraftKey, "name", value); });
            appendField(resetCard, "enabled", ruleDraftState.value.enabled !== false, function patch(value) { patchDraftValue(model, ruleDraftKey, "enabled", value); });
            appendField(resetCard, "ordered", ruleDraftState.value.ordered !== false, function patch(value) { patchDraftValue(model, ruleDraftKey, "ordered", value); });
            if (targetNode) {
                appendField(resetCard, "windowSeconds", ruleDraftState.value.windowSeconds || 8, function patch(value) { patchDraftValue(model, ruleDraftKey, "windowSeconds", value); });
            }
            appendField(resetCard, "resetOnDrain", ruleDraftState.value.resetOnDrain !== false, function patch(value) { patchDraftValue(model, ruleDraftKey, "resetOnDrain", value); });
            appendField(resetCard, "resetOnComplete", ruleDraftState.value.resetOnComplete !== false, function patch(value) { patchDraftValue(model, ruleDraftKey, "resetOnComplete", value); });
            appendField(resetCard, "resetOnWrongOrder", !!ruleDraftState.value.resetOnWrongOrder, function patch(value) { patchDraftValue(model, ruleDraftKey, "resetOnWrongOrder", value); });
            appendDraftActions(resetCard, ruleDraftKey, ruleDraftState.dirty, function saveRule() {
                if (model.onSaveRuleDraft) model.onSaveRuleDraft(ruleDraftKey, selectedRule.id, ruleDraftState.value);
            }, function resetRule() {
                if (model.onResetCardDraft) model.onResetCardDraft(ruleDraftKey);
            });
            resetSection.appendChild(resetCard);
        }

        if (activeLogicSubtab === "check") renderRuleValidationAndSwitchMap(container, model);

        const selectedNode = selectedGraph && model.selectedGraphNodeId ?
            (selectedGraph.nodes || []).find(function find(node) { return node.id === model.selectedGraphNodeId; }) :
            null;
        if (activeLogicSubtab === "advanced") {
            const advancedSection = appendSection(container, "Advanced");
            appendSmallText(advancedSection, "Raw graph editing remains available here for unusual cases. Most sequence authoring should happen in Design, Outcomes, and Reset.");
            appendActionRow(advancedSection, [
                { label: "Add Action", onClick: function addActionNode() { if (model.onAddLogicNode) model.onAddLogicNode(selectedGraph.id, "action", { actionType: "setElementScore", targetId: "", value: 0 }); } },
                { label: "Add Event", onClick: function addEventNode() { if (model.onAddLogicNode) model.onAddLogicNode(selectedGraph.id, "event", { eventType: "switchClosed", sourceId: "" }); } },
                { label: "Add Condition", onClick: function addConditionNode() { if (model.onAddLogicNode) model.onAddLogicNode(selectedGraph.id, "condition", { variableId: "", property: "value", operator: "truthy", value: true }); } },
                { label: "Add Note", onClick: function addNoteNode() { if (model.onAddLogicNode) model.onAddLogicNode(selectedGraph.id, "note", { text: "" }); } }
            ]);
            const graphView = document.createElement("div");
            graphView.className = "logic-graph";
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.classList.add("logic-edges");
            const nodeById = {};
            let maxY = 220;
            (selectedGraph.nodes || []).forEach(function each(node) {
                nodeById[node.id] = node;
                maxY = Math.max(maxY, (node.y || 0) + 90);
            });
            svg.setAttribute("viewBox", "0 0 960 " + maxY);
            ((selectedGraph.edges || [])).forEach(function each(edge) {
                const from = nodeById[edge.from];
                const to = nodeById[edge.to];
                if (!from || !to) return;
                const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                line.setAttribute("x1", String((from.x || 0) + 132));
                line.setAttribute("y1", String((from.y || 0) + 32));
                line.setAttribute("x2", String(to.x || 0));
                line.setAttribute("y2", String((to.y || 0) + 32));
                line.setAttribute("class", "logic-edge-line");
                svg.appendChild(line);
            });
            graphView.appendChild(svg);
            (selectedGraph.nodes || []).forEach(function each(node, index) {
                appendLogicNode(graphView, {
                    id: node.id,
                    graphId: selectedGraph.id,
                    type: node.type,
                    title: titleForNode(selectedGraph, node, index),
                    meta: metaForNode(selectedGraph, node),
                    x: node.x || 0,
                    y: node.y || 0
                }, model);
            });
            advancedSection.appendChild(graphView);
        }
        if (activeLogicSubtab === "advanced" && selectedNode) {
            const detail = appendSection(container, "Selected Item");
            const nodeDraftKey = "logicNode:" + selectedGraph.id + ":" + selectedNode.id;
            const nodeDraftState = getDraftState(model, nodeDraftKey, Pin.editorTools.clone(selectedNode));
            const itemMeta = document.createElement("p");
            itemMeta.className = "small";
            itemMeta.textContent = titleForNode(selectedGraph, selectedNode, 0) + "  " + metaForNode(selectedGraph, selectedNode);
            detail.appendChild(itemMeta);

            const switchCandidates = (model.elements || []).filter(function keep(el) {
                return ["lane", "scoreZone", "spinner", "gate", "valve", "drain", "launcher", "dropTarget", "bumper", "kicker"].indexOf(el.type) >= 0;
            }).map(function map(el) {
                return { value: el.id, label: elementDisplayName(el) };
            }).concat((rulesEngine.triggers || []).map(function map(trigger) {
                return { value: trigger.switchId || "", label: (trigger.id || "Timer") + " (" + (trigger.switchId || "no switch") + ")" };
            }));
            const lightCandidates = (model.elements || []).filter(function keep(el) { return el.type === "light" || el.type === "arrowLight" || el.type === "boxLight"; }).map(function map(el) {
                return { value: el.lampId || el.id, label: elementDisplayName(el) };
            });
            const variableCandidates = (rulesEngine.variables || []).map(function map(variable) {
                return { value: variable.id || variable.name || "", label: (variable.name || variable.id || "Variable") + (variable.id ? " (" + variable.id + ")" : "") };
            });
            const objectCandidates = (model.elements || []).filter(function keep(el) { return el.type !== "light" && el.type !== "arrowLight" && el.type !== "boxLight"; }).map(function map(el) {
                return { value: el.id, label: elementDisplayName(el) };
            });
            if (nodeDraftState.value.type === "switchStep") {
                appendChoiceList(detail, "Trigger", "Current: " + displaySwitchRef(model.table, nodeDraftState.value.switchId || ""), switchCandidates, nodeDraftState.value.switchId || "", function pickSwitch(value) {
                    patchDraftValue(model, nodeDraftKey, "switchId", value);
                });
                appendChoiceList(detail, "Lamp", "Current: " + displayLampRef(model.table, nodeDraftState.value.lampId || ""), lightCandidates, nodeDraftState.value.lampId || "", function pickLamp(value) {
                    patchDraftValue(model, nodeDraftKey, "lampId", value);
                });
            } else if (nodeDraftState.value.type === "timedTarget") {
                appendChoiceList(detail, "Target", "Current: " + displaySwitchRef(model.table, nodeDraftState.value.switchId || ""), switchCandidates, nodeDraftState.value.switchId || "", function pickTarget(value) {
                    patchDraftValue(model, nodeDraftKey, "switchId", value);
                });
                appendChoiceList(detail, "Lamp", "Current: " + displayLampRef(model.table, nodeDraftState.value.lampId || ""), lightCandidates, nodeDraftState.value.lampId || "", function pickTargetLamp(value) {
                    patchDraftValue(model, nodeDraftKey, "lampId", value);
                });
                appendField(detail, "windowSeconds", nodeDraftState.value.windowSeconds || 8, function patch(value) {
                    patchDraftValue(model, nodeDraftKey, "windowSeconds", value);
                });
            } else if (nodeDraftState.value.type === "award") {
                appendField(detail, "awardPoints", nodeDraftState.value.awardPoints || 0, function patch(value) {
                    patchDraftValue(model, nodeDraftKey, "awardPoints", value);
                });
                appendField(detail, "awardEvent", nodeDraftState.value.awardEvent || "ruleAwarded", function patch(value) {
                    patchDraftValue(model, nodeDraftKey, "awardEvent", value);
                });
            } else if (nodeDraftState.value.type === "reset") {
                appendField(detail, "resetOnDrain", nodeDraftState.value.resetOnDrain !== false, function patch(value) {
                    patchDraftValue(model, nodeDraftKey, "resetOnDrain", value);
                });
                appendField(detail, "resetOnComplete", nodeDraftState.value.resetOnComplete !== false, function patch(value) {
                    patchDraftValue(model, nodeDraftKey, "resetOnComplete", value);
                });
                appendField(detail, "resetOnWrongOrder", !!nodeDraftState.value.resetOnWrongOrder, function patch(value) {
                    patchDraftValue(model, nodeDraftKey, "resetOnWrongOrder", value);
                });
            } else if (nodeDraftState.value.type === "lamp") {
                appendChoiceList(detail, "Lamp", "Current: " + displayLampRef(model.table, nodeDraftState.value.lampId || ""), lightCandidates, nodeDraftState.value.lampId || "", function pickLampOnly(value) {
                    patchDraftValue(model, nodeDraftKey, "lampId", value);
                });
            } else if (nodeDraftState.value.type === "event") {
                appendField(detail, "eventType", nodeDraftState.value.eventType || "switchClosed", function patch(value) {
                    patchDraftValue(model, nodeDraftKey, "eventType", value);
                });
                appendChoiceList(detail, "Source", "Current: " + displaySwitchRef(model.table, nodeDraftState.value.sourceId || ""), switchCandidates, nodeDraftState.value.sourceId || "", function pickSource(value) {
                    patchDraftValue(model, nodeDraftKey, "sourceId", value);
                });
            } else if (nodeDraftState.value.type === "condition") {
                appendChoiceList(detail, "Variable", "Current: " + (nodeDraftState.value.variableId || "(none)"), variableCandidates, nodeDraftState.value.variableId || "", function pickVariable(value) {
                    patchDraftValue(model, nodeDraftKey, "variableId", value);
                });
                appendField(detail, "property", nodeDraftState.value.property || "value", function patch(value) {
                    patchDraftValue(model, nodeDraftKey, "property", value);
                });
                appendField(detail, "operator", nodeDraftState.value.operator || "eq", function patch(value) {
                    patchDraftValue(model, nodeDraftKey, "operator", value);
                }, optionList(["eq", "ne", "gt", "gte", "lt", "lte", "truthy", "falsy"], false));
                appendField(detail, "value", Object.prototype.hasOwnProperty.call(nodeDraftState.value, "value") ? nodeDraftState.value.value : true, function patch(value) {
                    patchDraftValue(model, nodeDraftKey, "value", value);
                });
            } else if (nodeDraftState.value.type === "action") {
                appendField(detail, "actionType", nodeDraftState.value.actionType || "setElementScore", function patch(value) {
                    patchDraftValue(model, nodeDraftKey, "actionType", value);
                }, optionList([
                    { value: "setElementScore", label: "Set Element Score" },
                    { value: "addElementScore", label: "Add Element Score" },
                    { value: "resetElementScore", label: "Reset Element Score" },
                    { value: "setElementProperty", label: "Set Element Property" },
                    { value: "resetElementProperty", label: "Reset Element Property" },
                    { value: "setVariableProperty", label: "Set Variable Property" },
                    { value: "addVariableProperty", label: "Add Variable Property" },
                    { value: "toggleVariableProperty", label: "Toggle Variable Property" },
                    { value: "resetVariableProperty", label: "Reset Variable Property" },
                    { value: "setLamp", label: "Set Lamp" },
                    { value: "clearLamp", label: "Clear Lamp" },
                    { value: "setLampFromVariable", label: "Set Lamp From Variable" }
                ], false));
                const actionType = nodeDraftState.value.actionType || "setElementScore";
                const variableAction = actionType === "setVariableProperty" || actionType === "addVariableProperty" || actionType === "toggleVariableProperty" || actionType === "resetVariableProperty" || actionType === "setLampFromVariable";
                const lampAction = actionType === "setLamp" || actionType === "clearLamp" || actionType === "setLampFromVariable";
                if (variableAction) {
                    appendChoiceList(detail, "Variable", "Current: " + (nodeDraftState.value.variableId || nodeDraftState.value.targetId || "(none)"), variableCandidates, nodeDraftState.value.variableId || nodeDraftState.value.targetId || "", function pickVariable(value) {
                        patchDraftValue(model, nodeDraftKey, "variableId", value);
                    });
                } else if (!lampAction) {
                    appendChoiceList(detail, "Target", "Current: " + displaySwitchRef(model.table, nodeDraftState.value.targetId || ""), objectCandidates, nodeDraftState.value.targetId || "", function pickActionTarget(value) {
                        patchDraftValue(model, nodeDraftKey, "targetId", value);
                    });
                }
                if (lampAction) {
                    appendChoiceList(detail, "Lamp", "Current: " + displayLampRef(model.table, nodeDraftState.value.lampId || nodeDraftState.value.targetId || ""), lightCandidates, nodeDraftState.value.lampId || nodeDraftState.value.targetId || "", function pickActionLamp(value) {
                        patchDraftValue(model, nodeDraftKey, "lampId", value);
                    });
                }
                if (actionType === "setElementProperty" || actionType === "resetElementProperty") {
                    appendField(detail, "property", nodeDraftState.value.property || "locked", function patch(value) {
                        patchDraftValue(model, nodeDraftKey, "property", value);
                    });
                }
                if (variableAction) {
                    appendField(detail, "property", nodeDraftState.value.property || "value", function patch(value) {
                        patchDraftValue(model, nodeDraftKey, "property", value);
                    });
                }
                if (actionType !== "resetElementScore" && actionType !== "resetElementProperty" && actionType !== "toggleVariableProperty" && actionType !== "resetVariableProperty" && actionType !== "clearLamp" && actionType !== "setLampFromVariable") {
                    const propertyName = nodeDraftState.value.property || "locked";
                    const actionValue = (actionType === "setElementProperty" && propertyName === "locked") || actionType === "setLamp" ?
                        (typeof nodeDraftState.value.value === "boolean" ? nodeDraftState.value.value : true) :
                        (actionType === "setElementProperty" ? nodeDraftState.value.value : (typeof nodeDraftState.value.value === "number" ? nodeDraftState.value.value : 0));
                    appendField(detail, "value", actionValue === undefined ? "" : actionValue, function patch(value) {
                        patchDraftValue(model, nodeDraftKey, "value", value);
                    });
                }
            } else if (nodeDraftState.value.type === "note") {
                appendField(detail, "text", nodeDraftState.value.text || "", function patch(value) {
                    patchDraftValue(model, nodeDraftKey, "text", value);
                });
            }
            appendDraftActions(detail, nodeDraftKey, nodeDraftState.dirty, function saveNode() {
                if (model.onSaveGraphNodeDraft) model.onSaveGraphNodeDraft(nodeDraftKey, selectedGraph.id, selectedNode.id, nodeDraftState.value);
            }, function resetNode() {
                if (model.onResetCardDraft) model.onResetCardDraft(nodeDraftKey);
            });

            const selectedElement = model.selected ? model.selected.type + " " + model.selected.id : "nothing selected";
            const context = document.createElement("p");
            context.className = "small";
            context.textContent = "Table selection: " + (model.selected ? elementDisplayName(model.selected) : "nothing selected");
            detail.appendChild(context);

            if (model.pendingEdgeSourceNodeId) {
                const sourceNode = (selectedGraph.nodes || []).find(function find(node) { return node.id === model.pendingEdgeSourceNodeId; }) || null;
                const sourceText = document.createElement("p");
                sourceText.className = "small";
                sourceText.textContent = "Edge source: " + (sourceNode ? (sourceNode.label || sourceNode.type || sourceNode.id) : model.pendingEdgeSourceNodeId);
                detail.appendChild(sourceText);
            }

            const isSequenceCoreNode = ["start", "switchStep", "timedTarget", "award", "reset", "lamp"].indexOf(selectedNode.type) >= 0;
            const bindable = selectedNode.type === "switchStep" || selectedNode.type === "timedTarget" || selectedNode.type === "lamp" || selectedNode.type === "event";
            const assignDisabled = selectedNode.type === "lamp" && (!model.selected || (model.selected.type !== "light" && model.selected.type !== "arrowLight" && model.selected.type !== "boxLight"));
            if (!isSequenceCoreNode) {
                appendActionRow(detail, [
                    { label: bindable ? (selectedNode.type === "lamp" ? "Use Selected Light" : "Use Selected Object") : "Bind Selected", onClick: function assign() {
                        if (assignDisabled || !bindable) return;
                        if (model.onAssignSelectedToLogicNode) {
                            model.onAssignSelectedToLogicNode({
                                id: selectedNode.id,
                                graphId: selectedGraph.id
                            });
                        }
                    }, className: assignDisabled || !bindable ? "disabled-action" : "" },
                    { label: "Mark as Source", onClick: function markSource() {
                        if (model.onMarkLogicEdgeSource) model.onMarkLogicEdgeSource(selectedNode.id);
                    } },
                    { label: "Connect Source -> This", onClick: function connectSource() {
                        if (!model.pendingEdgeSourceNodeId || model.pendingEdgeSourceNodeId === selectedNode.id) return;
                        if (model.onConnectLogicNodes) model.onConnectLogicNodes(selectedGraph.id, model.pendingEdgeSourceNodeId, selectedNode.id);
                    }, className: (!model.pendingEdgeSourceNodeId || model.pendingEdgeSourceNodeId === selectedNode.id) ? "disabled-action" : "" },
                    { label: "Clear Source", onClick: function clearSource() {
                        if (model.onMarkLogicEdgeSource) model.onMarkLogicEdgeSource(null);
                    }, className: model.pendingEdgeSourceNodeId ? "" : "disabled-action" },
                    { label: "Delete Node", onClick: function removeNode() {
                        if (model.onDeleteGraphNode) model.onDeleteGraphNode(selectedGraph.id, selectedNode.id);
                    }, className: "danger" }
                ]);
            } else if (selectedNode.type === "switchStep" || selectedNode.type === "timedTarget" || selectedNode.type === "lamp") {
                appendActionRow(detail, [
                    { label: selectedNode.type === "lamp" ? "Use Selected Light" : "Use Selected Object", onClick: function assignCore() {
                        if (assignDisabled || !model.onAssignSelectedToLogicNode) return;
                        model.onAssignSelectedToLogicNode({
                            id: selectedNode.id,
                            graphId: selectedGraph.id
                        });
                    }, className: assignDisabled ? "disabled-action" : "" }
                ]);
            }
        } else if (activeLogicSubtab === "advanced") {
            const detail = appendSection(container, "Selected Item");
            appendSmallText(detail, "Select a flow item to edit its details.");
        }
        }

        function renderRuleValidationAndSwitchMap(container, model) {
        const rulesEngine = model.table.rulesEngine || { switchMap: [], sequenceRules: [] };
        const ruleOptions = {
            eventTypes: ["switchClosed", "switchOpened", "score", "ballDrained", "plungerReleased"],
            elementIds: (model.elements || []).map(function map(element) { return element.id; }).filter(Boolean),
            switchIds: (model.elements || []).map(function map(element) { return element.id; }).filter(Boolean)
                .concat((rulesEngine.switchMap || []).map(function map(mapping) { return mapping && mapping.switchId; }).filter(Boolean))
                .concat((rulesEngine.triggers || []).map(function map(trigger) { return trigger && trigger.switchId; }).filter(Boolean))
        };
        const validation = Pin.rules && Pin.rules.validate ? Pin.rules.validate(model.table) : [];
        const validationSection = appendSection(container, "Validation");
        const validationCount = document.createElement("p");
        validationCount.className = "small";
        validationCount.textContent = validation.length + " issue" + (validation.length === 1 ? "" : "s");
        validationSection.appendChild(validationCount);
        if (!validation.length) {
            appendSmallText(validationSection, "No rule issues found");
        } else {
            validation.forEach(function each(issue) {
                const row = document.createElement("div");
                row.className = "validation-row " + (issue.severity || "warning");
                row.textContent = (issue.severity || "warning") + ": " + issue.message;
                if (issue.ruleId && model.onFocusValidationIssue) {
                    row.tabIndex = 0;
                    row.onclick = function focusIssue() { model.onFocusValidationIssue(issue); };
                }
                validationSection.appendChild(row);
            });
        }

        const mappings = appendSection(container, "Switch Map");
        appendActionRow(mappings, [
            { label: "Add Mapping", onClick: model.onAddSwitchMap }
        ]);
        (rulesEngine.switchMap || []).forEach(function each(mapping, index) {
            const group = document.createElement("div");
            group.className = "anchor-card";
            const mapDraftKey = "switchMap:" + index;
            const mapDraftState = getDraftState(model, mapDraftKey, Pin.editorTools.clone(mapping));
            appendField(group, "eventType", mapDraftState.value.eventType || "", function patch(value) { patchDraftValue(model, mapDraftKey, "eventType", value); }, optionList(ruleOptions.eventTypes, true));
            appendField(group, "sourceId", mapDraftState.value.sourceId || "", function patch(value) { patchDraftValue(model, mapDraftKey, "sourceId", value); }, optionList(ruleOptions.elementIds, true));
            appendField(group, "switchId", mapDraftState.value.switchId || "", function patch(value) { patchDraftValue(model, mapDraftKey, "switchId", value); }, optionList(ruleOptions.switchIds, true));
            appendDraftActions(group, mapDraftKey, mapDraftState.dirty, function saveSwitchMap() {
                if (model.onSaveSwitchMapDraft) model.onSaveSwitchMapDraft(mapDraftKey, index, mapDraftState.value);
            }, function resetSwitchMap() {
                if (model.onResetCardDraft) model.onResetCardDraft(mapDraftKey);
            });
            appendActionRow(group, [
                { label: "Remove Mapping", onClick: function remove() { model.onRemoveSwitchMap(index); }, className: "danger" }
            ]);
            mappings.appendChild(group);
        });
        }

        function renderRuleEditor(container, model, title, options) {
        const opts = options || {};
        const rulesEngine = model.table.rulesEngine || { switchMap: [], sequenceRules: [] };
        const sequenceRules = rulesEngine.sequenceRules || [];
        const rulesSection = appendSection(container, title || "Sequence Detail");
        if (!opts.compact) {
            appendActionRow(rulesSection, [
                { label: "Add Sequence", onClick: model.onAddSequenceRule }
            ]);
            const ruleCount = document.createElement("p");
            ruleCount.className = "small";
            ruleCount.textContent = sequenceRules.length + " sequence rule" + (sequenceRules.length === 1 ? "" : "s");
            rulesSection.appendChild(ruleCount);
        }
        if (!opts.compact && !sequenceRules.length) {
            appendSmallText(rulesSection, "No rules yet");
        } else if (!opts.compact) {
            sequenceRules.forEach(function each(rule) {
                const row = document.createElement("div");
                row.className = "layer-row rule-row" + (model.selectedRuleId === rule.id ? " active" : "");
                const pick = document.createElement("button");
                pick.className = "layer-pick";
                pick.textContent = (rule.name || rule.id) + (rule.enabled === false ? " disabled" : "");
                pick.onclick = function pickRule() { model.onSelectRule(rule.id); };
                const controls = document.createElement("div");
                controls.className = "mini-actions";
                [
                    { label: "copy", onClick: function copyRule() { model.onDuplicateRule(rule.id); } },
                    { label: "\u2715", onClick: function deleteRule() { model.onDeleteRule(rule.id); } }
                ].forEach(function eachAction(action) {
                    const button = document.createElement("button");
                    button.textContent = action.label;
                    button.onclick = action.onClick;
                    controls.appendChild(button);
                });
                row.appendChild(pick);
                row.appendChild(controls);
                rulesSection.appendChild(row);
            });
        }

        const selectedRule = sequenceRules.find(function find(rule) { return rule.id === model.selectedRuleId; }) || sequenceRules[0];
        if (selectedRule) {
            const matchingGraph = (model.logicGraphs || []).find(function find(graph) {
                return graph && graph.sourceRuleId === selectedRule.id;
            }) || null;
            const edit = appendSection(container, "Rule Detail");
            const ruleDraftKey = "rule:" + selectedRule.id;
            const ruleDraftState = getDraftState(model, ruleDraftKey, Pin.editorTools.clone(selectedRule));
            appendField(edit, "enabled", ruleDraftState.value.enabled !== false, function patch(value) { patchDraftValue(model, ruleDraftKey, "enabled", value); });
            appendField(edit, "name", ruleDraftState.value.name || "", function patch(value) { patchDraftValue(model, ruleDraftKey, "name", value); });
            appendField(edit, "ordered", ruleDraftState.value.ordered !== false, function patch(value) { patchDraftValue(model, ruleDraftKey, "ordered", value); });
            appendSmallText(edit, "Use Builder above for step order, trigger objects, target binding, and lamps.");
            appendField(edit, "windowSeconds", ruleDraftState.value.windowSeconds || 8, function patch(value) { patchDraftValue(model, ruleDraftKey, "windowSeconds", value); });
            appendField(edit, "awardPoints", ruleDraftState.value.awardPoints || 0, function patch(value) { patchDraftValue(model, ruleDraftKey, "awardPoints", value); });
            appendField(edit, "awardEvent", ruleDraftState.value.awardEvent || "ruleAwarded", function patch(value) { patchDraftValue(model, ruleDraftKey, "awardEvent", value); });
            appendField(edit, "resetOnDrain", ruleDraftState.value.resetOnDrain !== false, function patch(value) { patchDraftValue(model, ruleDraftKey, "resetOnDrain", value); });
            appendField(edit, "resetOnComplete", ruleDraftState.value.resetOnComplete !== false, function patch(value) { patchDraftValue(model, ruleDraftKey, "resetOnComplete", value); });
            appendField(edit, "resetOnWrongOrder", !!ruleDraftState.value.resetOnWrongOrder, function patch(value) { patchDraftValue(model, ruleDraftKey, "resetOnWrongOrder", value); });
            appendDraftActions(edit, ruleDraftKey, ruleDraftState.dirty, function saveRule() {
                if (model.onSaveRuleDraft) model.onSaveRuleDraft(ruleDraftKey, selectedRule.id, ruleDraftState.value);
            }, function resetRule() {
                if (model.onResetCardDraft) model.onResetCardDraft(ruleDraftKey);
            });
            appendActionRow(edit, [
                { label: "Delete Sequence", onClick: function removeRule() { if (model.onDeleteRule) model.onDeleteRule((matchingGraph && matchingGraph.id) || selectedRule.id); }, className: "danger" }
            ]);
        }
        }
        
        function renderRulesTab() {
        renderRuleEditor(container, model, "Rules");
        }

        function renderPropertiesTab() {
        const selected = model.selected;
        const selectionSection = appendSection(container, "Selection");
        if (!selected) {
            appendSmallText(selectionSection, "Nothing selected");
            return;
        }

        const summaryCard = document.createElement("div");
        summaryCard.className = "anchor-card property-summary-card";
        const summaryTop = document.createElement("div");
        summaryTop.className = "property-summary-top";
        summaryTop.appendChild(makeElementIcon(selected.type));
        const summaryText = document.createElement("div");
        summaryText.className = "property-summary-text";
        const summaryTitle = document.createElement("strong");
        summaryTitle.textContent = elementLabelOnly(selected);
        const summaryMeta = document.createElement("div");
        summaryMeta.className = "property-summary-meta";
        summaryMeta.textContent = selected.id;
        summaryText.appendChild(summaryTitle);
        summaryText.appendChild(summaryMeta);
        summaryTop.appendChild(summaryText);
        const typeBadge = document.createElement("span");
        typeBadge.className = "property-type-badge";
        typeBadge.textContent = labelForType(selected.type);
        summaryTop.appendChild(typeBadge);
        summaryCard.appendChild(summaryTop);
        selectionSection.appendChild(summaryCard);

        appendActionRow(summaryCard, [
            { label: "Frame", onClick: model.onFrameSelected },
            { label: "Duplicate", onClick: model.onDuplicateSelected },
            { label: "Delete", onClick: model.onDeleteSelected, className: "danger" }
        ]);

        const module = Pin.elements && Pin.elements.registry ? Pin.elements.registry[selected.type] : null;
        const configuredFields = module && module.editor && Array.isArray(module.editor.inspectorFields) ? module.editor.inspectorFields : null;
        const hiddenLegacyFields = hiddenLegacyInspectorFields(selected.type);
        const fallbackDefaults = {
            launcher: {
                valve: false
            },
            flipper: {
                length: 95,
                restAngle: -0.5,
                activeAngle: -1.1,
                flipSpeed: 24,
                flipAccel: 220,
                returnSpeed: 18,
                returnAccel: 160,
                strikeBoost: 0.52,
                tipStrikeBoost: 0.68,
                surfaceRestitution: 0.28,
                surfaceFriction: 0.08,
                tipRestitution: 0.38,
                tipFriction: 0.04
            }
        };
        const rendered = {};
        const selectedDraftKey = "selected:" + selected.id;
        const selectedDraftState = getDraftState(model, selectedDraftKey, Pin.editorTools.clone(selected));
        const rootFieldsCard = document.createElement("div");
        rootFieldsCard.className = "anchor-card property-card";
        appendCardTitle(rootFieldsCard, "Core Properties");
        selectionSection.appendChild(rootFieldsCard);
        const nestedCards = {};
        const fieldEntries = [];

        function readField(path) {
            const current = Pin.editorTools.getByPath(selectedDraftState.value, path);
            // Launcher valve must stay boolean so the editor renders a checkbox rather than text.
            if (selected.type === "launcher" && path === "valve") {
                if (current === undefined || current === null || current === "") return false;
                if (typeof current === "string") return current !== "false" && current !== "0";
                return !!current;
            }
            if (selected.type === "gate" && (path === "swingStartAngle" || path === "swingEndAngle") && current === undefined) {
                const restAngle = typeof selectedDraftState.value.angle === "number" ? selectedDraftState.value.angle : 0;
                const maxAngle = Math.abs(typeof selectedDraftState.value.maxAngle === "number" ? selectedDraftState.value.maxAngle : 1.05);
                return path === "swingStartAngle" ? restAngle - maxAngle : restAngle + maxAngle;
            }
            if (current !== undefined) return current;
            const byType = fallbackDefaults[selected.type] || {};
            if (Object.prototype.hasOwnProperty.call(byType, path)) return byType[path];
            return current;
        }

        function queueField(path, label, groupKey) {
            if (rendered[path]) return;
            rendered[path] = true;
            fieldEntries.push({
                path: path,
                label: label || path,
                groupKey: groupKey || "",
                tabId: propertyTabForField(path),
                options: null
            });
        }

        queueField("name", "name");

        const customFieldConfig = customInspectorFieldConfig(selected.type);
        if (customFieldConfig && customFieldConfig.length) {
            customFieldConfig.forEach(function each(entry) {
                queueField(entry.path, entry.label, entry.groupKey);
                if (entry.options && fieldEntries.length) fieldEntries[fieldEntries.length - 1].options = entry.options;
            });
        }

        if (configuredFields && configuredFields.length) {
            configuredFields.forEach(function each(path) {
                const dot = path.indexOf(".");
                queueField(path, dot >= 0 ? path.slice(dot + 1) : path, dot >= 0 ? path.slice(0, dot) : "");
            });
        }

        Object.keys(selected).forEach(function each(key) {
            if (key === "id" || key === "type") return;
            if (hiddenLegacyFields && hiddenLegacyFields[key]) return;
            if (Array.isArray(selected[key])) return;
            const value = selected[key];
            if (value && typeof value === "object") {
                Object.keys(value).forEach(function eachNested(childKey) {
                    if (hiddenLegacyFields && hiddenLegacyFields[key + "." + childKey]) return;
                    queueField(key + "." + childKey, childKey, key);
                });
                return;
            }
            queueField(key, key);
        });

        const availableTabs = ["layout", "physics", "contact", "visual", "meta"].filter(function filter(tabId) {
            return fieldEntries.some(function some(entry) { return entry.tabId === tabId; });
        });
        const activePropertyTab = availableTabs.indexOf(model.propertySubtab || "") >= 0 ? (model.propertySubtab || "") : (availableTabs[0] || "layout");
        if (availableTabs.length > 1) {
            const tabRow = document.createElement("div");
            tabRow.className = "property-subtabs";
            availableTabs.forEach(function each(tabId) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = activePropertyTab === tabId ? "active" : "";
                button.textContent = propertyTabLabel(tabId);
                button.onclick = function chooseTab() {
                    if (model.onSetPropertySubtab) model.onSetPropertySubtab(tabId);
                };
                tabRow.appendChild(button);
            });
            rootFieldsCard.appendChild(tabRow);
        }
        const tabGroups = {};
        fieldEntries.forEach(function each(entry) {
            if (!tabGroups[entry.tabId]) tabGroups[entry.tabId] = {};
            const key = entry.groupKey || "_root";
            if (!tabGroups[entry.tabId][key]) tabGroups[entry.tabId][key] = [];
            tabGroups[entry.tabId][key].push(entry);
        });
        availableTabs.forEach(function eachTab(tabId) {
            const pane = document.createElement("div");
            pane.className = "property-tab-pane" + (activePropertyTab === tabId ? " active" : "");
            const groups = tabGroups[tabId] || {};
            Object.keys(groups).forEach(function eachGroup(groupKey) {
                const target = groupKey === "_root" ? pane : (function makeGroup() {
                    const groupCard = document.createElement("div");
                    groupCard.className = "property-subgroup";
                    appendCardTitle(groupCard, groupKey);
                    pane.appendChild(groupCard);
                    return groupCard;
                })();
                groups[groupKey].forEach(function eachField(entry) {
                    appendField(target, entry.label, readField(entry.path), function patchValue(nextValue) {
                        patchDraftValue(model, selectedDraftKey, entry.path, nextValue);
                    }, entry.options);
                });
            });
            rootFieldsCard.appendChild(pane);
        });

        function renderAnchorList(key) {
            const list = selected[key];
            if (!Array.isArray(list)) return;
            if (selected.type !== "path" && selected.type !== "ramp" && selected.type !== "kicker") return;
            const anchorSection = document.createElement("div");
            anchorSection.className = "anchor-card property-card";
            appendCardTitle(anchorSection, key, list.length + " point" + (list.length === 1 ? "" : "s"));
            selectionSection.appendChild(anchorSection);
            list.forEach(function eachAnchor(a, i) {
                const group = document.createElement("div");
                group.className = "anchor-card compact-anchor-card";
                const anchorDraftKey = "anchor:" + selected.id + ":" + key + ":" + i;
                const anchorDraftState = getDraftState(model, anchorDraftKey, selected.type === "kicker" ? { x: a.x, y: a.y, radius: typeof a.radius === "number" ? a.radius : (selected.radius || 14) } : { x: a.x, y: a.y });
                const row = document.createElement("div");
                row.className = "anchor-row";
                row.innerHTML = '<span>Point ' + i + "</span>" +
                    "<span>" + (a.inHandle ? "in" : "-") + "/" + (a.outHandle ? "out" : "-") + "</span>";
                const rm = document.createElement("button");
                rm.textContent = "remove";
                rm.onclick = function removeAnchor() { model.onRemoveAnchor(key, i); };
                row.appendChild(rm);
                group.appendChild(row);
                appendField(group, "x", anchorDraftState.value.x, function patchX(value) { patchDraftValue(model, anchorDraftKey, "x", value); });
                appendField(group, "y", anchorDraftState.value.y, function patchY(value) { patchDraftValue(model, anchorDraftKey, "y", value); });
                if (selected.type === "kicker") {
                    appendField(group, "radius", anchorDraftState.value.radius, function patchRadius(value) { patchDraftValue(model, anchorDraftKey, "radius", value); });
                }
                appendDraftActions(group, anchorDraftKey, anchorDraftState.dirty, function saveAnchor() {
                    if (model.onSaveAnchorDraft) model.onSaveAnchorDraft(anchorDraftKey, key, i, anchorDraftState.value);
                }, function resetAnchor() {
                    if (model.onResetCardDraft) model.onResetCardDraft(anchorDraftKey);
                });
                anchorSection.appendChild(group);
            });
            appendActionRow(anchorSection, [
                { label: "Add " + key, onClick: function addAnchor() { model.onAddAnchor(key); } }
            ]);
        }
        renderAnchorList("anchors");
        renderAnchorList("leftAnchors");
        renderAnchorList("rightAnchors");

        const relations = collectElementRelations(model.table, selected);
        const relationSection = appendSection(container, "Logic Links");
        if (!relations.length) {
            appendSmallText(relationSection, "No logic references for this object");
        } else {
            relations.forEach(function each(relation) {
                const row = document.createElement("div");
                row.className = "validation-row info";
                row.textContent = relationText(relation);
                relationSection.appendChild(row);
            });
        }
        appendDraftActions(rootFieldsCard, selectedDraftKey, selectedDraftState.dirty, function saveSelected() {
            if (model.onSaveSelectedDraft) model.onSaveSelectedDraft(selectedDraftKey, selectedDraftState.value);
        }, function resetSelected() {
            if (model.onResetCardDraft) model.onResetCardDraft(selectedDraftKey);
        });
        }

        if (activeTab === "table") renderTableTab();
        else if (activeTab === "layers") renderLayersTab();
        else if (activeTab === "assistant") renderAssistantTab();
        else if (activeTab === "rules" || activeTab === "logic") renderLogicTab();
        else renderPropertiesTab();
    }

    Pin.editorPanels = {
        renderPalette: renderPalette,
        renderInspector: renderInspector
    };
})(window.Pin);
