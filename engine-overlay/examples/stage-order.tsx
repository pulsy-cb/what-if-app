import React from 'react';
import { Stage, StageItem } from '../../engine';
const R: React.FC<{ x: number; w: number; c: string }> = ({ x, w, c }) => <rect x={x} y={440} width={w} height={200} fill={c} />;
// written shuffled; a Fragment inside; raw SVG before and after the first placed element
export const Order: React.FC = () => (
  <Stage fade={0}>
    <R x={600} w={300} c="#808080" />
    <StageItem depth={0.8}><R x={800} w={300} c="#00ff00" /></StageItem>
    <>
      <StageItem depth={0.5}><R x={700} w={300} c="#0000ff" /></StageItem>
    </>
    <StageItem depth={0.2}><R x={650} w={300} c="#ff0000" /></StageItem>
    <R x={1000} w={300} c="#ffff00" />
  </Stage>
);
