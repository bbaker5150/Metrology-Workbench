import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi, beforeEach } from "vitest";
import axios from "axios";
import Calibration from "./Calibration";
import { selectSettingsSection } from "../../utils/calibrationSettingsScope";
import { PRESET_KEY } from "./SettingsPresets";
vi.mock("axios", () => ({ default: { get: vi.fn(async () => ({ data: {} })), patch: vi.fn(async () => ({data:{}})), post: vi.fn(async (_url, payload) => ({data:{settings:payload.settings}})) } }));
vi.mock("../../contexts/InstrumentContext", () => ({ useInstruments: () => ({
  selectedSessionId: 1, stdReaderModel: "5790A", tiReaderModel: "8508A",
  liveReadings: [], tiLiveReadings: [], initialLiveReadings: [], discoveredInstruments: [],
  collectionProgress: {}, activeCollectionDetails: {}, stabilizationStatus: "", slidingWindowStatus: {},
  timerState: {}, setFailedTPKeys: vi.fn(),
}) }));
vi.mock("../../../../shared/ThemeContext", () => ({ useTheme: () => ({ theme: "light" }) }));
it("keeps section actions inside their sections with matching reader save icons", () => {
  const point = { key: "p", current: 1, frequency: 1000, forward: { id: 1, settings: {}, results: {} }, reverse: { id: 2, settings: {}, results: {} } };
  render(<Calibration orderedTestPoints={[point]} sharedFocusedTestPoint={point} sharedSelectedTPs={new Set()} activeDirection="Forward" showNotification={vi.fn()} onDataUpdate={vi.fn()} setSharedFocusedTestPoint={vi.fn()} />);
  const general = screen.getByText("General", { exact: true }).closest(".settings-form-group");
  const save = screen.getByRole("button", { name: "Save General settings for this point" });
  const apply = screen.getByRole("button", { name: "Apply General settings to all test points" });
  expect(general).toContainElement(save);
  expect(general).toContainElement(apply);
  expect(general).toContainElement(screen.getByRole("button", { name: "Reset General settings" }));
  for (const reader of ["5790", "8508A"]) {
    expect(screen.getByRole("button", { name: `Save ${reader} settings for this test point` }).querySelector("svg").innerHTML).toBe(save.querySelector("svg").innerHTML);
    expect(screen.getByRole("button", { name: `Apply ${reader} settings to all measurement points` }).querySelector("svg").innerHTML).toBe(apply.querySelector("svg").innerHTML);
  }
});


beforeEach(() => { localStorage.clear(); axios.patch.mockClear(); axios.post.mockClear(); });
const renderSettings = () => {
  const point = { key: "p", current: 1, frequency: 1000, forward: { id: 1, settings: { n_cycles: 7, num_samples: 50, stability_window: 10, f5790_filter_mode: "SLOW" }, results: {} }, reverse: { id: 2, settings: {}, results: {} } };
  return render(<Calibration orderedTestPoints={[point]} sharedFocusedTestPoint={point} sharedSelectedTPs={new Set()} activeDirection="Forward" showNotification={vi.fn()} onDataUpdate={vi.fn()} setSharedFocusedTestPoint={vi.fn()} />);
};
it.each(["General", "Stability"])("saves only %s fields, preserving other section drafts", async section => {
  renderSettings();
  fireEvent.change(screen.getByLabelText("Paired cycles (N)"), {target:{value:"9"}});
  fireEvent.change(screen.getByLabelText("# of samples"), {target:{value:"60"}});
  const save = screen.getByRole("button", {name:`Save ${section} settings for this point`});
  expect(screen.getByText(section,{exact:true}).closest('.settings-form-group')).toContainElement(save);
  fireEvent.click(save);
  await waitFor(()=>expect(axios.post).toHaveBeenCalled());
  const payload=axios.post.mock.calls[0][1].settings;
  if(section==="General") {
    expect(payload).toEqual({n_cycles:9});
    await waitFor(()=>expect(axios.post).toHaveBeenCalledTimes(1));
  } else {
    expect(payload).toMatchObject({num_samples:60});
    expect(payload).not.toHaveProperty('n_cycles');
    expect(payload).not.toHaveProperty('f5790_filter_mode');
    expect(axios.post).toHaveBeenCalledTimes(1);
  }
  expect(screen.getByLabelText("Paired cycles (N)")).toHaveValue(9);
  expect(screen.getByLabelText("# of samples")).toHaveValue(60);
});
it.each(["General", "Stability"])("applies only %s settings to all points", async section => {
  renderSettings();
  fireEvent.click(screen.getByRole('button',{name:`Apply ${section} settings to all test points`}));
  fireEvent.click(screen.getByRole('button',{name:'Ready'}));
  await waitFor(()=>expect(axios.post).toHaveBeenCalled());
  const payload=axios.post.mock.calls[0][1].settings;
  if(section==='General') expect(payload).toEqual({n_cycles:7});
  else {expect(payload.num_samples).toBe(50);expect(payload).not.toHaveProperty('n_cycles');expect(payload).not.toHaveProperty('f5790_filter_mode');}
});
it.each(["General", "Stability", "8508A", "5790"])("resets only %s settings", async section => {
  renderSettings();
  fireEvent.click(screen.getByRole('button',{name:`Reset ${section} settings`}));
  fireEvent.click(screen.getByRole('button',{name:'Ready'}));
  await waitFor(()=>expect(axios.post).toHaveBeenCalled());
  const payload=axios.post.mock.calls[0][1].settings;
  if(section==='General') expect(Object.keys(payload)).toEqual(['n_cycles']);
  else {
    expect(payload).not.toHaveProperty('n_cycles');
    if(section==='Stability') {expect(payload).toHaveProperty('num_samples');expect(payload).not.toHaveProperty('f5790_filter_mode');}
    else {expect(payload).not.toHaveProperty('num_samples');expect(payload).toHaveProperty(section==='5790'?'f5790_filter_mode':'f8508_dc_resolution');}
  }
});

it("isolates characterization fields from General and Stability", () => {
  const settings = { n_cycles: 3, num_samples: 35, characterization_source: "AC", characterize_std_first: true, characterize_test_first: false, f5790_filter_mode: "SLOW" };
  expect(selectSettingsSection(settings, "characterization")).toEqual({ characterization_source: "AC", characterize_std_first: true, characterize_test_first: false });
});

it("reset uses the user's configured default setup", async () => {
  localStorage.setItem(PRESET_KEY, JSON.stringify({ defaultId: "default", presets: [{ id: "default", settings: { n_cycles: 11 } }] }));
  renderSettings();
  fireEvent.click(screen.getByRole('button', { name: 'Reset General settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ready' }));
  await waitFor(() => expect(axios.post).toHaveBeenCalled());
  expect(axios.post.mock.calls[0][1]).toMatchObject({ category: 'general', scope: 'point', settings: { n_cycles: 11 } });
});

it("refresh preserves an unsaved category and changing points loads its own cycle count", () => {
  const point = { key: "p", current: 1, frequency: 1000, forward: { id: 1, settings: { n_cycles: 7, num_samples: 50 } } };
  const other = { key: "q", current: 2, frequency: 1000, forward: { id: 3, settings: { n_cycles: 12, num_samples: 40 } } };
  const props = { sharedSelectedTPs: new Set(), activeDirection: "Forward", showNotification: vi.fn(), onDataUpdate: vi.fn(), setSharedFocusedTestPoint: vi.fn() };
  const view = render(<Calibration {...props} orderedTestPoints={[point, other]} sharedFocusedTestPoint={point} />);
  fireEvent.change(screen.getByLabelText('# of samples'), {target:{value:'60'}});
  view.rerender(<Calibration {...props} orderedTestPoints={[{...point}, other]} sharedFocusedTestPoint={{...point}} />);
  expect(screen.getByLabelText('# of samples')).toHaveValue(60);
  view.rerender(<Calibration {...props} orderedTestPoints={[point, other]} sharedFocusedTestPoint={other} />);
  expect(screen.getByLabelText('Paired cycles (N)')).toHaveValue(12);
  expect(screen.getByLabelText('# of samples')).toHaveValue(40);
});

it("failed save preserves drafts and makes no success claim", async () => {
  axios.post.mockRejectedValueOnce(new Error('Disconnected'));
  renderSettings();
  fireEvent.change(screen.getByLabelText('# of samples'), {target:{value:'60'}});
  fireEvent.click(screen.getByRole('button', {name:'Save Stability settings for this point'}));
  await waitFor(() => expect(screen.getByRole('button', {name:'Save Stability settings for this point'})).not.toBeDisabled());
  expect(screen.getByLabelText('# of samples')).toHaveValue(60);
});

it("Apply Stability excludes warm-up and identifies the active direction", async () => {
  renderSettings();
  fireEvent.change(screen.getByLabelText('Initial warm-up wait (sec)'), {target:{value:'900'}});
  fireEvent.click(screen.getByRole('button', {name:'Apply Stability settings to all test points'}));
  expect(screen.getByText(/Initial warm-up is excluded/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name:'Ready'}));
  await waitFor(() => expect(axios.post).toHaveBeenCalled());
  expect(axios.post.mock.calls[0][1]).toMatchObject({ scope:'all', direction:'Forward' });
  expect(axios.post.mock.calls[0][1].settings).not.toHaveProperty('initial_warm_up_time');
  expect(screen.getByLabelText('Initial warm-up wait (sec)')).toHaveValue(900);
});
it("later points disable warm-up and Reverse loads its own saved cycles", () => {
  const first = { key:'first', current:1, frequency:1000, forward:{id:1,settings:{n_cycles:7}} };
  const next = { key:'next', current:2, frequency:1000, forward:{id:2,settings:{n_cycles:7}}, reverse:{id:3,settings:{n_cycles:11, initial_warm_up_time:900}} };
  render(<Calibration orderedTestPoints={[first,next]} sharedFocusedTestPoint={next} sharedSelectedTPs={new Set()} activeDirection="Reverse" showNotification={vi.fn()} onDataUpdate={vi.fn()} setSharedFocusedTestPoint={vi.fn()} />);
  expect(screen.getByLabelText('Initial warm-up wait (sec)')).toBeDisabled();
  expect(screen.getByLabelText('Initial warm-up wait (sec)')).toHaveValue(0);
  expect(screen.getByLabelText('Paired cycles (N)')).toHaveValue(11);
});
