# Writes the Exif Orientation fixtures: <n>.jpg, <n>.png and <n>.webp for n = 1..8.
#
# Every file SHOWS the same upright picture (24x16: a 3x2 grid of solid 8x8 blocks, see UPRIGHT)
# once its Orientation is applied. The pixels are stored turned the other way, the way a camera
# writes them: orientation n stores the upright picture with the INVERSE of n's transform, so
# 5..8 are stored 16x24. Each file carries a single Exif tag (Orientation) in its own Exif block:
# JPEG APP1, PNG eXIf, WebP EXIF (VP8X).
#
# 6-alpha.webp is 6.webp half transparent (alpha 128 everywhere).
#
# JPEG is quality 95 without chroma subsampling and WebP is lossless, so the block colours
# survive the encode. Run from this directory with Pillow: python3 generate.py
from PIL import Image

UPRIGHT = [
    [(255, 0, 0), (0, 255, 0), (0, 0, 255)],
    [(255, 255, 0), (255, 0, 255), (0, 255, 255)],
]
BLOCK = 8

# Pillow's ImageOps.exif_transpose applies these to turn orientation n upright.
TO_UPRIGHT = {
    2: Image.Transpose.FLIP_LEFT_RIGHT,
    3: Image.Transpose.ROTATE_180,
    4: Image.Transpose.FLIP_TOP_BOTTOM,
    5: Image.Transpose.TRANSPOSE,
    6: Image.Transpose.ROTATE_270,
    7: Image.Transpose.TRANSVERSE,
    8: Image.Transpose.ROTATE_90,
}
# Their inverses: every one undoes itself except the two quarter turns.
INVERSE = {
    **TO_UPRIGHT,
    6: Image.Transpose.ROTATE_90,
    8: Image.Transpose.ROTATE_270,
}

upright = Image.new("RGB", (3 * BLOCK, 2 * BLOCK))
for row, colours in enumerate(UPRIGHT):
    for col, colour in enumerate(colours):
        upright.paste(colour, (col * BLOCK, row * BLOCK, (col + 1) * BLOCK, (row + 1) * BLOCK))

for n in range(1, 9):
    stored = upright if n == 1 else upright.transpose(INVERSE[n])
    # Sanity check: turning the stored pixels upright gives the upright picture back.
    back = stored if n == 1 else stored.transpose(TO_UPRIGHT[n])
    assert back.tobytes() == upright.tobytes(), n
    exif = Image.Exif()
    exif[0x0112] = n
    stored.save(f"{n}.jpg", quality=95, subsampling=0, exif=exif)
    stored.save(f"{n}.png", exif=exif)
    stored.save(f"{n}.webp", lossless=True, exif=exif)

alpha = upright.transpose(INVERSE[6]).convert("RGBA")
alpha.putalpha(128)
exif = Image.Exif()
exif[0x0112] = 6
alpha.save("6-alpha.webp", lossless=True, exif=exif)
