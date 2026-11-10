import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ClockSync,
  clockFromState,
  decodeBlePayload,
  encodeBlePayload,
  hash32,
} from "./sync-protocol.ts";

test("ClockSync usa la muestra de menor ida y vuelta", () => {
  const c = new ClockSync();
  // Servidor adelantado 1000 ms. Muestra lenta (rtt 200, asimétrica) y rápida (rtt 10).
  c.add(0, 1000 + 150, 200);
  c.add(500, 1000 + 505, 510);
  assert.equal(c.rtt, 10);
  assert.equal(c.offset, 1000);
  assert.equal(c.serverNow(2000), 3000);
});

test("clockFromState adelanta la posición si está sonando", () => {
  const st = { status: "playing" as const, positionMs: 10_000, rate: 1.5 };
  const clock = clockFromState(st, 5000, 5200, 42);
  assert.equal(clock.anchorPositionMs, 10_300);
  assert.equal(clock.anchorWallMs, 42);
  const paused = clockFromState({ ...st, status: "paused" }, 5000, 9000, 0);
  assert.equal(paused.anchorPositionMs, 10_000);
});

test("payload BLE ida y vuelta", () => {
  const p = {
    seq: 70_001,
    setlistHash: hash32("cl1234-setlist"),
    entryIndex: 12,
    status: "playing" as const,
    positionMs: 183_456,
    rate: 1.04,
  };
  const buf = encodeBlePayload(p);
  assert.equal(buf.length, 16);
  assert.deepEqual(decodeBlePayload(buf), { ...p, seq: 70_001 & 0xffff });
  assert.equal(decodeBlePayload(new Uint8Array(16)), null); // versión 0
});

test("hash32 es estable", () => {
  assert.equal(hash32(""), 0x811c9dc5);
  assert.equal(hash32("abc"), hash32("abc"));
  assert.notEqual(hash32("abc"), hash32("abd"));
});
