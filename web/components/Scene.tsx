"use client";

import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { UsageNode } from "@/lib/types";
import { City } from "./diagrams/City";
import { Columns } from "./diagrams/Columns";
import { Disk } from "./diagrams/Disk";

export type DiagramView = "explosion" | "rings" | "city" | "columns";

const CAMERAS: Record<DiagramView, { pos: [number, number, number]; target: [number, number, number] }> = {
  explosion: { pos: [5.8, 4.5, 5.8], target: [0, 0.5, 0] },
  rings: { pos: [0.15, 9.2, 0.15], target: [0, 0, 0] },
  city: { pos: [7.4, 6.6, 7.4], target: [0, 0.8, 0] },
  columns: { pos: [0.4, 3.5, 8.4], target: [0, 1.3, 0] },
};

export function Scene({
  root,
  view,
  explode,
  onHover,
  onSelect,
}: {
  root: UsageNode;
  view: DiagramView;
  explode: number;
  onHover: (node: UsageNode | null) => void;
  onSelect: (node: UsageNode) => void;
}) {
  return (
    <Canvas camera={{ position: CAMERAS.explosion.pos, fov: 40, near: 0.1, far: 80 }} dpr={[1, 1.75]} gl={{ antialias: true }}>
      <color attach="background" args={["#07080b"]} />
      <fog attach="fog" args={["#07080b", 18, 36]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#f3e2b0", "#1a1d27", 0.35]} />
      <directionalLight position={[8, 12, 6]} intensity={1.55} color="#fff4e0" />
      <directionalLight position={[-7, 6, -4]} intensity={0.4} color="#9eb6ff" />
      <Floor />
      <Rig view={view} />
      {view === "explosion" && <Disk root={root} explode={explode} depth={2} onHover={onHover} onSelect={onSelect} />}
      {view === "rings" && <Disk root={root} explode={0} depth={3} onHover={onHover} onSelect={onSelect} />}
      {view === "city" && <City root={root} onHover={onHover} onSelect={onSelect} />}
      {view === "columns" && <Columns root={root} onHover={onHover} />}
      <ContactShadows position={[0, -0.02, 0]} opacity={0.45} scale={18} blur={2.4} far={5} />
      <OrbitControls makeDefault enableDamping maxPolarAngle={Math.PI / 2.08} minDistance={2.2} maxDistance={24} />
    </Canvas>
  );
}

function Rig({ view }: { view: DiagramView }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { target?: THREE.Vector3; update?: () => void } | null;
  useEffect(() => {
    const preset = CAMERAS[view];
    camera.position.set(...preset.pos);
    camera.lookAt(...preset.target);
    if (controls?.target) {
      controls.target.set(...preset.target);
      controls.update?.();
    }
  }, [view, camera, controls]);
  return null;
}

function Floor() {
  const grid = useMemo(() => {
    const helper = new THREE.GridHelper(22, 22, "#3a3324", "#22262f");
    const materials = Array.isArray(helper.material) ? helper.material : [helper.material];
    for (const material of materials) {
      material.transparent = true;
      material.opacity = 0.55;
    }
    return helper;
  }, []);
  return <primitive object={grid} position={[0, -0.03, 0]} />;
}
