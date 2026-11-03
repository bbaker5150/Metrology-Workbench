import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SessionNotesWorkspace, {
  DOCX_NOTE_PREFIX,
  decodeDocxNotePayload,
  encodeDocxNotePayload,
  isDocxNotePayload,
  legacyNotesToText,
} from "./SessionNotesWorkspace";

describe("SessionNotesWorkspace DOCX persistence", () => {
  it("keeps a light editor across sessions in a dark Workbench and can follow the app again", () => {
    document.body.classList.add("dark-mode");
    try {
      const { rerender } = render(<SessionNotesWorkspace sessionData={{ id: 1 }} />);
      const mode = () => screen.getByTestId("docx-editor").getAttribute("data-color-mode");
      expect(mode()).toBe("dark");
      fireEvent.change(screen.getByLabelText("Editor theme"), { target: { value: "light" } });
      expect(mode()).toBe("light");
      expect(document.body).toHaveClass("dark-mode");
      rerender(<SessionNotesWorkspace sessionData={{ id: 2 }} />);
      expect(mode()).toBe("light");
      fireEvent.change(screen.getByLabelText("Editor theme"), { target: { value: "auto" } });
      expect(mode()).toBe("dark");
    } finally {
      localStorage.removeItem("uncertalytics.notesEditorTheme");
      document.body.classList.remove("dark-mode");
    }
  });

  it("round-trips native DOCX bytes through the versioned session payload", () => {
    const original = new Uint8Array([80, 75, 3, 4, 10, 20, 30, 255]);
    const payload = encodeDocxNotePayload(original);

    expect(payload.startsWith(DOCX_NOTE_PREFIX)).toBe(true);
    expect(isDocxNotePayload(payload)).toBe(true);
    expect([...decodeDocxNotePayload(payload)]).toEqual([...original]);
  });

  it("distinguishes legacy note content from a native DOCX payload", () => {
    expect(isDocxNotePayload("<p>Legacy note</p>")).toBe(false);
    expect(decodeDocxNotePayload("Legacy note")).toBeNull();
  });

  it("replays a theme change with Notes closed and updates a reopened editor immediately", () => {
    const recordHistoryAction = vi.fn();
    const notes = <SessionNotesWorkspace sessionData={{ id: 1 }} {...{ recordHistoryAction }} />;
    const { rerender } = render(notes);
    try {
      fireEvent.change(screen.getByLabelText("Editor theme"), { target: { value: "dark" } });
      const [before, after, restore] = recordHistoryAction.mock.calls[0];
      rerender(null);
      act(() => restore(before));
      rerender(notes);
      expect(screen.getByLabelText("Editor theme")).toHaveValue("auto");
      act(() => restore(after));
      expect(screen.getByLabelText("Editor theme")).toHaveValue("dark");
      expect(screen.getByTestId("docx-editor")).toHaveAttribute("data-color-mode", "dark");
      expect(recordHistoryAction).toHaveBeenCalledTimes(1);
    } finally {
      localStorage.removeItem("uncertalytics.notesEditorTheme");
    }
  });

  it("migrates readable legacy HTML, tables, and image labels into seed text", () => {
    const text = legacyNotesToText(
      "<h2>OEM limits</h2><p>Verify at <strong>10 V</strong>.</p>" +
        "<table><tr><th>Range</th><th>Limit</th></tr>" +
        "<tr><td>100 V</td><td>0.1%</td></tr></table>" +
        '<img alt="datasheet chart" src="data:image/png;base64,abc">',
    );

    expect(text).toContain("OEM limits");
    expect(text).toContain("Verify at 10 V.");
    expect(text).toContain("Range\tLimit");
    expect(text).toContain("100 V\t0.1%");
    expect(text).toContain("[Image: datasheet chart]");
  });

  it("autosaves edited DOCX bytes into the active session", async () => {
    const onNotesSave = vi.fn().mockResolvedValue(undefined);
    render(
      <SessionNotesWorkspace
        sessionData={{ id: 11, name: "Calibration", notes: "", noteImages: [] }}
        onNotesSave={onNotesSave}
      />,
    );

    const editor = screen.getByText("", { selector: ".mock-docx-content" });
    editor.textContent = "Part ABC-123";
    fireEvent.input(editor);

    await waitFor(() => expect(onNotesSave).toHaveBeenCalledTimes(1), {
      timeout: 1800,
    });
    const [sessionId, payload] = onNotesSave.mock.calls[0];
    expect(sessionId).toBe(11);
    expect(isDocxNotePayload(payload)).toBe(true);
    expect(new TextDecoder().decode(decodeDocxNotePayload(payload))).toBe("Part ABC-123");
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("flushes the latest edit for history, keeps the cursor on save echoes and reloads restored notes", async () => {
    const flushNotesRef = React.createRef();
    let acknowledgeFirstSave;
    const onNotesSave = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { acknowledgeFirstSave = resolve; }))
      .mockResolvedValue(undefined);
    const workspace = (notes) => (
      <SessionNotesWorkspace sessionData={{ id: 5, notes }} {...{ onNotesSave, flushNotesRef }} />
    );
    const { rerender } = render(workspace("Original"));
    const editor = screen.getByText("Original", { selector: ".mock-docx-content" });
    editor.textContent = "First edit";
    fireEvent.input(editor);
    const pending = flushNotesRef.current();
    await waitFor(() => expect(onNotesSave).toHaveBeenCalledTimes(1));
    editor.textContent = "Latest edit";
    fireEvent.input(editor);
    rerender(workspace(onNotesSave.mock.calls[0][1]));
    expect(screen.getByText("Latest edit")).toBe(editor);
    await act(async () => {
      acknowledgeFirstSave();
      expect(await pending).toBe(true);
    });
    const latest = onNotesSave.mock.calls[1][1];
    expect(new TextDecoder().decode(decodeDocxNotePayload(latest))).toBe("Latest edit");
    rerender(workspace(latest));
    expect(screen.getByText("Latest edit")).toBe(editor);
    rerender(workspace("Original"));
    expect(screen.getByText("Original")).toBeInTheDocument();
    rerender(workspace(latest));
    expect(screen.getByTestId("docx-editor")).toHaveAttribute("data-buffer-size", "11");
    expect(flushNotesRef.current()).toBeNull();
  });

  it("routes DOCX loading through the editor File menu without duplicate title actions", () => {
    render(
      <SessionNotesWorkspace
        sessionData={{ id: 12, name: "Torque", notes: "", noteImages: [] }}
        onNotesSave={vi.fn()}
      />,
    );

    expect(screen.getByTestId("docx-editor")).toHaveAttribute(
      "data-show-file-open",
      "true",
    );
    expect(screen.getByTestId("docx-editor")).toHaveAttribute(
      "data-has-open-handler",
      "true",
    );
    expect(screen.queryByRole("button", { name: "Load DOCX" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save DOCX" })).not.toBeInTheDocument();
    expect(screen.queryByText("Session images")).not.toBeInTheDocument();
  });
});
