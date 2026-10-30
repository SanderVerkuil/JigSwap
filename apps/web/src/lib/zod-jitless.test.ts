// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { ZOD_JITLESS_SCRIPT } from "./zod-jitless";

describe("ZOD_JITLESS_SCRIPT", () => {
  it("makes zod, loaded after it, build and parse object schemas without eval", async () => {
    // What the inline script does on the page, before any module loads.
    new Function(ZOD_JITLESS_SCRIPT)();
    const FunctionSpy = vi.spyOn(globalThis, "Function");
    const { config, z } = await import("zod");

    expect(config().jitless).toBe(true);
    const schema = z.object({ title: z.string(), pieces: z.number() });
    expect(schema.parse({ title: "Kattenshow", pieces: 1000 })).toEqual({
      title: "Kattenshow",
      pieces: 1000,
    });
    // Not even the probe zod runs to see whether eval is allowed.
    expect(FunctionSpy).not.toHaveBeenCalled();
    FunctionSpy.mockRestore();
  });
});
