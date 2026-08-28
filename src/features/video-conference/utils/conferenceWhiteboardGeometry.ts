import type {
  ConferenceWhiteboardElement,
  ConferenceWhiteboardPoint,
} from '../types/conference.types';

function boundsForPoints(points: ConferenceWhiteboardPoint[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  from: ConferenceWhiteboardPoint,
  to: ConferenceWhiteboardPoint,
  width: number,
) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = Math.max(12, width * 4);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(
    to.x - head * Math.cos(angle - Math.PI / 6),
    to.y - head * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    to.x - head * Math.cos(angle + Math.PI / 6),
    to.y - head * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const words = text.split(/\s+/);
  let line = '';
  let offsetY = 0;

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, y + offsetY);
      line = word;
      offsetY += lineHeight;
    } else {
      line = next;
    }
  }
  if (line) ctx.fillText(line, x, y + offsetY);
}

export function renderConferenceWhiteboardElement(
  ctx: CanvasRenderingContext2D,
  element: ConferenceWhiteboardElement,
  image?: HTMLImageElement,
) {
  if (element.points.length === 0) return;
  const [start, end] = element.points;
  ctx.save();
  ctx.strokeStyle = element.color;
  ctx.fillStyle = element.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = element.type === 'marker'
    ? Math.max(element.width * 3, 10)
    : element.width;

  if (element.type === 'marker') {
    ctx.globalAlpha = 0.35;
  }

  if (element.type === 'pen' || element.type === 'marker') {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (const point of element.points.slice(1)) {
      ctx.lineTo(point.x, point.y);
    }
    if (element.points.length === 1) {
      ctx.arc(start.x, start.y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.stroke();
    }
  } else if (element.type === 'line' && end) {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  } else if (element.type === 'arrow' && end) {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    drawArrowHead(ctx, start, end, element.width);
  } else if (element.type === 'rectangle' && end) {
    ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
  } else if (element.type === 'circle' && end) {
    ctx.beginPath();
    ctx.ellipse(
      (start.x + end.x) / 2,
      (start.y + end.y) / 2,
      Math.abs(end.x - start.x) / 2,
      Math.abs(end.y - start.y) / 2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  } else if (element.type === 'text') {
    ctx.font = `${Math.max(16, element.width * 5)}px Vazirmatn, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(element.text || '', start.x, start.y);
  } else if (element.type === 'sticky' && end) {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.max(120, Math.abs(end.x - start.x));
    const height = Math.max(100, Math.abs(end.y - start.y));
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fef3c7';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = '#1f2937';
    ctx.font = '16px Vazirmatn, sans-serif';
    ctx.textBaseline = 'top';
    drawWrappedText(ctx, element.text || '', x + 10, y + 10, width - 20, 22);
  } else if (element.type === 'image' && end) {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.max(40, Math.abs(end.x - start.x));
    const height = Math.max(40, Math.abs(end.y - start.y));
    if (image?.complete) {
      ctx.globalAlpha = 1;
      ctx.drawImage(image, x, y, width, height);
    } else {
      ctx.strokeStyle = '#94a3b8';
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(x, y, width, height);
      ctx.setLineDash([]);
      ctx.fillStyle = '#64748b';
      ctx.font = '12px sans-serif';
      ctx.fillText('Loading image…', x + 8, y + 18);
    }
  }

  ctx.restore();
}

export function hitTestConferenceWhiteboardElement(
  element: ConferenceWhiteboardElement,
  point: ConferenceWhiteboardPoint,
  tolerance = 12,
): boolean {
  if (element.points.length === 0) return false;
  const bounds = boundsForPoints(element.points);
  const extra = Math.max(tolerance, element.width * 2);

  if (
    point.x < bounds.minX - extra
    || point.x > bounds.maxX + extra
    || point.y < bounds.minY - extra
    || point.y > bounds.maxY + extra
  ) {
    return false;
  }

  if (
    element.type === 'rectangle'
    || element.type === 'circle'
    || element.type === 'sticky'
    || element.type === 'image'
    || element.type === 'text'
  ) {
    return true;
  }

  for (let index = 1; index < element.points.length; index += 1) {
    const a = element.points[index - 1];
    const b = element.points[index];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, (
        (point.x - a.x) * dx + (point.y - a.y) * dy
      ) / lengthSq));
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    if (Math.hypot(point.x - px, point.y - py) <= extra) return true;
  }

  return element.points.length === 1
    && Math.hypot(point.x - element.points[0].x, point.y - element.points[0].y) <= extra;
}
