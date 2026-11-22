import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect } from "react";
import { WORLD_RADIUS } from "../sim/types";
import { theme } from "../theme";
import { Bacteria, SelectionRing, Trails } from "./Bacteria";
import { Dish } from "./Dish";
import { Interaction } from "./Interaction";
import { Sources } from "./Sources";

const ELEV = (62 * Math.PI) / 180;
const FOV = 38;
const DIST = 115;

/** Once, pull the camera back far enough that the whole dish (plus margin) fits the viewport. */
function FitCamera() {
  const camera = useThree((s) => s.camera);
  const w = useThree((s) => s.size.width);
  const h = useThree((s) => s.size.height);
  useEffect(() => {
    if (w === 0 || h === 0) return;
    const t = Math.tan((FOV * Math.PI) / 360);
    const half = WORLD_RADIUS * 1.12;
    const dh = half / (t * (w / h));
    const dv = (half * Math.sin(ELEV) + 4) / t;
    const d = Math.max(dh, dv, 40);
    camera.position.set(0, Math.sin(ELEV) * d, Math.cos(ELEV) * d);
    camera.lookAt(0, 0, 0);
  }, [camera, w, h]);
  return null;
}

/** The 3D petri dish. Fills its parent; renders `engine` state each frame (does not step it). */
export function WorldScene() {
  return (
    <div style={{ width: "100%", height: "100%", position: "relative", background: theme.bg }}>
      <Canvas
        dpr={[1, 2]}
        camera={{
          fov: FOV,
          near: 1,
          far: 500,
          position: [0, Math.sin(ELEV) * DIST, Math.cos(ELEV) * DIST],
        }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={[theme.bg]} />
        <ambientLight intensity={1.0} />
        <directionalLight position={[20, 50, 15]} intensity={1.2} />
        <Dish />
        <Sources />
        <Trails />
        <Bacteria />
        <SelectionRing />
        <Interaction />
        <FitCamera />
        <OrbitControls
          makeDefault
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          minDistance={14}
          maxDistance={200}
          minPolarAngle={0.08}
          maxPolarAngle={Math.PI / 2 - 0.12}
          target={[0, 0, 0]}
        />
      </Canvas>
    </div>
  );
}
