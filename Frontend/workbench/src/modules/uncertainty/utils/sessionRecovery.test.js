import { beforeEach, expect, it } from "vitest";
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
