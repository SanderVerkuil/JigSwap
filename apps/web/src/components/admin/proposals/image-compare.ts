// Pure math for the image-diff overlay: map a pointer's clientX inside the compare
// container to a wipe percentage, clamped to [0, 100].
export const wipePercentFromPointer = (
  clientX: number,
  rectLeft: number,
  rectWidth: number,
): number => {
  if (rectWidth <= 0) return 50;
  const percent = ((clientX - rectLeft) / rectWidth) * 100;
  return Math.min(100, Math.max(0, percent));
};
