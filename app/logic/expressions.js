/* What: Safe expression parsing and evaluation for logic conditions.
 * Why: Computed state and rule conditions must be evaluable without eval().
 */
(function initLogicExpressions(Pin) {
    function tokenize(input) {
        /* What: Split expression text into lexical tokens.
         * Why: The parser operates on predictable token streams.
         */
        var text = String(input || "");
        var out = [];
        var i = 0;
        while (i < text.length) {
            var ch = text[i];
            if (/\s/.test(ch)) {
                i += 1;
                continue;
            }
            var two = text.slice(i, i + 2);
            if (two === "&&" || two === "||" || two === "==" || two === "!=" || two === ">=" || two === "<=") {
                out.push({ type: "op", value: two });
                i += 2;
                continue;
            }
            if (ch === "!" || ch === ">" || ch === "<" || ch === "(" || ch === ")") {
                out.push({ type: ch === "(" || ch === ")" ? "paren" : "op", value: ch });
                i += 1;
                continue;
            }
            if (/[0-9]/.test(ch)) {
                var start = i;
                i += 1;
                while (i < text.length && /[0-9]/.test(text[i])) i += 1;
                out.push({ type: "number", value: Number(text.slice(start, i)) });
                continue;
            }
            if (/[A-Za-z_]/.test(ch)) {
                var idStart = i;
                i += 1;
                while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) i += 1;
                var word = text.slice(idStart, i);
                if (word === "true" || word === "false") out.push({ type: "bool", value: word === "true" });
                else out.push({ type: "ident", value: word });
                continue;
            }
            throw new Error("Unexpected token '" + ch + "'");
        }
        return out;
    }

    function parseExpression(input) {
        /* What: Parse supported condition syntax to an AST.
         * Why: Validation and simulation share one syntax implementation.
         */
        var tokens = tokenize(input);
        var index = 0;
        function peek() { return tokens[index] || null; }
        function eat(type, value) {
            var tok = peek();
            if (!tok || tok.type !== type || (value != null && tok.value !== value)) return null;
            index += 1;
            return tok;
        }
        function expect(type, value) {
            var tok = eat(type, value);
            if (!tok) throw new Error("Expected " + (value || type));
            return tok;
        }
        function parsePrimary() {
            var tok = peek();
            if (!tok) throw new Error("Unexpected end of expression");
            if (eat("paren", "(")) {
                var node = parseOr();
                expect("paren", ")");
                return node;
            }
            if (tok.type === "number" || tok.type === "bool" || tok.type === "ident") {
                index += 1;
                return { type: tok.type, value: tok.value };
            }
            throw new Error("Unexpected token " + tok.value);
        }
        function parseUnary() {
            if (eat("op", "!")) return { type: "not", value: parseUnary() };
            return parsePrimary();
        }
        function parseCompare() {
            var node = parseUnary();
            var tok = peek();
            while (tok && tok.type === "op" && (tok.value === "==" || tok.value === "!=" || tok.value === ">" || tok.value === ">=" || tok.value === "<" || tok.value === "<=")) {
                index += 1;
                node = { type: "bin", op: tok.value, left: node, right: parseUnary() };
                tok = peek();
            }
            return node;
        }
        function parseAnd() {
            var node = parseCompare();
            while (eat("op", "&&")) node = { type: "bin", op: "&&", left: node, right: parseCompare() };
            return node;
        }
        function parseOr() {
            var node = parseAnd();
            while (eat("op", "||")) node = { type: "bin", op: "||", left: node, right: parseAnd() };
            return node;
        }
        var ast = parseOr();
        if (index !== tokens.length) throw new Error("Unexpected token " + tokens[index].value);
        return ast;
    }

    function evalAst(node, env) {
        /* What: Evaluate a parsed AST against a value environment.
         * Why: State/computed/condition logic needs deterministic execution.
         */
        if (!node) return false;
        if (node.type === "number" || node.type === "bool") return node.value;
        if (node.type === "ident") return env.hasOwnProperty(node.value) ? env[node.value] : undefined;
        if (node.type === "not") return !truthy(evalAst(node.value, env));
        if (node.type === "bin") {
            var l = evalAst(node.left, env);
            var r = evalAst(node.right, env);
            if (node.op === "&&") return truthy(l) && truthy(r);
            if (node.op === "||") return truthy(l) || truthy(r);
            if (node.op === "==") return l === r;
            if (node.op === "!=") return l !== r;
            if (node.op === ">") return Number(l || 0) > Number(r || 0);
            if (node.op === ">=") return Number(l || 0) >= Number(r || 0);
            if (node.op === "<") return Number(l || 0) < Number(r || 0);
            if (node.op === "<=") return Number(l || 0) <= Number(r || 0);
        }
        return false;
    }

    function truthy(value) {
        return !!value;
    }

    function collectIdentifiers(node, out) {
        /* What: Collect identifier references from an AST.
         * Why: Validation must verify expression dependencies and cycles.
         */
        if (!node) return;
        if (node.type === "ident") out[node.value] = true;
        if (node.type === "not") collectIdentifiers(node.value, out);
        if (node.type === "bin") {
            collectIdentifiers(node.left, out);
            collectIdentifiers(node.right, out);
        }
    }

    function evaluate(text, env) {
        var ast = parseExpression(String(text || ""));
        return evalAst(ast, env || {});
    }

    Pin.logicExpressions = {
        tokenize: tokenize,
        parseExpression: parseExpression,
        evaluate: evaluate,
        evalAst: evalAst,
        collectIdentifiers: collectIdentifiers
    };
})(window.Pin);
