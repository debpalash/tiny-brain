import { describe, expect, test } from "vite-plus/test";
import { createEngine } from "./createEngine";
import { N, NEURON, WORLD_RADIUS } from "./types";
import type { Bacterium, Engine, Source } from "./types";

const WINS_MIN = 17;
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

/** Cell at the origin in an otherwise empty dish; energy is pinned so it cannot die. */
function emptyDish(seed: number): { e: Engine; b: Bacterium } {
  const e = createEngine(seed);
  e.clearSources();
  const b = e.bacteria[0] as Bacterium;
  b.x = 0;
  b.z = 0;
  return { e, b };
}

/**
 * Walker = the same brain with TUMBLE clamped at the designed brain's own resting level (0.37),
 * i.e. identical tumble rate and speed but no sensing.
 */
const WALKER = 0.37;

function runTrial(seed: number, tumbleClamp: number | null, scenario: "food" | "edge" | "inside") {
  const { e, b } = emptyDish(seed);
  if (scenario === "food") e.addSource("food", 25, 0).radius = 10;
  if (scenario === "edge") e.addSource("toxin", 12, 0).radius = 6; // cloud 12 units away
  if (scenario === "inside") e.addSource("toxin", 0, 0).radius = 10; // cell starts in the cloud
  if (tumbleClamp !== null) e.setClamp(NEURON.TUMBLE, tumbleClamp);
  const dist: number[] = [];
  const tox: number[] = [];
  const steps = scenario === "inside" ? 120 : 160;
  for (let i = 0; i < steps; i++) {
    e.step(0.25);
    b.energy = 1;
    b.alive = true;
    tox.push(e.sample(b.x, b.z).toxin);
    if (i >= 40) dist.push(Math.hypot(b.x - 25, b.z));
  }
  return { dist: mean(dist), tox: mean(tox) };
}

describe("chemotaxis", () => {
  test("designed brain climbs a food gradient far better than a random walker", () => {
    const designed = SEEDS.map((s) => runTrial(s, null, "food").dist);
    const walker = SEEDS.map((s) => runTrial(s, WALKER, "food").dist);
    const wins = designed.filter((d, i) => d < (walker[i] as number)).length;
    expect(mean(designed)).toBeLessThan(0.6 * mean(walker));
    expect(wins).toBeGreaterThanOrEqual(WINS_MIN);
  });

  test("designed brain keeps away from a toxin cloud", () => {
    const designed = SEEDS.map((s) => runTrial(s, null, "edge").tox);
    const walker = SEEDS.map((s) => runTrial(s, WALKER, "edge").tox);
    expect(mean(designed)).toBeLessThan(0.55 * mean(walker));
  });

  test("a cell that starts inside a toxin cloud escapes faster than a random walker", () => {
    const designed = SEEDS.map((s) => runTrial(s, null, "inside").tox);
    const walker = SEEDS.map((s) => runTrial(s, WALKER, "inside").tox);
    expect(mean(designed)).toBeLessThan(0.85 * mean(walker));
  });
});

describe("clamps", () => {
  test("silenced TUMBLE never tumbles; stimulated TUMBLE barely moves", () => {
    const silent = emptyDish(11);
    silent.e.setClamp(NEURON.TUMBLE, 0);
    let tumbles = 0;
    for (let i = 0; i < 80; i++) {
      silent.e.step(0.25);
      silent.b.energy = 1;
      if (silent.b.tumbling) tumbles++;
    }
    expect(tumbles).toBe(0);
    expect(silent.b.act[NEURON.TUMBLE]).toBe(0);
    expect(Math.hypot(silent.b.x, silent.b.z)).toBeGreaterThan(8);

    const stim = emptyDish(11);
    stim.e.setClamp(NEURON.TUMBLE, 1);
    for (let i = 0; i < 80; i++) {
      stim.e.step(0.25);
      stim.b.energy = 1;
    }
    expect(stim.b.act[NEURON.TUMBLE]).toBe(1);
    expect(Math.hypot(stim.b.x, stim.b.z)).toBeLessThan(6);
  });

  test("a released clamp lets the neuron move again", () => {
    const { e, b } = emptyDish(3);
    e.setClamp(NEURON.RUN, 0);
    e.step(0.1);
    expect(b.act[NEURON.RUN]).toBe(0);
    e.setClamp(NEURON.RUN, null);
    e.step(0.5);
    expect(b.act[NEURON.RUN]).toBeGreaterThan(0.3);
  });
});

describe("world and body", () => {
  test("eating shrinks and finally removes food, bumping version", () => {
    const e = createEngine(2);
    e.clearSources();
    const f = e.addSource("food", 0, 0);
    f.strength = 0.03;
    const b = e.bacteria[0] as Bacterium;
    b.energy = 0.5;
    const v = e.version;
    e.setClamp(NEURON.RUN, 0);
    e.setClamp(NEURON.TUMBLE, 1);
    for (let i = 0; i < 160; i++) e.step(0.25);
    expect(b.foodEaten).toBeGreaterThan(0);
    expect(e.sources.includes(f)).toBe(false);
    expect(e.version).toBeGreaterThan(v);
  });

  test("solo dish is restocked with food once the cell has eaten it out", () => {
    const e = createEngine(6);
    e.clearSources();
    const b = e.bacteria[0] as Bacterium;
    const f = e.addSource("food", 0, 0);
    f.strength = 0.03;
    e.setClamp(NEURON.RUN, 0);
    e.setClamp(NEURON.TUMBLE, 1);
    let removedAt = -1;
    let v = e.version;
    for (let i = 0; i < 1200 && e.sources.includes(f); i++) {
      e.step(0.25);
      b.energy = 1;
      if (removedAt < 0 && !e.sources.includes(f)) {
        removedAt = e.time;
        v = e.version;
      }
    }
    expect(removedAt).toBeGreaterThan(0);
    expect(e.sources.filter((s) => s.kind === "food").length).toBe(0);
    for (let i = 0; i < 20; i++) e.step(0.25); // 5 s: past the ~3 s delay
    const foods = e.sources.filter((s) => s.kind === "food");
    expect(foods.length).toBeGreaterThanOrEqual(1);
    const nf = foods[0] as Source;
    expect(Math.hypot(nf.x - b.x, nf.z - b.z)).toBeGreaterThanOrEqual(12);
    expect(e.version).toBeGreaterThan(v);
    for (let i = 0; i < 80; i++) e.step(0.25);
    expect(e.sources.filter((s) => s.kind === "food").length).toBeGreaterThanOrEqual(2);
  });

  test("clearing sources by hand does not trigger a restock", () => {
    const e = createEngine(6);
    e.clearSources();
    for (let i = 0; i < 80; i++) e.step(0.25);
    expect(e.sources.length).toBe(0);
  });

  test("solo cell dies of starvation and respawns at the centre", () => {
    const e = createEngine(4);
    e.clearSources();
    const b = e.bacteria[0] as Bacterium;
    b.energy = 0.001;
    let died = false;
    for (let i = 0; i < 20; i++) {
      e.step(0.25);
      if (!b.alive) {
        died = true;
        expect(b.speed).toBe(0);
        break;
      }
    }
    expect(died).toBe(true);
    for (let i = 0; i < 12; i++) e.step(0.25);
    expect(b.alive).toBe(true);
    expect(b.energy).toBeGreaterThan(0.9);
  });

  test("cells stay inside the dish and trails are capped", () => {
    const { e, b } = emptyDish(5);
    for (let i = 0; i < 400; i++) {
      e.step(0.25);
      b.energy = 1;
      expect(Math.hypot(b.x, b.z)).toBeLessThanOrEqual(WORLD_RADIUS);
    }
    expect(b.trail.length).toBeLessThanOrEqual(240);
    expect(b.trail.length).toBeGreaterThan(100);
  });

  test("sample sums blobs and clamps to 1", () => {
    const e = createEngine(1);
    e.clearSources();
    e.addSource("food", 0, 0);
    e.addSource("food", 0, 0);
    expect(e.sample(0, 0).food).toBe(1);
    expect(e.sample(0, 0).toxin).toBe(0);
  });
});

describe("evolution", () => {
  test("population fitness improves over 25 generations", () => {
    const first: number[] = [];
    const last: number[] = [];
    const bestFirst: number[] = [];
    const bestLast: number[] = [];
    for (const seed of [2, 3, 5]) {
      const e = createEngine(seed);
      e.setMode("evolution");
      expect(e.bacteria.length).toBe(24);
      while (e.history.length < 25) e.step(0.5);
      const avg = e.history.map((h) => h.mean);
      const best = e.history.map((h) => h.best);
      first.push(mean(avg.slice(0, 5)));
      last.push(mean(avg.slice(-5)));
      bestFirst.push(mean(best.slice(0, 5)));
      bestLast.push(mean(best.slice(-5)));
      expect(e.history[0]?.generation).toBe(1);
      expect(e.generation).toBe(26);
    }
    expect(mean(last)).toBeGreaterThan(mean(first) + 0.2);
    // the best cell must not get worse either (it is noisier, so only a loose bound)
    expect(mean(bestLast)).toBeGreaterThan(mean(bestFirst) - 0.5);
  }, 30000);

  test("nextGeneration keeps elites and mutates the rest", () => {
    const e = createEngine(9);
    e.setMode("evolution");
    for (let i = 0; i < 40; i++) e.step(0.25);
    const top = [...e.bacteria].sort((a, b) => b.fitness - a.fitness)[0] as Bacterium;
    const topWeights = Array.from(top.genome.weights);
    e.nextGeneration();
    expect(e.history.length).toBe(1);
    expect(e.generationTimeLeft).toBe(e.generationLength);
    expect(e.bacteria.every((b) => b.fitness === 0 && b.energy === 1 && b.alive)).toBe(true);
    const survivor = e.bacteria.find((b) => b.id === top.id);
    expect(survivor).toBeDefined();
    expect(Array.from((survivor as Bacterium).genome.weights)).toEqual(topWeights);
    expect(e.selectedId).toBe(top.id);
  });
});

describe("determinism", () => {
  test("same seed gives identical state; different seeds differ", () => {
    const run = (seed: number) => {
      const e = createEngine(seed);
      e.setMode("evolution");
      for (let i = 0; i < 300; i++) e.step(0.2);
      return JSON.stringify(
        e.bacteria.map((b) => [
          b.x,
          b.z,
          b.heading,
          b.energy,
          b.fitness,
          Array.from(b.act),
          Array.from(b.w),
        ]),
      );
    };
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
  });
});

describe("structure", () => {
  test("array identities survive mode changes, generations and reset", () => {
    const e = createEngine(1);
    const { bacteria, sources, history, neurons } = e;
    e.setMode("evolution");
    e.step(1);
    e.nextGeneration();
    e.reset();
    e.setMode("solo");
    e.reset();
    expect(e.bacteria).toBe(bacteria);
    expect(e.sources).toBe(sources);
    expect(e.history).toBe(history);
    expect(e.neurons).toBe(neurons);
    expect(e.neurons.length).toBe(9);
  });

  test("version bumps and subscribers fire on structural changes only", () => {
    const e = createEngine(1);
    let calls = 0;
    const off = e.subscribe(() => calls++);
    const check = (fn: () => void) => {
      const v = e.version;
      const c = calls;
      fn();
      expect(e.version).toBe(v + 1);
      expect(calls).toBe(c + 1);
    };
    const s = e.addSource("food", 5, 5);
    expect(e.sources).toContain(s);
    calls = 0;
    const v0 = e.version;
    e.step(0.1);
    expect(e.version).toBe(v0);
    expect(calls).toBe(0);
    check(() => e.addSource("toxin", 1, 1));
    check(() => e.removeSource(s.id));
    check(() => e.setClamp(NEURON.RUN, 1));
    check(() => e.setWeight(0, 3, 2));
    check(() => e.resetBrain());
    check(() => e.scrambleBrain());
    check(() => e.clearSources());
    check(() => e.reset());
    check(() => e.setMode("evolution"));
    check(() => e.nextGeneration());
    check(() => e.select(null));
    off();
    const c = calls;
    e.reset();
    expect(calls).toBe(c);
  });

  test("brain edits act on the selected cell and respect limits", () => {
    const e = createEngine(1);
    const b = e.selected() as Bacterium;
    expect(b).not.toBeNull();
    e.setWeight(0, 3, 100);
    expect(b.genome.weights[3]).toBe(8);
    e.resetBrain();
    expect(b.genome.weights[NEURON.FOOD * N + NEURON.KINASE]).toBeGreaterThan(0);
    e.select(null);
    e.setWeight(0, 3, 1);
    expect(b.genome.weights[3]).not.toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Lifetime learning
// ---------------------------------------------------------------------------------------------
const SCENT_KINASE = NEURON.SCENT * N + NEURON.KINASE;
const TRAIN_SECONDS = 180;

/** Train the designed cell on a dish where scent comes with food (or toxin). Energy is pinned. */
function trainCell(seed: number, pairing: "food" | "toxin") {
  const e = createEngine(seed);
  e.clearSources();
  e.setPairing(pairing);
  const b = e.bacteria[0] as Bacterium;
  e.addSource("food", 22, 14);
  e.addSource("food", -12, 28);
  if (pairing === "toxin") {
    e.addSource("toxin", -14, -14);
    e.addSource("toxin", 14, -24);
  }
  for (let i = 0; i < TRAIN_SECONDS * 4; i++) {
    e.step(0.25);
    b.energy = 1;
    b.alive = true;
  }
  return { e, b };
}

/** Scent-only dish: one scent blob 25 units away, no food. Learning is frozen during the test. */
function scentTest(e: Engine, b: Bacterium, walker = false) {
  e.setPairing("none");
  e.setLearning(false);
  e.clearSources();
  b.x = 0;
  b.z = 0;
  b.energy = 1;
  e.addSource("scent", 25, 0);
  if (walker) e.setClamp(NEURON.TUMBLE, WALKER);
  const dist: number[] = [];
  const cloud: number[] = [];
  for (let i = 0; i < 160; i++) {
    e.step(0.25);
    b.energy = 1;
    b.alive = true;
    if (i >= 40) dist.push(Math.hypot(b.x - 25, b.z));
    cloud.push(e.sample(b.x, b.z).scent);
  }
  return { dist: mean(dist), cloud: mean(cloud) };
}

function naiveScent(seed: number, walker = false) {
  const e = createEngine(seed);
  const b = e.bacteria[0] as Bacterium;
  return scentTest(e, b, walker);
}

describe("lifetime learning", () => {
  test("naive cell ignores scent: no better than a random walker, w equals inborn", () => {
    const naive = SEEDS.map((s) => naiveScent(s).dist);
    const walker = SEEDS.map((s) => naiveScent(s, true).dist);
    expect(mean(naive)).toBeGreaterThan(0.9 * mean(walker));
    const e = createEngine(1);
    const b = e.bacteria[0] as Bacterium;
    expect(b.genome.weights[SCENT_KINASE]).toBe(0);
    expect(b.genome.plastic[SCENT_KINASE]).toBeGreaterThan(0);
    expect(b.genome.plastic.filter((p) => p > 0).length).toBe(1);
  });

  test("food-paired scent: trained cells climb scent gradients", () => {
    const trained = SEEDS.map((s) => trainCell(s, "food"));
    const ws = trained.map(({ b }) => b.w[SCENT_KINASE] as number);
    const after = trained.map(({ e, b }) => scentTest(e, b).dist);
    const naive = SEEDS.map((s) => naiveScent(s).dist);
    console.log(
      `food-trained: dist ${mean(after).toFixed(1)} vs naive ${mean(naive).toFixed(1)}; ` +
        `SCENT->KINASE w mean ${mean(ws).toFixed(2)} min ${Math.min(...ws).toFixed(2)} max ${Math.max(...ws).toFixed(2)}`,
    );
    expect(mean(ws)).toBeGreaterThan(2);
    expect(ws.filter((w) => w > 0.5).length).toBeGreaterThanOrEqual(20);
    expect(mean(after)).toBeLessThan(0.75 * mean(naive));
    expect(after.filter((d, i) => d < (naive[i] as number)).length).toBeGreaterThanOrEqual(17);
    for (const { b } of trained) for (const v of b.w) expect(Math.abs(v)).toBeLessThanOrEqual(8);
  }, 30000);

  test("toxin-paired scent: trained cells learn to flee the smell", () => {
    const trained = SEEDS.map((s) => trainCell(s, "toxin"));
    const ws = trained.map(({ b }) => b.w[SCENT_KINASE] as number);
    const after = trained.map(({ e, b }) => scentTest(e, b).cloud);
    const naive = SEEDS.map((s) => naiveScent(s).cloud);
    console.log(
      `toxin-trained: scent exposure ${mean(after).toFixed(3)} vs naive ${mean(naive).toFixed(3)}; ` +
        `SCENT->KINASE w mean ${mean(ws).toFixed(2)} min ${Math.min(...ws).toFixed(2)} max ${Math.max(...ws).toFixed(2)}`,
    );
    expect(mean(ws)).toBeLessThan(-1);
    expect(ws.filter((w) => w < -0.5).length).toBeGreaterThanOrEqual(17);
    expect(mean(after)).toBeLessThan(0.8 * mean(naive));
  }, 30000);

  test("forget() restores inborn weights and behaviour; learning off freezes w", () => {
    const { e, b } = trainCell(3, "food");
    expect(b.w[SCENT_KINASE]).toBeGreaterThan(1);
    expect(b.genome.weights[SCENT_KINASE]).toBe(0);
    const v = e.version;
    e.forget();
    expect(e.version).toBeGreaterThan(v);
    expect(Array.from(b.w)).toEqual(Array.from(b.genome.weights));

    const frozen = trainCell(3, "food");
    frozen.e.setLearning(false);
    const snap = Array.from(frozen.b.w);
    for (let i = 0; i < 400; i++) {
      frozen.e.step(0.25);
      frozen.b.energy = 1;
    }
    expect(Array.from(frozen.b.w)).toEqual(snap);

    const off = createEngine(5);
    off.setLearning(false);
    off.clearSources();
    off.setPairing("food");
    off.addSource("food", 0, 0);
    const ob = off.bacteria[0] as Bacterium;
    for (let i = 0; i < 200; i++) off.step(0.25);
    expect(ob.foodEaten).toBeGreaterThan(0);
    expect(ob.w[SCENT_KINASE]).toBe(0);

    const forgotten = SEEDS.map((s) => {
      const t = trainCell(s, "food");
      t.e.forget();
      return scentTest(t.e, t.b).dist;
    });
    const naive = SEEDS.map((s) => naiveScent(s).dist);
    expect(mean(forgotten)).toBeGreaterThan(0.85 * mean(naive));
  }, 30000);

  test("reward is positive while eating, negative in toxin, and decays", () => {
    const eat = createEngine(2);
    eat.clearSources();
    eat.addSource("food", 0, 0);
    const b = eat.bacteria[0] as Bacterium;
    eat.setClamp(NEURON.RUN, 0);
    eat.setClamp(NEURON.TUMBLE, 1);
    eat.step(1);
    expect(b.reward).toBeGreaterThan(0.3);
    expect(b.reward).toBeLessThanOrEqual(1);
    eat.clearSources();
    eat.step(2);
    expect(Math.abs(b.reward)).toBeLessThan(0.02);

    const hurt = createEngine(2);
    hurt.clearSources();
    hurt.addSource("toxin", 0, 0);
    const hb = hurt.bacteria[0] as Bacterium;
    hurt.setClamp(NEURON.RUN, 0);
    hurt.setClamp(NEURON.TUMBLE, 1);
    hurt.step(1);
    expect(hb.reward).toBeLessThan(-0.3);
    expect(hb.reward).toBeGreaterThanOrEqual(-1);
  });

  test("edits write live weights too; reset and scramble rebuild them", () => {
    const e = createEngine(1);
    const b = e.selected() as Bacterium;
    e.setWeight(NEURON.SCENT, NEURON.KINASE, 2);
    expect(b.w[SCENT_KINASE]).toBe(2);
    expect(b.genome.weights[SCENT_KINASE]).toBe(2);
    e.resetBrain();
    expect(b.w[SCENT_KINASE]).toBe(0);
    expect(Array.from(b.w)).toEqual(Array.from(b.genome.weights));
    e.scrambleBrain();
    expect(Array.from(b.w)).toEqual(Array.from(b.genome.weights));
    expect(e.neurons[NEURON.SCENT]?.id).toBe("SCENT");
  });

  test("version bumps on learning drift, setLearning, setPairing and forget", () => {
    const { e, b } = trainCell(3, "food");
    const v = e.version;
    e.setLearning(false);
    expect(e.version).toBe(v + 1);
    e.setLearning(true);
    e.setPairing("none");
    expect(e.version).toBe(v + 3);
    // drift: force the selected cell's live weight far from the snapshot, then step
    const v2 = e.version;
    b.w[SCENT_KINASE] = (b.w[SCENT_KINASE] as number) + 0.5;
    e.step(0.1);
    expect(e.version).toBe(v2 + 1);
    e.step(0.1);
    expect(e.version).toBe(v2 + 1);
    e.forget();
    expect(e.version).toBe(v2 + 2);
  });

  test("evolution: offspring inherit inborn weights and plastic masks, never learned ones", () => {
    const e = createEngine(9);
    e.setMode("evolution");
    e.setPairing("food");
    expect(e.bacteria.some((b) => b.genome.plastic.some((p) => p > 0))).toBe(true);
    for (let i = 0; i < 40; i++) e.step(0.25);
    for (const b of e.bacteria) for (let i = 0; i < N * N; i++) b.w[i] = 5.5; // "learned" marker
    const inborn = new Set(e.bacteria.map((b) => b.genome.weights));
    e.nextGeneration();
    for (const b of e.bacteria) {
      expect(Array.from(b.w)).toEqual(Array.from(b.genome.weights));
      expect(b.genome.weights.every((v) => v !== 5.5)).toBe(true);
    }
    expect(e.bacteria.filter((b) => inborn.has(b.genome.weights)).length).toBe(6); // elites only
    expect(e.bacteria.some((b) => b.genome.plastic.some((p) => p > 0))).toBe(true);
  });
});

describe("scent sources and pairing", () => {
  const count = (e: Engine, kind: string) => e.sources.filter((s) => s.kind === kind).length;

  test("scent is sampled, standalone, and never eaten", () => {
    const e = createEngine(1);
    e.clearSources();
    const s = e.addSource("scent", 5, 0);
    expect(s.radius).toBeCloseTo(12, 0);
    expect(e.sample(5, 0).scent).toBeCloseTo(1, 5);
    expect(e.sample(5, 0).food).toBe(0);
    const b = e.bacteria[0] as Bacterium;
    b.x = 5;
    b.z = 0;
    for (let i = 0; i < 40; i++) e.step(0.25);
    expect(s.strength).toBe(1);
    expect(b.foodEaten).toBe(0);
    expect(b.fitness).toBe(0);
  });

  test("paired scent appears with food, is larger, and leaves with it", () => {
    const e = createEngine(1);
    e.clearSources();
    e.setPairing("food");
    const f = e.addSource("food", 10, -5);
    expect(count(e, "scent")).toBe(1);
    const sc = e.sources.find((s) => s.kind === "scent") as Source;
    expect([sc.x, sc.z]).toEqual([10, -5]);
    expect(sc.radius).toBeGreaterThan(1.7 * f.radius);
    e.addSource("toxin", 0, 0);
    expect(count(e, "scent")).toBe(1);
    e.removeSource(f.id);
    expect(count(e, "scent")).toBe(0);
    expect(count(e, "toxin")).toBe(1);
  });

  test("switching pairing updates existing sources; standalone scent survives", () => {
    const e = createEngine(1); // default solo dish: 3 food, 1 toxin
    e.clearSources();
    e.addSource("food", 5, 5);
    e.addSource("toxin", -5, 5);
    const mine = e.addSource("scent", 0, -20);
    e.setPairing("food");
    expect(count(e, "scent")).toBe(2);
    e.setPairing("toxin");
    expect(count(e, "scent")).toBe(2);
    const twin = e.sources.find((s) => s.kind === "scent" && s !== mine) as Source;
    expect([twin.x, twin.z]).toEqual([-5, 5]);
    e.setPairing("none");
    expect(e.sources.filter((s) => s.kind === "scent")).toEqual([mine]);
    expect(e.pairing).toBe("none");
  });

  test("eaten-out food takes its scent with it; restock and re-seeding respect pairing", () => {
    const e = createEngine(6);
    e.clearSources();
    e.setPairing("food");
    const f = e.addSource("food", 0, 0);
    f.strength = 0.03;
    const b = e.bacteria[0] as Bacterium;
    e.setClamp(NEURON.RUN, 0);
    e.setClamp(NEURON.TUMBLE, 1);
    for (let i = 0; i < 160 && e.sources.includes(f); i++) {
      e.step(0.25);
      b.energy = 1;
    }
    expect(e.sources.includes(f)).toBe(false);
    expect(count(e, "scent")).toBe(0);
    for (let i = 0; i < 120; i++) e.step(0.25);
    expect(count(e, "food")).toBeGreaterThanOrEqual(2);
    expect(count(e, "scent")).toBe(count(e, "food"));

    e.setMode("evolution");
    expect(count(e, "scent")).toBe(count(e, "food"));
    e.nextGeneration();
    expect(count(e, "scent")).toBe(count(e, "food"));
    expect(count(e, "food")).toBe(6);
    e.setPairing("toxin");
    expect(count(e, "scent")).toBe(count(e, "toxin"));
    e.nextGeneration();
    expect(count(e, "scent")).toBe(3);
    e.setPairing("none");
    e.nextGeneration();
    expect(count(e, "scent")).toBe(0);
  });
});
