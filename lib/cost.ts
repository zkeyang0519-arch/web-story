export type CostQuote = {
  version: "mvp-platform-cost-v5";
  currency: "CNY";
  referenceCount: number;
  duration: number;
  model: "Seedance 2.0 Standard";
  analysis: { min: number; max: number };
  storyboard: { count: number; unit: number; min: number; max: number };
  generation: { min: number; max: number };
  storage: { min: number; max: number };
  totalMin: number;
  totalMax: number;
};

function money(value: number) {
  return Math.round(value * 100) / 100;
}

export function calculateCostQuote(referenceCount: number, duration: number): CostQuote {
  const count = Math.max(1, Math.min(10, Math.round(referenceCount)));
  const seconds = duration === 15 ? 15 : duration;
  const analysis = { min: money(count * 0.08 + 0.4), max: money(count * 0.25 + 2.5) };
  const storyboard = { count: 4, unit: 0.22, min: 0.88, max: 0.88 };
  const generationFactor = seconds / 15;
  const generation = { min: money(28 * generationFactor), max: money(42 * generationFactor) };
  const storage = { min: 0.05, max: 0.15 };
  return {
    version: "mvp-platform-cost-v5",
    currency: "CNY",
    referenceCount: count,
    duration: seconds,
    model: "Seedance 2.0 Standard",
    analysis,
    storyboard,
    generation,
    storage,
    totalMin: money(analysis.min + storyboard.min + generation.min + storage.min),
    totalMax: money(analysis.max + storyboard.max + generation.max + storage.max),
  };
}
