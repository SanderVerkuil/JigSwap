import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Number.prototype.toFixed() always writes a full stop, so a rating shows "4.8" to Dutch
// members, who read "4,8" (UX-63). Displayed decimals go through use-intl's formatter instead:
// format.number(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).
async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const dirent of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (
      /\.tsx?$/.test(dirent.name) &&
      !/\.(test|spec)\./.test(dirent.name)
    )
      out.push(full);
  }
  return out;
}

describe("displayed decimals", () => {
  it("never use toFixed()", async () => {
    const root = path.resolve(__dirname, "..");
    const offenders: string[] = [];
    for (const file of await sourceFiles(root)) {
      const lines = (await fs.readFile(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        if (/\.toFixed\(/.test(line))
          offenders.push(`${path.relative(root, file)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
