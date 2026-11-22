import { N, NEURON, WEIGHT_MAX, WORLD_RADIUS } from "./types";
import type {
  Bacterium,
  Engine,
  GenerationStats,
  Genome,
  Mode,
  Pairing,
  Source,
  SourceKind,
} from "./types";
import { createRng } from "./rng";
import { BODY } from "./body";
import { NEURONS } from "./neurons";
import { BRAIN_DT, copyGenomeInto, settleBrain, stepBrain } from "./brain";
import { learnState, resetLearnState, stepLearning, stepReward } from "./learning";
import { crossoverGenome, designedGenome, mutateGenome, randomGenome } from "./genome";
import {
  EAT_RADIUS_FRAC,
  EAT_RATE,
  ENERGY_PER_FOOD,
  SOURCE_DEPLETION,
  SOURCE_DEPLETION_EVOLUTION,
  TOXIN_ENERGY_DRAIN,
  TOXIN_FITNESS_DRAIN,
  sampleSources,
} from "./world";

const MIN_FOOD_STRENGTH = 0.02; // a blob this faint counts as eaten up
const POPULATION = 24;
const ELITES = 6;
const IMMIGRANTS = 2;
const TOURNAMENT = 3;
const GENERATION_LENGTH = 30;
const RESPAWN_DELAY = 2;
const RESTOCK_DELAY = 3;
const TRAIL_MAX_POINTS = 120;
const TRAIL_EVERY = 6; // sub-steps

export function createEngine(seed = 1337): Engine {
  const rng = createRng(seed);
  const bacteria: Bacterium[] = [];
  const sources: Source[] = [];
  const history: GenerationStats[] = [];
  const listeners = new Set<() => void>();
  const probe = { food: 0, toxin: 0, scent: 0 };
  /** food/toxin source id -> its paired scent source id. */
  const partner = new Map<number, number>();
  let pairing: Pairing = "none";
  let learning = true;
  /** Live weights of the selected cell at the last version bump (to notice learning drift). */
  const lastW = new Float32Array(N * N);

  let mode: Mode = "solo";
  let generation = 1;
  let time = 0;
  let timeLeft = 0;
  let selectedId: number | null = null;
  let version = 0;
  let nextBacId = 1;
  let nextSourceId = 1;
  let respawnTimer = 0;
  let subCarry = 0;
  /** Rank score memory: this generation's fitness plus half of the previous one (damps layout luck). */
  const carried = new Map<number, number>();
  let restockArmed = false;
  let restockTimer = 0;

  const changed = () => {
    version++;
    const sel = selected();
    if (sel) lastW.set(sel.w);
    for (const l of listeners) l();
  };

  // ---------- construction helpers ----------
  const makeBacterium = (genome: Genome, x: number, z: number, hue: number): Bacterium => {
    const b: Bacterium = {
      id: nextBacId++,
      x,
      z,
      heading: rng.range(0, Math.PI * 2),
      speed: 0,
      tumbling: false,
      energy: 1,
      alive: true,
      genome,
      w: genome.weights.slice(),
      reward: 0,
      y: new Float32Array(N),
      act: new Float32Array(N),
      clamp: Array.from({ length: N }, (): number | null => null),
      fitness: 0,
      foodEaten: 0,
      trail: [x, z],
      hue,
    };
    settle(b);
    return b;
  };

  const settle = (b: Bacterium, seconds = mode === "solo" ? 40 : 10) => {
    b.y.fill(0);
    b.act.fill(0.5);
    sampleSources(sources, b.x, b.z, probe);
    settleBrain(b, probe.food, probe.toxin, probe.scent, seconds);
    resetLearnState(b);
  };

  const placeNearCentre = (b: Bacterium, spread: number) => {
    const r = spread * Math.sqrt(rng.next());
    const a = rng.range(0, Math.PI * 2);
    b.x = Math.cos(a) * r;
    b.z = Math.sin(a) * r;
    b.heading = rng.range(0, Math.PI * 2);
    b.speed = 0;
    b.tumbling = false;
    b.energy = 1;
    b.alive = true;
    b.fitness = 0;
    b.foodEaten = 0;
    b.trail.length = 0;
    b.trail.push(b.x, b.z);
  };

  const newSource = (
    kind: SourceKind,
    x: number,
    z: number,
    radius: number,
    strength: number,
  ): Source => {
    const s: Source = { id: nextSourceId++, kind, x, z, radius, strength };
    sources.push(s);
    return s;
  };

  const SCENT_RADIUS_FACTOR = 2;
  /** Create a source; food/toxin get a scent twin when the current pairing says so. */
  const spawn = (
    kind: SourceKind,
    x: number,
    z: number,
    radius: number,
    strength: number,
  ): Source => {
    const s = newSource(kind, x, z, radius, strength);
    if (kind !== "scent" && kind === pairing) {
      partner.set(s.id, newSource("scent", x, z, radius * SCENT_RADIUS_FACTOR, 1).id);
    }
    return s;
  };

  const removeById = (id: number) => {
    const i = sources.findIndex((s) => s.id === id);
    if (i < 0) return;
    sources.splice(i, 1);
    const twin = partner.get(id);
    if (twin !== undefined) {
      partner.delete(id);
      const j = sources.findIndex((s) => s.id === twin);
      if (j >= 0) sources.splice(j, 1);
    } else {
      for (const [k, v] of partner) if (v === id) partner.delete(k);
    }
  };

  const wipeSources = () => {
    sources.length = 0;
    partner.clear();
  };

  const seedSolo = () => {
    wipeSources();
    spawn("food", 20, 6, 9, 1);
    spawn("food", -16, 13, 9, 1);
    spawn("food", 4, -24, 9, 1);
    spawn("toxin", -14, -14, 7, 1);
  };

  /** Rings of food and toxin around the start, randomly rotated and jittered each generation. */
  const seedEvolution = () => {
    wipeSources();
    const rot = rng.range(0, Math.PI * 2);
    for (let i = 0; i < 6; i++) {
      const a = rot + (i * Math.PI * 2) / 6 + rng.range(-0.2, 0.2);
      const r = rng.range(15, 19);
      spawn("food", Math.cos(a) * r, Math.sin(a) * r, rng.range(7, 8.5), 1);
    }
    for (let i = 0; i < 3; i++) {
      const a = rot + ((i + 0.5) * Math.PI * 2) / 3 + rng.range(-0.3, 0.3);
      const r = rng.range(8, 12);
      spawn("toxin", Math.cos(a) * r, Math.sin(a) * r, rng.range(3.5, 5), 0.8);
    }
  };

  const buildSolo = () => {
    bacteria.length = 0;
    history.length = 0;
    seedSolo();
    const b = makeBacterium(designedGenome(), 0, 0, 0.35);
    bacteria.push(b);
    selectedId = b.id;
    generation = 1;
    timeLeft = 0;
    respawnTimer = 0;
  };

  const buildEvolution = () => {
    carried.clear();
    bacteria.length = 0;
    history.length = 0;
    seedEvolution();
    for (let i = 0; i < POPULATION; i++) {
      const b = makeBacterium(randomGenome(rng), 0, 0, rng.next());
      placeNearCentre(b, 6);
      settle(b);
      bacteria.push(b);
    }
    selectedId = (bacteria[0] as Bacterium).id;
    generation = 1;
    timeLeft = GENERATION_LENGTH;
  };

  const build = () => {
    time = 0;
    subCarry = 0;
    restockArmed = false;
    restockTimer = 0;
    if (mode === "solo") buildSolo();
    else buildEvolution();
  };

  // ---------- evolution ----------
  const breed = () => {
    const rank = (b: Bacterium) => b.fitness + 0.5 * (carried.get(b.id) ?? 0);
    const ranked = [...bacteria].sort((a, b) => rank(b) - rank(a));
    let sum = 0;
    let best = -Infinity;
    let worst = Infinity;
    for (const b of ranked) {
      sum += b.fitness;
      best = Math.max(best, b.fitness);
      worst = Math.min(worst, b.fitness);
    }
    history.push({ generation, best, mean: sum / ranked.length, worst });

    const nextCarried = new Map<number, number>();
    for (const b of ranked) nextCarried.set(b.id, rank(b));
    carried.clear();
    for (const [id, v] of nextCarried) carried.set(id, v);

    const tournament = (): Bacterium => {
      let winner = ranked[Math.floor(rng.next() * ranked.length)] as Bacterium;
      for (let k = 1; k < TOURNAMENT; k++) {
        const c = ranked[Math.floor(rng.next() * ranked.length)] as Bacterium;
        if (rank(c) > rank(winner)) winner = c;
      }
      return winner;
    };
    const mutationScale = Math.max(0.7, 1.2 * 0.97 ** (generation - 1));

    const elites = ranked.slice(0, ELITES);
    const next: Bacterium[] = [...elites];
    for (let i = elites.length; i < POPULATION - IMMIGRANTS; i++) {
      const parent = tournament();
      let genome = parent.genome;
      if (rng.next() < 0.5) genome = crossoverGenome(parent.genome, tournament().genome, rng);
      const hue = (((parent.hue + rng.gauss() * 0.03) % 1) + 1) % 1;
      next.push(makeBacterium(mutateGenome(genome, rng, mutationScale), 0, 0, hue));
    }
    for (let i = 0; i < IMMIGRANTS; i++)
      next.push(makeBacterium(randomGenome(rng), 0, 0, rng.next()));
    bacteria.length = 0;
    seedEvolution();
    for (const b of next) {
      b.w.set(b.genome.weights); // a new generation is a new life: nothing learned carries over
      placeNearCentre(b, 6);
      b.clamp.fill(null);
      settle(b);
      bacteria.push(b);
    }
    generation++;
    timeLeft = GENERATION_LENGTH;
    selectedId = (bacteria[0] as Bacterium).id; // elites[0] is the best of last generation
  };

  // ---------- physics ----------
  const randn = () => rng.gauss();

  const moveBody = (b: Bacterium, h: number) => {
    const act = b.act;
    if (b.tumbling) {
      b.heading += randn() * Math.sqrt(2 * BODY.tumbleTurnDiffusion * h);
      if (rng.next() < 1 - Math.exp(-BODY.tumbleEndRate * h)) b.tumbling = false;
    } else {
      b.heading += randn() * BODY.runTurnNoise * Math.sqrt(h);
      const t = act[NEURON.TUMBLE] as number;
      if (rng.next() < 1 - Math.exp(-BODY.tumbleMaxRate * t ** BODY.tumblePow * h))
        b.tumbling = true;
    }
    const swim = BODY.baseSpeed + BODY.speedRange * (act[NEURON.RUN] as number);
    b.speed = b.tumbling ? swim * BODY.tumbleSpeedFrac : swim;
    b.x += Math.cos(b.heading) * b.speed * h;
    b.z += Math.sin(b.heading) * b.speed * h;
    const r = Math.hypot(b.x, b.z);
    const limit = WORLD_RADIUS - 0.5;
    if (r > limit) {
      const nx = b.x / r;
      const nz = b.z / r;
      b.x = nx * limit;
      b.z = nz * limit;
      const dx = Math.cos(b.heading);
      const dz = Math.sin(b.heading);
      const dot = dx * nx + dz * nz;
      if (dot > 0) b.heading = Math.atan2(dz - 2 * dot * nz, dx - 2 * dot * nx);
    }
  };

  const substep = (h: number, subIndex: number) => {
    let foodRemoved = false;
    for (const b of bacteria) {
      if (!b.alive) continue;
      sampleSources(sources, b.x, b.z, probe);
      stepBrain(b, probe.food, probe.toxin, probe.scent, h);
      moveBody(b, h);

      // eating
      let intake = 0;
      for (let i = 0; i < sources.length; i++) {
        const s = sources[i] as Source;
        if (s.kind !== "food") continue;
        const dx = b.x - s.x;
        const dz = b.z - s.z;
        if (dx * dx + dz * dz > (EAT_RADIUS_FRAC * s.radius) ** 2) continue;
        const local = s.strength * Math.exp(-(dx * dx + dz * dz) / (2 * s.radius * s.radius));
        const amount = local * EAT_RATE * h;
        b.fitness += amount;
        b.foodEaten += amount;
        intake += amount;
        b.energy = Math.min(1, b.energy + amount * ENERGY_PER_FOOD);
        s.strength -=
          amount * (mode === "evolution" ? SOURCE_DEPLETION_EVOLUTION : SOURCE_DEPLETION);
        if (s.strength < MIN_FOOD_STRENGTH) s.strength = 0;
      }
      // toxin
      if (probe.toxin > 0.001) {
        b.energy -= probe.toxin * TOXIN_ENERGY_DRAIN * h;
        b.fitness -= probe.toxin * TOXIN_FITNESS_DRAIN * h;
      }
      stepReward(b, h, intake / h, probe.toxin);
      stepLearning(b, learnState(b), h, learning);
      b.energy -= (0.012 + 0.003 * b.speed) * h;
      if (b.energy <= 0) {
        b.energy = 0;
        b.alive = false;
        b.reward = 0;
        b.speed = 0;
        b.tumbling = false;
      }
      if (subIndex % TRAIL_EVERY === 0) {
        b.trail.push(b.x, b.z);
        if (b.trail.length > TRAIL_MAX_POINTS * 2)
          b.trail.splice(0, b.trail.length - TRAIL_MAX_POINTS * 2);
      }
    }
    for (let i = sources.length - 1; i >= 0; i--) {
      const s = sources[i] as Source;
      if (s.kind === "food" && s.strength <= 0) {
        removeById(s.id); // also takes its scent twin; both may sit anywhere in the list
        i = sources.length;
        foodRemoved = true;
        if (mode === "solo") restockArmed = true;
      }
    }
    if (foodRemoved) changed();
  };

  /** Solo dish: once the cell has eaten food out, keep at least two blobs available. */
  const restock = (h: number) => {
    if (!restockArmed) return;
    let foods = 0;
    for (const s of sources) if (s.kind === "food") foods++;
    if (foods >= 2) {
      restockArmed = false;
      restockTimer = 0;
      return;
    }
    restockTimer += h;
    if (restockTimer < RESTOCK_DELAY) return;
    restockTimer = 0;
    const cell = bacteria[0] as Bacterium;
    for (let tries = 0; tries < 30; tries++) {
      const r = Math.sqrt(rng.range(100, 30 * 30));
      const a = rng.range(0, Math.PI * 2);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (tries < 29 && Math.hypot(x - cell.x, z - cell.z) < 12) continue;
      spawn("food", x, z, 9, 1);
      changed();
      return;
    }
  };

  let subCounter = 0;
  const step = (dt: number) => {
    if (!(dt > 0)) return;
    subCarry += dt;
    while (subCarry >= BRAIN_DT) {
      subCarry -= BRAIN_DT;
      subCounter++;
      substep(BRAIN_DT, subCounter);
      time += BRAIN_DT;
      if (mode === "solo") {
        restock(BRAIN_DT);
        const b = bacteria[0] as Bacterium;
        if (!b.alive) {
          respawnTimer += BRAIN_DT;
          if (respawnTimer >= RESPAWN_DELAY) {
            respawnTimer = 0;
            placeNearCentre(b, 0);
            b.trail.length = 0;
            b.trail.push(0, 0);
            settle(b);
          }
        }
      } else {
        timeLeft -= BRAIN_DT;
        if (timeLeft <= 0) {
          breed();
          changed();
        }
      }
    }
    if (learning) {
      const sel = selected();
      if (sel) {
        const w = sel.w;
        for (let i = 0; i < N * N; i++) {
          if (Math.abs((w[i] as number) - (lastW[i] as number)) >= 0.25) {
            changed();
            break;
          }
        }
      }
    }
  };

  // ---------- public API ----------
  const selected = (): Bacterium | null => {
    if (selectedId === null) return null;
    return bacteria.find((b) => b.id === selectedId) ?? null;
  };

  const engine: Engine = {
    bacteria,
    sources,
    neurons: NEURONS,
    history,
    get mode() {
      return mode;
    },
    get generation() {
      return generation;
    },
    get time() {
      return time;
    },
    get generationTimeLeft() {
      return mode === "evolution" ? Math.max(0, timeLeft) : 0;
    },
    generationLength: GENERATION_LENGTH,
    get selectedId() {
      return selectedId;
    },
    get version() {
      return version;
    },

    step,
    sample(x, z) {
      return { ...sampleSources(sources, x, z, { food: 0, toxin: 0, scent: 0 }) };
    },

    addSource(kind, x, z) {
      const s = spawn(
        kind,
        x,
        z,
        kind === "food" ? 7 : kind === "toxin" ? 6 : 12,
        kind === "toxin" ? 0.9 : 1,
      );
      changed();
      return s;
    },
    removeSource(id) {
      if (!sources.some((s) => s.id === id)) return;
      removeById(id);
      changed();
    },
    clearSources() {
      wipeSources();
      changed();
    },

    select(id) {
      const next = id !== null && bacteria.some((b) => b.id === id) ? id : null;
      if (next === selectedId) return;
      selectedId = next;
      changed();
    },
    selected,
    setClamp(neuron, value) {
      const b = selected();
      if (!b || neuron < 0 || neuron >= N) return;
      const v = value === null ? null : Math.max(0, Math.min(1, value));
      b.clamp[neuron] = v;
      if (v !== null) b.act[neuron] = v;
      changed();
    },
    setWeight(from, to, value) {
      const b = selected();
      if (!b || from < 0 || from >= N || to < 0 || to >= N) return;
      const v = Math.max(-WEIGHT_MAX, Math.min(WEIGHT_MAX, value));
      b.genome.weights[from * N + to] = v;
      b.w[from * N + to] = v;
      changed();
    },
    resetBrain() {
      const b = selected();
      if (!b) return;
      copyGenomeInto(b.genome, designedGenome());
      b.w.set(b.genome.weights);
      settle(b);
      changed();
    },
    scrambleBrain() {
      const b = selected();
      if (!b) return;
      copyGenomeInto(b.genome, randomGenome(rng));
      b.w.set(b.genome.weights);
      settle(b);
      changed();
    },

    get learning() {
      return learning;
    },
    setLearning(on) {
      learning = on;
      changed();
    },
    get pairing() {
      return pairing;
    },
    setPairing(p) {
      pairing = p;
      // drop paired scents that no longer apply
      for (const [owner, twin] of partner) {
        const o = sources.find((s) => s.id === owner);
        if (!o || o.kind !== p) {
          partner.delete(owner);
          const j = sources.findIndex((s) => s.id === twin);
          if (j >= 0) sources.splice(j, 1);
        }
      }
      // add scents for sources of the paired kind that lack one
      if (p !== "none") {
        for (const s of sources) {
          if (s.kind !== p || partner.has(s.id)) continue;
          partner.set(s.id, newSource("scent", s.x, s.z, s.radius * SCENT_RADIUS_FACTOR, 1).id);
        }
      }
      changed();
    },
    forget() {
      const b = selected();
      if (!b) return;
      b.w.set(b.genome.weights);
      settle(b);
      changed();
    },

    setMode(m) {
      if (m === mode) return;
      mode = m;
      build();
      changed();
    },
    nextGeneration() {
      if (mode !== "evolution") return;
      breed();
      changed();
    },
    reset() {
      build();
      changed();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  build();
  return engine;
}
