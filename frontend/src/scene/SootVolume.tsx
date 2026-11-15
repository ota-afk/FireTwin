/* EXPERIMENT: Smokeview-style volumetric soot. One <points> object (one draw call) with a soft sprite
   at every cell centre of the g = 0 SootField; each sprite's opacity is the cell's soot
   (alpha = 1 - exp(-kappa c)), so overlapping cells read as a continuous 3D smoke volume.
   No React state per frame: the field is stepped and the opacity buffer flagged inside useFrame. */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { SimulateOut } from "../api/types";
import { CAMERA_FOV } from "../lab/core.js";
import { fieldSettings, sootDriverFor } from "./sootDriver";

const VERT = "attribute float aAlpha; varying float vA; uniform float uScale; uniform float uSize; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = aAlpha; gl_PointSize = uSize * uScale / max(0.05, -mv.z); gl_Position = projectionMatrix * mv; }";
const FRAG = "uniform vec3 uColor; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d) * vA; if (a < 0.004) discard; gl_FragColor = vec4(uColor, a);\n#include <colorspace_fragment>\n}";

export function SootVolume({ simulate, ignition }: { simulate: SimulateOut | null; ignition: number }) {
  const settings = useMemo(() => fieldSettings(simulate), [simulate]);
  const driver = useMemo(() => sootDriverFor(ignition), [ignition]);
  const { size, gl } = useThree();

  const { geometry, material } = useMemo(() => {
    const f = driver.field;
    const pos = new Float32Array(f.c.length * 3);
    for (let k = 0; k < f.nz; k++) for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx; i++) {
      const m = f.idx(i, j, k), p = f.centre(i, j, k);
      pos[m * 3] = p[0]; pos[m * 3 + 1] = p[1]; pos[m * 3 + 2] = p[2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(driver.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 }, uSize: { value: Math.max(f.dx, f.dy, f.dz) * 2.2 }, uColor: { value: new THREE.Color(0x3c4049) } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    });
    return { geometry: g, material: mat };
  }, [driver]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  useEffect(() => { if (simulate) driver.resume(fieldSettings(simulate)); }, [driver]); // catch up when a view opens
  useEffect(() => { if (!simulate) { driver.clear(); geometry.attributes.aAlpha.needsUpdate = true; } }, [driver, simulate, geometry]);
  useEffect(() => {
    material.uniforms.uScale.value = (size.height * gl.getPixelRatio()) / (2 * Math.tan((CAMERA_FOV * Math.PI) / 360));
  }, [material, size.height, gl]);

  useFrame((_, delta) => {
    if (!simulate) return;
    driver.advance(delta, settings);
    geometry.attributes.aAlpha.needsUpdate = true;
  });

  return <points geometry={geometry} material={material} frustumCulled={false} name="soot-volume" />;
}
