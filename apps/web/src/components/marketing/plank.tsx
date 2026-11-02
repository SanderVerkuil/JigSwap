// The shape of a puzzle box on a plank, shared by the 3D box in plank-3d/box.tsx that the app's
// shelves render through components/common/puzzle-plank-3d.
export interface PlankBox {
  title?: string;
  series?: string;
  pieceCount?: number;
  cover?: string;
  c1?: string;
  c2?: string;
  width?: number;
  height?: number;
}
