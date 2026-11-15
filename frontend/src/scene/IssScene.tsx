/* FE-04: the ISS module scene.
   <Suspense> shows the coded FallbackModule while the glTF loads; an error boundary keeps showing it
   if the file is missing or broken, so the scene is never empty. OrbitControls (camera kept inside
   the aisle), soft lighting, and a marker at every detector position /detect returns. */
import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Component, type MutableRefObject, type ReactNode, Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import type { DetectOut, SimulateOut } from "../api/types";
import { CAMERA_FOV, CAMERA_START, clampCamera } from "../lab/core.js";
import { FallbackModule } from "./FallbackModule";
import { Flame } from "./Flame";
import { Smoke } from "./Smoke";
import { SootVolume } from "./SootVolume";
import { FdsReplay } from "./FdsReplay";
import { IssLab } from "./IssLab";
import { detectorMarks } from "./detectors";
import { simSecondsSince } from "./clock";

// EXPERIMENT switches, read once from the URL:
//   ?transport=particles  the FE-06 particle smoke instead of the g = 0 soot field
//   ?fds=/fds/sample_slice.json  replay a pre-computed FDS slice (scene/fdsSlice.ts format)
const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
const TRANSPORT = params.get("transport") === "particles" ? "particles" : "field";
const fdsReplayUrl = params.get("fds");

// Falls back to the coded module when the glTF can't load (Suspense only covers "still loading").
class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.info("ISS glTF unavailable, showing the coded module:", err instanceof Error ? err.message : err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function KeepCameraInside() {
  useFrame(({ camera }) => clampCamera(camera));
  return null;
}

const IDLE_COLOR = 0x63e6be;
const ALARM_COLOR = 0xff5a4a;

// FE-04 markers at the /detect positions; FE-06: the tripped one turns red and pulses.
function DetectorMarkers({ detect, alarmId }: { detect: DetectOut | null; alarmId: string | null }) {
  const marks = useMemo(() => detectorMarks(detect), [detect]);
  const halos = useRef<Record<string, THREE.Mesh | null>>({});
  const t = useRef(0);
  useFrame((_, delta) => {
    t.current += delta;
    const pulse = 1 + 0.35 * (0.5 + 0.5 * Math.sin(t.current * 8));
    for (const [key, mesh] of Object.entries(halos.current)) {
      if (mesh) mesh.scale.setScalar(key.endsWith(`-${alarmId}`) ? pulse : 1);
    }
  });
  return (
    <>
      {marks.map((m, index) => {
        const key = `${index}-${m.id}`; // index + id: two detectors could share an id
        const tripped = m.id === alarmId;
        const color = tripped ? ALARM_COLOR : IDLE_COLOR;
        return (
          <group key={key} position={m.position} name={m.id}>
            <mesh>
              <sphereGeometry args={[0.05, 16, 12]} />
              <meshBasicMaterial color={color} />
            </mesh>
            <mesh ref={el => { halos.current[key] = el; }}>
              <sphereGeometry args={[0.16, 24, 16]} />
              <meshBasicMaterial color={color} transparent opacity={tripped ? 0.45 : 0.2} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <Html center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
              <div className={`lab3d-tag r3f ${tripped ? "hit" : "vent"}`}>
                {m.id}{tripped ? " · alarm" : ""}{m.synthetic ? " · synthetic" : ""}
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}



// The demo clock readout: simulated seconds since ignition (10x real time). DOM text only.
function ClockReadout({ el, ignitedAt }: { el: MutableRefObject<HTMLSpanElement | null>; ignitedAt: number | null }) {
  useFrame(() => {
    if (el.current) el.current.textContent = simSecondsSince(ignitedAt).toFixed(1);
  });
  return null;
}

interface IssSceneProps {
  detect: DetectOut | null;
  simulate: SimulateOut | null;
  // From the store, so every view (main page or Compare) shows the same moment of the same ignition.
  alarmId?: string | null; // the detector that tripped, once the demo clock reached time_to_detect_s
  ignition?: number; // the ignition counter: a new value restarts the smoke
  ignitedAt?: number | null; // Date.now() at this ignition: drives the clock and smoke catch-up
  clockEl?: MutableRefObject<HTMLSpanElement | null>; // optional HUD readout of the demo clock
}

export function IssScene({ detect, simulate, alarmId = null, ignition = 0, ignitedAt = null, clockEl }: IssSceneProps) {
  return (
    <Canvas
      flat
      dpr={[1, 2]}
      camera={{ position: CAMERA_START as [number, number, number], fov: CAMERA_FOV, near: 0.05, far: 30 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ scene }) => { scene.background = new THREE.Color(0x05080f); }}
      fallback={<div className="lab3d-msg">WebGL is off, so the 3D view can't start.</div>}
    >
      <ambientLight intensity={0.45} />
      <hemisphereLight args={[0xe4ecff, 0x3a404c, 0.5]} />
      <ModelBoundary fallback={<FallbackModule />}>
        <Suspense fallback={<FallbackModule />}>
          <IssLab />
        </Suspense>
      </ModelBoundary>
      <DetectorMarkers detect={detect} alarmId={alarmId} />
      {clockEl && <ClockReadout el={clockEl} ignitedAt={ignitedAt} />}
      {/* EXPERIMENT: g = 0 volumetric soot field (FDS-style); ?transport=particles brings back FE-06. */}
      {TRANSPORT === "particles" ? <Smoke simulate={simulate} ignition={ignition} /> : <SootVolume simulate={simulate} ignition={ignition} />}
      <Flame simulate={simulate} />
      {fdsReplayUrl && <FdsReplay url={fdsReplayUrl} />}
      <OrbitControls makeDefault enableDamping enablePan={false} minDistance={0.6} maxDistance={4.2} />
      <KeepCameraInside />
    </Canvas>
  );
}
