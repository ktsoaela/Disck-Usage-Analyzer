"use client";

import { Billboard, Text } from "@react-three/drei";
import { useMemo, useState } from "react";
import { human, shortName } from "@/lib/format";
import { cityBlocks } from "@/lib/layout";
import type { UsageNode } from "@/lib/types";

export function City({
  root,
  onHover,
  onSelect,
}: {
  root: UsageNode;
  onHover: (node: UsageNode | null) => void;
  onSelect: (node: UsageNode) => void;
}) {
  const blocks = useMemo(() => cityBlocks(root), [root]);
  const tallest = root.size || 1;

  return (
    <group>
      {blocks.map((block) => (
        <Tower
          key={`${block.node.path}-${block.node.name}-${block.x.toFixed(2)}-${block.z.toFixed(2)}`}
          block={block}
          rootSize={tallest}
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}

function Tower({
  block,
  rootSize,
  onHover,
  onSelect,
}: {
  block: ReturnType<typeof cityBlocks>[number];
  rootSize: number;
  onHover: (node: UsageNode | null) => void;
  onSelect: (node: UsageNode) => void;
}) {
  const [hot, setHot] = useState(false);
  const height = 0.12 + Math.sqrt(block.node.size / rootSize) * 3.3;
  const x = block.x + block.w / 2 - 4;
  const z = block.z + block.d / 2 - 4;
  const canOpen = block.node.kind === "dir" && block.node.children.length > 0;
  const showLabel = block.w > 0.7 && block.d > 0.45;

  return (
    <group position={[x, height / 2, z]}>
      <mesh
        onPointerOver={(event) => {
          event.stopPropagation();
          setHot(true);
          onHover(block.node);
        }}
        onPointerOut={() => {
          setHot(false);
          onHover(null);
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (canOpen) onSelect(block.node);
        }}
      >
        <boxGeometry args={[block.w, height, block.d]} />
        <meshStandardMaterial
          color={block.color}
          roughness={0.42}
          metalness={0.16}
          emissive={block.color}
          emissiveIntensity={hot ? 0.4 : 0.05}
        />
      </mesh>
      {showLabel && (
        <Billboard position={[0, height / 2 + 0.08, 0]}>
          <Text fontSize={0.14} color="#f5f7fb" anchorX="center" anchorY="bottom" outlineWidth={0.008} outlineColor="#07080b">
            {shortName(block.node.name, 18)}
          </Text>
          <Text position={[0, -0.16, 0]} fontSize={0.11} color="#f0c75a" anchorX="center" anchorY="top" outlineWidth={0.007} outlineColor="#07080b">
            {human(block.node.size)}
          </Text>
        </Billboard>
      )}
    </group>
  );
}
