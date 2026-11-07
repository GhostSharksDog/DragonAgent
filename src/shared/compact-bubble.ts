export interface BubbleRect { x: number; y: number; width: number; height: number }
type Edge = 'left' | 'right' | 'top' | 'bottom';

export interface CompactBubbleLayout {
  width: number;
  height: number;
  tailEdge: Edge;
  body: BubbleRect;
  tip: { x: number; y: number };
  outline: string;
}

const BODY_WIDTH = 300;
const BODY_HEIGHT = 90;
const STROKE_INSET = 2;
const TAIL = 12;
const GAP = 6;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function outlineFor(width: number, height: number, tailEdge: Edge, target: number): CompactBubbleLayout {
  const inset = Math.min(STROKE_INSET, Math.min(width, height) / 8);
  const lateral = tailEdge === 'left' || tailEdge === 'right';
  const tail = Math.min(TAIL, Math.max(0, (lateral ? width : height) - inset * 2 - 20));
  const x = inset + (tailEdge === 'left' ? tail : 0);
  const y = inset + (tailEdge === 'top' ? tail : 0);
  const right = width - inset - (tailEdge === 'right' ? tail : 0);
  const bottom = height - inset - (tailEdge === 'bottom' ? tail : 0);
  const radius = Math.min(16, (right - x) / 4, (bottom - y) / 4);
  const start = lateral ? y : x;
  const end = lateral ? bottom : right;
  const half = Math.min(8, (end - start - radius * 2) / 4);
  const center = clamp(target, start + radius + half, end - radius - half);
  const point = clamp(target, Math.max(start + half, center - 14), Math.min(end - half, center + 14));
  const tip = lateral ? { x: tailEdge === 'left' ? x - tail : right + tail, y: point }
    : { x: point, y: tailEdge === 'top' ? y - tail : bottom + tail };
  const tipLine = `L ${tip.x} ${tip.y}`;
  const outline = [
    `M ${x + radius} ${y}`,
    tailEdge === 'top' ? `H ${center - half} ${tipLine} L ${center + half} ${y}` : '',
    `H ${right - radius} Q ${right} ${y} ${right} ${y + radius}`,
    tailEdge === 'right' ? `V ${center - half} ${tipLine} L ${right} ${center + half}` : '',
    `V ${bottom - radius} Q ${right} ${bottom} ${right - radius} ${bottom}`,
    tailEdge === 'bottom' ? `H ${center + half} ${tipLine} L ${center - half} ${bottom}` : '',
    `H ${x + radius} Q ${x} ${bottom} ${x} ${bottom - radius}`,
    tailEdge === 'left' ? `V ${center + half} ${tipLine} L ${x} ${center - half}` : '',
    `V ${y + radius} Q ${x} ${y} ${x + radius} ${y} Z`,
  ].filter(Boolean).join(' ');
  return { width, height, tailEdge, body: { x, y, width: right - x, height: bottom - y }, tip, outline };
}

export function placeCompactBubble(pet: BubbleRect, area: BubbleRect): { bounds: BubbleRect; layout: CompactBubbleLayout } {
  const margin = Math.min(6, Math.max(0, Math.floor((Math.min(area.width, area.height) - 1) / 2)));
  const left = area.x + margin;
  const right = area.x + area.width - margin;
  const top = area.y + margin;
  const bottom = area.y + area.height - margin;
  const centerX = pet.x + pet.width / 2;
  const anchorY = pet.y + pet.height * .32;
  const rightStart = Math.max(left, pet.x + pet.width + GAP);
  const leftEnd = Math.min(right, pet.x - GAP);
  const lateralWidth = BODY_WIDTH + TAIL + STROKE_INSET * 2;
  const fitsLeft = leftEnd - left >= lateralWidth;
  const fitsRight = right - rightStart >= lateralWidth;
  const preferRight = centerX <= area.x + area.width / 2;
  if (fitsLeft || fitsRight) {
    const onRight = fitsRight && (preferRight || !fitsLeft);
    const height = Math.min(BODY_HEIGHT + STROKE_INSET * 2, bottom - top);
    const x = onRight ? rightStart : leftEnd - lateralWidth;
    const y = clamp(Math.round(anchorY - 28), top, bottom - height);
    return { bounds: { x, y, width: lateralWidth, height }, layout: outlineFor(lateralWidth, height, onRight ? 'left' : 'right', Math.round(anchorY - y)) };
  }

  const aboveEnd = clamp(pet.y - GAP, top, bottom);
  const belowStart = clamp(pet.y + pet.height + GAP, top, bottom);
  const above = aboveEnd - top >= bottom - belowStart;
  const room = above ? aboveEnd - top : bottom - belowStart;
  const width = Math.min(BODY_WIDTH + STROKE_INSET * 2, right - left);
  const height = Math.min(BODY_HEIGHT + TAIL + STROKE_INSET * 2, room || bottom - top);
  const x = clamp(Math.round(centerX - width / 2), left, right - width);
  const y = room ? (above ? aboveEnd - height : belowStart) : top;
  return { bounds: { x, y, width, height }, layout: outlineFor(width, height, above ? 'bottom' : 'top', Math.round(centerX - x)) };
}
