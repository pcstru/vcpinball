(function initEditorPanels(Pin) {
    function isAngleField(labelText) {
        return /(^|\.)(restAngle|activeAngle|angle|maxAngle|swingStartAngle|swingEndAngle|swingAngle)$/i.test(labelText) ||
            /^(rest angle|active angle|swing start angle|swing end angle|swing limit|opening angle)$/i.test(labelText);
    }

    function isColorField(labelText) {
        return /(^|\.|\s)(color|glowColor|pinColor)$/i.test(labelText);
    }

    function isSecretField(labelText) {
        return /(^|\.)(apiKey|token|secret|password)$/i.test(labelText);
    }
    function isTextualField(labelText) {
        return /(^|\.)(text|label|name)$/i.test(labelText);
    }

    function defaultStepForField(labelText, value) {
        if (typeof value !== "number") return "any";
        if (isAngleField(labelText)) return "1";
        if (/(\.|^)(gravity|friction|restitution|opacity|scale|surfaceRestitution|surfaceFriction|tipRestitution|tipFriction|strikeBoost|tipStrikeBoost)$/i.test(labelText)) return "0.01";
        if (/(\.|^)(flipSpeed|flipAccel|returnSpeed|returnAccel|maxPower|maxRetract|pullSpeed|springStrength|windowSeconds|awardPoints|balls|width|height|radius|size|length|thickness|bandThickness|x|y|offsetX|offsetY|top|bottom)$/i.test(labelText)) return "1";
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
        } else if (typeof value === "number" && !isTextualField(labelText)) {
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

    /*
     * What: Render a searchable model picker backed by provider-discovered models.
     * Why: Some providers return long model lists; search keeps selection usable while
     *      preserving a separate free-text model field for manual overrides.
     * Correctness: Selecting an option writes directly to assistant settings `model`,
     *              which remains the single source of truth used by Save Provider.
     */
    function appendSearchableModelPicker(container, labelText, models, selectedValue, onChoose) {
        const row = document.createElement("div");
        row.className = "field-row";
        const label = document.createElement("span");
        label.className = "field-label";
        label.textContent = labelText;
        row.appendChild(label);

        const pickerWrap = document.createElement("div");
        pickerWrap.style.display = "flex";
        pickerWrap.style.flexDirection = "column";
        pickerWrap.style.gap = "6px";

        const searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.placeholder = "Search discovered models";
        searchInput.value = "";

        const select = document.createElement("select");

        function modelId(item) {
            const raw = item && (item.id != null ? item.id : item.value);
            return raw == null ? "" : String(raw);
        }

        function modelLabel(item) {
            if (!item) return "";
            const label = item.label != null ? item.label : (item.id != null ? item.id : item.value);
            return label == null ? "" : String(label);
        }

        function refreshOptions() {
            const search = String(searchInput.value || "").trim().toLowerCase();
            const filtered = (models || []).filter(function keep(item) {
                const id = modelId(item);
                const labelText = modelLabel(item);
                if (!search) return true;
                return id.toLowerCase().indexOf(search) >= 0 || labelText.toLowerCase().indexOf(search) >= 0;
            });

            const previousValue = select.value || "";
            select.innerHTML = "";
            if (!filtered.length) {
                const none = document.createElement("option");
                none.value = "";
                none.textContent = "(no matching discovered models)";
                select.appendChild(none);
                select.disabled = true;
                return;
            }

            select.disabled = false;
            const blank = document.createElement("option");
            blank.value = "";
            blank.textContent = "(choose discovered model)";
            select.appendChild(blank);
            filtered.forEach(function each(item) {
                const option = document.createElement("option");
                option.value = modelId(item);
                option.textContent = modelLabel(item);
                select.appendChild(option);
            });

            const current = selectedValue == null ? "" : String(selectedValue);
            if (current && filtered.some(function has(item) { return modelId(item) === current; })) {
                select.value = current;
            } else if (previousValue && filtered.some(function has(item) { return modelId(item) === previousValue; })) {
                select.value = previousValue;
            } else {
                select.value = "";
            }
        }

        searchInput.oninput = refreshOptions;
        select.onchange = function chooseModel() {
            onChoose(select.value);
        };

        refreshOptions();
        pickerWrap.appendChild(searchInput);
        pickerWrap.appendChild(select);
        row.appendChild(pickerWrap);
        container.appendChild(row);
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
        if (path === "name" || path === "level" || path === "side" || path === "control" || path === "role" || path === "direction" || path === "capacity" || path === "closed") {
            return "meta";
        }
        if (/(^|\.)(color|glowColor|pinColor|label|lampId|bandThickness)$/.test(path)) {
            return "visual";
        }
        if (/(^|\.)(surfaceRestitution|surfaceFriction|strikeBoost|thickness|rootRadius|tipRadius)$/.test(path)) {
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
                { path: "rootRadius", label: "root radius", groupKey: "Blade" },
                { path: "tipRadius", label: "tip radius", groupKey: "Blade" },
                { path: "restAngle", label: "rest angle", groupKey: "Blade" },
                { path: "activeAngle", label: "active angle", groupKey: "Blade" },
                { path: "flipSpeed", label: "flip speed", groupKey: "Stroke" },
                { path: "flipAccel", label: "flip accel", groupKey: "Stroke" },
                { path: "returnSpeed", label: "return speed", groupKey: "Stroke" },
                { path: "returnAccel", label: "return accel", groupKey: "Stroke" },
                { path: "strikeBoost", label: "strike boost", groupKey: "Contact" },
                { path: "surfaceRestitution", label: "surface restitution", groupKey: "Contact" },
                { path: "surfaceFriction", label: "surface friction", groupKey: "Contact" },
                { path: "color", label: "body color", groupKey: "Appearance" },
                { path: "glowColor", label: "glow color", groupKey: "Appearance" },
                { path: "bodyColor", label: "body start color", groupKey: "Appearance" },
                { path: "tipColor", label: "tip color", groupKey: "Appearance" },
                { path: "strokeColor", label: "stroke color", groupKey: "Appearance" },
                { path: "pivotColor", label: "pivot color", groupKey: "Appearance" },
                { path: "highlightColor", label: "highlight color", groupKey: "Appearance" },
                { path: "glowStrength", label: "glow strength", groupKey: "Appearance" },
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
                { path: "returnSpeed", label: "return speed", groupKey: "Spring" }
            ],
            path: [
                { path: "role", label: "role", groupKey: "Shape" },
                { path: "closed", label: "closed", groupKey: "Shape" },
                { path: "thickness", label: "thickness", groupKey: "Shape" },
                { path: "restitution", label: "restitution", groupKey: "Physics" },
                { path: "color", label: "color", groupKey: "Appearance" },
                { path: "transparency", label: "transparency", groupKey: "Appearance" }
            ],
            bumper: [
                { path: "radius", label: "radius", groupKey: "Shape" },
                { path: "power", label: "power", groupKey: "Physics" },
                { path: "restitution", label: "restitution", groupKey: "Physics" },
                { path: "score", label: "score", groupKey: "Physics" },
                { path: "color", label: "color", groupKey: "Appearance" },
                { path: "transparency", label: "transparency", groupKey: "Appearance" }
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
                { path: "label", label: "label", groupKey: "Text" },
                { path: "color", label: "color", groupKey: "Appearance" },
                { path: "transparency", label: "transparency", groupKey: "Appearance" }
            ],
            arrowLight: [
                { path: "w", label: "width", groupKey: "Shape" },
                { path: "h", label: "height", groupKey: "Shape" },
                { path: "angle", label: "angle", groupKey: "Shape" },
                { path: "lampId", label: "lamp id", groupKey: "Logic" },
                { path: "text", label: "text", groupKey: "Text" },
                { path: "label", label: "label", groupKey: "Text" },
                { path: "color", label: "color", groupKey: "Appearance" },
                { path: "transparency", label: "transparency", groupKey: "Appearance" }
            ],
            boxLight: [
                { path: "w", label: "width", groupKey: "Shape" },
                { path: "h", label: "height", groupKey: "Shape" },
                { path: "angle", label: "angle", groupKey: "Shape" },
                { path: "cornerRadius", label: "corner radius", groupKey: "Shape" },
                { path: "lampId", label: "lamp id", groupKey: "Logic" },
                { path: "text", label: "text", groupKey: "Text" },
                { path: "label", label: "label", groupKey: "Text" },
                { path: "color", label: "color", groupKey: "Appearance" },
                { path: "transparency", label: "transparency", groupKey: "Appearance" }
            ],
            dropTarget: [
                { path: "w", label: "width", groupKey: "Shape" },
                { path: "h", label: "height", groupKey: "Shape" },
                { path: "angle", label: "angle", groupKey: "Shape" },
                { path: "restitution", label: "restitution", groupKey: "Physics" },
                { path: "score", label: "score", groupKey: "Physics" },
                { path: "color", label: "color", groupKey: "Appearance" },
                { path: "transparency", label: "transparency", groupKey: "Appearance" }
            ],
            gate: [
                { path: "x", label: "x", groupKey: "Shape" },
                { path: "y", label: "y", groupKey: "Shape" },
                { path: "length", label: "length", groupKey: "Shape" },
                { path: "angle", label: "angle", groupKey: "Shape" },
                { path: "direction", label: "direction", groupKey: "Setup" },
                { path: "open", label: "open", groupKey: "Setup" },
                { path: "locked", label: "locked", groupKey: "Setup" },
                { path: "swingAngle", label: "opening angle", groupKey: "Hinge" },
                { path: "returnStrength", label: "return spring", groupKey: "Hinge" },
                { path: "returnDamping", label: "return damping", groupKey: "Hinge" },
                { path: "thickness", label: "thickness", groupKey: "Shape" },
                { path: "restitution", label: "restitution", groupKey: "Contact" },
                { path: "color", label: "color", groupKey: "Appearance" },
                { path: "pinColor", label: "pin color", groupKey: "Appearance" }
            ],
            spinner: [
                { path: "x", label: "x", groupKey: "Shape" },
                { path: "y", label: "y", groupKey: "Shape" },
                { path: "radius", label: "radius", groupKey: "Shape" },
                { path: "angle", label: "angle", groupKey: "Shape" },
                { path: "damping", label: "damping", groupKey: "Physics" },
                { path: "score", label: "score", groupKey: "Physics" },
                { path: "color", label: "color", groupKey: "Appearance" }
            ],
            lane: [
                { path: "x", label: "x", groupKey: "Shape" },
                { path: "y", label: "y", groupKey: "Shape" },
                { path: "w", label: "width", groupKey: "Shape" },
                { path: "h", label: "height", groupKey: "Shape" },
                { path: "angle", label: "angle", groupKey: "Shape" },
                { path: "score", label: "score", groupKey: "Physics" },
                { path: "label", label: "label", groupKey: "Appearance" },
                { path: "color", label: "color", groupKey: "Appearance" },
                { path: "opacity", label: "opacity", groupKey: "Appearance" }
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
                { path: "pitColor", label: "pit color", groupKey: "Appearance" },
                { path: "opacity", label: "opacity", groupKey: "Appearance" }
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
                drivenSettleBias: true,
                tipStrikeBoost: true,
                tipRestitution: true,
                tipFriction: true
            },
            spinner: {
                size: true,
                length: true
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

    function normalizeGateDirection(value) {
        const raw = String(value || "").toLowerCase();
        if (raw === "reverse") return "reverse";
        if (raw === "twoway" || raw === "two-way" || raw === "two_way" || raw === "both") return "twoWay";
        return "forward";
    }

    function patchGateDraftValue(model, key, draftValue, path, value) {
        patchDraftValue(model, key, path, value);
        if (path === "swingAngle") {
            const angle = typeof draftValue.swingStartAngle === "number" ? draftValue.swingStartAngle : (typeof draftValue.angle === "number" ? draftValue.angle : 0);
            patchDraftValue(model, key, "swingEndAngle", angle + value);
            return;
        }
        if (path !== "direction") return;
        const previous = normalizeGateDirection(draftValue && draftValue.direction);
        const next = normalizeGateDirection(value);
        if (previous === next || next === "twoWay") return;
        if ((previous !== "forward" && previous !== "reverse") || (next !== "forward" && next !== "reverse")) return;
        const angle = typeof draftValue.swingStartAngle === "number" ? draftValue.swingStartAngle : (typeof draftValue.angle === "number" ? draftValue.angle : 0);
        const span = typeof draftValue.swingAngle === "number" ? draftValue.swingAngle :
            (typeof draftValue.swingEndAngle === "number" ? draftValue.swingEndAngle - angle : 1.05);
        patchDraftValue(model, key, "swingAngle", -span);
        patchDraftValue(model, key, "swingEndAngle", angle - span);
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
                const eventKind = entry.kind || entry.stage || "event";
                const flow = entry.flow ? (" | flow " + entry.flow) : "";
                const phase = entry.phase ? (" | phase " + entry.phase) : "";
                const level = entry.level ? (" | " + entry.level) : "";
                meta.textContent = entry.at + " - " + eventKind + flow + phase + level;
                if (entry.summary) {
                    const summary = document.createElement("div");
                    summary.className = "small";
                    summary.textContent = entry.summary;
                    card.appendChild(summary);
                }
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

    function renderTabBar(container, activeTab, onSetTab, onPlay, onLogic, onLab) {
        const tabs = document.createElement("div");
        tabs.className = "sidebar-tabs";
        [
            { id: "properties", label: "Properties" },
            { id: "layers", label: "Levels" },
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
        if (onLogic) {
            const logicButton = document.createElement("button");
            logicButton.textContent = "Logic";
            logicButton.onclick = onLogic;
            tabs.appendChild(logicButton);
        }
        if (onLab) {
            const labButton = document.createElement("button");
            labButton.textContent = "Lab";
            labButton.onclick = onLab;
            tabs.appendChild(labButton);
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
        if (activeTool === "pen" && actions && actions.pen) {
            const penSection = appendSection(container, "Pen");
            appendField(penSection, "color", actions.pen.color || "#a8b5ea", function setPenColor(value) {
                if (actions.pen.onSetColor) actions.pen.onSetColor(value);
            });
            appendField(penSection, "width", typeof actions.pen.thickness === "number" ? actions.pen.thickness : 6, function setPenWidth(value) {
                if (actions.pen.onSetThickness) actions.pen.onSetThickness(value);
            });
        }
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
        renderTabBar(
            container,
            activeTab,
            model.onSetTab || function noop() {},
            model.onTestPlay,
            model.onOpenLogicStudio,
            model.onOpenPhysicsLab
        );

        function renderTableTab() {
        const tableSection = appendSection(container, "Table");
        const tablePaths = [
            "name",
            "tableVersion",
            "date",
            "playfield.width",
            "playfield.height",
            "playfield.ballRadius",
            "playfield.gravity",
            "playfield.friction",
            "playfield.restitution",
            "playfield.maxSpeed",
            "playfield.realTimeScale",
            "playfield.tilt.enabled",
            "playfield.tilt.impulseX",
            "playfield.tilt.impulseY",
            "playfield.tilt.cooldownSeconds",
            "playfield.tilt.warningWindowSeconds",
            "playfield.tilt.warningLimit",
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
            { label: "Save Slot1", onClick: model.onSaveSlot1 },
            { label: "Wipe Browser Memory", onClick: model.onWipeBrowserMemory, className: "danger" }
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
        appendSmallText(assistantSection, "Assistant can generate structured table/logic patches from provider responses. Current logic workflow remains feature-first in the Logic workspace.");
        const assistantState = model.assistant || { settings: {}, messages: [], draft: "", busy: false, error: "", lastPatch: null };
        const runStatus = assistantState.runStatus || { flow: "idle", phase: "idle", summary: "Idle", attempt: 0, maxSteps: 0, at: "" };
        const assistantSubtabs = document.createElement("div");
        assistantSubtabs.className = "assistant-subtabs";
        [
            { id: "chat", label: "Chat" },
            { id: "agentic", label: "Agentic" },
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
        appendField(settingsSection, "model", settingsDraftState.value.model || "", function patch(value) {
            patchDraftValue(model, settingsKey, "model", value);
            if (model.onAutoSaveAssistantModel) model.onAutoSaveAssistantModel(value);
        });
        const discoveredModels = optionList((assistantState.availableModels || []).map(function map(item) {
            return { value: item.id, label: item.label || item.id };
        }), false);
        if (discoveredModels.length) {
            appendSearchableModelPicker(
                settingsSection,
                "modelDropdown",
                discoveredModels,
                settingsDraftState.value.model || "",
                function chooseDiscoveredModel(value) {
                    if (!value) return;
                    patchDraftValue(model, settingsKey, "model", value);
                    if (model.onAutoSaveAssistantModel) model.onAutoSaveAssistantModel(value);
                }
            );
        } else {
            appendSmallText(settingsSection, "No discovered models loaded. Use Load Models to fetch provider model IDs.");
        }
        appendSmallText(settingsSection, "Warning: provider settings persist in browser localStorage on this machine.");
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
        appendActionRow(settingsSection, [
            { label: "Show Log", onClick: model.onOpenAssistantLog, disabled: false }
        ]);
        return;
        }

        if ((model.assistantSubtab || "chat") === "agentic") {
        const agenticSection = appendSection(container, "Agentic");
        appendSmallText(agenticSection, "Multi-step flow for feature-first table logic and design edits. It can use provider-backed structured patches, stage pending batches, or auto-apply when enabled.");
        const agenticKey = "assistant:agentic";
        const agenticDraftState = getDraftState(model, agenticKey, {
            fullyAuto: assistantState.agenticFullyAuto !== false,
            approveEachChange: !!assistantState.agenticApproveEachChange
        });
        appendField(agenticSection, "Fully Auto", !!agenticDraftState.value.fullyAuto, function patch(value) {
            patchDraftValue(model, agenticKey, "fullyAuto", value);
        });
        appendField(agenticSection, "Approve Each Batch", !!agenticDraftState.value.approveEachChange, function patch(value) {
            patchDraftValue(model, agenticKey, "approveEachChange", value);
        });
        appendDraftActions(agenticSection, agenticKey, agenticDraftState.dirty, function saveAgenticMode() {
            if (model.onSaveAgenticModeDraft) model.onSaveAgenticModeDraft(agenticKey, agenticDraftState.value);
        }, function resetAgenticMode() {
            if (model.onResetCardDraft) model.onResetCardDraft(agenticKey);
        });
        const agenticComposer = document.createElement("textarea");
        agenticComposer.className = "assistant-composer";
        agenticComposer.placeholder = "Describe a feature-first logic or table-editing task for the Agentic loop.";
        agenticComposer.value = assistantState.agenticDraft || "";
        agenticComposer.oninput = function updateAgenticDraft() {
            if (model.onSetAgenticDraft) model.onSetAgenticDraft(agenticComposer.value);
        };
        agenticSection.appendChild(agenticComposer);
        appendActionRow(agenticSection, [
            { label: assistantState.agenticRunning ? "Running..." : "Run", onClick: model.onRunAgentic, disabled: !!assistantState.busy || !!assistantState.agenticRunning },
            { label: "Stop", onClick: model.onStopAgentic, disabled: !assistantState.agenticRunning },
            { label: "Apply Pending", onClick: model.onApplyAgenticPendingPatch, disabled: !assistantState.agenticPendingPatch },
            { label: "Reject Pending", onClick: model.onRejectAgenticPendingPatch, disabled: !assistantState.agenticPendingPatch }
        ]);
        appendSmallText(agenticSection, "Run status: " + (runStatus.flow || "agentic") + " | " + (runStatus.phase || "idle") + " | " + (runStatus.summary || "Idle"));
        if ((runStatus.attempt || 0) > 0) appendSmallText(agenticSection, "Attempts: " + String(runStatus.attempt || 0) + "/" + String(runStatus.maxSteps || 0));
        appendActionRow(agenticSection, [
            { label: "Show Log", onClick: model.onOpenAssistantLog, disabled: false }
        ]);
        if (assistantState.agenticPendingPatch) {
            const pendingCard = document.createElement("div");
            pendingCard.className = "assistant-patch-summary";
            const pendingHead = document.createElement("div");
            pendingHead.className = "assistant-patch-line";
            pendingHead.textContent = "Pending patch awaiting decision";
            pendingCard.appendChild(pendingHead);
            const pendingPre = document.createElement("pre");
            pendingPre.className = "assistant-patch";
            pendingPre.textContent = JSON.stringify(assistantState.agenticPendingPatch, null, 2);
            pendingCard.appendChild(pendingPre);
            agenticSection.appendChild(pendingCard);
        }
        if (assistantState.error) {
            const errorRow = document.createElement("div");
            errorRow.className = "validation-row error";
            errorRow.textContent = assistantState.error;
            agenticSection.appendChild(errorRow);
        }
        const batchSection = appendSection(container, "Agentic Batches");
        const batches = assistantState.agenticBatches || [];
        if (!batches.length) {
            appendSmallText(batchSection, "No agentic batches yet");
        } else {
            batches.slice().reverse().forEach(function eachBatch(batch) {
                const card = document.createElement("div");
                card.className = "assistant-patch-summary";
                const head = document.createElement("div");
                head.className = "assistant-patch-line";
                head.textContent = "[" + (batch.status || "unknown") + "] " + (batch.at || "");
                card.appendChild(head);
                (batch.summary || []).forEach(function eachLine(line) {
                    const row = document.createElement("div");
                    row.className = line.indexOf("  ") === 0 ? "assistant-patch-detail" : "assistant-patch-line";
                    row.textContent = line.replace(/^  /, "");
                    card.appendChild(row);
                });
                if (batch.error) {
                    const err = document.createElement("div");
                    err.className = "validation-row error";
                    err.textContent = batch.error;
                    card.appendChild(err);
                }
                if (batch.preview) {
                    const preview = document.createElement("div");
                    preview.className = "assistant-patch-line";
                    if (batch.preview.ok) {
                        preview.textContent = "Preview issues before apply: " + batch.preview.issuesCount;
                    } else {
                        preview.textContent = "Preview failed: " + (batch.preview.error || "Unknown error");
                    }
                    card.appendChild(preview);
                }
                batchSection.appendChild(card);
            });
        }
        return;
        }

        const conversationSection = appendSection(container, "Conversation");
        const status = document.createElement("div");
        status.className = "assistant-status";
        status.textContent =
            "Selection: " + (model.selected ? elementDisplayName(model.selected) : "none") +
            " | Objects: " + ((model.elements || []).length);
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
        composer.placeholder = "Ask the assistant to change the current table/logic. It will return a structured patch for preview/apply.";
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
        appendSmallText(conversationSection, "Run status: " + (runStatus.flow || "chat") + " | " + (runStatus.phase || "idle") + " | " + (runStatus.summary || "Idle"));
        if ((runStatus.attempt || 0) > 0) appendSmallText(conversationSection, "Attempts: " + String(runStatus.attempt || 0) + "/" + String(runStatus.maxSteps || 0));

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

        function renderPropertiesTab() {
            const selected = model.selected || null;
            const section = appendSection(container, "Properties");
            if (!selected) {
                appendSmallText(section, "Select an element to edit.");
                appendActionRow(section, [
                    { label: "Fit Table", onClick: model.onFrameTable },
                    { label: "Test Play", onClick: model.onTestPlay }
                ]);
                return;
            }

            appendSmallText(section, elementDisplayName(selected));
            appendActionRow(section, [
                { label: "Frame", onClick: model.onFrameSelected },
                { label: "Duplicate", onClick: model.onDuplicateSelected },
                { label: "Delete", onClick: model.onDeleteSelected, className: "danger" }
            ]);

            function flattenPrimitivePaths(value, prefix, out) {
                Object.keys(value || {}).forEach(function each(key) {
                    const nextPath = prefix ? prefix + "." + key : key;
                    const current = value[key];
                    if (current == null) return;
                    if (Array.isArray(current)) return;
                    if (typeof current === "object") {
                        flattenPrimitivePaths(current, nextPath, out);
                        return;
                    }
                    if (typeof current === "string" || typeof current === "number" || typeof current === "boolean") out.push(nextPath);
                });
            }
            function optionsForPath(path) {
                if (path === "direction") {
                    return optionList([
                        { value: "forward", label: "Forward" },
                        { value: "reverse", label: "Reverse" },
                        { value: "twoWay", label: "Both ways" }
                    ], false);
                }
                return null;
            }

            const config = customInspectorFieldConfig(selected.type);
            const hidden = hiddenLegacyInspectorFields(selected.type) || {};
            const candidatePaths = [];
            if (config && config.length) {
                config.forEach(function each(field) { if (field && field.path) candidatePaths.push(field.path); });
            } else {
                flattenPrimitivePaths(selected, "", candidatePaths);
            }
            const editablePaths = candidatePaths.filter(function keep(path) {
                if (!path || path === "id" || path === "type") return false;
                const leaf = path.split(".").pop();
                return !hidden[leaf];
            });
            if (editablePaths.indexOf("name") < 0) editablePaths.unshift("name");
            const draftKey = "selected:" + selected.id;
            const draftState = getDraftState(model, draftKey, pickPaths(selected, editablePaths));
            appendField(section, "name", Pin.editorTools.getByPath(draftState.value, "name"), function patch(value) {
                patchDraftValue(model, draftKey, "name", value);
            });
            editablePaths.forEach(function each(path) {
                if (path === "name") return;
                const configured = (config || []).find(function find(item) { return item.path === path; });
                appendField(section, configured && configured.label ? configured.label : path, Pin.editorTools.getByPath(draftState.value, path), function patch(value) {
                    if (selected.type === "gate") patchGateDraftValue(model, draftKey, draftState.value, path, value);
                    else patchDraftValue(model, draftKey, path, value);
                }, optionsForPath(path));
            });
            appendDraftActions(section, draftKey, draftState.dirty, function saveSelected() {
                if (model.onSaveSelectedDraft) model.onSaveSelectedDraft(draftKey, draftState.value);
            }, function resetSelected() {
                if (model.onResetCardDraft) model.onResetCardDraft(draftKey);
            });
        }

        function renderLogicTab() {
            const section = appendSection(container, "Logic");
            appendSmallText(section, "Logic authoring now lives in the dedicated feature-first Logic workspace. Use Table > Logic to open it.");
        }


        if (activeTab === "table") renderTableTab();
        else if (activeTab === "layers") renderLayersTab();
        else if (activeTab === "assistant") renderAssistantTab();
        else if (activeTab === "rules") renderLogicTab();
        else renderPropertiesTab();
    }

    Pin.editorPanels = {
        renderPalette: renderPalette,
        renderInspector: renderInspector
    };
})(window.Pin);
