import { useState } from "react";
import { engine } from "../engine";

/** One line under the diagram: learning switch and Forget (with one inline confirmation). */
export function LearningRow() {
  const [confirm, setConfirm] = useState(false);
  const on = engine.learning;
  return (
    <div className="brain-learnrow">
      <label className="brain-toggle">
        <input
          className="brain-check"
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(e) => engine.setLearning(e.target.checked)}
        />
        Learning {on ? "on" : "off"}
      </label>
      {confirm ? (
        <span className="brain-confirmline">
          Forget what it learned?
          <button
            type="button"
            className="brain-link"
            onClick={() => {
              engine.forget();
              setConfirm(false);
            }}
          >
            Forget
          </button>
          <button type="button" className="brain-link" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button type="button" className="brain-link" onClick={() => setConfirm(true)}>
          Forget
        </button>
      )}
    </div>
  );
}
