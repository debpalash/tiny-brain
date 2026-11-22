import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import {
  BufferGeometry,
  CircleGeometry,
  LineDashedMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
} from "three";
import { engine } from "../engine";
import { WORLD_RADIUS } from "../sim/types";
import { theme } from "../theme";
import { useUi } from "../uiStore";
import type { Tool } from "../uiStore";
import { hover } from "./shared";
import { noRaycast } from "./util";

const CLICK_SLOP_PX = 5;
const PICK_CELL = 2.4; // click on a cell with any tool
const PICK_CELL_SELECT = 6; // select tool is more forgiving
const GHOST_RADIUS: Record<Tool, number> = { food: 7, toxin: 6, scent: 12, erase: 3, select: 2.4 };
const TOOL_COLOR: Record<Tool, string> = {
  food: theme.food,
  toxin: theme.toxin,
  scent: theme.scent,
  erase: theme.textDim,
  select: theme.accent,
};
const TOOL_CURSOR: Record<Tool, string> = {
  food: "crosshair",
  toxin: "crosshair",
  scent: "crosshair",
  erase: "cell",
  select: "pointer",
};
const RIPPLES = 6;
const RIPPLE_LIFE = 0.6;

/**
 * Pointer handling on the dish plane, hover ghost ring and click ripples.
 * Clicks vs orbit drags are told apart by screen-space movement.
 */
export function Interaction() {
  const gl = useThree((s) => s.gl);
  const ghostRef = useRef<LineLoop>(null);
  const rippleRefs = useRef<(Mesh | null)[]>([]);
  const down = useRef<{ x: number; y: number } | null>(null);
  const lastTool = useRef<Tool | null>(null);
  const age = useRef(new Float32Array(RIPPLES).fill(-1));
  const rpos = useRef(new Float32Array(RIPPLES * 2));
  const rnext = useRef(0);

  const geo = useMemo(() => {
    const pts: Vector3[] = [];
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      pts.push(new Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    const ghostGeo = new BufferGeometry().setFromPoints(pts);
    const ghostMat = new LineDashedMaterial({
      color: theme.textDim,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      dashSize: 0.05,
      gapSize: 0.04,
    });
    const ghost = new LineLoop(ghostGeo, ghostMat);
    ghost.computeLineDistances();
    ghost.raycast = noRaycast;
    ghost.visible = false;
    ghost.renderOrder = 5;
    return {
      ghost,
      ghostGeo,
      ghostMat,
      ring: new RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2),
      disc: new CircleGeometry(WORLD_RADIUS, 64).rotateX(-Math.PI / 2),
    };
  }, []);
  useEffect(
    () => () => {
      geo.ghostGeo.dispose();
      geo.ghostMat.dispose();
      geo.ring.dispose();
      geo.disc.dispose();
    },
    [geo],
  );

  const ripple = (x: number, z: number, color: string) => {
    const i = rnext.current;
    rnext.current = (i + 1) % RIPPLES;
    age.current[i] = 0;
    rpos.current[i * 2] = x;
    rpos.current[i * 2 + 1] = z;
    const m = rippleRefs.current[i];
    if (m) (m.material as MeshBasicMaterial).color.set(color);
  };

  const act = (x: number, z: number) => {
    const tool = useUi.getState().tool;
    const reach = tool === "select" ? PICK_CELL_SELECT : PICK_CELL;
    let bestId: number | null = null;
    let bestD = reach * reach;
    for (const b of engine.bacteria) {
      const d = (b.x - x) ** 2 + (b.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        bestId = b.id;
      }
    }
    if (bestId !== null) {
      engine.select(bestId);
      ripple(x, z, theme.accent);
      return;
    }
    if (tool === "food" || tool === "toxin" || tool === "scent") {
      engine.addSource(tool, x, z);
      ripple(x, z, TOOL_COLOR[tool]);
    } else if (tool === "erase") {
      let sid: number | null = null;
      let sd = Infinity;
      for (const s of engine.sources) {
        const d = Math.hypot(s.x - x, s.z - z);
        // scent rings are huge: only its centre counts as a hit
        const reach = s.kind === "scent" ? 3 : Math.max(s.radius, 2) * 1.1 + 1.5;
        if (d < reach && d < sd) {
          sd = d;
          sid = s.id;
        }
      }
      if (sid !== null) {
        // a paired scent goes with its food/toxin partner: remove the partner instead
        const hit = engine.sources.find((s) => s.id === sid);
        if (hit && hit.kind === "scent") {
          const partner = engine.sources.find(
            (o) => o.kind !== "scent" && (o.x - hit.x) ** 2 + (o.z - hit.z) ** 2 < 0.25,
          );
          if (partner) sid = partner.id;
        }
        engine.removeSource(sid);
        ripple(x, z, theme.text);
      }
    }
  };

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    down.current = e.nativeEvent.button === 0 ? { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY } : null;
  };
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    const d = down.current;
    down.current = null;
    if (!d) return;
    if (Math.hypot(e.nativeEvent.clientX - d.x, e.nativeEvent.clientY - d.y) >= CLICK_SLOP_PX) return;
    act(e.point.x, e.point.z);
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    hover.x = e.point.x;
    hover.z = e.point.z;
    hover.on = true;
    hover.overCell = false;
    for (const b of engine.bacteria) {
      if ((b.x - e.point.x) ** 2 + (b.z - e.point.z) ** 2 < PICK_CELL * PICK_CELL) {
        hover.overCell = true;
        break;
      }
    }
    gl.domElement.style.cursor = TOOL_CURSOR[useUi.getState().tool];
  };
  const onOut = () => {
    hover.on = false;
    down.current = null;
    gl.domElement.style.cursor = "";
  };

  useFrame((_, delta) => {
    const g = ghostRef.current;
    if (g) {
      const tool = useUi.getState().tool;
      const h = hover;
      g.visible = h.on && !h.overCell && tool !== "select";
      if (g.visible) {
        if (lastTool.current !== tool) {
          lastTool.current = tool;
          geo.ghostMat.color.set(TOOL_COLOR[tool]);
        }
        g.position.set(h.x, 0.1, h.z);
        g.scale.setScalar(GHOST_RADIUS[tool]);
      }
    }
    const a = age.current;
    for (let i = 0; i < RIPPLES; i++) {
      const m = rippleRefs.current[i];
      if (!m) continue;
      if (a[i] < 0) {
        m.visible = false;
        continue;
      }
      a[i] += delta;
      const f = a[i] / RIPPLE_LIFE;
      if (f >= 1) {
        a[i] = -1;
        m.visible = false;
        continue;
      }
      m.visible = true;
      m.position.set(rpos.current[i * 2], 0.12, rpos.current[i * 2 + 1]);
      m.scale.setScalar(0.8 + 3.5 * (1 - (1 - f) ** 3));
      (m.material as MeshBasicMaterial).opacity = 0.45 * (1 - f);
    }
  });

  return (
    <group>
      <mesh
        geometry={geo.disc}
        position={[0, 0.02, 0]}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerMove={onMove}
        onPointerOut={onOut}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <primitive object={geo.ghost} ref={ghostRef} />
      {Array.from({ length: RIPPLES }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            rippleRefs.current[i] = m;
          }}
          geometry={geo.ring}
          visible={false}
          raycast={noRaycast}
          renderOrder={5}
        >
          <meshBasicMaterial transparent depthWrite={false} fog={false} />
        </mesh>
      ))}
    </group>
  );
}
