import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import SessionNotesWorkspace, {
  applyStoredImageLayouts,
  normalizeNoteHtml,
  sanitizeNoteHtml,
  serializeNoteDocument,
} from "./SessionNotesWorkspace";

beforeAll(() => {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  }
});

describe("SessionNotesWorkspace document safety", () => {
  it("preserves legacy plain-text notes as readable rich text", () => {
    expect(normalizeNoteHtml("Part ABC-123\nVerify at 10 V")).toBe(
      "Part ABC-123<br>Verify at 10 V",
    );
  });

  it("removes executable markup while retaining supported formatting", () => {
    const cleaned = sanitizeNoteHtml(
      '<h2 onclick="alert(1)">Limits</h2><script>alert(1)</script>' +
        '<a href="javascript:alert(1)">bad</a><strong>safe</strong>',
    );
    expect(cleaned).toContain("<h2>Limits</h2>");
    expect(cleaned).toContain("<strong>safe</strong>");
    expect(cleaned).not.toContain("script");
    expect(cleaned).not.toContain("onclick");
    expect(cleaned).not.toContain("javascript:");
  });

  it("preserves Office-style tables and safe inline presentation", () => {
    const cleaned = sanitizeNoteHtml(
      '<table style="width: 100%; border-collapse: collapse" onclick="bad()">' +
        '<thead><tr><th colspan="2" style="background-color: #ddeeff">Limits</th></tr></thead>' +
        '<tbody><tr><td style="text-align: right; font-weight: 700">10 V</td>' +
        '<td><sup>2</sup><iframe src="https://bad.example"></iframe></td></tr></tbody></table>',
    );

    expect(cleaned).toContain("<table");
    expect(cleaned).toContain('colspan="2"');
    expect(cleaned).toContain("background-color");
    expect(cleaned).toContain("text-align: right");
    expect(cleaned).toContain("<sup>2</sup>");
    expect(cleaned).not.toContain("onclick");
    expect(cleaned).not.toContain("iframe");
  });

  it("stores image references without duplicating base64 data in notes", () => {
    const editor = document.createElement("div");
    editor.innerHTML =
      '<figure data-note-image-id="img-1"><img src="data:image/png;base64,abc" ' +
      'data-note-image-id="img-1" alt="spec"><figcaption>Spec</figcaption></figure>';
    const serialized = serializeNoteDocument(editor);
    expect(serialized).toContain('data-note-image-id="img-1"');
    expect(serialized).toContain("<figcaption>Spec</figcaption>");
    expect(serialized).not.toContain("base64");
  });

  it("preserves image sizing, alignment, and wrapping metadata", () => {
    const editor = document.createElement("div");
    editor.innerHTML =
      '<figure data-note-image-id="img-2" data-note-width="42" ' +
      'data-note-align="right" data-note-wrap="right"><img ' +
      'data-note-image-id="img-2"><figcaption>Annotated limit</figcaption></figure>';
    applyStoredImageLayouts(editor);
    expect(editor.querySelector("figure").style.width).toBe("42%");

    const serialized = serializeNoteDocument(editor);
    expect(serialized).toContain('data-note-width="42"');
    expect(serialized).toContain('data-note-align="right"');
    expect(serialized).toContain('data-note-wrap="right"');
    expect(serialized).not.toContain("style=");
    expect(serialized).not.toContain("draggable=");
  });
});

describe("SessionNotesWorkspace image interactions", () => {
  it("adopts images inserted by the rich editor into session persistence", async () => {
    const onSessionSave = vi.fn().mockResolvedValue(undefined);
    render(
      <SessionNotesWorkspace
        sessionData={{ id: 11, notes: "", noteImages: [] }}
        sessionImageCache={new Map()}
        onSessionImageCacheChange={vi.fn()}
        onLoadSessionImages={vi.fn()}
        onSessionSave={onSessionSave}
        onNotesSave={vi.fn()}
      />,
    );

    const editor = document.querySelector(".session-notes-editor");
    editor.insertAdjacentHTML(
      "beforeend",
      '<p>Specification</p><img src="data:image/png;base64,abc" alt="OEM chart">',
    );
    fireEvent.input(editor);

    await waitFor(() => expect(onSessionSave).toHaveBeenCalledTimes(1));
    const [savedSession, savedImages] = onSessionSave.mock.calls[0];
    expect(savedSession.noteImages).toHaveLength(1);
    expect(savedSession.notes).toContain("<figure");
    expect(savedSession.notes).toContain('data-note-image-id="');
    expect(savedSession.notes).not.toContain("base64");
    expect(savedImages).toHaveLength(1);
    expect(savedImages[0].fileObject).toBe("data:image/png;base64,abc");
  });

  it("edits and deletes a selected image directly inside the document", async () => {
    const onSessionSave = vi.fn();
    const session = {
      id: 10,
      notes:
        '<p>Before</p><figure data-note-image-id="img-1" data-note-width="70" ' +
        'data-note-align="center" data-note-wrap="none"><img ' +
        'data-note-image-id="img-1" alt="spec"><figcaption>Original</figcaption></figure>',
      noteImages: [{ id: "img-1", fileName: "spec.png" }],
    };

    render(
      <SessionNotesWorkspace
        sessionData={session}
        sessionImageCache={new Map([[10, new Map([["img-1", "data:image/png;base64,abc"]])]])}
        onSessionImageCacheChange={vi.fn()}
        onLoadSessionImages={vi.fn()}
        onSessionSave={onSessionSave}
        onNotesSave={vi.fn()}
      />,
    );

    const image = await screen.findByAltText("spec");
    fireEvent.click(image);
    expect(screen.getByRole("toolbar", { name: "Selected image controls" })).toBeInTheDocument();
    expect(screen.queryByText("Session images")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Add a caption or notation"), {
      target: { value: "Upper-limit callout" },
    });
    expect(screen.getByText("Upper-limit callout")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete selected image" }));
    await waitFor(() => expect(onSessionSave).toHaveBeenCalledTimes(1));
    const savedSession = onSessionSave.mock.calls[0][0];
    expect(savedSession.noteImages).toEqual([]);
    expect(savedSession.notes).not.toContain("img-1");
  });
});
