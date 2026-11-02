import { describe, expect, it } from "vitest";
import {
  hasSolveFormErrors,
  solveFormErrorsFromCode,
  solveMinutes,
  validateSolveForm,
} from "./solve-form";

const TODAY = "2026-11-02";
const rules = { today: TODAY, datesRequired: true };

describe("validateSolveForm", () => {
  it("accepts a finished solve with today's dates and no time", () => {
    const errors = validateSolveForm(
      { start: TODAY, end: TODAY, hours: "", minutes: "" },
      rules,
    );
    expect(hasSolveFormErrors(errors)).toBe(false);
  });

  it("refuses an end before the start", () => {
    expect(
      validateSolveForm({ start: "2026-10-12", end: "2026-10-10" }, rules).end,
    ).toBe("beforeStart");
  });

  it("refuses an end in the future", () => {
    expect(
      validateSolveForm({ start: TODAY, end: "2026-11-03" }, rules).end,
    ).toBe("future");
  });

  it("allows a start in the future while there is no end: a solve still going", () => {
    const errors = validateSolveForm({ start: "2026-12-01" }, rules);
    expect(hasSolveFormErrors(errors)).toBe(false);
  });

  it("asks for the dates a dated solve needs", () => {
    expect(validateSolveForm({ start: "", end: "" }, rules)).toEqual({
      start: "required",
      end: "required",
    });
  });

  it("lets an undated solve keep its empty dates", () => {
    const errors = validateSolveForm(
      { start: "", end: "" },
      { today: TODAY, datesRequired: false },
    );
    expect(hasSolveFormErrors(errors)).toBe(false);
  });

  it.each([
    ["-1", ""],
    ["1.5", ""],
    ["", "-5"],
    ["", "60"],
    ["2", "7.5"],
  ])("refuses hours %j and minutes %j", (hours, minutes) => {
    expect(validateSolveForm({ hours, minutes }, rules).time).toBe("invalid");
  });

  it.each([
    ["", ""],
    ["0", "0"],
    ["3", "20"],
    ["", "59"],
    ["120", ""],
  ])("accepts hours %j and minutes %j", (hours, minutes) => {
    expect(validateSolveForm({ hours, minutes }, rules).time).toBeUndefined();
  });
});

describe("solveMinutes", () => {
  it("adds hours and minutes", () => {
    expect(solveMinutes("3", "20")).toBe(200);
    expect(solveMinutes("", "45")).toBe(45);
  });

  it("is undefined when blank or zero: no time was given", () => {
    expect(solveMinutes("", "")).toBeUndefined();
    expect(solveMinutes("0", "0")).toBeUndefined();
  });
});

describe("solveFormErrorsFromCode", () => {
  it("places what the server refuses on the field it is about", () => {
    expect(solveFormErrorsFromCode("InvalidTimeRange")).toEqual({
      end: "beforeStart",
    });
    expect(solveFormErrorsFromCode("FutureEndDate")).toEqual({ end: "future" });
    // The form already checked for whole numbers, so what comes back is over the server's limit.
    expect(solveFormErrorsFromCode("InvalidDuration")).toEqual({
      time: "impossible",
    });
  });

  it("leaves every other failure to the form's toast", () => {
    expect(solveFormErrorsFromCode("RateLimited")).toBeUndefined();
    expect(solveFormErrorsFromCode(undefined)).toBeUndefined();
  });
});
