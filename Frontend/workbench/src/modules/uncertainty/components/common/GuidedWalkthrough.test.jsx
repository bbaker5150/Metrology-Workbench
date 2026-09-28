import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GuidedWalkthrough, {
  getWalkthroughCardPosition,
} from "./GuidedWalkthrough";

const steps = [
  {
    id: "start",
    title: "Start here",
    description: "Use the highlighted control.",
    target: '[data-tour="target"]',

  },
  {
    id: "finish",
    title: "Finished",
    description: "Done.",
  },
];

describe("GuidedWalkthrough", () => {
  it("jumps directly between workflows and their steps without requiring setup", () => {
    const onStepChange = vi.fn();
    render(
      <GuidedWalkthrough
        isOpen
        steps={[
          { ...steps[0], workflow: "Direct", canAdvance: false },
          { ...steps[1], workflow: "Derived" },
        ]}
        stepIndex={0}
        onStepChange={onStepChange}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Walkthrough workflow" }),
      { target: { value: "Derived" } },
    );
    expect(onStepChange).toHaveBeenCalledWith(1);
  });

  it("positions a taller tutorial card fully inside a short viewport", () => {
    const position = getWalkthroughCardPosition(
      { left: 50, right: 80, top: 420, bottom: 450 },
      { width: 800, height: 600 },
      480,
    );
    expect(position.top).toBeGreaterThanOrEqual(12);
    expect(position.top + 480).toBeLessThanOrEqual(588);
  });

  it("narrows the card to keep required inputs accessible beside it", () => {
    const position=getWalkthroughCardPosition({left:4,right:544,top:338,bottom:550},{width:900,height:600},540);
    expect(position.left).toBeGreaterThanOrEqual(558);
    expect(position.left+position.width).toBeLessThanOrEqual(888);
  });

  it("keeps the coach card inside the viewport", () => {
    expect(
      getWalkthroughCardPosition(
        { top: 40, left: 900, right: 980, bottom: 70, width: 80, height: 30 },
        { width: 1000, height: 700 },
      ),
    ).toMatchObject({ left: 526, top: 40, width: 360 });

    const centered = getWalkthroughCardPosition(null, {
      width: 320,
      height: 500,
    });
    expect(centered.left).toBeGreaterThanOrEqual(12);
    expect(centered.width).toBe(296);
  });

  it("advances only after the requested action changes application state", async () => {
    const onStepChange = vi.fn();
    const actionSteps = [{ ...steps[0], action: {
      label: "Create a session", allowed: '[data-tour="target"]',
      complete: context => context.sessionCount > 0, autoAdvance: true,
    }}, steps[1]];
    const props = { isOpen: true, steps: actionSteps, stepIndex: 0, onStepChange, onClose: vi.fn() };
    const view = context => <><button data-tour="target">Create</button><GuidedWalkthrough {...props} actionContext={context} /></>;
    const {rerender} = render(view({sessionCount:0}));
    fireEvent.click(screen.getByRole("button", {name:"Create"}));
    expect(screen.getByRole("button", {name:/^Next/})).toBeDisabled();
    expect(onStepChange).not.toHaveBeenCalled();
    rerender(view({sessionCount:1}));
    await waitFor(() => expect(onStepChange).toHaveBeenCalledWith(1));
  });

  it("blocks unrelated mouse and keyboard controls while keeping navigation and close available", () => {
    const unrelated = vi.fn(), allowed = vi.fn(), onClose = vi.fn(), onStepChange = vi.fn();
    const actionSteps = [{ ...steps[0], workflow:"Setup", action:{label:"Edit", allowed:'[data-tour="target"]', complete:()=>false}}, {...steps[1],workflow:"Review"}];
    const props = {steps:actionSteps,stepIndex:0,onStepChange,onClose};
    const view = isOpen => <><button onClick={unrelated} onKeyDown={unrelated}>Unrelated</button><button data-tour="target" onClick={allowed}>Edit</button><GuidedWalkthrough isOpen={isOpen} {...props}/></>;
    const {rerender} = render(view(true));
    fireEvent.click(screen.getByText("Unrelated"));
    fireEvent.keyDown(screen.getByText("Unrelated"), {key:"Enter"});
    expect(unrelated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Edit"}));
    expect(allowed).toHaveBeenCalledOnce();
    const workspaceKey=vi.fn();
    document.addEventListener('keydown',workspaceKey);
    expect(() => fireEvent.keyDown(window,{key:'Delete'})).not.toThrow();
    fireEvent.keyDown(screen.getByRole('combobox',{name:'Walkthrough workflow'}),{key:'Delete'});
    expect(workspaceKey).not.toHaveBeenCalled();
    document.removeEventListener('keydown',workspaceKey);
    fireEvent.change(screen.getByRole("combobox",{name:"Walkthrough workflow"}),{target:{value:"Review"}});
    expect(onStepChange).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button",{name:"Close walkthrough"}));
    expect(onClose).toHaveBeenCalledOnce();
    rerender(view(false));
    fireEvent.click(screen.getByText("Unrelated"));
    expect(unrelated).toHaveBeenCalledOnce();
  });

  it("remembers completed actions on Back and resets them when closed", () => {
    const onStepChange = vi.fn();
    const actionSteps = [{...steps[0], action:{label:"Edit",allowed:'[data-tour="target"]', snapshot:context=>context.value, complete:(context,baseline)=>context.value!==baseline}}, steps[1]];
    const props = {isOpen:true,steps:actionSteps,onStepChange,onClose:vi.fn()};
    const {rerender} = render(<GuidedWalkthrough {...props} stepIndex={0} actionContext={{value:0}}/>);
    rerender(<GuidedWalkthrough {...props} stepIndex={0} actionContext={{value:1}}/>);
    expect(screen.getByRole('button',{name:/^Next/})).toBeEnabled();
    rerender(<GuidedWalkthrough {...props} stepIndex={1} actionContext={{value:1}}/>);
    rerender(<GuidedWalkthrough {...props} stepIndex={0} actionContext={{value:1}}/>);
    expect(screen.getByRole('button',{name:/^Next/})).toBeEnabled();
    rerender(<GuidedWalkthrough {...props} isOpen={false} stepIndex={0} actionContext={{value:1}}/>);
    rerender(<GuidedWalkthrough {...props} stepIndex={0} actionContext={{value:1}}/>);
    expect(screen.getByRole('button',{name:/^Next/})).toBeDisabled();
    expect(onStepChange).not.toHaveBeenCalled();
  });

  it.each(['jump', 'close'])("cancels deferred advancement after %s", async navigation => {
    const onStepChange=vi.fn();
    const actionSteps=[{...steps[0],action:{label:'Choose',allowed:'[data-tour="target"]',acceptEvent:event=>event.type==='click',complete:(_context,_baseline,ui)=>ui.evidence,autoAdvance:true}},steps[1]];
    const props={isOpen:true,steps:actionSteps,stepIndex:0,onStepChange,onClose:vi.fn()};
    const view=overrides=><><button data-tour="target">Choose</button><GuidedWalkthrough {...props} {...overrides}/></>;
    const {rerender}=render(view({}));
    fireEvent.click(screen.getByRole('button',{name:'Choose'}));
    rerender(view(navigation==='close'?{isOpen:false}:{stepIndex:1}));
    await new Promise(resolve=>setTimeout(resolve,1000));
    expect(onStepChange).not.toHaveBeenCalled();
  });

  it("skips an incomplete action without waiting or later advancing again", async () => {
    const onStepChange=vi.fn();
    const actionSteps=[{...steps[0],action:{label:'Edit',allowed:'[data-tour="target"]',complete:()=>false}},steps[1]];
    render(<GuidedWalkthrough isOpen steps={actionSteps} stepIndex={0} onStepChange={onStepChange} onClose={vi.fn()}/>);
    expect(screen.getByRole('button',{name:/^Next/})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Skip'}));
    expect(onStepChange).toHaveBeenCalledWith(1);
  });

  it("cancels automatic advancement if the completed value becomes invalid", async () => {
    const onStepChange=vi.fn();
    const actionSteps=[{...steps[0],action:{label:'Set value',allowed:'[data-tour="target"]',complete:context=>context.valid}},steps[1]];
    const props={isOpen:true,steps:actionSteps,stepIndex:0,onStepChange,onClose:vi.fn()};
    const {rerender}=render(<GuidedWalkthrough {...props} actionContext={{valid:false}}/>);
    rerender(<GuidedWalkthrough {...props} actionContext={{valid:true}}/>);
    expect(screen.getByRole('button',{name:/^Next/})).toBeEnabled();
    rerender(<GuidedWalkthrough {...props} actionContext={{valid:false}}/>);
    expect(screen.getByRole('button',{name:/^Next/})).toBeDisabled();
    await new Promise(resolve=>setTimeout(resolve,1000));
    expect(onStepChange).not.toHaveBeenCalled();
  });

  it("explains when a later dynamic target is not available yet", async () => {
    render(
      <GuidedWalkthrough
        isOpen
        steps={steps}
        stepIndex={0}
        onStepChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(/Complete the preceding setup/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "Uncertalytics walkthrough" }),
      ).toBeInTheDocument(),
    );
  });

  it("includes the revealed menu in the spotlight without elevating application containers", async () => {
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getRect() {
        if (this.dataset?.tour === "revealed-menu") {
          return {
            top: 90,
            left: 40,
            right: 280,
            bottom: 300,
            width: 240,
            height: 210,
          };
        }
        return {
          top: 40,
          left: 40,
          right: 70,
          bottom: 70,
          width: 30,
          height: 30,
        };
      });
    const menuSteps = [
      {
        id: "menu",
        title: "Open the menu",
        description: "Use the menu.",
        target: '[data-tour="target"]',
        revealedTarget: '[data-tour="revealed-menu"]',
      },
    ];
    const props = {
      steps: menuSteps,
      stepIndex: 0,
      onStepChange: vi.fn(),
      onClose: vi.fn(),
    };
    const { rerender } = render(
      <>
        <button type="button" data-tour="target">
          Open
        </button>
        <div role="menu" data-tour="revealed-menu">
          Menu
        </div>
        <GuidedWalkthrough isOpen {...props} />
      </>,
    );

    const menu = screen.getByRole("menu");
    await waitFor(() =>
      expect(
        document.querySelector(".guided-walkthrough-highlight"),
      ).toHaveStyle({
        top: "34px",
        left: "34px",
        width: "252px",
        height: "272px",
      }),
    );
    expect(menu.className).toBe("");
    expect(
      document.querySelector(".guided-walkthrough-layer").parentElement,
    ).toBe(document.body);
    expect(screen.getByRole("dialog")).toHaveStyle({ left: "294px" });

    rerender(
      <>
        <button type="button" data-tour="target">
          Open
        </button>
        <div role="menu" data-tour="revealed-menu">
          Menu
        </div>
        <GuidedWalkthrough isOpen={false} {...props} />
      </>,
    );
    expect(screen.getByRole("menu")).not.toHaveClass(
      "guided-walkthrough-elevated-surface",
    );
    rectSpy.mockRestore();
  });
});
