import * as THREE from "three";

/** Annulus sector in the XZ plane, sitting on y = 0 with the given height. */
export function makeWedge(inner: number, outer: number, a0: number, a1: number, height: number) {
  const shape = new THREE.Shape();
  const steps = Math.max(3, Math.ceil((a1 - a0) * 22));
  const point = (radius: number, angle: number) =>
    new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);

  const start = point(outer, a0);
  shape.moveTo(start.x, start.y);
  for (let i = 1; i <= steps; i += 1) {
    const p = point(outer, a0 + ((a1 - a0) * i) / steps);
    shape.lineTo(p.x, p.y);
  }
  for (let i = steps; i >= 0; i -= 1) {
    const p = point(inner, a0 + ((a1 - a0) * i) / steps);
    shape.lineTo(p.x, p.y);
  }
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/** Matches makeWedge after rotateX(-90): shape (x, y) becomes (x, height, -y). */
export function wedgePoint(radius: number, angle: number, y: number): [number, number, number] {
  return [Math.cos(angle) * radius, y, -Math.sin(angle) * radius];
}

export const RINGS = [
  { inner: 0.62, outer: 1.78, height: 0.42 },
  { inner: 1.92, outer: 2.78, height: 0.32 },
  { inner: 2.92, outer: 3.55, height: 0.24 },
];
