import { describe, expect, it } from "vitest";
import {
  allocateMinorUnits,
  basisPoints,
  calculateBasisPoints,
  minorToMoney,
  minorUnits,
  moneyToMinor,
  multiplyMinorUnits,
} from "./money";

describe("marketplace integer money", () => {
  it("converts store money to integer minor units and back", () => {
    expect(moneyToMinor(0)).toBe(0);
    expect(moneyToMinor(12.34)).toBe(1234);
    expect(moneyToMinor(1.005)).toBe(101);
    expect(minorToMoney(minorUnits(1234))).toBe(12.34);
  });

  it("validates branded minor units and basis points", () => {
    expect(minorUnits(25)).toBe(25);
    expect(basisPoints(1250)).toBe(1250);
    expect(() => minorUnits(-1)).toThrow(/minor units/i);
    expect(() => minorUnits(1.5)).toThrow(/minor units/i);
    expect(() => basisPoints(10_001)).toThrow(/basis points/i);
  });

  it("multiplies and calculates commission without floating arithmetic", () => {
    expect(multiplyMinorUnits(minorUnits(250), 3)).toBe(750);
    expect(calculateBasisPoints(minorUnits(10_001), basisPoints(1250))).toBe(1250);
    expect(calculateBasisPoints(minorUnits(1), basisPoints(5000))).toBe(1);
  });

  it("allocates all remainder units deterministically", () => {
    expect(allocateMinorUnits(minorUnits(10), [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocateMinorUnits(minorUnits(7), [3, 2])).toEqual([4, 3]);
    expect(allocateMinorUnits(minorUnits(0), [1, 2])).toEqual([0, 0]);
  });

  it("rejects unsafe values and invalid allocation weights", () => {
    expect(() => moneyToMinor(Number.POSITIVE_INFINITY)).toThrow(/finite/i);
    expect(() => multiplyMinorUnits(minorUnits(100), 0)).toThrow(/quantity/i);
    expect(() => allocateMinorUnits(minorUnits(10), [0, 0])).toThrow(/positive weight/i);
    expect(() => allocateMinorUnits(minorUnits(10), [1, -1])).toThrow(/weight/i);
  });
});
