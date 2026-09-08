const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const { test } = require("node:test");

// Load the pure formatters without initializing the browser application.
const source = readFileSync(`${__dirname}/../app.js`, "utf8");
const context = {};
for (const name of ["formatDuration", "formatDurationLabel", "formatAxisHours"]) {
  const definition = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
  assert.ok(definition, `${name} exists`);
  runInNewContext(definition[0], context);
}

test("durations use hours and minutes, never fractional hours", () => {
  const cases = [
    [0, "0m", "0 minutes"],
    [1, "1m", "1 minute"],
    [30, "30m", "30 minutes"],
    [59, "59m", "59 minutes"],
    [60, "1h", "1 hour"],
    [61, "1h 1m", "1 hour 1 minute"],
    [90, "1h 30m", "1 hour 30 minutes"],
    [120, "2h", "2 hours"],
    [135, "2h 15m", "2 hours 15 minutes"],
    [1501, "25h 1m", "25 hours 1 minute"],
    [59.6, "1h", "1 hour"],
    [-1, "0m", "0 minutes"]
  ];
  for (const [minutes, compact, label] of cases) {
    assert.equal(context.formatDuration(minutes), compact);
    assert.equal(context.formatDurationLabel(minutes), label);
  }
});

test("chart axes use minute labels for partial hours", () => {
  assert.equal(context.formatAxisHours(0), "0m");
  assert.equal(context.formatAxisHours(0.5), "30m");
  assert.equal(context.formatAxisHours(1), "1h");
  assert.equal(context.formatAxisHours(1.5), "1h 30m");
  assert.equal(context.formatAxisHours(12), "12h");
});
