import { useEffect, useRef, useState } from "react";
import { engine } from "../engine";
import { N } from "../sim/types";
import { useUi } from "../uiStore";
import { useAttention, neuronIndex } from "./attention";
import { classify, sentence } from "./explain";
import type { Held, Situation } from "./explain";

const HIST = 24; // samples at 4 Hz = 6 s
const HOLD_MS = 1500;

export function Readout() {
  const [sit, setSit] = useState<Situation>("calm");
  const [held, setHeld] = useState<Held[]>([]);
  const hot = useAttention((s) => s.hot);
  const focus = useUi((s) => s.focusNeuron);
  const active = hot ?? focus;
  const activeId = active === null ? null : engine.neurons[active]?.id;

  const heldKey = useRef("");
  const cur = useRef<{ sit: Situation; since: number }>({ sit: "calm", since: 0 });

  useEffect(() => {
    const food: number[] = [];
    const toxin: number[] = [];
    const kin: number[] = [];
    let key = "";
    const iFood = neuronIndex("FOOD");
    const iToxin = neuronIndex("TOXIN");
    const iKin = neuronIndex("KINASE");
    const iScent = neuronIndex("SCENT");
    const wHist: number[] = [];
    const tick = () => {
      const b = engine.selected();
      if (!b) return;
      const k = `${b.id}:${engine.generation}`;
      if (k !== key) {
        key = k;
        food.length = toxin.length = kin.length = wHist.length = 0;
        cur.current = { sit: "calm", since: -1e9 };
      }
      food.push(b.act[iFood]);
      toxin.push(b.act[iToxin]);
      kin.push(b.act[iKin]);
      const hasScent = iScent >= 0 && iKin >= 0;
      const sw = hasScent ? b.w[iScent * N + iKin] : 0;
      wHist.push(sw);
      if (wHist.length > 9) wHist.shift();
      if (food.length > HIST) {
        food.shift();
        toxin.shift();
        kin.shift();
      }
      let sum = 0;
      for (const v of kin) sum += v;
      const back = Math.max(0, food.length - 5);
      const cand = classify(
        {
          alive: b.alive,
          tumbling: b.tumbling,
          foodNow: food[food.length - 1],
          foodThen: food[back],
          toxinNow: toxin[toxin.length - 1],
          toxinThen: toxin[back],
          kinaseNow: kin[kin.length - 1],
          kinaseAvg: sum / kin.length,
          scentNow: hasScent ? b.act[iScent] : 0,
          scentLearned: hasScent ? sw - b.genome.weights[iScent * N + iKin] : 0,
          scentRise: sw - wHist[0],
        },
        cur.current.sit,
      );
      const now = performance.now();
      if (cand !== cur.current.sit && (cand === "dead" || now - cur.current.since >= HOLD_MS)) {
        cur.current = { sit: cand, since: now };
        setSit(cand);
      }
      const hs: Held[] = [];
      let hk = "";
      for (let i = 0; i < N; i++) {
        const c = b.clamp[i];
        if (c !== null) {
          const n = engine.neurons[i];
          hs.push({ id: n.id, label: n.label, on: c > 0.5 });
          hk += `${i}${c > 0.5 ? "+" : "-"}`;
        }
      }
      if (hk !== heldKey.current) {
        heldKey.current = hk;
        setHeld(hs);
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, []);

  return (
    <p className="brain-readout" role="status" aria-live="polite" data-dim={active !== null}>
      {sentence(sit, held).map((p, k) => (
        <span key={k} className={p.n && p.n === activeId ? "brain-lit" : undefined}>
          {p.t}
        </span>
      ))}
    </p>
  );
}
