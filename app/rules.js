(function initRules(Pin) {
    /*
     * What: Return a JSON-safe deep copy for runtime rule defaults.
     * Why: variables are table-defined defaults, but runtime actions must not
     *      mutate the table authoring data.
     * Correctness: table rule data is JSON-shaped, so JSON cloning preserves the
     *              supported values without sharing nested objects.
     */
    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function ensureRuleConfig(table) {
        table.rulesEngine = table.rulesEngine || {};
        table.rulesEngine.switchMap = table.rulesEngine.switchMap || [];
        table.rulesEngine.sequenceRules = table.rulesEngine.sequenceRules || [];
        table.rulesEngine.logicGraphs = table.rulesEngine.logicGraphs || [];
        table.rulesEngine.triggers = table.rulesEngine.triggers || [];
        table.rulesEngine.variables = table.rulesEngine.variables || [];
        return table.rulesEngine;
    }

    function needsGraphSync(config) {
        if (!config || !config.logicGraphs || !config.logicGraphs.length) return false;
        if (!config.sequenceRules || config.sequenceRules.length !== config.logicGraphs.length) return true;
        return config.logicGraphs.some(function each(graph, index) {
            const seq = config.sequenceRules[index];
            return !seq || (graph.sourceRuleId && seq.id !== graph.sourceRuleId);
        });
    }

    function runtimeSequenceRules(config) {
        if (!needsGraphSync(config) || !Pin.ruleGraph || !Pin.ruleGraph.compileGraphToSequenceRule) {
            return config.sequenceRules || [];
        }
        return (config.logicGraphs || []).map(function compile(graph, index) {
            return Pin.ruleGraph.compileGraphToSequenceRule(graph, graph.sourceRuleId || ("rule_" + index));
        });
    }

    function eventSwitchIds(table, event) {
        const config = ensureRuleConfig(table);
        const ids = [];
        if (event.switchId) ids.push(event.switchId);
        if (event.sourceId) ids.push(event.sourceId);
        config.switchMap.forEach(function each(mapping) {
            if (mapping.eventType && mapping.eventType !== event.type) return;
            if (mapping.sourceId && mapping.sourceId !== event.sourceId) return;
            if (mapping.switchId) ids.push(mapping.switchId);
        });
        return ids.filter(function unique(id, index, all) { return id && all.indexOf(id) === index; });
    }

    /*
     * What: Reset runtime variables from table defaults when the loaded defaults change.
     * Why: logic variables are intentionally not saved mid-game and should begin
     *      each loaded table from the authored properties.
     * Correctness: the signature only contains variable ids/names/defaults, so
     *              ordinary action mutations keep their current state until the
     *              table definition changes.
     */
    function ensureVariableState(world) {
        const config = ensureRuleConfig((world && world.table) || {});
        const signature = JSON.stringify((config.variables || []).map(function map(variable) {
            return {
                id: variable && (variable.id || variable.name || ""),
                name: variable && (variable.name || ""),
                properties: variable && variable.properties ? variable.properties : { value: false }
            };
        }));
        if (!world.variableState || world.variableStateSignature !== signature) {
            world.variableState = {};
            (config.variables || []).forEach(function each(variable) {
                if (!variable) return;
                const key = variable.id || variable.name;
                if (!key) return;
                world.variableState[key] = clone(variable.properties || { value: false });
            });
            world.variableStateSignature = signature;
        }
        return world.variableState;
    }

    function findVariableConfig(table, idOrName) {
        const config = ensureRuleConfig(table || {});
        return (config.variables || []).find(function find(variable) {
            return variable && (variable.id === idOrName || variable.name === idOrName);
        }) || null;
    }

    function resolveVariableKey(table, idOrName) {
        const variable = findVariableConfig(table, idOrName);
        return variable ? (variable.id || variable.name) : idOrName;
    }

    function readVariableProperty(world, idOrName, property, fallbackValue) {
        if (!world || !idOrName) return fallbackValue;
        const state = ensureVariableState(world);
        const key = resolveVariableKey(world.table, idOrName);
        const props = state[key] || {};
        const prop = property || "value";
        if (Object.prototype.hasOwnProperty.call(props, prop)) return props[prop];
        const config = findVariableConfig(world.table, idOrName);
        const defaults = (config && config.properties) || {};
        if (Object.prototype.hasOwnProperty.call(defaults, prop)) return defaults[prop];
        return fallbackValue;
    }

    function writeVariableProperty(world, idOrName, property, value) {
        if (!world || !idOrName) return;
        const state = ensureVariableState(world);
        const key = resolveVariableKey(world.table, idOrName);
        state[key] = state[key] || {};
        state[key][property || "value"] = value;
    }

    /*
     * What: Produce switch-like events for interval and tick trigger definitions.
     * Why: timers should flow through the existing sequence engine instead of a
     *      separate gameplay logic runtime.
     * Correctness: elapsed seconds and physics ticks are accumulated per trigger,
     *              and one synthetic switchClosed event is emitted for each full
     *              interval crossed.
     */
    function generateTriggerEvents(world, dt) {
        if (!world) return [];
        const config = ensureRuleConfig(world.table || {});
        world.triggerState = world.triggerState || {};
        const generated = [];
        (config.triggers || []).forEach(function each(trigger) {
            if (!trigger || trigger.enabled === false || !trigger.switchId) return;
            const id = trigger.id || trigger.switchId;
            const state = world.triggerState[id] || { elapsedSeconds: 0, elapsedTicks: 0, lastTick: null };
            world.triggerState[id] = state;
            if (trigger.type !== "interval") return;

            let count = 0;
            if (typeof trigger.everySeconds === "number" && trigger.everySeconds > 0) {
                state.elapsedSeconds = (state.elapsedSeconds || 0) + Math.max(0, dt || 0);
                while (state.elapsedSeconds >= trigger.everySeconds) {
                    state.elapsedSeconds -= trigger.everySeconds;
                    count += 1;
                }
            }
            if (typeof trigger.everyTicks === "number" && trigger.everyTicks > 0) {
                const currentTick = typeof world.physicsTick === "number" ? world.physicsTick : 0;
                if (state.lastTick == null) state.lastTick = currentTick;
                const deltaTicks = Math.max(0, currentTick - state.lastTick);
                state.lastTick = currentTick;
                state.elapsedTicks = (state.elapsedTicks || 0) + deltaTicks;
                while (state.elapsedTicks >= trigger.everyTicks) {
                    state.elapsedTicks -= trigger.everyTicks;
                    count += 1;
                }
            }
            for (let i = 0; i < count; i++) {
                generated.push({
                    type: "switchClosed",
                    sourceId: id,
                    switchId: trigger.switchId,
                    triggerId: id,
                    synthetic: true
                });
            }
        });
        return generated;
    }

    function defaultState(rule) {
        return {
            stepIndex: 0,
            completed: {},
            qualified: false,
            remaining: 0,
            completeCount: 0
        };
    }

    function resetState(state) {
        state.stepIndex = 0;
        state.completed = {};
        state.qualified = false;
        state.remaining = 0;
    }

    function setLamp(nextLampState, previousIds, id, value) {
        if (!id) return;
        nextLampState[id] = Object.assign({ lampId: id }, value || {});
        previousIds[id] = true;
    }

    function findElementById(table, id) {
        return ((table && table.elements) || []).find(function find(el) {
            return el && el.id === id;
        }) || null;
    }

    function ensureElementScoreState(world) {
        world.elementScoreState = world.elementScoreState || {};
        return world.elementScoreState;
    }

    function ensureElementPropertyState(world) {
        world.elementPropertyState = world.elementPropertyState || {};
        return world.elementPropertyState;
    }

    function resolveElementScore(world, element, fallbackScore) {
        if (!element) return typeof fallbackScore === "number" ? fallbackScore : 0;
        const state = ensureElementScoreState(world || {});
        if (typeof state[element.id] === "number") return state[element.id];
        if (typeof element.score === "number") return element.score;
        return typeof fallbackScore === "number" ? fallbackScore : 0;
    }

    function resolveElementProperty(world, element, property, fallbackValue) {
        if (!element || !property) return fallbackValue;
        const state = (world && world.elementPropertyState && world.elementPropertyState[element.id]) || null;
        if (state && Object.prototype.hasOwnProperty.call(state, property)) return state[property];
        if (Object.prototype.hasOwnProperty.call(element, property)) return element[property];
        return fallbackValue;
    }

    function resolveConditionOperand(world, operand) {
        if (!operand || typeof operand !== "object" || Array.isArray(operand)) return operand;
        const source = operand.source || operand.type || "";
        if (source === "constant") return operand.value;
        if (source === "score") return (world && world.score) || 0;
        if (source === "variable") {
            return readVariableProperty(world, operand.variableId || operand.targetId || operand.name, operand.property || "value", undefined);
        }
        if (source === "elementScore") {
            const element = findElementById(world.table, operand.targetId || operand.elementId);
            return resolveElementScore(world, element, operand.value);
        }
        if (source === "elementProperty") {
            const element = findElementById(world.table, operand.targetId || operand.elementId);
            return resolveElementProperty(world, element, operand.property, operand.value);
        }
        if (Object.prototype.hasOwnProperty.call(operand, "value")) return operand.value;
        return undefined;
    }

    function compareConditionValue(left, operator, right) {
        if (operator === "truthy") return !!left;
        if (operator === "falsy") return !left;
        if (operator === "ne") return left !== right;
        if (operator === "gt") return left > right;
        if (operator === "gte") return left >= right;
        if (operator === "lt") return left < right;
        if (operator === "lte") return left <= right;
        return left === right;
    }

    /*
     * What: Evaluate a rule condition using variables, elements, scores, or constants.
     * Why: sequence rules need simple gates without introducing another logic engine.
     * Correctness: both the explicit operand form and compact editor form resolve
     *              through the same operand comparer and supported operator set.
     */
    function evaluateCondition(world, condition) {
        if (!condition) return true;
        const operator = condition.operator || "eq";
        const leftOperand = condition.left || condition.subject || {
            source: condition.source || condition.type || "variable",
            variableId: condition.variableId || condition.targetId || condition.name,
            targetId: condition.targetId || condition.elementId,
            elementId: condition.elementId,
            property: condition.property || "value"
        };
        const rightOperand = condition.right || {
            source: "constant",
            value: Object.prototype.hasOwnProperty.call(condition, "value") ? condition.value : true
        };
        const left = resolveConditionOperand(world, leftOperand);
        const right = resolveConditionOperand(world, rightOperand);
        return compareConditionValue(left, operator, right);
    }

    function ruleConditionsPass(world, rule) {
        return (rule.conditions || []).every(function each(condition) {
            return evaluateCondition(world, condition);
        });
    }

    function applyLampAction(world, action, value) {
        const lampId = action.lampId || action.targetId;
        if (!world || !lampId) return;
        world.logicLampState = world.logicLampState || {};
        if (action.actionType === "clearLamp") {
            delete world.logicLampState[lampId];
            return;
        }
        const nextValue = value !== undefined ? value : action.value;
        const state = typeof nextValue === "object" && nextValue !== null && !Array.isArray(nextValue) ?
            Object.assign({ lampId: lampId }, nextValue) :
            {
                lampId: lampId,
                on: !!nextValue,
                intensity: nextValue ? 1 : 0,
                status: nextValue ? "logic" : "off"
            };
        world.logicLampState[lampId] = state;
    }

    function applyRuleAction(world, rule, action) {
        if (!world || !action || !action.actionType) return;
        if (action.actionType === "setVariableProperty") {
            writeVariableProperty(world, action.variableId || action.targetId, action.property || "value", action.value);
            return;
        }
        if (action.actionType === "addVariableProperty") {
            const current = readVariableProperty(world, action.variableId || action.targetId, action.property || "value", 0);
            if (typeof current === "number" && typeof action.value === "number") {
                writeVariableProperty(world, action.variableId || action.targetId, action.property || "value", current + action.value);
            }
            return;
        }
        if (action.actionType === "toggleVariableProperty") {
            const current = readVariableProperty(world, action.variableId || action.targetId, action.property || "value", false);
            writeVariableProperty(world, action.variableId || action.targetId, action.property || "value", !current);
            return;
        }
        if (action.actionType === "resetVariableProperty") {
            const variableId = action.variableId || action.targetId;
            const prop = action.property || "value";
            const config = findVariableConfig(world.table, variableId);
            const defaults = (config && config.properties) || {};
            writeVariableProperty(world, variableId, prop, Object.prototype.hasOwnProperty.call(defaults, prop) ? clone(defaults[prop]) : false);
            return;
        }
        if (action.actionType === "setLamp" || action.actionType === "clearLamp") {
            applyLampAction(world, action);
            return;
        }
        if (action.actionType === "setLampFromVariable") {
            applyLampAction(world, action, readVariableProperty(world, action.variableId, action.property || "value", false));
            return;
        }
        if (!action.targetId) return;
        const element = findElementById(world.table, action.targetId);
        if (!element) return;
        const state = ensureElementScoreState(world);
        const current = resolveElementScore(world, element, 0);
        if (action.actionType === "setElementScore") {
            if (typeof action.value === "number") state[element.id] = action.value;
            return;
        }
        if (action.actionType === "addElementScore") {
            if (typeof action.value === "number") state[element.id] = current + action.value;
            return;
        }
        if (action.actionType === "resetElementScore") {
            delete state[element.id];
            return;
        }
        if (action.actionType === "setElementProperty" && action.property) {
            const propState = ensureElementPropertyState(world);
            propState[element.id] = propState[element.id] || {};
            propState[element.id][action.property] = action.value;
            return;
        }
        if (action.actionType === "resetElementProperty" && action.property) {
            const propState = ensureElementPropertyState(world);
            if (propState[element.id]) delete propState[element.id][action.property];
        }
    }

    function stepComplete(rule, state, step, index) {
        if (rule.ordered === false) return !!state.completed[step];
        return index < (state.stepIndex || 0);
    }

    function collectRuleLamps(world, rules) {
        const next = {};
        const ids = {};
        rules.forEach(function each(rule) {
            if (!rule || !rule.id || rule.enabled === false) return;
            const state = world.ruleState && world.ruleState[rule.id];
            if (!state) return;
            const steps = rule.steps || [];
            const stepLampIds = rule.stepLampIds || [];
            steps.forEach(function eachStep(step, index) {
                const lampId = stepLampIds[index];
                const done = stepComplete(rule, state, step, index);
                const current = !done && !state.qualified && rule.ordered !== false && index === state.stepIndex;
                setLamp(next, ids, lampId, {
                    on: done,
                    intensity: done ? 0.75 : 0,
                    status: done ? "complete" : (current ? "next" : "off"),
                    ruleId: rule.id,
                    switchId: step
                });
            });
            if (rule.targetLampId) {
                const total = rule.windowSeconds || 8;
                const remaining = state.qualified ? Math.max(0, state.remaining || 0) : 0;
                setLamp(next, ids, rule.targetLampId, {
                    on: !!state.qualified,
                    intensity: state.qualified ? Math.max(0.2, remaining / total) : 0,
                    status: state.qualified ? "qualified" : "off",
                    remaining: remaining,
                    total: total,
                    ruleId: rule.id,
                    switchId: rule.targetSwitchId || ""
                });
            }
        });

        world.lampState = world.lampState || {};
        Object.keys(world.ruleLampIds || {}).forEach(function clear(id) {
            delete world.lampState[id];
        });
        Object.keys(next).forEach(function apply(id) {
            world.lampState[id] = next[id];
        });
        Object.keys(world.logicLampState || {}).forEach(function applyLogic(id) {
            world.lampState[id] = world.logicLampState[id];
        });
        world.ruleLampIds = ids;
    }

    function award(world, rule) {
        if (rule.awardPoints) {
            Pin.events.emit(world, { type: "score", sourceId: rule.id, points: rule.awardPoints });
        }
        (rule.actions || []).forEach(function each(action) {
            applyRuleAction(world, rule, action);
        });
        Pin.events.emit(world, { type: rule.awardEvent || "ruleAwarded", sourceId: rule.id, ruleId: rule.id });
    }

    function markStep(rule, state, switchId) {
        const steps = rule.steps || [];
        if (!steps.length) return false;
        if (rule.ordered === false) {
            if (steps.indexOf(switchId) < 0) return false;
            state.completed[switchId] = true;
            return steps.every(function done(step) { return !!state.completed[step]; });
        }
        if (switchId === steps[state.stepIndex]) {
            state.stepIndex += 1;
            return state.stepIndex >= steps.length;
        }
        if (rule.resetOnWrongOrder && steps.indexOf(switchId) >= 0) {
            resetState(state);
        }
        return false;
    }

    function processRule(world, rule, events, dt) {
        world.ruleState = world.ruleState || {};
        const state = world.ruleState[rule.id] || defaultState(rule);
        world.ruleState[rule.id] = state;

        if (state.qualified && dt) {
            state.remaining = Math.max(0, (state.remaining || 0) - dt);
            if (state.remaining <= 0) resetState(state);
        }

        events.forEach(function each(event) {
            if (rule.resetOnDrain !== false && (event.type === "ballDrained" || event.type === "drainEntered")) {
                resetState(state);
                return;
            }
            const switchIds = eventSwitchIds(world.table, event);
            if (!switchIds.length) return;
            if (!ruleConditionsPass(world, rule)) return;

            if (state.qualified) {
                if (rule.targetSwitchId && switchIds.indexOf(rule.targetSwitchId) >= 0) {
                    award(world, rule);
                    state.completeCount += 1;
                    if (rule.resetOnComplete !== false) resetState(state);
                }
                return;
            }

            const completed = switchIds.some(function step(id) { return markStep(rule, state, id); });
            if (!completed) return;
            if (rule.targetSwitchId) {
                state.qualified = true;
                state.remaining = rule.windowSeconds || 8;
                Pin.events.emit(world, { type: "ruleQualified", sourceId: rule.id, ruleId: rule.id });
            } else {
                award(world, rule);
                state.completeCount += 1;
                if (rule.resetOnComplete !== false) resetState(state);
            }
        });
    }

    function process(world, events, dt) {
        const config = ensureRuleConfig(world.table || {});
        ensureVariableState(world);
        const rules = runtimeSequenceRules(config);
        const allEvents = (events || []).concat(generateTriggerEvents(world, dt || 0));
        rules.forEach(function each(rule) {
            if (!rule || !rule.id || rule.enabled === false) return;
            processRule(world, rule, allEvents, dt || 0);
        });
        collectRuleLamps(world, rules);
        return allEvents;
    }

    function addIssue(issues, severity, message, ruleId) {
        issues.push({ severity: severity, message: message, ruleId: ruleId || "" });
    }

    function collectKnownIds(table) {
        const elementIds = {};
        const switchIds = {};
        const lampIds = {};
        const variableIds = {};
        (table.elements || []).forEach(function each(el) {
            if (!el || !el.id) return;
            elementIds[el.id] = true;
            switchIds[el.id] = true;
            if (el.type === "light" || el.type === "arrowLight" || el.type === "boxLight") lampIds[el.lampId || el.id] = true;
        });
        (ensureRuleConfig(table).switchMap || []).forEach(function each(mapping) {
            if (mapping && mapping.switchId) switchIds[mapping.switchId] = true;
        });
        (ensureRuleConfig(table).triggers || []).forEach(function each(trigger) {
            if (trigger && trigger.switchId) switchIds[trigger.switchId] = true;
        });
        (ensureRuleConfig(table).variables || []).forEach(function each(variable) {
            if (!variable) return;
            if (variable.id) variableIds[variable.id] = true;
            if (variable.name) variableIds[variable.name] = true;
        });
        return { elementIds: elementIds, switchIds: switchIds, lampIds: lampIds, variableIds: variableIds };
    }

    function validate(table) {
        const issues = [];
        const config = ensureRuleConfig(table || {});
        const rules = runtimeSequenceRules(config);
        const known = collectKnownIds(table || {});
        const ruleIds = {};
        const mappingKeys = {};

        (config.switchMap || []).forEach(function each(mapping, index) {
            const key = [mapping.eventType || "", mapping.sourceId || "", mapping.switchId || ""].join("|");
            if (!mapping.eventType && !mapping.sourceId && !mapping.switchId) {
                addIssue(issues, "info", "Switch mapping #" + (index + 1) + " is incomplete.");
            } else if (!mapping.switchId) {
                addIssue(issues, "warning", "Switch mapping #" + (index + 1) + " is missing switchId.");
            }
            if (mapping.sourceId && !known.elementIds[mapping.sourceId]) {
                addIssue(issues, "warning", "Switch mapping source '" + mapping.sourceId + "' does not match an element id.");
            }
            if (mappingKeys[key]) addIssue(issues, "warning", "Duplicate switch mapping for '" + key + "'.");
            mappingKeys[key] = true;
        });

        (config.variables || []).forEach(function each(variable, index) {
            if (!variable || (!variable.id && !variable.name)) {
                addIssue(issues, "warning", "Variable #" + (index + 1) + " is missing an id or name.");
                return;
            }
            if (!variable.properties || typeof variable.properties !== "object" || Array.isArray(variable.properties)) {
                addIssue(issues, "warning", "Variable '" + (variable.id || variable.name) + "' should define properties.");
            }
        });

        (config.triggers || []).forEach(function each(trigger, index) {
            if (!trigger || !trigger.switchId) {
                addIssue(issues, "warning", "Trigger #" + (index + 1) + " is missing switchId.");
                return;
            }
            if (trigger.type !== "interval") {
                addIssue(issues, "warning", "Trigger '" + (trigger.id || trigger.switchId) + "' should use type 'interval'.");
            }
            const hasSeconds = typeof trigger.everySeconds === "number" && trigger.everySeconds > 0;
            const hasTicks = typeof trigger.everyTicks === "number" && trigger.everyTicks > 0;
            if (!hasSeconds && !hasTicks) {
                addIssue(issues, "warning", "Trigger '" + (trigger.id || trigger.switchId) + "' needs everySeconds or everyTicks greater than zero.");
            }
        });

        (rules || []).forEach(function each(rule) {
            if (!rule || !rule.id) {
                addIssue(issues, "error", "A sequence rule is missing an id.");
                return;
            }
            if (ruleIds[rule.id]) addIssue(issues, "error", "Duplicate rule id '" + rule.id + "'.", rule.id);
            ruleIds[rule.id] = true;
            if (!Array.isArray(rule.steps) || !rule.steps.length) {
                addIssue(issues, "warning", "Rule '" + rule.id + "' has no sequence steps.", rule.id);
            }
            (rule.steps || []).forEach(function eachStep(step) {
                if (!step) {
                    addIssue(issues, "warning", "Rule '" + rule.id + "' has an unassigned sequence step.", rule.id);
                    return;
                }
                if (!known.switchIds[step]) addIssue(issues, "warning", "Rule '" + rule.id + "' references unknown step switch '" + step + "'.", rule.id);
            });
            if (rule.targetSwitchId && !known.switchIds[rule.targetSwitchId]) {
                addIssue(issues, "warning", "Rule '" + rule.id + "' references unknown target switch '" + rule.targetSwitchId + "'.", rule.id);
            }
            (rule.stepLampIds || []).forEach(function eachLamp(lampId) {
                if (lampId && !known.lampIds[lampId]) addIssue(issues, "warning", "Rule '" + rule.id + "' references unknown step lamp '" + lampId + "'.", rule.id);
            });
            if (rule.targetLampId && !known.lampIds[rule.targetLampId]) {
                addIssue(issues, "warning", "Rule '" + rule.id + "' references unknown target lamp '" + rule.targetLampId + "'.", rule.id);
            }
            (rule.actions || []).forEach(function eachAction(action, index) {
                if (!action || !action.actionType) {
                    addIssue(issues, "warning", "Rule '" + rule.id + "' has an action #" + (index + 1) + " with no actionType.", rule.id);
                    return;
                }
                const variableAction = action.actionType === "setVariableProperty" || action.actionType === "addVariableProperty" || action.actionType === "toggleVariableProperty" || action.actionType === "resetVariableProperty" || action.actionType === "setLampFromVariable";
                const lampAction = action.actionType === "setLamp" || action.actionType === "clearLamp" || action.actionType === "setLampFromVariable";
                if ((action.actionType === "setElementScore" || action.actionType === "addElementScore" || action.actionType === "resetElementScore" || action.actionType === "setElementProperty" || action.actionType === "resetElementProperty") && !action.targetId) {
                    addIssue(issues, "warning", "Rule '" + rule.id + "' has an action with no target element.", rule.id);
                }
                if (!variableAction && !lampAction && action.targetId && !known.elementIds[action.targetId]) {
                    addIssue(issues, "warning", "Rule '" + rule.id + "' action references unknown target '" + action.targetId + "'.", rule.id);
                }
                if (variableAction && !known.variableIds[action.variableId || action.targetId]) {
                    addIssue(issues, "warning", "Rule '" + rule.id + "' action references unknown variable '" + (action.variableId || action.targetId || "") + "'.", rule.id);
                }
                if (lampAction && !known.lampIds[action.lampId || action.targetId]) {
                    addIssue(issues, "warning", "Rule '" + rule.id + "' action references unknown lamp '" + (action.lampId || action.targetId || "") + "'.", rule.id);
                }
                if ((action.actionType === "setElementScore" || action.actionType === "addElementScore") && typeof action.value !== "number") {
                    addIssue(issues, "warning", "Rule '" + rule.id + "' score action should provide a numeric value.", rule.id);
                }
                if ((action.actionType === "setElementProperty" || action.actionType === "resetElementProperty") && !action.property) {
                    addIssue(issues, "warning", "Rule '" + rule.id + "' property action should provide a property name.", rule.id);
                }
            });
            (rule.conditions || []).forEach(function eachCondition(condition, index) {
                const op = condition && (condition.operator || "eq");
                if (["eq", "ne", "gt", "gte", "lt", "lte", "truthy", "falsy"].indexOf(op) < 0) {
                    addIssue(issues, "warning", "Rule '" + rule.id + "' condition #" + (index + 1) + " has unsupported operator '" + op + "'.", rule.id);
                }
                const variableId = condition && (condition.variableId || (condition.left && condition.left.variableId));
                if (variableId && !known.variableIds[variableId]) {
                    addIssue(issues, "warning", "Rule '" + rule.id + "' condition references unknown variable '" + variableId + "'.", rule.id);
                }
            });
            if ((rule.stepLampIds || []).length > (rule.steps || []).length) {
                addIssue(issues, "warning", "Rule '" + rule.id + "' has more step lamps than steps.", rule.id);
            }
            if (rule.targetSwitchId && (!rule.windowSeconds || rule.windowSeconds <= 0)) {
                addIssue(issues, "warning", "Rule '" + rule.id + "' target window should be greater than zero.", rule.id);
            }
        });

        return issues;
    }

    Pin.rules = {
        ensureRuleConfig: ensureRuleConfig,
        process: process,
        eventSwitchIds: eventSwitchIds,
        validate: validate,
        resolveElementScore: resolveElementScore,
        resolveElementProperty: resolveElementProperty
    };
})(window.Pin);
