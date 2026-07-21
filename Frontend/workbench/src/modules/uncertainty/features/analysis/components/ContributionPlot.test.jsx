import { render } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Plotly from "plotly.js-dist";
import PercentageBarGraph from "./ContributionPlot";

// The component used to draw via `window.Plotly`, which the app never assigns,
// so the chart silently never rendered. It now imports Plotly directly; assert
// it actually drives Plotly instead of no-oping.
vi.mock("plotly.js-dist", () => ({
  default: {
    react: vi.fn(),
    purge: vi.fn(),
    Plots: { resize: vi.fn() },
    Icons: { camera: { width: 1000, path: "" } },
    toImage: vi.fn(),
  },
}));

vi.mock("../../../context/ThemeContext", () => ({
  useTheme: () => false,
}));

beforeAll(() => {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  Plotly.react.mockClear();
  Plotly.purge.mockClear();
});

describe("ContributionPlot", () => {
  it("draws the chart through the imported Plotly, not window.Plotly", () => {
    render(
      <PercentageBarGraph
        data={{ "DMM Accuracy": 0.01, "Reference": 0.004 }}
        unit="V"
      />,
    );

    expect(Plotly.react).toHaveBeenCalledTimes(1);
    const [, plotData] = Plotly.react.mock.calls[0];
    // Two non-zero contributors -> two horizontal bars.
    expect(plotData[0].y).toEqual(
      expect.arrayContaining(["DMM Accuracy", "Reference"]),
    );
    const [, , layout, config] = Plotly.react.mock.calls[0];
    expect(layout.paper_bgcolor).toBe("rgba(0, 0, 0, 0)");
    expect(layout.plot_bgcolor).toBe("rgba(0, 0, 0, 0)");
    expect(layout.xaxis.title.text).toBe("Relative contribution (%)");
    expect(config.displayModeBar).toBe(false);
    expect(config.modeBarButtonsToAdd).toBeUndefined();
    expect(document.querySelector(".contribution-plot")).toBeInTheDocument();
  });

  it("purges the chart on unmount", () => {
    const { unmount } = render(
      <PercentageBarGraph data={{ "DMM Accuracy": 0.01 }} unit="V" />,
    );
    unmount();
    expect(Plotly.purge).toHaveBeenCalledTimes(1);
  });

  it("renders Monte Carlo influence as percentages without physical units", () => {
    render(
      <PercentageBarGraph
        data={{ Weight: 0.6, Length: 0.4 }}
        unit="in-oz"
        valueMode="share"
        title="Monte Carlo variable influence"
      />,
    );

    const [, plotData, layout] = Plotly.react.mock.calls[0];
    expect(plotData[0].y).toEqual(["Length", "Weight"]);
    expect(plotData[0].x).toEqual([40, 60]);
    expect(plotData[0].customdata).toEqual(["40.00%", "60.00%"]);
    expect(plotData[0].hovertemplate).toContain("Variable influence");
    expect(plotData[0].customdata.join(" ")).not.toContain("in-oz");
    expect(layout.title.text).toBe("Monte Carlo variable influence");
  });

  it("shows a placeholder and does not draw when there are no contributors", () => {
    const { getByText } = render(<PercentageBarGraph data={{}} unit="V" />);
    expect(getByText(/No significant error sources/i)).toBeInTheDocument();
    expect(Plotly.react).not.toHaveBeenCalled();
  });
});
