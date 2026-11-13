"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";

export function Label({
  position,
  title,
  detail,
  scale = 1,
}: {
  position: [number, number, number];
  title: string;
  detail?: string;
  scale?: number;
}) {
  const texture = useMemo(() => makeLabelTexture(title, detail), [title, detail]);
  useEffect(() => () => texture.dispose(), [texture]);
  const height = detail ? 0.38 : 0.26;
  return (
    <sprite position={position} scale={[1.25 * scale, height * scale, 1]} renderOrder={2}>
      <spriteMaterial map={texture} transparent depthTest={false} />
    </sprite>
  );
}

function makeLabelTexture(title: string, detail?: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = detail ? 188 : 128;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (!context) return texture;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(7, 8, 11, 0.9)";
  context.beginPath();
  context.roundRect(10, 10, canvas.width - 20, canvas.height - 20, 28);
  context.fill();
  context.strokeStyle = "rgba(240, 199, 90, 0.6)";
  context.lineWidth = 6;
  context.stroke();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#f5f7fb";
  context.font = "700 52px Segoe UI, sans-serif";
  context.fillText(fit(context, title, 460), canvas.width / 2, detail ? 72 : canvas.height / 2);
  if (detail) {
    context.fillStyle = "#f0c75a";
    context.font = "44px Consolas, monospace";
    context.fillText(fit(context, detail, 460), canvas.width / 2, 128);
  }
  texture.needsUpdate = true;
  return texture;
}

function fit(context: CanvasRenderingContext2D, text: string, max: number) {
  let value = text;
  while (value.length > 1 && context.measureText(value).width > max) {
    value = `${value.slice(0, -2)}…`;
  }
  return value;
}
