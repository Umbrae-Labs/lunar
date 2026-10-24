/** Shape-preserving cubic Hermite interpolation: never invent peaks or negative time. */
export function readingCurve(values: readonly number[], width: number, height: number, maximum: number) {
  const points = values.map((value, index) => ({
    x: values.length === 1 ? width / 2 : (index * width) / (values.length - 1),
    y: height - (value / maximum) * height,
  }));
  if (!points.length) return { points, path: '' };
  const slopes = points.slice(1).map((point, index) => (point.y - points[index].y) / (point.x - points[index].x));
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0] ?? 0;
    if (index === points.length - 1) return slopes[index - 1] ?? 0;
    const a = slopes[index - 1],
      b = slopes[index];
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  });
  let path = `M ${points[0].x} ${points[0].y}`;
  if (points.length <= 3)
    return {
      points,
      path:
        path +
        points
          .slice(1)
          .map((point) => ` L ${point.x} ${point.y}`)
          .join(''),
    };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = (b.x - a.x) / 3;
    path += ` C ${a.x + dx} ${a.y + tangents[i - 1] * dx} ${b.x - dx} ${b.y - tangents[i] * dx} ${b.x} ${b.y}`;
  }
  return { points, path };
}
