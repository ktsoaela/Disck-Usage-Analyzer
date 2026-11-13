"use client";

import { Billboard, Text } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { human, shortName } from "@/lib/format";
import { canEnter, layoutSlices, type Slice } from "@/lib/layout";
import type { UsageNode } from "@/lib/types";
import { RINGS, makeWedge, wedgePoint } from "./geometry";

type DiskProps = {
  root: UsageNode;
  explode: number;
  depth: number;
  onHover: (node: UsageNode | null) => void;
  onSelect: (node: UsageNode) => void;
};

export function Disk({ root, explode, depth, onHover, onSelect }: DiskProps) {
  const slices = useMemo(() => layoutSlices(root, depth), [root, depth]);
  const labels = useMemo(() => labelSet(slices), [slices]);

  return (
    <group>
      <Hub label={human(root.size)} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <ringGeometry args={[3.7, 3.86, 96]} />
        <meshBasicMaterial color="#f0c75a" transparent opacity={0.22 + (1 - explode) * 0.2} side={THREE.DoubleSide} />
      </mesh>
      {slices.map((slice) => (
        <Wedge
          key={`${slice.depth}-${slice.node.path}-${slice.node.name}-${slice.a0.toFixed(3)}`}
          slice={slice}
          explode={explode}
          showLabel={labels.has(slice)}
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}
      {explode > 0.08 &&
        slices
          .filter((slice) => slice.depth === 0 && slice.share >= 0.04)
          .map((slice) => <Leader key={`lead-${slice.a0}`} slice={slice} explode={explode} />)}
    </group>
  );
}

function labelSet(slices: Slice[]) {
  const chosen = new Set<Slice>();
  for (const slice of slices) {
    if (chosen.size >= 10) break;
    if (slice.depth === 0 && slice.share >= 0.06) chosen.add(slice);
  }
  for (const slice of slices) {
    if (chosen.size >= 16) break;
    if (slice.depth === 1 && slice.share >= 0.16) chosen.add(slice);
  }
  return chosen;
}

function Hub({ label }: { label: string }) {
  return (
    <group>
      <mesh position={[0, 0.16, 0]}>
        <cylinderGeometry args={[0.4, 0.48, 0.32, 48]} />
        <meshStandardMaterial color="#171b24" metalness={0.58} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.34, 0]}>
        <cylinderGeometry args={[0.24, 0.24, 0.05, 32]} />
        <meshStandardMaterial color="#f0c75a" emissive="#f0c75a" emissiveIntensity={0.35} metalness={0.2} roughness={0.35} />
      </mesh>
      <Billboard position={[0, 0.72, 0]}>
        <Text fontSize={0.12} color="#f5f7fb" anchorX="center" anchorY="middle" outlineWidth={0.008} outlineColor="#07080b">
          Total
        </Text>
        <Text position={[0, -0.16, 0]} fontSize={0.11} color="#f0c75a" anchorX="center" anchorY="middle" outlineWidth={0.008} outlineColor="#07080b">
          {label}
        </Text>
      </Billboard>
    </group>
  );
}

function Wedge({
  slice,
  explode,
  showLabel,
  onHover,
  onSelect,
}: {
  slice: Slice;
  explode: number;
  showLabel: boolean;
  onHover: (node: UsageNode | null) => void;
  onSelect: (node: UsageNode) => void;
}) {
  const ring = RINGS[Math.min(slice.depth, RINGS.length - 1)];
  const geometry = useMemo(
    () => makeWedge(ring.inner, ring.outer, slice.a0, slice.a1, ring.height),
    [ring, slice.a0, slice.a1],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  const [hot, setHot] = useState(false);
  const mid = (slice.a0 + slice.a1) / 2;
  const radial = (0.72 + slice.depth * 1.05) * explode;
  const lift = (0.22 + slice.depth * 0.62) * explode;
  const offset = wedgePoint(radial, mid, lift);
  const labelAt = wedgePoint((ring.inner + ring.outer) / 2, mid, ring.height + 0.08);
  const canOpen = canEnter(slice.node);

  return (
    <group position={offset}>
      <mesh
        geometry={geometry}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHot(true);
          onHover(slice.node);
        }}
        onPointerOut={() => {
          setHot(false);
          onHover(null);
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (canOpen) onSelect(slice.node);
        }}
      >
        <meshStandardMaterial
          color={slice.color}
          roughness={0.4}
          metalness={0.2}
          emissive={slice.color}
          emissiveIntensity={hot ? 0.42 : 0.05}
          side={THREE.DoubleSide}
        />
      </mesh>
      {showLabel && (
        <Billboard position={labelAt}>
          <Text fontSize={0.13} color="#f5f7fb" anchorX="center" anchorY="bottom" outlineWidth={0.008} outlineColor="#07080b">
            {shortName(slice.node.name, 22)}
          </Text>
          <Text position={[0, -0.16, 0]} fontSize={0.11} color="#f0c75a" anchorX="center" anchorY="top" outlineWidth={0.007} outlineColor="#07080b">
            {human(slice.node.size)}
          </Text>
        </Billboard>
      )}
    </group>
  );
}

function Leader({ slice, explode }: { slice: Slice; explode: number }) {
  const ring = RINGS[0];
  const mid = (slice.a0 + slice.a1) / 2;
  const radial = 0.72 * explode;
  const lift = 0.22 * explode;
  const end = add(wedgePoint(radial, mid, lift), wedgePoint(ring.inner, mid, ring.height * 0.4));
  const start = wedgePoint(0.5, mid, 0.16);
  const geometry = useMemo(
    () => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...start), new THREE.Vector3(...end)]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [start[0], start[1], start[2], end[0], end[1], end[2]],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  const line = useMemo(() => {
    const material = new THREE.LineBasicMaterial({ color: "#f0c75a", transparent: true, opacity: 0.45 });
    return new THREE.Line(geometry, material);
  }, [geometry]);
  useEffect(() => () => {
    (line.material as THREE.Material).dispose();
  }, [line]);
  return <primitive object={line} />;
}

function add(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
