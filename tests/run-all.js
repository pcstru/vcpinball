// What: Runs the repository's Node-based checks without relying on shell glue.
// Why: `npm test` should work the same way on Windows shells and POSIX shells.
const childProcess = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const tests = [
    "tests/smoke.test.js"
];

tests.forEach(function run(testFile) {
    const result = childProcess.spawnSync(process.execPath, [testFile], {
        cwd: root,
        stdio: "inherit"
    });
    if (result.status !== 0) process.exit(result.status || 1);
});
