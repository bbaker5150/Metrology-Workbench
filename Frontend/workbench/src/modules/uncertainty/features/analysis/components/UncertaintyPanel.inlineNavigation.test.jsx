import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  EditableDescriptionCell,
  InlineDistributionCell,
  InlineToleranceCell,
  RangeCell,
  ResolutionCellInput,
} from "./UncertaintyPanel";

describe("inline instrument column navigation", () => {
  it.each(['range', 'qualifier', 'resolution', 'distribution', 'description'])('hands tolerance editing to %s and back before mouse-up', async kind => {
    const commit = vi.fn();
    const range = { id: 'handoff-range', min: 0, max: 10, unit: 'V', text: '100 Hz' };
    const editors = {
      range: <RangeCell activeRange={range} editable onPatchRange={vi.fn()} />,
      qualifier: <RangeCell activeRange={range} textMode editable onPatchRange={vi.fn()} />,
      resolution: <ResolutionCellInput value="0.1" unit="V" onCommit={vi.fn()} />,
      distribution: <InlineDistributionCell divisor="1.732" onChange={vi.fn()} />,
      description: <EditableDescriptionCell name="Test instrument" onCommit={vi.fn()} />,
    };
    const expanded = '.inline-range-editor.is-editing, .instrument-resolution-editor, .inline-distribution-editor, .inline-desc-fields';
    const { container } = render(<div className="uncertainty-module">
      <div data-testid="tolerance"><InlineToleranceCell tolerance={{ reading: { value: '1', unit: '%' } }}
        activeRange={range} editable onCommit={commit} /></div>
      <div data-testid="destination">{editors[kind]}</div>
    </div>);
    const tolerance = screen.getByTestId('tolerance'), destination = screen.getByTestId('destination');
    fireEvent.mouseDown(tolerance.querySelector('.inline-tolerance-summary'));
    const draft = tolerance.querySelector('input.inline-tolerance-input');
    draft.focus();
    fireEvent.change(draft, { target: { value: '2.5' } });
    const press = element => { fireEvent.pointerDown(element); fireEvent.mouseDown(element); };
    const release = async () => {
      fireEvent.pointerUp(document.body); fireEvent.mouseUp(document.body);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    };
    press(destination.querySelector('button'));
    expect(tolerance.querySelector('.inline-tolerance-editor')).toBeNull();
    expect(destination.querySelector(expanded)).not.toBeNull();
    expect(commit).toHaveBeenCalledWith('reading', expect.objectContaining({ value: '2.5' }));
    await release();
    expect(destination.querySelector(expanded)).not.toBeNull();
    press(tolerance.querySelector('.inline-tolerance-summary'));
    expect(destination.querySelector(expanded)).toBeNull();
    expect(container.querySelectorAll('.inline-tolerance-editor')).toHaveLength(1);
    await release();
    expect(container.querySelectorAll('.inline-tolerance-editor')).toHaveLength(1);
  });

  it('switches tolerance editors on mouse-down without overlapping or losing the focused draft', async () => {
    const commit = vi.fn();
    const Harness = () => {
      const [requested, setRequested] = useState(null);
      return <div className="uncertainty-module">{[0, 1].map(index =>
        <div key={index} data-testid={`editor-${index}`}>
          <InlineToleranceCell tolerance={{reading:{value:'1',unit:'%'}}}
            activeRange={{id:`r${index}`,unit:'V',max:10}} editable onCommit={commit}
            openRequested={requested === index} onOpenRequest={() => setRequested(index)}
            onOpenRequestHandled={() => setRequested(null)} />
        </div>)}<div className="instrument-panel-table-container" /></div>;
    };
    const {container} = render(<Harness />);
    const first = screen.getByTestId('editor-0'), second = screen.getByTestId('editor-1');
    fireEvent.mouseDown(first.querySelector('.inline-tolerance-summary'));
    const input = first.querySelector('input.inline-tolerance-input');
    input.focus();
    fireEvent.change(input,{target:{value:'2.5'}});
    fireEvent.pointerDown(second.querySelector('.inline-tolerance-summary'));
    fireEvent.mouseDown(second.querySelector('.inline-tolerance-summary'));
    expect(first.querySelector('.inline-tolerance-editor')).toBeNull();
    expect(second.querySelector('.inline-tolerance-editor')).not.toBeNull();
    expect(commit).toHaveBeenCalledWith('reading',expect.objectContaining({value:'2.5'}));
    fireEvent.pointerUp(second.querySelector('button'));
    fireEvent.mouseUp(second.querySelector('button'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve,10)); });
    expect(container.querySelectorAll('.inline-tolerance-editor')).toHaveLength(1);
    // A later scrollbar drag still leaves the destination editor open.
    const scroller = container.querySelector('.instrument-panel-table-container');
    fireEvent.pointerDown(scroller); fireEvent.mouseDown(scroller);
    fireEvent.pointerUp(scroller); fireEvent.mouseUp(scroller); fireEvent.click(scroller);
    await act(async () => { await new Promise(resolve => setTimeout(resolve,10)); });
    expect(second.querySelector('.inline-tolerance-editor')).not.toBeNull();
  });

  it.each(['uut', 'tmde', 'source'])('commits and collapses %s tolerance on Enter', biasRole => {
    const onCommit = vi.fn();
    const {container} = render(<InlineToleranceCell tolerance={{reading:{value:'1',unit:'%'}}}
      activeRange={{id:'enter-range',unit:'V',max:10}} biasRole={biasRole} editable onCommit={onCommit} />);
    fireEvent.click(container.querySelector('.inline-tolerance-summary'));
    const input = container.querySelector('input.inline-tolerance-input');
    input.focus();
    fireEvent.change(input,{target:{value:'2.5'}});
    fireEvent.keyDown(input,{key:'Enter'});
    expect(onCommit).toHaveBeenCalledWith('reading',expect.objectContaining({value:'2.5',high:'2.5',low:'-2.5'}));
    expect(container.querySelector('.inline-tolerance-editor')).toBeNull();
    expect(container.querySelector('.inline-tolerance-summary')).not.toBeNull();
  });

  it('keeps the tolerance editor open through a scrollbar drag but dismisses on a later outside click', async () => {
    const {container} = render(<><div className="instrument-panel-table-container">
      <InlineToleranceCell tolerance={{}} activeRange={{id:'r',unit:'V',max:10}} editable onCommit={vi.fn()} />
    </div><button>Outside table</button></>);
    fireEvent.click(screen.getByRole('button',{name:'Set tolerance'}));
    const scroller=container.querySelector('.instrument-panel-table-container');
    fireEvent.pointerDown(scroller); fireEvent.mouseDown(scroller);
    fireEvent.scroll(scroller,{target:{scrollLeft:200}});
    fireEvent.pointerUp(document.body); fireEvent.mouseUp(document.body); fireEvent.click(scroller);
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
    expect(screen.getByTitle('Asymmetric tolerance')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText('Outside table')); fireEvent.mouseUp(screen.getByText('Outside table')); fireEvent.click(screen.getByText('Outside table'));
    await waitFor(()=>expect(screen.queryByTitle('Asymmetric tolerance')).not.toBeInTheDocument());
  });
  it("keeps tolerance editing stable across parent rerenders and mode changes", async () => {
    const editingChanges = vi.fn();
    const Harness = () => {
      const [tolerance, setTolerance] = useState({});
      const [parentRevision, setParentRevision] = useState(0);
      return (
        <InlineToleranceCell
          tolerance={tolerance}
          activeRange={{ id: "range-tolerance", min: 0, max: 10, unit: "V" }}
          editable
          onEditingChange={(editing) => {
            editingChanges(editing);
            if (editing && parentRevision === 0) setParentRevision(1);
          }}
          onCommit={(typeKey, component) => {
            if (typeKey === "__replace__") setTolerance(component);
          }}
        />
      );
    };

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Set tolerance" }));
    await waitFor(() => {
      expect(screen.getByTitle("Asymmetric tolerance")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTitle("Asymmetric tolerance"));
    fireEvent.click(screen.getByTitle("Double-sided tolerance"));

    expect(screen.getByTitle("Asymmetric tolerance")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(editingChanges.mock.calls.filter(([editing]) => editing)).toHaveLength(1);
  });

  it("keeps a newly added blank range collapsed until its summary is clicked", () => {
    render(
      <RangeCell
        ranges={[{ id: "blank-range", min: "", max: "", unit: "V" }]}
        activeIndex={0}
        activeRange={{ id: "blank-range", min: "", max: "", unit: "V" }}
        editable
        editBlankByDefault
        onEditBound={vi.fn()}
        onEditUnit={vi.fn()}
      />,
    );

    expect(screen.getByText("Not Set")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("min")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Set range"));
    expect(screen.getByPlaceholderText("min")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("max")).toBeInTheDocument();
    expect(screen.queryByText("Not Set")).not.toBeInTheDocument();
  });

  it("opens tolerance rather than adding a range when Tab leaves its unit", () => {
    const onAdvanceRange = vi.fn();
    const onOpenTolerance = vi.fn();
    const range = { id: "range-1", min: "0", max: "10", unit: "V" };
    render(
      <RangeCell
        ranges={[range]}
        activeIndex={0}
        activeRange={range}
        editable
        onEditBound={vi.fn()}
        onEditUnit={vi.fn()}
        onAdvanceRange={onAdvanceRange}
        onOpenTolerance={onOpenTolerance}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "0 to 10 V" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Range unit prefix" }), {
      key: "Tab",
    });

    expect(onAdvanceRange).not.toHaveBeenCalled();
    expect(onOpenTolerance).toHaveBeenCalledOnce();
  });

  it("keeps a staged blank row editable while its bounds are completed", async () => {
    const onAdvanceRange = vi.fn();
    const onOpenTolerance = vi.fn();
    const RangeHarness = () => {
      const [range, setRange] = useState({
        id: "blank-range",
        min: "",
        max: "",
        unit: "V",
      });
      return (
        <RangeCell
          ranges={[range]}
          activeIndex={0}
          activeRange={range}
          editable
          editBlankByDefault
          onEditBound={(field, value) =>
            setRange((current) => ({ ...current, [field]: value }))
          }
          onEditUnit={(unit) => setRange((current) => ({ ...current, unit }))}
          onAdvanceRange={onAdvanceRange}
        onOpenTolerance={onOpenTolerance}
        />
      );
    };

    render(<RangeHarness />);
    fireEvent.click(screen.getByTitle("Set range"));
    const min = screen.getByPlaceholderText("min");
    const max = screen.getByPlaceholderText("max");
    const prefix = screen.getByRole("button", { name: "Range unit prefix" });

    fireEvent.change(min, { target: { value: "0" } });
    fireEvent.blur(min, { relatedTarget: max });
    fireEvent.change(max, { target: { value: "10" } });
    fireEvent.blur(max, { relatedTarget: prefix });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("min")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("max")).toBeInTheDocument();
    });
    fireEvent.keyDown(prefix, { key: "Tab" });
    expect(onAdvanceRange).not.toHaveBeenCalled();
    expect(onOpenTolerance).toHaveBeenCalledOnce();
  });

  it("commits a nickname on the first outside click", async () => {
    const onCommit = vi.fn();
    render(
      <EditableDescriptionCell
        make="Acme"
        model="DMM-1"
        name="Bench meter"
        nickname=""
        onCommit={onCommit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Acme DMM-1 Bench meter" }));
    const nickname = screen.getByPlaceholderText("Tag / nickname");
    fireEvent.change(nickname, { target: { value: "Primary" } });
    fireEvent.mouseDown(document.body);
    fireEvent.blur(nickname, { relatedTarget: document.body });

    await waitFor(() =>
      expect(onCommit).toHaveBeenCalledWith("nickname", "Primary"),
    );
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("keeps library suggestions concise and omits unset metadata", async () => {
    render(
      <EditableDescriptionCell
        make=""
        model=""
        name=""
        functionKey="voltage::V"
        onCommit={vi.fn()}
        onPickLibrary={vi.fn()}
        instruments={[
          {
            id: "local-dmm",
            manufacturer: "Acme",
            model: "DMM-1",
            description: "Bench meter",
            scope: "local",
            sourceId: "shared-dmm",
            validatedSnapshot: {
              manufacturer: "Acme",
              model: "DMM-1",
              description: "Original meter",
              functions: [],
            },
            functions: [
              {
                id: "voltage",
                name: "Voltage",
                unit: "V",
                ranges: [{ id: "all", min: "", max: "", unit: "V", tolerances: {} }],
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Click to add description" }));

    await waitFor(() => expect(screen.getByText("Acme DMM-1 Bench meter")).toBeInTheDocument());
    expect(screen.getByText("local")).toBeInTheDocument();
    expect(screen.queryByText(/not set/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/new|changed|synced/i)).not.toBeInTheDocument();
  });

  it("moves Tab from the final description input to the range column", async () => {
    const openRange = vi.fn();
    const RangeCellHarness = () => {
      const [isOpen, setIsOpen] = useState(false);
      return isOpen ? (
        <input aria-label="Range minimum" />
      ) : (
        <button
          type="button"
          className="inline-tolerance-summary"
          onClick={() => {
            openRange();
            // Initial range creation is persisted before the editor mounts in
            // the real table. Reproduce that delay so the test protects the
            // focus handoff rather than only the already-mounted case.
            window.setTimeout(() => setIsOpen(true), 30);
          }}
        >
          Not Set
        </button>
      );
    };
    render(
      <table>
        <tbody>
          <tr>
            <td>
              <EditableDescriptionCell
                make="Mock"
                model="Calibration"
                name="Beam"
                onCommit={vi.fn()}
              />
            </td>
            <td>
              <RangeCellHarness />
            </td>
          </tr>
        </tbody>
      </table>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Mock Calibration Beam" }),
    );
    const nameInput = screen.getByPlaceholderText("Name");
    nameInput.focus();
    fireEvent.keyDown(nameInput, { key: "Tab" });

    expect(openRange).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.getByLabelText("Range minimum")).toHaveFocus();
    });
  });

  it("opens all ranges and focuses the clicked range on the first click", async () => {
    const RangeHarness = () => {
      const [expanded, setExpanded] = useState(false);
      const [pending, setPending] = useState(false);
      const range = { id: "r1", min: "0", max: "10", unit: "V" };
      return (
        <RangeCell
          ranges={[range]}
          activeIndex={0}
          activeRange={range}
          editable
          onEditBound={vi.fn()}
          onEditUnit={vi.fn()}
          onExpandAll={expanded ? undefined : () => setExpanded(true)}
          onRequestEditAfterExpand={() => setPending(true)}
          openRequested={expanded && pending}
          onOpenRequestHandled={() => setPending(false)}
        />
      );
    };

    render(<RangeHarness />);
    const editRanges = screen.getByRole("button", { name: "Edit ranges" });
    expect(editRanges).toHaveAttribute("title", "Edit ranges");
    fireEvent.click(editRanges);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("min")).toHaveFocus();
    });
  });
});

it.each(["min", "unit"])("Ctrl+Enter adds a range from %s", field => {
 const add=vi.fn();const range={id:"r",min:0,max:10,unit:"V"};
 render(<RangeCell ranges={[range]} activeRange={range} editable onEditBound={vi.fn()} onEditUnit={vi.fn()} onAdvanceRange={add} />);
 fireEvent.click(screen.getByRole("button",{name:"0 to 10 V"}));
 const target=field==="min" ? screen.getByPlaceholderText("min") : screen.getByRole("button",{name:"Range unit prefix"});
 fireEvent.keyDown(target,{key:"Enter",ctrlKey:true});
 expect(add).toHaveBeenCalledOnce();
});
