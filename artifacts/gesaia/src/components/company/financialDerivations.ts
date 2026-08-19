export interface FinancialDerivationInputs {
  grossRevenue: number;
  deductions: number;
  netRevenue: number;
  cogs: number;
  fixedCosts: number;
  variableCosts: number;
  depreciationAmortization: number;
}

/**
 * Calculates the read-only financial fields shared by manual entry and CSV import.
 * A finite D&A value is optional because it is an add-back to EBITDA.
 */
export function deriveFinancialValues({
  grossRevenue,
  deductions,
  netRevenue,
  cogs,
  fixedCosts,
  variableCosts,
  depreciationAmortization,
}: FinancialDerivationInputs) {
  const netIsAuto = !Number.isNaN(grossRevenue) && !Number.isNaN(deductions);
  const net = netIsAuto ? grossRevenue - deductions : netRevenue;
  const grossProfit = !Number.isNaN(net) && !Number.isNaN(cogs) ? net - cogs : Number.NaN;
  const ebit = !Number.isNaN(grossProfit) && !Number.isNaN(fixedCosts) && !Number.isNaN(variableCosts)
    ? grossProfit - fixedCosts - variableCosts
    : Number.NaN;
  const ebitda = !Number.isNaN(ebit)
    ? ebit + (!Number.isNaN(depreciationAmortization) ? depreciationAmortization : 0)
    : Number.NaN;

  return { netIsAuto, net, grossProfit, ebit, ebitda };
}