import { beforeEach, expect, it, vi } from "vitest";
import { journalSession, acknowledgeSession, readRecovery, recoverSessions, saveNavigation } from "./sessionRecovery";
beforeEach(() => localStorage.clear());
it("an older acknowledgement cannot discard a newer unsaved edit", () => {
 const first = journalSession("saves", 1, { session: { id: 1, name: "first" } });
 const last = journalSession("saves", 1, { session: { id: 1, name: "last" } });
 acknowledgeSession("saves", 1, first);
 expect(recoverSessions([{ id: 1, name: "remote" }])[0].name).toBe("last");
 acknowledgeSession("saves", 1, last);
 expect(recoverSessions([{ id: 1, name: "remote" }])[0].name).toBe("remote");
});
it("deletion cannot resurrect a pending save and undo supersedes deletion", () => {
 journalSession("saves", 1, { session: { id: 1 } });
 journalSession("deletes", 1, {});
 expect(recoverSessions([{ id: 1 }])).toEqual([]);
 journalSession("saves", 1, { session: { id: 1, name: "restored" } });
 expect(recoverSessions([])[0].name).toBe("restored");
});
it("notes and navigation coexist with pending session saves", () => {
 journalSession("saves", 1, { session: { id: 1, notes: "old" } });
 journalSession("notes", 1, { notes: "new" });
 saveNavigation(1, "point");
 expect(recoverSessions([])[0].notes).toBe("new");
 expect(readRecovery().navigation).toEqual({ sessionId: 1, pointId: "point" });
});

it("point switching writes only navigation without reading or rewriting the recovery journal", () => {
 journalSession("saves", 1, { session: { id: 1, specifications: "x".repeat(100000) } });
 const journalKey = Object.keys(localStorage).find(key => key.startsWith("uncertainty:recovery:"));
 const journal = localStorage.getItem(journalKey);
 const read = vi.spyOn(Storage.prototype, "getItem");
 const write = vi.spyOn(Storage.prototype, "setItem");
 try {
  saveNavigation(1, "next");
  expect(read.mock.calls.some(([key]) => key === journalKey)).toBe(false);
  const navigationWrites = write.mock.calls.filter(([key]) => key.startsWith("uncertainty:navigation:"));
  expect(navigationWrites).toHaveLength(1);
  expect(navigationWrites[0][1].length).toBeLessThan(100);
  expect(write.mock.calls.some(([key]) => key === journalKey)).toBe(false);
  expect(localStorage.getItem(journalKey)).toBe(journal);
  expect(readRecovery().navigation.pointId).toBe("next");
 } finally { read.mockRestore(); write.mockRestore(); }
});

it("retains legacy navigation, tolerates a corrupt navigation key and permits clearing selection", () => {
 journalSession("notes", 1, { notes: "unsaved" });
 const journalKey = Object.keys(localStorage).find(key => key.startsWith("uncertainty:recovery:"));
 localStorage.setItem(journalKey, JSON.stringify({ ...readRecovery(), navigation: { sessionId: 1, pointId: "legacy" } }));
 expect(readRecovery().navigation.pointId).toBe("legacy");
 saveNavigation(2, "current");
 expect(readRecovery().navigation).toEqual({ sessionId: 2, pointId: "current" });
 const navigationKey = Object.keys(localStorage).find(key => key.startsWith("uncertainty:navigation:"));
 localStorage.setItem(navigationKey, "invalid");
 expect(readRecovery().navigation.pointId).toBe("legacy");
 saveNavigation(null, null);
 expect(readRecovery().navigation).toEqual({ sessionId: null, pointId: null });
 expect(readRecovery().notes[1].notes).toBe("unsaved");
});
