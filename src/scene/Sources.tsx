import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  CircleGeometry,
  RingGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
} from "three";
import { engine } from "../engine";
import { theme } from "../theme";
import { hover } from "./shared";
import { makeFieldTexture, makeScentTexture } from "./textures";
import { noRaycast } from "./util";

const MAX_SOURCES = 512; // food/toxin and scent instances are in separate meshes
const LABELS = 8;
const FOOD = new Color(theme.food);
const TOXIN = new Color(theme.toxin);
const SCENT = new Color(theme.scent);
const PEAK_ALPHA = 0.42;
const SCENT_ALPHA = 0.28; // keep overlapping rings quiet
const PAIR_DIST2 = 0.5 * 0.5;

/** Material whose alpha is multiplied by a per-instance attribute `instanceAlpha`. */
function patchInstanceAlpha(mat: MeshBasicMaterial): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float instanceAlpha;\nvarying float vInstAlpha;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvInstAlpha = instanceAlpha;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vInstAlpha;")
      .replace("#include <opaque_fragment>", "diffuseColor.a *= vInstAlpha;\n#include <opaque_fragment>");
  };
}


/**
 * Chemical field drawn as a flat contour map: soft disc (edge at 2 sigma) with thin rings,
 * normal alpha blending so overlaps never exceed the theme colour. A solid marker in the
 * centre (dot = food, diamond = toxin). Small text labels when few sources or hovered.
 */
export function Sources() {
  const fieldRef = useRef<InstancedMesh>(null);
  const dotRef = useRef<InstancedMesh>(null);
  const diaRef = useRef<InstancedMesh>(null);
  const scentRef = useRef<InstancedMesh>(null);
  const triRef = useRef<InstancedMesh>(null);
  const labelGroups = useRef<(Group | null)[]>([]);
  const labelDivs = useRef<(HTMLDivElement | null)[]>([]);

  const res = useMemo(() => {
    const fieldGeo = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const alphaAttr = new InstancedBufferAttribute(new Float32Array(MAX_SOURCES), 1);
    fieldGeo.setAttribute("instanceAlpha", alphaAttr);
    const tex = makeFieldTexture();
    const fieldMat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    patchInstanceAlpha(fieldMat);
    const scentGeo = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const scentAlpha = new InstancedBufferAttribute(new Float32Array(MAX_SOURCES), 1);
    scentGeo.setAttribute("instanceAlpha", scentAlpha);
    const scentTex = makeScentTexture();
    const scentMat = new MeshBasicMaterial({ map: scentTex, transparent: true, depthWrite: false, fog: false });
    patchInstanceAlpha(scentMat);
    const triGeo = new RingGeometry(0.3, 0.46, 3, 1).rotateX(-Math.PI / 2);
    const dotGeo = new CircleGeometry(0.5, 20).rotateX(-Math.PI / 2);
    const diaGeo = new CircleGeometry(0.62, 4).rotateX(-Math.PI / 2);
    const mk = () => new MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, fog: false });
    return {
      fieldGeo, alphaAttr, tex, fieldMat, dotGeo, diaGeo,
      scentGeo, scentAlpha, scentTex, scentMat, triGeo, triMat: mk(),
      paired: new Uint8Array(MAX_SOURCES),
      dotMat: mk(), diaMat: mk(), dummy: new Object3D(), col: new Color(),
    };
  }, []);

  useEffect(
    () => () => {
      res.fieldGeo.dispose();
      res.tex.dispose();
      res.fieldMat.dispose();
      res.dotGeo.dispose();
      res.diaGeo.dispose();
      res.dotMat.dispose();
      res.diaMat.dispose();
      res.scentGeo.dispose();
      res.scentTex.dispose();
      res.scentMat.dispose();
      res.triGeo.dispose();
      res.triMat.dispose();
    },
    [res],
  );

  useFrame(() => {
    const field = fieldRef.current;
    const dot = dotRef.current;
    const dia = diaRef.current;
    const scent = scentRef.current;
    const tri = triRef.current;
    if (!field || !dot || !dia || !scent || !tri) return;
    const { dummy, col, alphaAttr, scentAlpha, paired } = res;
    const src = engine.sources;
    const n = Math.min(src.length, MAX_SOURCES);
    let nd = 0;
    let nx = 0;
    let ns = 0;
    let nf = 0;
    let nt = 0;
    let labelable = 0;
    for (let i = 0; i < n; i++) {
      const s = src[i];
      paired[i] = 0;
      if (s.kind === "scent") {
        const st = Math.max(0, Math.min(1, s.strength));
        dummy.position.set(s.x, 0.03, s.z);
        dummy.scale.setScalar(s.radius * 2);
        dummy.updateMatrix();
        scent.setMatrixAt(ns, dummy.matrix);
        scent.setColorAt(ns, SCENT);
        scentAlpha.array[ns++] = SCENT_ALPHA * (0.3 + 0.7 * st);
        for (let j = 0; j < n; j++) {
          const o = src[j];
          if (o.kind !== "scent" && (o.x - s.x) ** 2 + (o.z - s.z) ** 2 < PAIR_DIST2) {
            paired[i] = 1;
            break;
          }
        }
        if (!paired[i]) {
          labelable++;
          dummy.position.y = 0.08;
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          tri.setMatrixAt(nt, dummy.matrix);
          tri.setColorAt(nt++, SCENT);
        }
        continue;
      }
      labelable++;
      const food = s.kind === "food";
      const st = Math.max(0, Math.min(1, s.strength));
      dummy.position.set(s.x, 0.04, s.z);
      dummy.scale.setScalar(s.radius * 2 * (0.75 + 0.25 * st));
      dummy.updateMatrix();
      field.setMatrixAt(nf, dummy.matrix);
      field.setColorAt(nf, col.copy(food ? FOOD : TOXIN));
      alphaAttr.array[nf++] = PEAK_ALPHA * (0.25 + 0.75 * st);

      dummy.position.y = 0.08;
      dummy.scale.setScalar(0.8 + 0.5 * st);
      dummy.updateMatrix();
      if (food) {
        dot.setMatrixAt(nd, dummy.matrix);
        dot.setColorAt(nd++, col.copy(FOOD));
      } else {
        dia.setMatrixAt(nx, dummy.matrix);
        dia.setColorAt(nx++, col.copy(TOXIN));
      }
    }
    field.count = nf;
    scent.count = ns;
    tri.count = nt;
    dot.count = nd;
    dia.count = nx;
    alphaAttr.needsUpdate = true;
    scentAlpha.needsUpdate = true;
    for (const m of [field, dot, dia, scent, tri]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    // labels
    let used = 0;
    const few = labelable <= LABELS;
    for (let i = 0; i < n && used < LABELS; i++) {
      const s = src[i];
      if (paired[i]) continue;
      if (!few) {
        if (!hover.on || hover.overCell) continue;
        if (Math.hypot(s.x - hover.x, s.z - hover.z) > s.radius * 0.8) continue;
      }
      const g = labelGroups.current[used];
      const d = labelDivs.current[used];
      if (g && d) {
        g.position.set(s.x, 0.1, s.z + 1.6);
        if (d.dataset.kind !== s.kind) {
          d.dataset.kind = s.kind;
          d.textContent = s.kind;
        }
        d.style.display = "block";
      }
      used++;
    }
    for (let i = used; i < LABELS; i++) {
      const d = labelDivs.current[i];
      if (d) d.style.display = "none";
    }
  });

  return (
    <group>
      <instancedMesh
        ref={fieldRef}
        args={[res.fieldGeo, res.fieldMat, MAX_SOURCES]}
        frustumCulled={false}
        raycast={noRaycast}
        renderOrder={1}
      />
      <instancedMesh
        ref={dotRef}
        args={[res.dotGeo, res.dotMat, MAX_SOURCES]}
        frustumCulled={false}
        raycast={noRaycast}
        renderOrder={2}
      />
      <instancedMesh
        ref={diaRef}
        args={[res.diaGeo, res.diaMat, MAX_SOURCES]}
        frustumCulled={false}
        raycast={noRaycast}
        renderOrder={2}
      />
      <instancedMesh
        ref={scentRef}
        args={[res.scentGeo, res.scentMat, MAX_SOURCES]}
        frustumCulled={false}
        raycast={noRaycast}
        renderOrder={1}
      />
      <instancedMesh
        ref={triRef}
        args={[res.triGeo, res.triMat, MAX_SOURCES]}
        frustumCulled={false}
        raycast={noRaycast}
        renderOrder={2}
      />
      {Array.from({ length: LABELS }, (_, i) => (
        <group
          key={i}
          ref={(g) => {
            labelGroups.current[i] = g;
          }}
        >
          <Html center pointerEvents="none" zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
            <div
              ref={(d) => {
                labelDivs.current[i] = d;
              }}
              style={{
                display: "none",
                font: `500 10px ${theme.fontUi}`,
                letterSpacing: "0.06em",
                color: theme.textDim,
                whiteSpace: "nowrap",
                userSelect: "none",
                pointerEvents: "none",
              }}
            />
          </Html>
        </group>
      ))}
    </group>
  );
}
