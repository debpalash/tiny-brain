import { useState } from "react";
import { PROTOCOL_VERSION } from "../brainlink/protocol";
import { useLarva } from "./link";

const BUILD = "cmake -S native -B native/build -DCMAKE_BUILD_TYPE=Release && cmake --build native/build -j";
const RUN = "./native/build/larva_server";

function Cmd({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="lv-cmd">
      <code>{text}</code>
      <button
        type="button"
        className="lv-btn"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setDone(true));
        }}
      >
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Shown instead of the brain whenever the native engine is not reachable. */
export function Offline() {
  const conn = useLarva((s) => s.conn);
  const engineProtocol = useLarva((s) => s.engineProtocol);
  if (conn === "connecting") {
    return (
      <div className="lv-offline" role="status">
        <p>Connecting to the brain engine…</p>
      </div>
    );
  }
  if (conn === "mismatch") {
    return (
      <div className="lv-offline" role="status">
        <h2>The engine speaks a different version</h2>
        <p>
          This page expects protocol {PROTOCOL_VERSION}; the engine reports {engineProtocol ?? "another one"}. Rebuild the engine so both match:
        </p>
        <Cmd text={BUILD} />
        <p className="lv-dim">Checking again every few seconds.</p>
      </div>
    );
  }
  return (
    <div className="lv-offline" role="status">
      <h2>The brain engine is not running</h2>
      <p>
        The fly larva brain is simulated by a separate program on your computer. Build it once, then start it from the project folder:
      </p>
      <Cmd text={BUILD} />
      <p className="lv-dim">then</p>
      <Cmd text={RUN} />
      <p className="lv-dim">This page retries automatically and will connect as soon as the engine is up.</p>
    </div>
  );
}
