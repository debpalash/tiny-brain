import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { NeuronsMsg, HelloMsg } from "../brainlink/protocol";
import { theme } from "../theme";
import { KIND_COLOR } from "./colors";
import { layoutNeurons } from "./layout";
import type { Layout } from "./layout";
import { activity, onFrame, selectNeuron, setHovered, useLarva } from "./link";

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aGroup;
attribute float aAct;
attribute float aIndex;
uniform float uScale;
uniform float uBase;
uniform float uFocus;
uniform float uSel;
uniform float uHot;
uniform vec3 uAccent;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float a = aAct;
  float inFocus = (uFocus < 0.0 || abs(aGroup - uFocus) < 0.5) ? 1.0 : 0.0;
  float sel = abs(aIndex - uSel) < 0.5 ? 1.0 : 0.0;
  float hot = abs(aIndex - uHot) < 0.5 ? 1.0 : 0.0;
  float mark = max(sel, hot * 0.6);
  vec3 c = aColor * mix(0.6, 1.1, a);
  c = mix(c, uAccent, mark * 0.85);
  vColor = min(c, vec3(0.85));
  vAlpha = mix(0.3, 1.0, inFocus) * mix(0.55, 0.95, a);
  vAlpha = max(vAlpha, mark);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float size = uBase * (1.0 + 0.8 * a) * (1.0 + 1.6 * mark);
  gl_PointSize = max(1.5, size * uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float edge = smoothstep(0.5, 0.35, d);
  gl_FragColor = vec4(vColor, vAlpha * edge);
  #include <colorspace_fragment>
}
`;

interface Built {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  act: THREE.BufferAttribute;
  layout: Layout;
}

/** Everything per-neuron lives in typed arrays; there are no per-neuron objects. */
function build(neurons: NeuronsMsg, hello: HelloMsg): Built {
  const n = neurons.group.length;
  const layout = layoutNeurons(neurons);
  const geometry = new THREE.BufferGeometry();
  const col = new Float32Array(n * 3);
  const grp = new Float32Array(n);
  const idx = new Float32Array(n);
  const byId = new Map<number, THREE.Color>();
  const tmp = new THREE.Color();
  for (const g of hello.groups) byId.set(g.id, new THREE.Color(KIND_COLOR[g.kind]));
  const fallback = new THREE.Color(theme.textDim);
  for (let i = 0; i < n; i++) {
    tmp.copy(byId.get(neurons.group[i]) ?? fallback);
    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
    grp[i] = neurons.group[i];
    idx[i] = i;
  }
  const act = new THREE.BufferAttribute(new Uint8Array(n), 1, true);
  act.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", new THREE.BufferAttribute(layout.positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  geometry.setAttribute("aGroup", new THREE.BufferAttribute(grp, 1));
  geometry.setAttribute("aIndex", new THREE.BufferAttribute(idx, 1));
  geometry.setAttribute("aAct", act);
  geometry.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uScale: { value: 500 },
      uBase: { value: layout.radius * 0.014 * Math.min(1, Math.max(0.3, Math.cbrt(3016 / n))) },
      uFocus: { value: -1 },
      uSel: { value: -1 },
      uHot: { value: -1 },
      uAccent: { value: new THREE.Color(theme.accent) },
    },
  });
  return { geometry, material, act, layout };
}

function Points({ built }: { built: Built }) {
  const { geometry, material, act, layout } = built;
  const invalidate = useThree((s) => s.invalidate);
  const raycaster = useThree((s) => s.raycaster);
  const lastVersion = useRef(-1);

  useEffect(() => {
    raycaster.params.Points.threshold = layout.radius * 0.02;
  }, [raycaster, layout.radius]);

  // Anything that changes what is drawn asks for exactly one new frame.
  useEffect(() => {
    const a = onFrame(invalidate);
    const b = useLarva.subscribe((s, p) => {
      if (s.focusGroup !== p.focusGroup || s.selected !== p.selected || s.hovered !== p.hovered) invalidate();
    });
    invalidate();
    return () => {
      a();
      b();
    };
  }, [invalidate]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame((state) => {
    const u = material.uniforms;
    const fov = (state.camera as THREE.PerspectiveCamera).fov;
    u.uScale.value = (state.size.height * state.viewport.dpr) / (2 * Math.tan((fov * Math.PI) / 360));
    const s = useLarva.getState();
    u.uFocus.value = s.focusGroup ?? -1;
    u.uSel.value = s.selected ?? -1;
    u.uHot.value = s.hovered ?? -1;
    if (activity.version !== lastVersion.current && activity.bytes && activity.bytes.length === act.count) {
      lastVersion.current = activity.version;
      (act.array as Uint8Array).set(activity.bytes);
      act.needsUpdate = true;
    }
  });

  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>): number | null => {
    const { focusGroup, neurons } = useLarva.getState();
    if (!neurons) return null;
    for (const hit of e.intersections) {
      if (hit.object !== e.object || hit.index === undefined) continue;
      if (focusGroup === null || neurons.group[hit.index] === focusGroup) return hit.index;
    }
    return null;
  };

  return (
    <group>
      <points
        geometry={geometry}
        material={material}
        frustumCulled={false}
        onPointerMove={(e) => {
          e.stopPropagation();
          setHovered(pick(e));
        }}
        onPointerOut={() => setHovered(null)}
        onClick={(e) => {
          if (e.delta > 4) return;
          const i = pick(e);
          if (i !== null) {
            e.stopPropagation();
            selectNeuron(i);
          }
        }}
      />
      {layout.unknownCenter && (
        <Html position={[layout.unknownCenter[0], -layout.radius * 1.15, 0]} center style={{ pointerEvents: "none" }}>
          <div className="larva-unknown">Position unknown ({layout.unknownCount})</div>
        </Html>
      )}
    </group>
  );
}

export function BrainScene() {
  const neurons = useLarva((s) => s.neurons);
  const hello = useLarva((s) => s.hello);
  const built = useMemo(() => (neurons && hello ? build(neurons, hello) : null), [neurons, hello]);
  if (!built) return null;
  const r = built.layout.radius;
  const sign = built.layout.viewSign === -1 ? -1 : 1;
  return (
    <Canvas
      frameloop="demand"
      flat
      dpr={[1, 2]}
      camera={{ position: [0, 0, sign * r * 3.4], fov: 45, near: 0.1, far: r * 40 }}
      onPointerMissed={() => selectNeuron(null)}
      gl={{ antialias: true }}
      style={{ background: theme.dish }}
    >
      <OrbitControls
        makeDefault
        enableDamping={false}
        rotateSpeed={0.7}
        minDistance={r * 0.6}
        maxDistance={r * 10}
        target={[0, 0, 0]}
      />
      <Points built={built} />
    </Canvas>
  );
}
