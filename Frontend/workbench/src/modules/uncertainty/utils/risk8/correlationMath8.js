/** Final V8.00 frmCalEquationUncertainty.CholeskyDecompose.
 * Shared by Taylor and Monte Carlo so both reject the same invalid matrices. */

/**
 * Strict workbook-style Cholesky decomposition.  A singular positive
 * semidefinite matrix is allowed; an invalid physical correlation matrix is
 * rejected instead of silently repaired or blended toward identity.
 */
export function risk8Cholesky(correlationMatrix) {
  const n = correlationMatrix.length;
  const lower = Array.from({ length: n }, () => new Float64Array(n));
  const tolerance = 1e-12;

  for (let i = 0; i < n; i += 1) {
    if (!Array.isArray(correlationMatrix[i]) && !(correlationMatrix[i] instanceof Float64Array)) {
      throw new Error("The correlation matrix must be square.");
    }
    if (correlationMatrix[i].length !== n) {
      throw new Error("The correlation matrix must be square.");
    }
    for (let j = 0; j <= i; j += 1) {
      let value = Number(correlationMatrix[i][j]);
      if (!Number.isFinite(value)) {
        throw new Error("Correlation coefficients must be numeric.");
      }
      for (let k = 0; k < j; k += 1) {
        value -= lower[i][k] * lower[j][k];
      }

      if (i === j) {
        if (Math.abs(Number(correlationMatrix[i][i]) - 1) > 1e-9) {
          throw new Error("The correlation matrix diagonal must be 1.");
        }
        if (value < -tolerance) {
          throw new Error("The correlation matrix is not physically valid.");
        }
        lower[i][j] = value < 0 ? 0 : Math.sqrt(value);
      } else {
        if (Math.abs(Number(correlationMatrix[i][j])) > 1) {
          throw new Error("Correlation coefficients must be between -1 and +1.");
        }
        if (Math.abs(lower[j][j]) < tolerance) {
          if (Math.abs(value) > tolerance) {
            throw new Error("The correlation matrix is not physically valid.");
          }
          lower[i][j] = 0;
        } else {
          lower[i][j] = value / lower[j][j];
        }
      }
    }
  }
  return lower;
}
