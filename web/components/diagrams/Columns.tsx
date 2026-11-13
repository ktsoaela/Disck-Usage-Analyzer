"use client";

import { Billboard, Text } from "@react-three/drei";
import { useMemo, useState } from "react";
import { human } from "@/lib/format";
import { columnRows } from "@/lib/layout";
import type { UsageNode } from "@/lib/types";

export function Columns({
  root,
  onHover,
}: {
  root: UsageNode;
  onHover: (node: UsageNode | null) => void;
}) {
  const rows = useMemo(() => columnRows(root), [root]);
  const max = rows[0]?.size || 1;
  const width = 0.78;
  const gap = 0.36;
  const total = rows.length * width + Math.max(0, rows.length - 1) * gap;

  return (
    <group>
      <mesh position={[0, -0.06, 0]}>
        <boxGeometry args={[Math.max(total + 1.6, 3), 0.08, 2.4]} />
        <meshStandardMaterial color="#141820" metalness={0.2} roughness={0.6} />
      </mesh>
      {rows.map((row, index) => {
        const height = 0.16 + (row.size / max) * 4.4;
        const x = -total / 2 + width / 2 + index * (width + gap);
        return (
          <Pillar
            key={row.id}
            x={x}
            height={height}
            width={width}
            color={row.color}
            label={row.label}
            size={human(row.size)}
            onHover={() => onHover(categoryNode(root, row.id, row.label))}
            onLeave={() => onHover(null)}
          />
        );
      })}
    </group>
  );
}

function categoryNode(root: UsageNode, id: string, label: string): UsageNode {
  const found = root.byType.find((entry) => entry.id === id);
  return {
    name: label,
    path: root.path,
    size: found?.size ?? 0,
    files: found?.files ?? 0,
    kind: "category",
    category: id,
    byType: found ? [found] : [],
    children: [],
  };
}

function Pillar({
  x,
  height,
  width,
  color,
  label,
  size,
  onHover,
  onLeave,
}: {
  x: number;
  height: number;
  width: number;
  color: string;
  label: string;
  size: string;
  onHover: () => void;
  onLeave: () => void;
}) {
  const [hot, setHot] = useState(false);
  return (
    <group position={[x, 0, 0]}>
      <mesh
        position={[0, height / 2, 0]}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHot(true);
          onHover();
        }}
        onPointerOut={() => {
          setHot(false);
          onLeave();
        }}
      >
        <boxGeometry args={[width, height, width]} />
        <meshStandardMaterial
          color={color}
          roughness={0.36}
          metalness={0.22}
          emissive={color}
          emissiveIntensity={hot ? 0.4 : 0.06}
        />
      </mesh>
      <Billboard position={[0, height + 0.18, 0]}>
        <Text fontSize={0.16} color="#f0c75a" anchorX="center" anchorY="bottom" outlineWidth={0.008} outlineColor="#07080b">
          {size}
        </Text>
      </Billboard>
      <Billboard position={[0, 0.22, 0.7]}>
        <Text fontSize={0.13} color="#f5f7fb" anchorX="center" anchorY="middle" maxWidth={1.3} textAlign="center" outlineWidth={0.007} outlineColor="#07080b">
          {label}
        </Text>
      </Billboard>
    </group>
  );
}
