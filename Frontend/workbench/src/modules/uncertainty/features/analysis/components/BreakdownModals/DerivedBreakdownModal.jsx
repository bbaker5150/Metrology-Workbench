import * as math from 'mathjs';
import React, { useMemo } from 'react';
import ReactDOM from 'react-dom';
import Latex from "../../../../components/common/Latex";
import { unitSystem, calculateUncertaintyFromToleranceObject } from "../../../../utils/uncertaintyMath";
import useFloatingWindow from '../../../../hooks/useFloatingWindow';

// Helper to format numbers for LaTeX display
const formatNumberForLatex = (num, precision = 4) => {
    if (typeof num !== 'number' || isNaN(num)) return 'NaN';
    // Use exponential notation for small numbers, increase precision
    if (Math.abs(num) < 1e-3 && num !== 0) {
        return num.toExponential(precision);
    }
    // Use toPrecision for other numbers
    return parseFloat(num.toPrecision(precision)).toString();
};

const MonteCarloMatrix = ({ title, symbols, values }) => {
    if (!Array.isArray(values) || values.length === 0) return null;
    return (
        <div style={{ marginTop: '14px', overflowX: 'auto' }}>
            <strong>{title}</strong>
            <table className="uncertainty-table" style={{ marginTop: '7px', width: 'auto', minWidth: '360px' }}>
                <thead><tr><th aria-label="Matrix row" />{symbols.map((symbol) => <th key={symbol}>{symbol}</th>)}</tr></thead>
                <tbody>{values.map((row, rowIndex) => (
                    <tr key={`${title}-${symbols[rowIndex] || rowIndex}`}>
                        <th>{symbols[rowIndex] || rowIndex + 1}</th>
                        {symbols.map((_, columnIndex) => <td key={columnIndex}>{formatNumberForLatex(Number(row?.[columnIndex]), 6)}</td>)}
                    </tr>
                ))}</tbody>
            </table>
        </div>
    );
};


const DerivedBreakdownModal = ({ isOpen, onClose, breakdownData }) => {
    
    const { style: windowStyle, handleMouseDown } = useFloatingWindow({
        isOpen,
        defaultWidth: Math.min(860, window.innerWidth - 48),
        defaultHeight: Math.min(720, window.innerHeight - 120)
    });

    // Use the same aggregated rows that drive the live derived budget. The
    // older implementation rebuilt uncertainty from raw TMDE assignments,
    // which became stale once derived inputs stopped requiring TMDE mapping and
    // could also double-count resolution. These rows already contain the
    // authoritative standard uncertainty, sensitivity, contribution, and
    // second-order diagnostics in display units.
    const formulaTerms = useMemo(() => {
        const components = breakdownData?.results?.calculatedBudgetComponents || [];
        const derivedUnit = breakdownData?.derivedNominalPoint?.unit || 'Units';
        const targetUnitInfo = unitSystem.units[derivedUnit];
        if (!Array.isArray(components) || !targetUnitInfo?.to_si) return [];

        const toNativeUncertainty = (component) => {
            const rawValue = Number(component?.value);
            const nativeUnit = component?.unit || component?.unit_native || derivedUnit;
            if (!Number.isFinite(rawValue)) return NaN;
            if (component?.isBaseUnitValue) {
                return unitSystem.fromBaseUnit(rawValue, nativeUnit);
            }
            if (Number.isFinite(Number(component?.value_native))) {
                return Number(component.value_native);
            }
            return rawValue;
        };

        const authoritativeTerms = components
            .filter((component) => Number.isFinite(Number(component?.contribution)))
            .map((component, index) => {
                const rawName = String(component.name || `Component ${index + 1}`);
                const isInput = rawName.startsWith("Input:");
                const symbolMatch = rawName.match(/\(([^)]+)\)$/);
                const symbol = symbolMatch
                    ? symbolMatch[1]
                    : component.isResolution
                      ? "res"
                      : `b_{${index + 1}}`;
                const contribution = Math.abs(Number(component.contribution));
                const quantity = isInput ? 1 : Math.max(1, Number(component.quantity) || 1);
                return {
                    component,
                    symbolLatex: isInput
                        ? `(c_{${symbol}} u_{${symbol}})^2`
                        : `u_{${symbol}}^2`,
                    varianceDerivedSq: contribution ** 2 * quantity,
                    ci: Number(component.sensitivityCoefficient),
                    ui_native: toNativeUncertainty(component),
                    ui_unit_native: component.unit || component.unit_native || derivedUnit,
                    contribution,
                    varSymbol: symbol,
                    name: rawName.replace(/^Input:\s*/, ""),
                    quantity,
                    isInput,
                };
            });

        // Backward compatibility for old saved points that predate the
        // calculatedBudgetComponents snapshot. This path is deliberately only
        // used when no authoritative rows exist.
        if (authoritativeTerms.length > 0) return authoritativeTerms;
        return (breakdownData?.tmdeTolerances || []).map((tmde, index) => {
            const reference = tmde?.measurementPoint;
            if (!reference) return null;
            const { standardUncertainty } = calculateUncertaintyFromToleranceObject(
                tmde.tolerance || tmde,
                reference,
                true,
            );
            const nominalBase = unitSystem.toBaseUnit(
                Number(reference.value),
                reference.unit,
            );
            const uiBase = (standardUncertainty / 1e6) * Math.abs(nominalBase);
            const uiNative = unitSystem.fromBaseUnit(uiBase, reference.unit);
            return {
                component: null,
                symbolLatex: `(c_{b_${index + 1}} u_{b_${index + 1}})^2`,
                varianceDerivedSq: NaN,
                ci: NaN,
                ui_native: uiNative,
                ui_unit_native: reference.unit,
                contribution: NaN,
                varSymbol: `b_${index + 1}`,
                name: tmde.name || "TMDE",
                quantity: 1,
                isInput: true,
            };
        }).filter(Boolean);
    }, [breakdownData]);

    // Reconstruct the exact nominal scope used by the derived calculator. The
    // derivative strings are evaluated in the calculator's base-unit scope;
    // parsing a formatted sourcePointLabel can silently produce the wrong
    // sensitivity coefficient when an input is displayed in a prefixed unit.
    const nominalScopeForDisplay = useMemo(() => {
        const scope = {};
        const derivedPoint = breakdownData?.derivedNominalPoint || {};
        const variableNominals = derivedPoint.variableNominals || {};

        Object.entries(variableNominals).forEach(([symbol, nominal]) => {
            const value = Number(nominal?.value);
            const unit = nominal?.unit;
            if (Number.isFinite(value) && unit) {
                scope[symbol] = unitSystem.toBaseUnit(value, unit);
            }
        });

        // Backward compatibility for snapshots that predate variableNominals.
        if (Object.keys(scope).length === 0) {
            const components = breakdownData?.results?.calculatedBudgetComponents || [];
            components.forEach((component) => {
                if (!component.name?.includes('Input:')) return;
                const symbolMatch = component.name.match(/\(([^)]+)\)$/);
                const symbol = symbolMatch ? symbolMatch[1] : null;
                const nominalMatch = component.sourcePointLabel?.match(/^([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)/);
                const nominalValue = nominalMatch ? parseFloat(nominalMatch[1]) : NaN;
                const nominalUnit = nominalMatch
                    ? component.sourcePointLabel.slice(nominalMatch[0].length).trim()
                    : null;
                if (symbol && Number.isFinite(nominalValue)) {
                    scope[symbol] = unitSystem.toBaseUnit(nominalValue, nominalUnit);
                }
            });
        }
        return scope;
    }, [breakdownData]);


    // Early return
    if (!isOpen || !breakdownData || !breakdownData.results) return null;

    // Destructure data
    const { equationString, derivedNominalPoint } = breakdownData;
    let displayEquation = equationString || 'N/A';
    const equalsIndex = displayEquation.indexOf('=');
    let expressionOnly = displayEquation; if (equalsIndex !== -1) { expressionOnly = displayEquation.substring(equalsIndex + 1).trim(); }
     let equationTex = displayEquation; try { equationTex = math.parse(displayEquation).toTex(); } catch(e) {}
     let expressionTex = expressionOnly; try { expressionTex = math.parse(expressionOnly).toTex(); } catch(e) {}

    const derivedUnit = derivedNominalPoint?.unit || 'Units';
    const monteCarlo = breakdownData.results.monteCarlo;
    const usesMonteCarlo = breakdownData.results.propagationMethod === 'montecarlo' && monteCarlo;

    const calculatedBudgetGroups = breakdownData.results.calculatedBudgetGroups || [];
    const equationBudgetGroup = calculatedBudgetGroups.find(
        (group) => group.kind === "equation" || group.id === "measurement_equation",
    );
    const finalBudgetGroup = calculatedBudgetGroups.find(
        (group) => group.kind === "final" || group.id === "final_budget",
    );

    // The component variances are useful for showing the independent RSS
    // reference, but the authoritative result may include input correlations
    // and final-budget components. Prefer the value emitted by the calculator.
    const sumOfVariancesDerivedUnits = formulaTerms.reduce((sum, term) => sum + (isNaN(term.varianceDerivedSq) ? 0 : term.varianceDerivedSq), 0);
    const independentCombinedUncertainty = Math.sqrt(sumOfVariancesDerivedUnits);
    const sumOfEquationVariancesDerivedUnits = formulaTerms
        .filter((term) => term.isInput)
        .reduce((sum, term) => sum + (isNaN(term.varianceDerivedSq) ? 0 : term.varianceDerivedSq), 0);
    const independentEquationCombinedUncertainty = Math.sqrt(sumOfEquationVariancesDerivedUnits);
    const resultCombinedBase = breakdownData.results.combined_uncertainty_absolute_base == null
        ? NaN
        : Number(breakdownData.results.combined_uncertainty_absolute_base);
    const groupCombined = finalBudgetGroup?.results?.combined == null
        ? NaN
        : Number(finalBudgetGroup.results.combined);
    const combinedUncertaintyInDerivedUnit = Number.isFinite(resultCombinedBase)
        ? unitSystem.fromBaseUnit(resultCombinedBase, derivedUnit)
        : Number.isFinite(groupCombined)
          ? groupCombined
          : independentCombinedUncertainty;
    const equationCombinedUncertainty = equationBudgetGroup?.results?.combined == null
        ? NaN
        : Number(equationBudgetGroup.results.combined);
    const hasCorrelationAdjustment = equationBudgetGroup?.correlationApplied === true;

    return ReactDOM.createPortal(
        <div 
            className="modal-content breakdown-modal-content" 
            style={{ 
                ...windowStyle, 
                zIndex: 2000,
            }}
        >
            <button onClick={onClose} className="modal-close-button">&times;</button>
            <h3 
                className="breakdown-modal-title"
                onMouseDown={handleMouseDown} 
            >
                Derived Uncertainty Calculation Breakdown
            </h3>

            <div className="modal-body-scrollable">
                {/* Equation Display */}
                <div className="breakdown-step">
                    <h5>Measurement Equation (<Latex>$y = f(x_1, x_2, ...)$</Latex>)</h5>
                    <div style={{ fontSize: '1.1em', textAlign: 'center' }}> <Latex>{`$$ ${equationTex} $$`}</Latex> </div>
                </div>

                {usesMonteCarlo && (
                    <>
                        <div className="breakdown-step">
                            <h5>Monte Carlo Input Model ({Number(monteCarlo.trials || 0).toLocaleString()} trials)</h5>
                            <p>
                                Each trial draws independent standard-normal values, applies the configured
                                input correlations, samples each input, and evaluates the full equation. These
                                are the exact matrices saved with this calculation.
                            </p>
                            <table className="uncertainty-table" style={{ width: '100%' }}>
                                <thead><tr><th>Input</th><th>Mean (base unit)</th><th>Standard uncertainty (base unit)</th><th>MC influence</th></tr></thead>
                                <tbody>{(monteCarlo.inputs || []).map((input, index) => (
                                    <tr key={input.componentId || input.symbol || index}>
                                        <td>{input.symbol || `x${index + 1}`}</td>
                                        <td>{formatNumberForLatex(Number(input.meanBase), 7)}</td>
                                        <td>{formatNumberForLatex(Number(input.standardUncertaintyBase), 7)}</td>
                                        <td>{formatNumberForLatex(100 * Number(monteCarlo.influenceFractions?.[index] || 0), 5)}%</td>
                                    </tr>
                                ))}</tbody>
                            </table>
                            <MonteCarloMatrix title="Correlation matrix (R)" symbols={(monteCarlo.inputs || []).map((input, index) => input.symbol || `x${index + 1}`)} values={monteCarlo.correlationMatrix} />
                            <MonteCarloMatrix title="Lower Cholesky matrix (L), where R = LLᵀ" symbols={(monteCarlo.inputs || []).map((input, index) => input.symbol || `x${index + 1}`)} values={monteCarlo.choleskyMatrix} />
                        </div>
                        <div className="breakdown-step">
                            <h5>Monte Carlo Propagation Walkthrough</h5>
                            <ol>
                                <li><Latex>{'$\\mathbf{z}^{(k)} \\sim N(\\mathbf{0}, I)$'}</Latex> generates independent standard-normal draws.</li>
                                <li><Latex>{'$\\mathbf{q}^{(k)} = L\\mathbf{z}^{(k)}$'}</Latex> applies the input correlations.</li>
                                <li><Latex>{'$x_i^{(k)} = \\bar{x}_i + u(x_i)q_i^{(k)}$'}</Latex> forms a physical input sample.</li>
                                <li><Latex>{'$y_k = f(x_1^{(k)}, \\ldots, x_n^{(k)})$'}</Latex> evaluates the equation.</li>
                            </ol>
                            <Latex>{`$$ \\bar{y} = \\frac{1}{N}\\sum_{k=1}^{N} y_k = ${formatNumberForLatex(Number(monteCarlo.meanBase), 7)} $$`}</Latex>
                            <Latex>{`$$ u_{MC} = \\sqrt{\\frac{\\sum_{k=1}^{N}(y_k-\\bar{y})^2}{N-1}} = ${formatNumberForLatex(Number(monteCarlo.standardUncertaintyBase), 7)} \\text{ (base unit)} $$`}</Latex>
                            <Latex>{`$$ f(\\bar{\\mathbf{x}}) = ${formatNumberForLatex(Number(monteCarlo.nominalResultBase), 7)} \\text{ (base unit)} $$`}</Latex>
                            <p>The <Latex>{'$N-1$'}</Latex> denominator produces the unbiased sample standard deviation. The Monte Carlo result enters the final budget once; its input rows are not counted again.</p>
                        </div>
                        <div className="breakdown-step">
                            <h5>Final Budget Combination</h5>
                            <p>The Monte Carlo approximation is combined by RSS with UUT resolution and any manual final-budget components.</p>
                            <Latex>{`$$ u_y = \\mathbf{${formatNumberForLatex(combinedUncertaintyInDerivedUnit, 6)}} \\text{ ${derivedUnit}} $$`}</Latex>
                            <strong>Final Combined Uncertainty: {Number.isFinite(combinedUncertaintyInDerivedUnit) ? `${combinedUncertaintyInDerivedUnit.toPrecision(6)} ${derivedUnit}` : 'N/A'}</strong>
                        </div>
                    </>
                )}

                {/* Component Breakdown Loop */}
                {!usesMonteCarlo && formulaTerms.map((term, index) => {
                     const formattedValueUi = formatNumberForLatex(term.ui_native);
                     const displayValueUnitUi = term.ui_unit_native;
                     const formattedCi = formatNumberForLatex(term.ci);
                     const formattedContribution = (term && !isNaN(term.contribution)) ? formatNumberForLatex(term.contribution) : 'N/A';

                    let derivativeDisplay = '';
                    let derivativeTex = '';
                    // Find the original budget component to get the derivative string
                    const budgetComp = term.component ||
                        breakdownData.results.calculatedBudgetComponents.find(c => String(c.name || '').includes(`(${term.varSymbol})`));
                    if (budgetComp) {
                        derivativeDisplay = budgetComp.derivativeString;
                        if(derivativeDisplay){ try { derivativeTex = math.parse(derivativeDisplay).toTex(); } catch (e) { derivativeTex = derivativeDisplay; } }
                    } else if (term.varSymbol === 'res') {
                        derivativeTex = "1"; // Ci for resolution is 1
                    }

                    let evaluationStepTex = '';
                    if (derivativeDisplay && Object.keys(nominalScopeForDisplay).length > 0) {
                        try { const derivativeNode = math.parse(derivativeDisplay); evaluationStepTex = derivativeNode.toTex({ handler: (node, options) => { if (node.isSymbolNode && nominalScopeForDisplay.hasOwnProperty(node.name)) { return formatNumberForLatex(nominalScopeForDisplay[node.name]); } } }); evaluationStepTex = `${evaluationStepTex} = ${formattedCi}`; } catch (e) { evaluationStepTex = `${formattedCi}`; }
                    } else if (derivativeTex) { evaluationStepTex = `${derivativeTex} = ${formattedCi}`; }
                    
                    const symbol = term.varSymbol;

                    return (
                        <div className="breakdown-step" key={term.name || index}>
                            <h5>{term.name} {term.quantity > 1 ? `(x${term.quantity})` : ''}</h5>
                            <ul>
                                <li><strong>Standard Uncertainty (<Latex>{`$u_{${symbol}}$`}</Latex>):</strong> {formattedValueUi} {displayValueUnitUi} {term.isInput ? "(aggregated input)" : ""}</li>
                                
                                <li>
                                    <strong>Sensitivity Coefficient (<Latex>{`$c_{${symbol}}$`}</Latex>):</strong>
                                    <ul style={{ listStyleType: 'none', paddingLeft: '10px' }}>
                                        {expressionTex && term.varSymbol !== 'res' && ( <li><Latex>{`$$ \\text{Calculate } c_{${symbol}} = \\frac{\\partial}{\\partial ${symbol}} \\left( ${expressionTex} \\right) $$`}</Latex></li> )}
                                        {derivativeTex && term.varSymbol !== 'res' && ( <li><Latex>{`$$ \\rightarrow c_{${symbol}} = ${derivativeTex} $$`}</Latex></li> )}
                                        {evaluationStepTex && ( <li><Latex>{`$$ \\text{Evaluate: } c_{${symbol}} = ${evaluationStepTex} $$`}</Latex></li> )}
                                    </ul>
                                </li>

                                <li><strong>Contribution (<Latex>{term.isInput ? `$|c_{${symbol}} \\times u_{${symbol}}|$` : `$u_{${symbol}}$`}</Latex>):</strong> {formattedContribution} {derivedUnit}</li>
                                {term.quantity > 1 && (
                                    <li><strong>Quantity-adjusted Variance Term (<Latex>{`$${term.quantity} \\cdot u_{${symbol}}^2$`}</Latex>):</strong> {formatNumberForLatex(term.varianceDerivedSq, 5)}</li>
                                )}

                                {/* 2nd-order Taylor term (nonlinear equations): ½·f″·u². */}
                                {budgetComp?.secondDerivativeString && Number.isFinite(budgetComp?.secondOrderContribution) && budgetComp.secondOrderContribution !== 0 && (() => {
                                    let secondDerivativeTex = budgetComp.secondDerivativeString;
                                    try { secondDerivativeTex = math.parse(budgetComp.secondDerivativeString).toTex(); } catch (e) { /* show raw string */ }
                                    return (
                                        <li>
                                            <strong>2nd-Order Taylor Term (<Latex>{`$\\tfrac{1}{2} c''_{${symbol}} u_{${symbol}}^2$`}</Latex>):</strong>
                                            <ul style={{ listStyleType: 'none', paddingLeft: '10px' }}>
                                                <li><Latex>{`$$ c''_{${symbol}} = \\frac{\\partial^2 f}{\\partial ${symbol}^2} = ${secondDerivativeTex} = ${formatNumberForLatex(budgetComp.secondDerivativeValue)} $$`}</Latex></li>
                                                <li><Latex>{`$$ \\left| \\tfrac{1}{2} c''_{${symbol}} u_{${symbol}}^2 \\right| = ${formatNumberForLatex(budgetComp.secondOrderContribution)} \\text{ ${derivedUnit}} $$`}</Latex></li>
                                            </ul>
                                        </li>
                                    );
                                })()}
                            </ul>
                            {budgetComp?.nonlinearityWarning && (
                                <p style={{ color: '#b45309', fontWeight: 600, marginTop: '6px' }}>
                                    ⚠ {budgetComp.nonlinearityWarning}
                                </p>
                            )}
                        </div>
                    );
                })}

                {!usesMonteCarlo && <div className="breakdown-step">
                    <h5>Combined Uncertainty Calculation (<Latex>{`$u_y$`}</Latex> in {derivedUnit})</h5>
                    <p>
                        The independent first-order terms provide an RSS reference. The final value below
                        is read from the live derived budget, so configured correlations, manual components,
                        and UUT resolution are included exactly once.
                    </p>
                    <Latex>{`$$ u_{RSS} = \\sqrt{${formulaTerms.map(t => t.symbolLatex).join(" + ")}} = \\sqrt{${formatNumberForLatex(sumOfVariancesDerivedUnits, 5)}} = \\mathbf{${formatNumberForLatex(independentCombinedUncertainty, 5)}} \\text{ ${derivedUnit}} $$`}</Latex>
                    {formulaTerms.some((term) => term.isInput) && (
                        <Latex>{`$$ u_{RSS, equation} = \\sqrt{${formulaTerms.filter(t => t.isInput).map(t => t.symbolLatex).join(" + ")}} = \\mathbf{${formatNumberForLatex(independentEquationCombinedUncertainty, 5)}} \\text{ ${derivedUnit}} $$`}</Latex>
                    )}
                    {Number.isFinite(equationCombinedUncertainty) && (
                        <Latex>{`$$ u_{equation} = \\mathbf{${formatNumberForLatex(equationCombinedUncertainty, 5)}} \\text{ ${derivedUnit}}${hasCorrelationAdjustment ? "\\quad (correlations applied)" : ""} $$`}</Latex>
                    )}
                    <Latex>{`$$ u_y = \\mathbf{${formatNumberForLatex(combinedUncertaintyInDerivedUnit, 5)}} \\text{ ${derivedUnit}} $$`}</Latex>

                    <hr style={{margin: '15px 0'}}/>
                    <strong>Final Combined Uncertainty (<Latex>$u_y$</Latex>): {isNaN(combinedUncertaintyInDerivedUnit) ? 'N/A' : `${combinedUncertaintyInDerivedUnit.toPrecision(5)} ${derivedUnit}`}</strong>
                </div>}

                {/* 2nd-order Taylor series summary — only for nonlinear equations
                    (at least one input with a non-zero ½f″u² term). Computed from
                    the same per-term values rendered above so the arithmetic shown
                    here ties out exactly. */}
                {!usesMonteCarlo && (() => {
                    const components = breakdownData.results.calculatedBudgetComponents || [];
                    const secondOrderComps = components.filter(
                        (c) => Number.isFinite(c.secondOrderContribution) && c.secondOrderContribution !== 0
                    );
                    if (secondOrderComps.length === 0) return null;
                    const valuesTex = secondOrderComps
                        .map((c) => `(${formatNumberForLatex(c.secondOrderContribution)})^2`)
                        .join(' + ');
                    const shiftValuesTex = secondOrderComps
                        .map((c) => formatNumberForLatex(c.secondOrderShift))
                        .join(' + ');
                    const sumSecondOrderSquares = secondOrderComps.reduce(
                        (sum, c) => sum + c.secondOrderContribution ** 2, 0
                    );
                    const meanShift = secondOrderComps.reduce(
                        (sum, c) => sum + (Number.isFinite(c.secondOrderShift) ? c.secondOrderShift : 0), 0
                    );
                    const uSecondOrder = Math.sqrt(
                        (isNaN(sumOfEquationVariancesDerivedUnits) ? 0 : sumOfEquationVariancesDerivedUnits) +
                        sumSecondOrderSquares
                    );
                    const linearMean = parseFloat(breakdownData.results.calculatedNominalValue);
                    const correctedMean = Number.isFinite(linearMean)
                        ? linearMean + meanShift
                        : NaN;
                    return (
                        <div className="breakdown-step">
                            <h5>2nd-Order Taylor Series (Nonlinearity Correction)</h5>
                            <p>
                                The equation is nonlinear at this operating point, so the first-order
                                (GUM) budget above is incomplete. This diagnostic adds the diagonal
                                second-order Taylor terms to the independent first-order RSS baseline.
                                It does not replace the authoritative correlated/final-budget result above:
                            </p>
                            <Latex>{`$$ u_y^{(2)} = \\sqrt{\\sum_i (c_i u_i)^2 + \\sum_i \\left( \\tfrac{1}{2} c''_i u_i^2 \\right)^2} $$`}</Latex>
                            <Latex>{`$$ u_y^{(2)} = \\sqrt{${formatNumberForLatex(sumOfEquationVariancesDerivedUnits, 5)} + ${valuesTex}} = \\mathbf{${formatNumberForLatex(uSecondOrder, 5)}} \\text{ (${derivedUnit})} $$`}</Latex>
                            <p>
                                The second-order terms also shift the expected result away from{' '}
                                <Latex>{`$f(\\bar{x})$`}</Latex> (the corrected mean):
                            </p>
                            <Latex>{`$$ \\Delta y = \\sum_i \\tfrac{1}{2} c''_i u_i^2 = ${shiftValuesTex} = \\mathbf{${formatNumberForLatex(meanShift, 5)}} \\text{ (${derivedUnit})} $$`}</Latex>
                            {Number.isFinite(correctedMean) && (
                                <Latex>{`$$ E[y] \\approx f(\\bar{x}) + \\Delta y = ${formatNumberForLatex(linearMean, 6)} + ${formatNumberForLatex(meanShift, 5)} = \\mathbf{${formatNumberForLatex(correctedMean, 6)}} \\text{ (${derivedUnit})} $$`}</Latex>
                            )}
                            <p style={{ color: 'var(--text-color-muted)', fontSize: '0.9em' }}>
                                These second-order values are diagnostic only (diagonal terms only;
                                correlations, manual components, and UUT resolution are not included;
                                symmetric input distributions are assumed. For the authoritative
                                result at a nonlinear or stationary operating point, switch the
                                point to Monte Carlo propagation — its mean and uncertainty include
                                all higher-order effects and feed the risk analysis directly.
                            </p>
                        </div>
                    );
                })()}
            </div>
        </div>,
        document.body
    );
};

export default DerivedBreakdownModal;
