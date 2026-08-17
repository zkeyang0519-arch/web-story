export type CostQuote = {
  version: "mvp-platform-cost-v3";
  currency: "CNY";
  referenceCount: number;
  duration: number;
  model: "Seedance 2.0 Standard";
  analysis: { min: number; max: number };
  keyframe: { min: number; max: number };
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
  const analysis = { min: money(count * 0.08), max: money(count * 0.25) };
  const keyframe = { min: 0.22, max: 0.22 };
  const generationFactor = seconds / 15;
  const generation = { min: money(28 * generationFactor), max: money(42 * generationFactor) };
  const storage = { min: 0.05, max: 0.15 };
  return {
    version: "mvp-platform-cost-v3",
    currency: "CNY",
    referenceCount: count,
    duration: seconds,
    model: "Seedance 2.0 Standard",
    analysis,
    keyframe,
    generation,
    storage,
    totalMin: money(analysis.min + keyframe.min + generation.min + storage.min),
    totalMax: money(analysis.max + keyframe.max + generation.max + storage.max),
  };
}
