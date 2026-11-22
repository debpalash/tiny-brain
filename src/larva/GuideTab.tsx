import { useLarva } from "./link";

export function GuideTab() {
  const hello = useLarva((s) => s.hello);
  const neurons = useLarva((s) => s.neurons);
  if (!hello) return null;
  const n = hello.network;
  const assumedSigns = neurons ? neurons.signKnown.reduce((a, k) => a + (k === 0 ? 1 : 0), 0) : null;
  return (
    <div className="lv-guide">
      <ol>
        <li>
          This is a real insect brain: {n.neurons.toLocaleString()} neurons and {n.synapses.toLocaleString()} synapses, wired as in a published map
          of the connections (a connectome), and simulated live.
        </li>
        <li>Smells arrive at the smell sensors and pass through relay neurons to the memory cells.</li>
        <li>The memory cells are the mushroom body. Each smell lights up its own small set of them, so the brain can tell smells apart.</li>
        <li>
          Reward and punishment neurons send a teaching signal. When it arrives together with a smell, the links from those memory cells to the
          output neurons change.
        </li>
        <li>The output neurons decide: approach or avoid. At the start every smell means nothing, so the verdict is indifferent.</li>
        <li>Try it: pick Odour A, press Teach with reward, then press Test. Compare with Odour B, which was never taught.</li>
        <li>Click a box in the pathway to focus on that group, and click any neuron in the 3D view to inspect it.</li>
      </ol>
      <h3>What is assumed</h3>
      <ul>
        <li>Wiring source: {n.source}.</li>
        {n.caveats.map((c) => (
          <li key={c}>{c}</li>
        ))}
        {assumedSigns !== null && assumedSigns > 0 && (
          <li>
            For {assumedSigns.toLocaleString()} of {n.neurons.toLocaleString()} neurons it is assumed, not measured, whether they excite or calm
            their targets.
          </li>
        )}
        <li>The verdict meter is a summary of the output neurons, not a measured behaviour.</li>
      </ul>
    </div>
  );
}
