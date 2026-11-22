import { useEffect, useMemo } from "react";
import { CircleGeometry, CylinderGeometry, TorusGeometry } from "three";
import { theme } from "../theme";
import { WORLD_RADIUS as R } from "../sim/types";
import { makeDishTexture } from "./textures";

/** The petri dish: flat neutral floor, thin rim, a dark body for a little depth. */
export function Dish() {
  const parts = useMemo(
    () => ({
      floor: new CircleGeometry(R, 96).rotateX(-Math.PI / 2),
      body: new CylinderGeometry(R + 0.4, R + 0.4, 0.8, 96, 1, false),
      rim: new TorusGeometry(R + 0.15, 0.12, 8, 160).rotateX(Math.PI / 2),
      tex: makeDishTexture(),
    }),
    [],
  );

  useEffect(
    () => () => {
      parts.floor.dispose();
      parts.body.dispose();
      parts.rim.dispose();
      parts.tex.dispose();
    },
    [parts],
  );

  return (
    <group>
      <mesh geometry={parts.body} position={[0, -0.41, 0]}>
        <meshBasicMaterial color="#0a0e12" />
      </mesh>
      <mesh geometry={parts.floor}>
        <meshBasicMaterial map={parts.tex} />
      </mesh>
      <mesh geometry={parts.rim} position={[0, 0.02, 0]}>
        <meshBasicMaterial color={theme.dishRim} />
      </mesh>
    </group>
  );
}
