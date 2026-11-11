# Original art

The original renders and paintings behind JigSwap's illustrations, kept at full size so a new crop, colour fix or size starts from the source instead of from the site's smaller copies. The site's own files live in `apps/web/src/components/marketing/assets/art/`, each with a `.json` provenance record that names its original. The prompts that made the renders are in the image prompts comment on PR #393.

The newer originals are stored as lossless WebP: every pixel matches the PNG the image model produced, at about three quarters of the size. Any editor that opens WebP can export them as PNG again.

| Original                                       | Made into (in `apps/web/src/components/marketing/assets/art/`)                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `house-wide.webp`                              | the home page's cutaway house: `house-cut*.webp`                                      |
| `kitchen-wide.webp`                            | the kitchen table on home and About: `kitchen-table*.webp`                            |
| `park-scene.webp`                              | the picture beside the How it works heading: `park-bridge*.webp`                      |
| `journey/step-1.webp` to `step-4.webp`         | the four stops on How it works: `journey/step-*.webp`                                 |
| `lids/lid-*.webp`                              | the 14 box lids: `covers/*.webp`                                                      |
| `guides/house-guide.webp`, `roof-guide.webp`   | layout guides attached to the house prompts, kept for re-rolls                        |
| `*.png` in this folder, `lids/dorpsstraat.png` | the first paintings and an earlier Dorpsstraat lid, still the source of several crops |
