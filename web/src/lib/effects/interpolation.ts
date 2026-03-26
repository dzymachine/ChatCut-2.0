import type { EffectKeyframe, KeyframeInterpolation, BezierHandles } from '@/types/effects';

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Evaluate a cubic bezier curve at parameter t using Newton-Raphson iteration.
 * The bezier is defined by control points (0,0), (outX,outY), (inX,inY), (1,1).
 * Given an X (time) value, returns the corresponding Y (eased) value.
 */
export function cubicBezier(t: number, handles: BezierHandles): number {
  const { outX, outY, inX, inY } = handles;

  // Solve for the bezier parameter `u` such that bezierX(u) ≈ t
  // B(u) = 3(1-u)²u·P1 + 3(1-u)u²·P2 + u³
  const sampleX = (u: number): number =>
    3 * (1 - u) * (1 - u) * u * outX +
    3 * (1 - u) * u * u * inX +
    u * u * u;

  const sampleY = (u: number): number =>
    3 * (1 - u) * (1 - u) * u * outY +
    3 * (1 - u) * u * u * inY +
    u * u * u;

  const sampleXDerivative = (u: number): number =>
    3 * (1 - u) * (1 - u) * outX +
    6 * (1 - u) * u * (inX - outX) +
    3 * u * u * (1 - inX);

  // Newton-Raphson with fallback to binary search
  let u = t;
  for (let i = 0; i < 8; i++) {
    const xError = sampleX(u) - t;
    if (Math.abs(xError) < 1e-6) break;
    const dx = sampleXDerivative(u);
    if (Math.abs(dx) < 1e-6) break;
    u -= xError / dx;
  }

  // Clamp and refine with binary search if Newton-Raphson diverged
  if (u < 0 || u > 1 || Math.abs(sampleX(u) - t) > 1e-4) {
    let lo = 0;
    let hi = 1;
    u = t;
    for (let i = 0; i < 20; i++) {
      const x = sampleX(u);
      if (Math.abs(x - t) < 1e-6) break;
      if (x < t) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
  }

  return sampleY(u);
}

export function applyInterpolation(
  t: number,
  interpolation: KeyframeInterpolation,
  handles?: BezierHandles,
): number {
  switch (interpolation) {
    case 'linear':
      return t;
    case 'hold':
      return 0;
    case 'ease_in':
      return t * t;
    case 'ease_out':
      return 1 - (1 - t) * (1 - t);
    case 'bezier':
      return handles ? cubicBezier(t, handles) : t;
  }
}

export function interpolateValue(
  keyframes: EffectKeyframe[],
  time: number,
  parameterId: string,
): number | null {
  const filtered = keyframes
    .filter((kf) => kf.parameterId === parameterId)
    .sort((a, b) => a.time - b.time);

  if (filtered.length === 0) return null;
  if (time <= filtered[0].time) return filtered[0].value;
  if (time >= filtered[filtered.length - 1].time) return filtered[filtered.length - 1].value;

  // Find surrounding keyframes
  for (let i = 0; i < filtered.length - 1; i++) {
    const kfA = filtered[i];
    const kfB = filtered[i + 1];
    if (time >= kfA.time && time <= kfB.time) {
      const span = kfB.time - kfA.time;
      const linearT = span === 0 ? 0 : (time - kfA.time) / span;
      const easedT = applyInterpolation(linearT, kfA.interpolation, kfA.bezierHandles);
      return lerp(kfA.value, kfB.value, easedT);
    }
  }

  return filtered[filtered.length - 1].value;
}

export function hasKeyframes(keyframes: EffectKeyframe[], parameterId: string): boolean {
  return keyframes.some((kf) => kf.parameterId === parameterId);
}
