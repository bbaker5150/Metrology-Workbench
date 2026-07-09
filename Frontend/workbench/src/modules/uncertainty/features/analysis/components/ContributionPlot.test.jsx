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
  });

  it("purges the chart on unmount", () => {
    const { unmount } = render(
      <PercentageBarGraph data={{ "DMM Accuracy": 0.01 }} unit="V" />,
    );
    unmount();
    expect(Plotly.purge).toHaveBeenCalledTimes(1);
  });

  it("shows a placeholder and does not draw when there are no contributors", () => {
    const { getByText } = render(<PercentageBarGraph data={{}} unit="V" />);
    expect(getByText(/No significant error sources/i)).toBeInTheDocument();
    expect(Plotly.react).not.toHaveBeenCalled();
  });
});
