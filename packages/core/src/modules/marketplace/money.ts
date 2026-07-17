declare const minorUnitsBrand: unique symbol;
declare const basisPointsBrand: unique symbol;

export type MinorUnits = number & { readonly [minorUnitsBrand]: "MinorUnits" };
export type BasisPoints = number & { readonly [basisPointsBrand]: "BasisPoints" };

function assertNonNegativeSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative safe integer.`);
    }
}

export function minorUnits(value: number): MinorUnits {
    assertNonNegativeSafeInteger(value, "Minor units");
    return value as MinorUnits;
}

export function basisPoints(value: number): BasisPoints {
    if (!Number.isInteger(value) || value < 0 || value > 10_000) {
        throw new Error("Basis points must be an integer between 0 and 10000.");
    }
    return value as BasisPoints;
}

export function moneyToMinor(value: number, label = "Money value"): MinorUnits {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${label} must be a finite non-negative number.`);
    }

    // Adding a magnitude-aware epsilon avoids common binary floating-point
    // boundary errors such as 1.005 * 100 evaluating just below 100.5.
    const adjusted = value + Number.EPSILON * Math.max(1, Math.abs(value));
    return minorUnits(Math.round(adjusted * 100));
}

export function minorToMoney(value: MinorUnits): number {
    return Number(value) / 100;
}

export function multiplyMinorUnits(value: MinorUnits, quantity: number): MinorUnits {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new Error("Quantity must be a positive safe integer.");
    }
    const result = Number(value) * quantity;
    return minorUnits(result);
}

export function calculateBasisPoints(
    amount: MinorUnits,
    rate: BasisPoints,
): MinorUnits {
    const rounded = (BigInt(amount) * BigInt(rate) + 5_000n) / 10_000n;
    return minorUnits(Number(rounded));
}

export function allocateMinorUnits(
    total: MinorUnits,
    weights: readonly number[],
): MinorUnits[] {
    if (weights.length === 0) {
        throw new Error("At least one allocation weight is required.");
    }

    for (const weight of weights) {
        assertNonNegativeSafeInteger(weight, "Allocation weight");
    }

    const totalWeight = weights.reduce((sum, weight) => sum + BigInt(weight), 0n);
    if (totalWeight <= 0n) {
        throw new Error("At least one positive weight is required for allocation.");
    }

    const totalBigInt = BigInt(total);
    const allocations = weights.map((weight, index) => {
        const numerator = totalBigInt * BigInt(weight);
        return {
            index,
            amount: numerator / totalWeight,
            remainder: numerator % totalWeight,
        };
    });

    const allocated = allocations.reduce((sum, entry) => sum + entry.amount, 0n);
    let unitsRemaining = totalBigInt - allocated;

    const remainderOrder = [...allocations].sort((left, right) => {
        if (left.remainder === right.remainder) return left.index - right.index;
        return left.remainder > right.remainder ? -1 : 1;
    });

    let cursor = 0;
    while (unitsRemaining > 0n) {
        remainderOrder[cursor % remainderOrder.length]!.amount += 1n;
        unitsRemaining -= 1n;
        cursor += 1;
    }

    allocations.sort((left, right) => left.index - right.index);
    return allocations.map((entry) => minorUnits(Number(entry.amount)));
}
