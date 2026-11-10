import { act, renderHook, waitFor } from "@testing-library/react";
import axios from "axios";
import { journalSession, readRecovery } from "../utils/sessionRecovery";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useSessionManager, {
  getSessionChangeGroup,
  prepareImportedSession,
} from "./useSessionManager";
import { linkAcShuntDefinition } from '../utils/acShuntLibrary';

vi.mock("axios", () => ({
  default: {
    delete: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  axios.delete.mockResolvedValue({});
  axios.post.mockResolvedValue({});
  axios.put.mockResolvedValue({});
  axios.patch.mockResolvedValue({});
  axios.get.mockImplementation((url) =>
    Promise.resolve({
      data: url.endsWith("/sessions/")
        ? [
            {
              id: 1,
              name: "Original",
              testPoints: [],
            },
          ]
        : [],
    }),
  );
});

describe("prepareImportedSession", () => {
  it('saves an AC-shunt budget with explicitly reused shared links while keeping the existing budget and library intact', async () => {
    const shared={id:'shared-meter',scope:'validated',model:'REF',description:'Y5020',functions:[]};
    const sharedTi={id:'shared-ti',scope:'validated',type:'uut',manufacturer:'Fluke',model:'Y5020 · TI-10',functions:[]};
    axios.get.mockImplementation(url=>Promise.resolve({data:url.endsWith('/instruments/') ? [shared,sharedTi] : url.endsWith('/sessions/') ? [{id:1,name:'Original',testPoints:[]}] : []}));
    const {result}=renderHook(()=>useSessionManager());
    await waitFor(()=>expect(result.current.instruments).toHaveLength(2));
    const item=linkAcShuntDefinition({id:'reference-instance'},shared);
    const ti=linkAcShuntDefinition({id:'ti-instance'},sharedTi);
    await act(async()=>{await result.current.importSession({name:'New AC/DC budget',uuts:[ti],tmdes:[item],testPoints:[]},new Map(),{requireSaved:true,reuseSharedInstruments:true});});
    expect(result.current.sessions.find(session=>session.id===1)).toMatchObject({name:'Original',testPoints:[]});
    expect(result.current.currentSessionData.tmdes[0]).toMatchObject({libraryInstrumentId:'shared-meter',instrument:{sourceId:'shared-meter',scope:'validated'}});
    const saved=axios.put.mock.calls.find(([,data])=>data.name==='New AC/DC budget')[1];
    expect(saved.tmdes[0].libraryInstrumentId).toBe('shared-meter');
    expect(saved.uuts[0]).toMatchObject({libraryInstrumentId:'shared-ti',instrument:{sourceId:'shared-ti',manufacturer:'Fluke',model:'Y5020 · TI-10'}});
    expect(result.current.instruments).toEqual([shared,sharedTi]);
    expect(axios.post).not.toHaveBeenCalled();
  });
  it('does not claim a local-library save succeeded when the API rejects it', async () => {
    const {result}=renderHook(()=>useSessionManager());
    await waitFor(()=>expect(result.current.currentSessionData?.name).toBe('Original'));
    axios.post.mockRejectedValue(new Error('Offline'));
    const log=vi.spyOn(console,'error').mockImplementation(()=>{});
    try {
      await act(async()=>{await expect(result.current.saveInstrument({id:'draft',scope:'local'},{requireSaved:true})).rejects.toThrow('Offline');});
      expect(result.current.instruments).not.toEqual(expect.arrayContaining([expect.objectContaining({id:'draft'})]));
    } finally { log.mockRestore(); }
  });
  it("keeps the current workspace when a required import save fails", async () => {
    const { result } = renderHook(() => useSessionManager());
    await waitFor(() => expect(result.current.currentSessionData?.name).toBe("Original"));
    axios.put.mockRejectedValue(new Error("Database offline"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await act(async () => {
        await expect(result.current.importSession({name:"AC/DC import",testPoints:[]},new Map(),{requireSaved:true}))
          .rejects.toThrow("could not be saved");
      });
      expect(result.current.currentSessionData.name).toBe("Original");
      expect(result.current.sessions).toHaveLength(1);
    } finally { log.mockRestore(); }
  });
  it("imports without fetching or writing the instrument library", async () => {
    const { result } = renderHook(() => useSessionManager());
    await waitFor(() => expect(result.current.currentSessionData?.name).toBe("Original"));
    axios.get.mockClear(); axios.post.mockClear();
    await act(async () => { await result.current.importSession({ name: "Imported", uuts: [{ id: "uut", instrument: { id: "shared", scope: "validated", functions: [] } }], testPoints: [] }); });
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post.mock.calls.filter(([url]) => url.includes("/instruments/"))).toEqual([]);
    expect(result.current.currentSessionData.uuts[0].instrument.scope).toBe("session");
  });
  it("always creates a separate session without changing nested IDs", () => {
    const loadedSession = {
      id: 100,
      name: "Torque Session",
      measurementAreas: [{ id: "area-1", name: "Torque" }],
      uuts: [{ id: "uut-1", measurementAreaId: "area-1" }],
      testPoints: [
        {
          id: "point-1",
          measurementAreaId: "area-1",
          associatedUutIds: ["uut-1"],
        },
      ],
    };
    const existing = [
      { id: 100, name: "Torque Session" },
      { id: 500, name: "Torque Session (Imported)" },
    ];

    const imported = prepareImportedSession(loadedSession, existing, 500);

    expect(imported.id).toBe(501);
    expect(imported.name).toBe("Torque Session (Imported 2)");
    expect(imported.measurementAreas[0].id).toBe("area-1");
    expect(imported.uuts[0].id).toBe("uut-1");
    expect(imported.testPoints[0].id).toBe("point-1");
    expect(loadedSession).toMatchObject({
      id: 100,
      name: "Torque Session",
    });
  });
});

describe("session undo history", () => {
  it("coalesces typing before cloning while retaining the original undo snapshot", async () => {
    const { result } = renderHook(() => useSessionManager());
    await waitFor(() => expect(result.current.currentSessionData?.name).toBe("Original"));
    const clone = vi.spyOn(globalThis, "structuredClone");
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      for (const name of ["E", "Ed", "Edited"]) {
        act(() => result.current.updateSession({ ...result.current.currentSessionData, name }));
      }
      expect(clone).toHaveBeenCalledTimes(1);
      act(() => expect(result.current.undoLastSessionChange()).toBe(true));
      expect(result.current.currentSessionData.name).toBe("Original");
      act(() => expect(result.current.undoLastSessionChange()).toBe(false));
    } finally { clone.mockRestore(); now.mockRestore(); }
  });

  it("restores the active session's previous snapshot", async () => {
    const { result } = renderHook(() => useSessionManager());

    await waitFor(() => {
      expect(result.current.currentSessionData?.name).toBe("Original");
    });

    act(() => {
      result.current.updateSession({
        ...result.current.currentSessionData,
        name: "Edited",
      });
    });
    expect(result.current.currentSessionData.name).toBe("Edited");

    let didUndo = false;
    act(() => {
      didUndo = result.current.undoLastSessionChange();
    });

    expect(didUndo).toBe(true);
    expect(result.current.currentSessionData.name).toBe("Original");
  });

  it("follows workspace chronology across edits and newly added sessions", async () => {
    const { result } = renderHook(() => useSessionManager());

    await waitFor(() => {
      expect(result.current.currentSessionData?.name).toBe("Original");
    });

    act(() => {
      result.current.updateSession({
        ...result.current.currentSessionData,
        name: "Edited before add",
      });
    });
    act(() => {
      result.current.addSession();
    });
    expect(result.current.sessions).toHaveLength(2);

    act(() => {
      expect(result.current.undoLastSessionChange()).toBe(true);
    });
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.currentSessionData.name).toBe("Edited before add");

    act(() => {
      expect(result.current.undoLastSessionChange()).toBe(true);
    });
    expect(result.current.currentSessionData.name).toBe("Original");
  });

  it("restores a deleted session and its previous selection", async () => {
    const { result } = renderHook(() => useSessionManager());

    await waitFor(() => {
      expect(result.current.currentSessionData?.id).toBe(1);
    });

    act(() => {
      result.current.deleteSession(1);
    });
    expect(result.current.sessions).toHaveLength(0);

    act(() => {
      expect(result.current.undoLastSessionChange()).toBe(true);
    });
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.currentSessionData).toMatchObject({
      id: 1,
      name: "Original",
    });
  });

  it("restores the stored note image after the pending session deletion finishes", async () => {
    const session = { id: 1, testPoints: [], noteImages: [{ id: 9, fileName: "chart.png" }] };
    axios.get.mockImplementation(async (url) => ({
      data: url.endsWith("/sessions/") ? [session] : url.endsWith("/images/") ? [{ id: 9, data: "chart-data" }] : [],
    }));
    let finishDelete;
    axios.delete.mockImplementationOnce(() => new Promise((resolve) => { finishDelete = resolve; }));
    const { result } = renderHook(() => useSessionManager());
    await waitFor(() => expect(result.current.currentSessionData?.id).toBe(1));
    await act(async () => { await result.current.deleteSession(1); });
    act(() => { expect(result.current.undoLastSessionChange()).toBe(true); });
    expect(axios.post).not.toHaveBeenCalled();
    await act(async () => { finishDelete({}); });
    await waitFor(() => expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/sessions\/1\/images\/$/), {
      imageId: 9, fileName: "chart.png", dataBase64: "chart-data",
    }));
  });

  it("reuploads legacy note images when an import is undone and redone", async () => {
    const { result } = renderHook(() => useSessionManager());
    await waitFor(() => expect(result.current.currentSessionData?.id).toBe(1));
    let id;
    await act(async () => {
      const imported = await result.current.importSession(
        { testPoints: [], noteImages: [{ id: 9, fileName: "chart.png" }] },
        new Map([["9", "imported-chart"]]),
      );
      id = imported.id;
    });
    axios.post.mockClear();
    act(() => {
      expect(result.current.undoLastSessionChange()).toBe(true);
      expect(result.current.redoLastSessionChange()).toBe(true);
    });
    await waitFor(() => expect(axios.post).toHaveBeenCalledWith(expect.stringContaining(`/sessions/${id}/images/`), {
      imageId: 9, fileName: "chart.png", dataBase64: "imported-chart",
    }));
    expect(result.current.currentSessionData?.id).toBe(id);
  });

  it("keeps rapid discrete workspace actions as separate undo steps", async () => {
    const { result } = renderHook(() => useSessionManager());

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1);
    });
    act(() => {
      result.current.addSession();
      result.current.addSession();
    });
    expect(result.current.sessions).toHaveLength(3);

    act(() => {
      expect(result.current.undoLastSessionChange()).toBe(true);
    });
    expect(result.current.sessions).toHaveLength(2);
    act(() => {
      expect(result.current.undoLastSessionChange()).toBe(true);
    });
    expect(result.current.sessions).toHaveLength(1);
  });
});

describe("session change detection", () => {
  it("does not serialize unchanged point snapshots when one of many points changes", () => {
    const points = Array.from({ length: 2000 }, (_, id) => ({ id, section: "4.1", snapshot: "x".repeat(1000) }));
    const updated = points.slice();
    updated[1000] = { ...points[1000], section: "4.2" };
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      expect(getSessionChangeGroup({ testPoints: points }, { testPoints: updated })).toBe("session:testPoints");
      expect(stringify).toHaveBeenCalledTimes(2);
      expect(stringify.mock.calls.every(([value]) => value.length === 1 && value[0].id === 1000)).toBe(true);
    } finally { stringify.mockRestore(); }
  });

  it("keeps serialized equality for replacement rows, null array entries and missing fields", () => {
    expect(getSessionChangeGroup({ testPoints: [{ id: 1, empty: undefined }, null, NaN] }, { testPoints: [{ id: 1 }, undefined, null] })).toBeNull();
    expect(getSessionChangeGroup({ testPoints: [{ id: 1 }] }, { testPoints: [{ id: 1 }, { id: 2 }] })).toBe("session:testPoints");
    expect(getSessionChangeGroup({ testPoints: [{ id: 1, units: "V" }] }, { testPoints: [{ id: 1, units: "A" }] })).toBe("session:testPoints");
  });
});

describe("saveTestPoint derived equation state", () => {
  it("preserves variableNominals when updating an existing point without that field", async () => {
    axios.get.mockImplementation((url) =>
      Promise.resolve({
        data: url.endsWith("/sessions/")
          ? [
              {
                id: 1,
                name: "Original",
                testPoints: [
                  {
                    id: "point-1",
                    section: "4.1",
                    measurementType: "derived",
                    equationString: "t = a + b",
                    equationName: "Temperature Ratio",
                    variableMappings: { a: "A", b: "B" },
                    variableNominals: {
                      a: { value: "10", unit: "degF" },
                      b: { value: "20", unit: "degF" },
                    },
                    testPointInfo: {
                      parameter: { name: "Temperature", value: "30", unit: "degF" },
                    },
                    tmdeTolerances: [],
                  },
                ],
              },
            ]
          : [],
      }),
    );

    const { result } = renderHook(() => useSessionManager());

    await waitFor(() => {
      expect(result.current.currentSessionData?.testPoints).toHaveLength(1);
    });

    act(() => {
      result.current.saveTestPoint({
        id: "point-1",
        section: "4.1 updated",
        measurementType: "derived",
        equationString: "t = a + b",
        variableMappings: { a: "A", b: "B" },
        testPointInfo: {
          parameter: { name: "Temperature", value: "30", unit: "degF" },
        },
      });
    });

    expect(
      result.current.currentSessionData.testPoints[0].variableNominals,
    ).toEqual({
      a: { value: "10", unit: "degF" },
      b: { value: "20", unit: "degF" },
    });
    expect(result.current.currentSessionData.testPoints[0].equationName).toBe(
      "Temperature Ratio",
    );
  });
});

describe("instrument sync reconciliation", () => {
  it("replaces a linked local instrument with the synced shared instrument", async () => {
    const shared = {
      id: "shared-1",
      manufacturer: "Acme",
      model: "DMM",
      description: "Shared DMM",
      scope: "validated",
      functions: [],
    };
    const local = {
      ...shared,
      id: "local-1",
      description: "Local edited DMM",
      scope: "local",
      owner: "bench-1",
      sourceId: shared.id,
      validatedSnapshot: {
        manufacturer: "Acme",
        model: "DMM",
        description: "Shared DMM",
        functions: [],
      },
    };
    const synced = {
      ...local,
      id: shared.id,
      scope: "validated",
      sourceId: shared.id,
    };

    axios.get.mockImplementation((url) =>
      Promise.resolve({
        data: url.includes("/instruments/")
          ? [shared, local]
          : url.endsWith("/sessions/")
            ? [{ id: 1, name: "Original", testPoints: [] }]
            : [],
      }),
    );

    const { result } = renderHook(() => useSessionManager());

    await waitFor(() => {
      expect(result.current.instruments).toHaveLength(2);
    });

    act(() => {
      result.current.reconcileSyncedInstrument(synced);
    });

    expect(result.current.instruments).toEqual([synced]);
  });
});

it("updates a submitted session instrument when its SME-approved definition is loaded", async () => {
  const pending = {id:"private", sourceId:"shared", scope:"pending", model:"DMM", functions:[], localOverride:true};
  const legacyUut = {id:"uut", instrument:{id:"existing", scope:"shared", model:"Reference"}};
  const session = {id:1, name:"Approval", uuts:[legacyUut], tmdes:[{id:"row", quantity:2, instrument:pending}], testPoints:[]};
  let library = [pending];
  axios.get.mockImplementation(async url => ({data:url.endsWith("/instruments/") ? library : url.endsWith("/sessions/") ? [session] : []}));
  const { result } = renderHook(() => useSessionManager());
  await waitFor(() => expect(result.current.sessionsLoaded && result.current.instruments.length).toBe(1));
  expect(result.current.sessions[0].uuts[0].instrument).toMatchObject({id:"existing", scope:"validated", model:"Reference"});
  const approved = {...pending, id:"shared", scope:"validated", localOverride:false};
  library = [approved];
  await act(async () => result.current.refreshInstrumentLibrary());
  expect(result.current.instruments).toEqual([approved]);
  expect(result.current.sessions[0].tmdes[0]).toMatchObject({id:"row", quantity:2,
    libraryInstrumentId:"shared", instrument:{id:"shared",scope:"validated",model:"DMM"}});
});

describe("local instrument persistence", () => {
  it.each([true, false])('checks a saved shared link against a complete library read (offline=%s)', async offline => {
    const row = {id:'row', instrument:{id:'instance', scope:'validated', sourceId:'public-id', model:'Saved specs'}};
    const session = {id:1, uuts:[row], testPoints:[]};
    axios.get.mockImplementation(async url => {
      if (offline && url.endsWith('/instruments/')) throw new Error('Offline');
      return {data:url.endsWith('/sessions/') ? [session] : []};
    });
    const {result} = renderHook(() => useSessionManager());
    await waitFor(() => expect(result.current.sessionsLoaded).toBe(true));
    expect(result.current.sessions[0].uuts[0].instrument).toMatchObject({scope:offline ? 'validated' : 'session', model:'Saved specs'});
  });
  it.each(['refresh', 'removal', 'reload'])('updates the creator’s shared icon to Local after %s without changing embedded specifications', async operation => {
    const shared = {id:'meter', scope:'validated', sourceId:'meter', model:'Published'};
    const local = {id:'restored', formerPublicationId:'meter', scope:'local', model:'Published', localOverride:true};
    const session = {id:1, tmdes:[{id:'row', quantity:3, libraryInstrumentId:'meter', instrument:{...shared, model:'Session specifications'}}], testPoints:[]};
    let records = operation === 'reload' ? [local] : [shared];
    axios.get.mockImplementation(async url => ({data:url.endsWith('/sessions/') ? [session] : url.endsWith('/instruments/') ? records : []}));
    const {result} = renderHook(() => useSessionManager());
    await waitFor(() => expect(result.current.sessionsLoaded && result.current.instruments.length).toBe(1));
    if (operation === 'refresh') {
      axios.get.mockRejectedValueOnce(new Error('Offline'));
      await act(async () => result.current.refreshInstrumentLibrary());
      expect(result.current.sessions[0].tmdes[0].instrument.scope).toBe('validated');
      records = [local];
      await act(async () => result.current.refreshInstrumentLibrary());
    } else if (operation === 'removal') {
      axios.delete.mockResolvedValueOnce({data:local});
      await act(async () => result.current.deleteInstrument('meter', {password:'calibrate'}));
    }
    expect(result.current.instruments).toEqual([local]);
    expect(result.current.sessions[0].tmdes[0]).toMatchObject({quantity:3, libraryInstrumentId:'restored',
      instrument:{id:'restored', scope:'local', model:'Session specifications', localOverride:true, sourceId:'', validatedSnapshot:null}});
  });
  it("updates a local instrument when its specifications change", async () => {
    const savedLocal = {
      id: "local-dmm-1",
      owner: "bench-1",
      scope: "local",
      manufacturer: "Acme",
      model: "DMM-1",
      description: "Bench meter",
      functions: [{ name: "Voltage", ranges: [] }],
    };
    axios.get.mockImplementation((url) =>
      Promise.resolve({
        data: url.endsWith("/instruments/")
          ? [savedLocal]
          : url.endsWith("/sessions/")
            ? [{ id: 1, name: "Original", testPoints: [] }]
            : [],
      }),
    );

    const { result } = renderHook(() => useSessionManager());
    await waitFor(() => {
      expect(result.current.instruments).toEqual([savedLocal]);
    });

    const editedDefinition = {
      ...savedLocal,
      id: savedLocal.id,
      functions: [
        {
          name: "Voltage",
          ranges: [{ min: "0", max: "10", unit: "V", tolerance: { iv: 1 } }],
        },
      ],
    };
    axios.post.mockResolvedValue({});

    await act(async () => {
      await result.current.saveInstrument(editedDefinition);
    });

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/instruments/"),
      expect.objectContaining({ id: savedLocal.id }), expect.objectContaining({headers: expect.any(Object)}),
    );
    expect(result.current.instruments).toHaveLength(1);
    expect(result.current.instruments[0]).toMatchObject({
      id: savedLocal.id,
      functions: editedDefinition.functions,
    });
  });
});

 it("inserts new points after the requested row and never persists insertion metadata", async () => {
   axios.get.mockImplementation(url => Promise.resolve({ data: url.endsWith("/sessions/") ? [{ id: 1, name: "Insertion", testPoints: [
     { id: "first", testPointInfo: { parameter: { value: 1, unit: "V" } } },
     { id: "last", testPointInfo: { parameter: { value: 2, unit: "V" } } },
   ] }] : [] }));
   const { result } = renderHook(() => useSessionManager());
   await waitFor(() => expect(result.current.currentSessionData?.testPoints).toHaveLength(2));
   let added;
   act(() => { added = result.current.saveTestPoint({ _insertAfterPointId: "first", testPointInfo: { parameter: { value: "", unit: "V" } } }); });
   expect(result.current.currentSessionData.testPoints.map(p => p.id)).toEqual(["first", added, "last"]);
   expect(result.current.currentSessionData.testPoints[1]).not.toHaveProperty("_insertAfterPointId");
   act(() => { result.current.saveTestPoint({ _insertAfterPointId: added, testPointInfo: { parameter: { value: "", unit: "V" } } }); });
   expect(result.current.currentSessionData.testPoints[3].id).toBe("last");
 });

it("preserves clipboard order when inserting a batch below one row", async () => {
  axios.get.mockImplementation(url => Promise.resolve({ data: url.endsWith("/sessions/") ? [{ id: 1, name: "Batch", testPoints: [
    { id: "first", testPointInfo: { parameter: { value: 1, unit: "V" } } },
    { id: "last", testPointInfo: { parameter: { value: 9, unit: "V" } } },
  ] }] : [] }));
  const { result } = renderHook(() => useSessionManager());
  await waitFor(() => expect(result.current.currentSessionData?.testPoints).toHaveLength(2));
  act(() => result.current.saveTestPoint([2, 3, 4].map(value => ({
    _insertAfterPointId: "first", testPointInfo: { parameter: { value, unit: "V" } },
  }))));
  const points = result.current.currentSessionData.testPoints;
  expect(points.map(point => point.testPointInfo.parameter.value)).toEqual([1, 2, 3, 4, 9]);
  expect(new Set(points.map(point => point.id)).size).toBe(5);
  expect(points.every(point => !("_insertAfterPointId" in point))).toBe(true);
});


it("recovers an edit even if unmounted before the debounce fires", async () => {
  const first = renderHook(() => useSessionManager());
  await waitFor(() => expect(first.result.current.currentSessionData?.name).toBe("Original"));
  act(() => first.result.current.updateSession({ ...first.result.current.currentSessionData, name: "Recovered immediately", testPoints: [{ id: "p", components: [{ id: "authored", name: "Source" }] }] }));
  act(() => first.result.current.setSelectedTestPointId("p"));
  first.unmount();
  const second = renderHook(() => useSessionManager());
  await waitFor(() => expect(second.result.current.currentSessionData?.name).toBe("Recovered immediately"));
  expect(second.result.current.selectedTestPointId).toBe("p");
  expect(second.result.current.currentSessionData.testPoints[0].components[0].name).toBe("Source");
  await waitFor(() => expect(axios.put).toHaveBeenCalledWith(expect.stringMatching(/sessions\/1\/$/), expect.objectContaining({ name: "Recovered immediately" })));
});

it("replays recovered notes after a numeric-ID session save completes", async () => {
  journalSession("saves", 1, { session: { id: 1, name: "Recovered", notes: "Older", testPoints: [] } });
  journalSession("notes", "1", { notes: "Latest paragraph" });
  let finishSave;
  axios.put.mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }));
  const view = renderHook(() => useSessionManager());
  await waitFor(() => expect(axios.put).toHaveBeenCalled());
  expect(view.result.current.currentSessionData.notes).toBe("Latest paragraph");
  expect(axios.patch).not.toHaveBeenCalled();
  await act(async () => finishSave({}));
  await waitFor(() => expect(axios.patch).toHaveBeenCalledWith(expect.stringMatching(/sessions\/1\/notes\/$/), { notes: "Latest paragraph" }));
  await waitFor(() => expect(readRecovery().notes).toEqual({}));
});


it("persists independent local copies with the same name and shared lineage by id", async () => {
  const first = { id: "local-one", scope: "local", sourceId: "shared", description: "Meter", manufacturer: "Acme", model: "DMM", functions: [] };
  axios.get.mockImplementation(url => Promise.resolve({ data: url.includes("/instruments/") ? [first] : [] }));
  axios.post.mockImplementation((url, payload) => Promise.resolve({ data: payload }));
  const { result } = renderHook(() => useSessionManager());
  await waitFor(() => expect(result.current.instruments).toHaveLength(1));
  const second = { ...first, id: "local-two", functions: [{ name: "Voltage", ranges: [{ min: 0, max: 20 }] }] };
  await act(async () => { await result.current.saveInstrument(second); });
  expect(result.current.instruments).toEqual([expect.objectContaining(first), expect.objectContaining(second)]);
  await act(async () => { await result.current.saveInstrument({ ...second, functions: [] }); });
  expect(result.current.instruments).toHaveLength(2);
  expect(result.current.instruments[0]).toEqual(first);
});

it("allocates unique point IDs when generated IDs collide with saved points and the same batch", async () => {
  axios.get.mockImplementation(url => Promise.resolve({ data: url.endsWith("/sessions/") ? [{ id: 1, name: "Collisions", testPoints: [
    { id: "1002", testPointInfo: { parameter: { value: 1, unit: "V" } } },
  ] }] : [] }));
  const { result } = renderHook(() => useSessionManager());
  await waitFor(() => expect(result.current.currentSessionData?.testPoints).toHaveLength(1));
  const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  const random = vi.spyOn(Math, "random").mockReturnValueOnce(.0002).mockReturnValueOnce(.0001).mockReturnValueOnce(0);
  try {
    act(() => result.current.saveTestPoint([2, 3, 4].map(value => ({
      _insertAfterPointId: "1002", testPointInfo: { parameter: { value, unit: "V" } },
    }))));
    const points = result.current.currentSessionData.testPoints;
    expect(points.map(point => point.id)).toEqual(["1002", 1003, 1004, 1005]);
    expect(points.map(point => point.testPointInfo.parameter.value)).toEqual([1, 2, 3, 4]);
  } finally {
    now.mockRestore();
    random.mockRestore();
  }
});


it('undoes qualifier enable and additions individually without undoing earlier range edits', async () => {
  const {result} = renderHook(() => useSessionManager());
  await waitFor(() => expect(result.current.currentSessionData?.id).toBe(1));
  const update = ranges => act(() => result.current.updateSession({...result.current.currentSessionData,uuts:[{id:'uut',instrument:{functions:[{id:'fn',unit:'A',ranges}]}}]}));
  const base={id:'range',min:0,max:10,unit:'A'};
  update([base]);
  update([{...base,max:20}]);
  update([{...base,max:20,qualifier:{min:'',max:'',unit:'Hz'}}]);
  update([{...base,max:20,qualifier:{min:'',max:'',unit:'Hz'}},{...base,id:'second',qualifier:{min:'',max:'',unit:'Hz'}}]);
  act(() => expect(result.current.undoLastSessionChange()).toBe(true));
  expect(result.current.currentSessionData.uuts[0].instrument.functions[0].ranges).toHaveLength(1);
  act(() => expect(result.current.undoLastSessionChange()).toBe(true));
  expect(result.current.currentSessionData.uuts[0].instrument.functions[0].ranges[0]).toMatchObject({max:20});
  expect(result.current.currentSessionData.uuts[0].instrument.functions[0].ranges[0].qualifier).toBeUndefined();
});

it('keeps background recalculation out of undo history but retains propagation-mode edits', async () => {
  const {result}=renderHook(()=>useSessionManager());
  await waitFor(()=>expect(result.current.currentSessionData?.id).toBe(1));
  act(()=>result.current.updateSession({...result.current.currentSessionData,testPoints:[{id:'p',testPointInfo:{parameter:{value:1,unit:'V'}}}]}));
  act(()=>result.current.setSelectedTestPointId('p'));
  act(()=>result.current.updateTestPointData({section:'Authored'}));
  act(()=>result.current.updateTestPointData({calculatedBudgetComponents:[],combined_uncertainty:1,budgetPropagationMethod:'linear'}));
  act(()=>result.current.updateTestPointData({uutTolerance:{min:0,max:10}}, {recordUndo:false}));
  act(()=>expect(result.current.undoLastSessionChange()).toBe(true));
  expect(result.current.currentSessionData.testPoints[0].section).toBeUndefined();
  act(()=>result.current.updateTestPointData({uutTolerance:{min:0,max:20}}));
  act(()=>expect(result.current.undoLastSessionChange()).toBe(true));
  expect(result.current.currentSessionData.testPoints[0].uutTolerance).toBeUndefined();
  act(()=>result.current.updateTestPointData({budgetPropagationMethod:'montecarlo'}));
  act(()=>expect(result.current.undoLastSessionChange()).toBe(true));
  expect(result.current.currentSessionData.testPoints[0].budgetPropagationMethod).not.toBe('montecarlo');
});

it('clears a pending library edit when the instrument is deleted so reopening cannot restore it',async()=>{
 const {result}=renderHook(()=>useSessionManager());
 await waitFor(()=>expect(result.current.currentSessionData?.name).toBe('Original'));
 journalSession('libraryEdits','removed',{instrument:{id:'removed',scope:'local',qualifierColumnNames:['Frequency']}});
 await act(async()=>{await result.current.deleteInstrument('removed');});
 expect(readRecovery().libraryEdits.removed).toBeUndefined();
});

it('sends a shared deletion password only in the request body and retains the instrument on rejection', async () => {
  const instrument = { id: 'shared-delete', scope: 'validated', description: 'Shared meter', functions: [] };
  axios.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/instruments/') ? [instrument] : [] }));
  const { result } = renderHook(() => useSessionManager());
  await waitFor(() => expect(result.current.instruments).toHaveLength(1));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    axios.delete.mockRejectedValueOnce(new Error('Invalid shared-library password.'));
    await act(async () => { await expect(result.current.deleteInstrument(instrument.id, { password: 'wrong' })).rejects.toThrow('Invalid shared-library password.'); });
    expect(result.current.instruments).toEqual([instrument]);
    expect(axios.delete).toHaveBeenLastCalledWith(expect.stringMatching(/instruments\/shared-delete\/$/), expect.objectContaining({
      params: { owner: expect.any(String) }, data: { password: 'wrong' },
    }));
    await act(async () => { await result.current.deleteInstrument(instrument.id, { password: 'calibrate' }); });
    expect(result.current.instruments).toEqual([]);
    expect(axios.delete).toHaveBeenLastCalledWith(expect.stringMatching(/instruments\/shared-delete\/$/), expect.objectContaining({
      params: { owner: expect.any(String) }, data: { password: 'calibrate' },
    }));
    expect(JSON.stringify(readRecovery())).not.toContain('password');
  } finally { log.mockRestore(); }
});

it("replays session, workspace and library changes in order and clears redo after a new edit", async () => {
  const { result } = renderHook(() => useSessionManager());
  await waitFor(() => expect(result.current.currentSessionData?.name).toBe("Original"));
  act(() => result.current.addSession());
  const added = result.current.currentSessionData;
  act(() => result.current.updateSession({ ...added, name: "Bench" }));
  await act(async () => result.current.saveInstrument({ id: "meter", scope: "local" }, { requireSaved: true }));
  await act(async () => result.current.saveCustomEquation({ id: "law", name: "Gain" }));
  await act(async () => result.current.saveBugReport({ id: "issue", title: "Display" }));
  for (let step = 0; step < 5; step++) act(() => expect(result.current.undoLastSessionChange()).toBe(true));
  expect(result.current.sessions).toHaveLength(1);
  expect(result.current.instruments).toHaveLength(0);
  expect(result.current.customEquations).toHaveLength(0);
  expect(result.current.bugReports).toHaveLength(0);
  for (let step = 0; step < 5; step++) act(() => expect(result.current.redoLastSessionChange()).toBe(true));
  expect(result.current.currentSessionData).toMatchObject({ id: added.id, name: "Bench" });
  expect(result.current.instruments[0].id).toBe("meter");
  expect(result.current.customEquations[0].id).toBe("law");
  expect(result.current.bugReports[0].id).toBe("issue");
  act(() => result.current.undoLastSessionChange());
  act(() => result.current.updateSession({ ...result.current.currentSessionData, name: "Changed" }));
  expect(result.current.redoLastSessionChange()).toBe(false);
  await waitFor(() => expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining("/bug_reports/issue/")));
});

it("undos a library Type B edit and its linked session change together", async () => {
  const meter = {id:'meter', scope:'local', typeBComponents:[{id:'before'}]};
  const session = {id:1, name:'Bench', uuts:[], tmdes:[{id:'instance', instrument:{
    ...meter, typeBComponents:[{id:'instance-before'}]
  }}], testPoints:[]};
  axios.get.mockImplementation(async url => ({data: url.endsWith('/sessions/') ? [session] : url.endsWith('/instruments/') ? [meter] : []}));
  const {result} = renderHook(() => useSessionManager());
  await waitFor(() => expect(result.current.instruments).toHaveLength(1));
  let finish;
  axios.post.mockImplementationOnce((_url, data) => new Promise(resolve => { finish = () => resolve({data}); }));
  let writing;
  act(() => { writing = result.current.saveInstrument({...meter, typeBComponents:[{id:'after'}]}, {requireSaved:true, syncSessionId:1}); });
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  act(() => result.current.updateSession({...result.current.currentSessionData, name:'Renamed while saving'}));
  await act(async () => { finish(); await writing; });
  const linked = () => result.current.currentSessionData.tmdes[0].instrument.typeBComponents;
  expect(linked()).toEqual([{id:'after'}]);
  act(() => result.current.undoLastSessionChange());
  expect(linked()).toEqual([{id:'instance-before'}]);
  expect(result.current.instruments[0].typeBComponents).toEqual([{id:'before'}]);
  expect(result.current.currentSessionData.name).toBe('Renamed while saving');
  act(() => result.current.redoLastSessionChange());
  expect(linked()).toEqual([{id:'after'}]);
  expect(result.current.instruments[0].typeBComponents).toEqual([{id:'after'}]);
});
