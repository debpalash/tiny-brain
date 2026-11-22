import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineDashedMaterial,
  LineLoop,
  LineSegments,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from "three";
import { engine } from "../engine";
import { theme } from "../theme";
import { cellColor, noRaycast } from "./util";

const MAX_CELLS = 64;
const TAIL_SEG = 12;
const TRAIL_PTS = 90;
const BODY_Y = 0.4;
// body: radius 0.35 + straight 1.5 => about 2.2 long
const BODY_R = 0.35;
const BODY_LEN = 1.5;

/** Matte rod bodies with wiggling flagella. Instanced; no per-frame allocation. */
export function Bacteria() {
  const bodyRef = useRef<InstancedMesh>(null);
  const tailRef = useRef<InstancedMesh>(null);

  const res = useMemo(
    () => ({
      bodyGeo: new CapsuleGeometry(BODY_R, BODY_LEN, 6, 14).rotateZ(Math.PI / 2),
      tailGeo: new SphereGeometry(1, 8, 6),
      mat: new MeshStandardMaterial({ roughness: 0.9, metalness: 0 }),
      dummy: new Object3D(),
      col: new Color(),
      col2: new Color(),
      // per-slot smoothed animation state: freq, amp, wavenumber, curl, phase
      anim: new Float32Array(MAX_CELLS * 5),
    }),
    [],
  );

  useEffect(
    () => () => {
      res.bodyGeo.dispose();
      res.tailGeo.dispose();
      res.mat.dispose();
    },
    [res],
  );

  useFrame((_, delta) => {
    const body = bodyRef.current;
    const tail = tailRef.current;
    if (!body || !tail) return;
    const { dummy, col, col2, anim } = res;
    const bs = engine.bacteria;
    const n = Math.min(bs.length, MAX_CELLS);
    const evo = engine.mode === "evolution";
    const dt = Math.min(delta, 0.1);
    const k = Math.min(1, dt * 7);

    for (let i = 0; i < n; i++) {
      const b = bs[i];
      const a = i * 5;
      // running = fast, tight ripple; tumbling = slow, wide flailing
      let fT: number, aT: number, wT: number, cT: number;
      if (!b.alive) {
        fT = 0.4; aT = 0.03; wT = 0.6; cT = 0.1;
      } else if (b.tumbling) {
        fT = 6; aT = 0.5; wT = 0.4; cT = 0.6;
      } else {
        fT = 15 + b.speed * 0.5; aT = 0.12; wT = 0.95; cT = 0;
      }
      anim[a] += (fT - anim[a]) * k;
      anim[a + 1] += (aT - anim[a + 1]) * k;
      anim[a + 2] += (wT - anim[a + 2]) * k;
      anim[a + 3] += (cT - anim[a + 3]) * k;
      anim[a + 4] += anim[a] * dt;
      const ph = anim[a + 4];
      const amp = anim[a + 1];
      const wn = anim[a + 2];
      const curl = anim[a + 3];

      cellColor(b, evo, col);
      const dx = Math.cos(b.heading);
      const dz = Math.sin(b.heading);
      const px = -dz;
      const pz = dx;

      col2.copy(col).multiplyScalar(0.8);
      for (let s = 0; s < TAIL_SEG; s++) {
        const kk = (s + 1) / TAIL_SEG;
        const dist = 1.05 + s * 0.17;
        const lat = amp * kk * Math.sin(ph - s * wn) + curl * kk * kk;
        dummy.position.set(b.x - dx * dist + px * lat, BODY_Y - 0.05, b.z - dz * dist + pz * lat);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0.07 * (1 - 0.5 * kk));
        dummy.updateMatrix();
        const idx = i * TAIL_SEG + s;
        tail.setMatrixAt(idx, dummy.matrix);
        tail.setColorAt(idx, col2);
      }

      dummy.position.set(b.x, BODY_Y, b.z);
      dummy.rotation.set(0, -b.heading, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      body.setMatrixAt(i, dummy.matrix);
      body.setColorAt(i, col);
    }

    body.count = n;
    tail.count = n * TAIL_SEG;
    for (const m of [body, tail]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group>
      <instancedMesh
        ref={tailRef}
        args={[res.tailGeo, res.mat, MAX_CELLS * TAIL_SEG]}
        frustumCulled={false}
        raycast={noRaycast}
      />
      <instancedMesh
        ref={bodyRef}
        args={[res.bodyGeo, res.mat, MAX_CELLS]}
        frustumCulled={false}
        raycast={noRaycast}
      />
    </group>
  );
}

/** Thin faint trail. Evolution: selected cell only. Solo: every cell (just one). */
export function Trails() {
  const res = useMemo(() => {
    const maxVerts = MAX_CELLS * (TRAIL_PTS - 1) * 2;
    const pos = new BufferAttribute(new Float32Array(maxVerts * 3), 3);
    const colr = new BufferAttribute(new Float32Array(maxVerts * 4), 4);
    pos.setUsage(35048); // DynamicDrawUsage
    colr.setUsage(35048);
    const geo = new BufferGeometry();
    geo.setAttribute("position", pos);
    geo.setAttribute("color", colr);
    geo.setDrawRange(0, 0);
    const mat = new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    return { geo, mat, pos, colr, col: new Color() };
  }, []);

  useEffect(
    () => () => {
      res.geo.dispose();
      res.mat.dispose();
    },
    [res],
  );

  useFrame(() => {
    const { pos, colr, col, geo } = res;
    const p = pos.array as Float32Array;
    const c = colr.array as Float32Array;
    const bs = engine.bacteria;
    const n = Math.min(bs.length, MAX_CELLS);
    const evo = engine.mode === "evolution";
    const sel = engine.selectedId;
    let v = 0;
    for (let i = 0; i < n; i++) {
      const b = bs[i];
      if (evo && b.id !== sel) continue;
      const tr = b.trail;
      const pts = Math.min(tr.length >> 1, TRAIL_PTS);
      if (pts < 2) continue;
      const base = (tr.length >> 1) - pts;
      cellColor(b, evo, col);
      const gain = b.alive ? 0.5 : 0.2;
      for (let j = 0; j < pts - 1; j++) {
        for (let e = 0; e < 2; e++) {
          const q = (base + j + e) * 2;
          const f = (j + e) / (pts - 1);
          p[v * 3] = tr[q];
          p[v * 3 + 1] = 0.1;
          p[v * 3 + 2] = tr[q + 1];
          c[v * 4] = col.r;
          c[v * 4 + 1] = col.g;
          c[v * 4 + 2] = col.b;
          c[v * 4 + 3] = f * gain;
          v++;
        }
      }
    }
    geo.setDrawRange(0, v);
    pos.needsUpdate = true;
    colr.needsUpdate = true;
  });

  return <lineSegments geometry={res.geo} material={res.mat} frustumCulled={false} raycast={noRaycast} renderOrder={2} />;
}

const SEG = 64;
function circlePoints(): Vector3[] {
  const pts: Vector3[] = [];
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    pts.push(new Vector3(Math.cos(a), 0, Math.sin(a)));
  }
  return pts;
}

/**
 * One thin ring around the selected cell plus a small heading arrow.
 * While the cell is tumbling the ring turns dashed and slowly spins.
 */
export function SelectionRing() {
  const groupRef = useRef<Group>(null);
  const spinRef = useRef<Group>(null);
  const arrowRef = useRef<Group>(null);
  const solidRef = useRef<LineLoop>(null);
  const dashedRef = useRef<LineLoop>(null);

  const res = useMemo(() => {
    const ringGeo = new BufferGeometry().setFromPoints(circlePoints());
    const solid = new LineBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.8, depthWrite: false });
    const dashed = new LineDashedMaterial({
      color: theme.accent,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      dashSize: 0.14,
      gapSize: 0.1,
    });
    const arrowGeo = new BufferGeometry().setFromPoints([
      new Vector3(1.4, 0, 0), new Vector3(2.3, 0, 0),
      new Vector3(2.3, 0, 0), new Vector3(2.05, 0, 0.14),
      new Vector3(2.3, 0, 0), new Vector3(2.05, 0, -0.14),
    ]);
    const arrowMat = new LineBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.9, depthWrite: false });
    const arrow = new LineSegments(arrowGeo, arrowMat);
    arrow.raycast = noRaycast;
    return { ringGeo, solid, dashed, arrowGeo, arrowMat, arrow };
  }, []);

  useEffect(() => {
    const dashedLoop = dashedRef.current;
    if (dashedLoop) dashedLoop.computeLineDistances();
    const arrowGroup = arrowRef.current;
    arrowGroup?.add(res.arrow);
    return () => {
      arrowGroup?.remove(res.arrow);
      res.ringGeo.dispose();
      res.solid.dispose();
      res.dashed.dispose();
      res.arrowGeo.dispose();
      res.arrowMat.dispose();
    };
  }, [res]);

  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const id = engine.selectedId;
    let found = false;
    if (id !== null) {
      for (const b of engine.bacteria) {
        if (b.id !== id) continue;
        const t = state.clock.elapsedTime;
        const tum = b.alive && b.tumbling;
        g.position.set(b.x, 0.12, b.z);
        if (spinRef.current) spinRef.current.rotation.y = tum ? t * 1.2 : 0;
        if (arrowRef.current) {
          arrowRef.current.rotation.y = -b.heading;
          arrowRef.current.visible = b.alive;
        }
        if (solidRef.current) solidRef.current.visible = !tum;
        if (dashedRef.current) dashedRef.current.visible = tum;
        found = true;
        break;
      }
    }
    g.visible = found;
  });

  return (
    <group ref={groupRef} visible={false}>
      <group ref={spinRef} scale={1.75}>
        <lineLoop ref={solidRef} geometry={res.ringGeo} material={res.solid} raycast={noRaycast} />
        <lineLoop ref={dashedRef} geometry={res.ringGeo} material={res.dashed} raycast={noRaycast} visible={false} />
      </group>
      <group ref={arrowRef} />
    </group>
  );
}
