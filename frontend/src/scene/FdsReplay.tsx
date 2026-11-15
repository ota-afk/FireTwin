/* EXPERIMENT: replays a pre-computed FDS slice in the 3D scene (open the app with
   ?fds=/fds/sample_slice.json or the URL of any file in the fdsSlice.ts format). Points coloured with
   Smokeview's rainbow map and faded where the value is low; frames loop on the 10x demo clock.
   One <points> draw call; colours updated in useFrame without React state. */
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { SCENE_TIME_SCALE } from "./clock";
import { type SliceData, frameAt, parseSlice, rainbow } from "./fdsSlice";

export function FdsReplay({ url }: { url: string }) {
  const [data, setData] = useState<SliceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = useRef<HTMLSpanElement>(null);
  const t = useRef(0);
  const shown = useRef(-1);

  useEffect(() => {
    let live = true;
    fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.text(); })
      .then(text => live && setData(parseSlice(text, url)))
      .catch(e => live && setError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [url]);

  const points = useMemo(() => {
    if (!data) return null;
    const n = data.positions.length / 3;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.PointsMaterial({ size: 0.18, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true });
    return { g, m };
  }, [data]);
  useEffect(() => () => { points?.g.dispose(); points?.m.dispose(); }, [points]);

  useFrame((_, delta) => {
    if (!data || !points) return;
    t.current += Math.min(delta, 1) * SCENE_TIME_SCALE;
    const i = frameAt(data.times, data.times[0] + t.current);
    if (i === shown.current) return;
    shown.current = i;
    const col = points.g.attributes.color as THREE.BufferAttribute;
    const span = data.max - data.min || 1;
    data.frames[i].forEach((v, k) => {
      const x = (v - data.min) / span, [r, gg, b] = rainbow(x);
      col.setXYZW(k, r, gg, b, x < 0.02 ? 0 : 0.25 + 0.6 * x);
    });
    col.needsUpdate = true;
    if (label.current) {
      const synthetic = /synthetic/i.test(data.source) ? " · synthetic sample, not FDS output" : "";
      label.current.textContent = `FDS replay · ${data.quantity} · t = ${data.times[i].toFixed(1)} s${synthetic}`;
    }
  });

  return (
    <group name="fds-replay">
      {points && <points geometry={points.g} material={points.m} frustumCulled={false} />}
      <Html position={[0, -1.25, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <span ref={label} className="lab3d-tag r3f">{error ? `FDS replay failed: ${error}` : "FDS replay: loading…"}</span>
      </Html>
    </group>
  );
}
