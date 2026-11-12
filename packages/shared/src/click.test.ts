import { test } from "node:test";
import assert from "node:assert/strict";
import { accentOf, clickPlan, countInAt, parseCompas, videoRate } from "./click.ts";
import { clockPosition } from "./timeline.ts";

test("parseCompas: simples y compuestos", () => {
  assert.deepEqual(parseCompas("4/4"), { beatsPerBar: 4, subdivision: 1 });
  assert.deepEqual(parseCompas("3/4"), { beatsPerBar: 3, subdivision: 1 });
  assert.deepEqual(parseCompas("6/8"), { beatsPerBar: 2, subdivision: 3 });
  assert.deepEqual(parseCompas("12/8"), { beatsPerBar: 4, subdivision: 3 });
  assert.deepEqual(parseCompas("3/8"), { beatsPerBar: 3, subdivision: 1 });
  assert.equal(parseCompas("4"), null);
  assert.equal(parseCompas("0/4"), null);
});

test("clickPlan: sin BPM no hay clic; cuenta por defecto 2 compases", () => {
  assert.equal(clickPlan({ bpmManual: null }), null);
  const p = clickPlan({ bpmManual: 120 })!;
  assert.equal(p.pulseMs, 500);
  assert.equal(p.countInPulses, 8);
  assert.equal(p.countInMs, 4000);
  assert.equal(p.sound, "madera");
  const c = clickPlan({ bpmManual: 60, compas: "6/8", compasesCuenta: 1, sonidoClic: "beep" }, "cencerro")!;
  assert.equal(c.pulsesPerBar, 6);
  assert.equal(c.countInMs, 2000);
  assert.equal(c.sound, "cencerro");
  assert.equal(clickPlan({ bpmManual: 100, compasesCuenta: 9 })!.countInBars, 4);
});

test("accentOf: primer tiempo, tiempos y subdivisiones (también en la cuenta)", () => {
  const p = clickPlan({ bpmManual: 60, compas: "6/8" })!;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => accentOf(p, i)), [2, 0, 0, 1, 0, 0, 2]);
  assert.equal(accentOf(p, -6), 2);
  assert.equal(accentOf(p, -3), 1);
});

test("countInAt: cuenta 1..4 por compás y termina en 0", () => {
  const p = clickPlan({ bpmManual: 120 })!; // 4 s de cuenta, tiempos de 500 ms
  assert.equal(countInAt(p, 10, 1), null);
  assert.deepEqual(
    { ...countInAt(p, -4000, 1)!, remainingMs: 0 },
    { bar: 1, bars: 2, beat: 1, beatsPerBar: 4, remainingMs: 0 },
  );
  const v = countInAt(p, -1200, 1)!;
  assert.equal(v.bar, 2);
  assert.equal(v.beat, 2);
  // Con el tempo de la letra al 110 %, la posición va 1,1 veces más rápido.
  assert.equal(countInAt(p, -4400, 1.1)!.beat, 1);
});

test("el reloj anclado en el futuro da posición negativa (cuenta previa)", () => {
  const c = { status: "playing" as const, anchorPositionMs: 0, anchorWallMs: 5000, rate: 1 };
  assert.equal(clockPosition(c, 1000), -4000);
  assert.equal(clockPosition(c, 6000), 1000);
});

test("videoRate", () => {
  assert.equal(videoRate({ bpmManual: 120, videoBpmReferencia: 100 }, 1), 1.2);
  assert.equal(videoRate({ bpmManual: null, videoBpmReferencia: 100 }, 1.1), 1.1);
  assert.equal(videoRate({ bpmManual: 300, videoBpmReferencia: 30 }, 1), 4);
});
