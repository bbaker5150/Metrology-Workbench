import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import NotificationModal from "./NotificationModal";

const title = "Could not save instrument to Local";
const message = "HTTP 403\nAccess denied.";
const report = `${title}\n${message}`;
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalCommand = Object.getOwnPropertyDescriptor(document, "execCommand");
const copyButton = () => screen.getByRole("button", { name: "Copy error details" });

function setClipboard(clipboard, command) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
  Object.defineProperty(document, "execCommand", { configurable: true, value: command });
}

afterEach(() => {
  cleanup();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else delete navigator.clipboard;
  if (originalCommand) Object.defineProperty(document, "execCommand", originalCommand);
  else delete document.execCommand;
});

it("copies the displayed error with its title and keeps the prompt open", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  setClipboard({ writeText });
  const onClose = vi.fn();
  render(<NotificationModal isOpen copyable title={title} message={message} onClose={onClose} />);
  expect(screen.getByRole("alertdialog")).toHaveTextContent("HTTP 403 Access denied.");
  expect(fireEvent.keyDown(copyButton(), { key: "Enter" })).toBe(true);
  fireEvent.click(copyButton());
  expect(await screen.findByText("Error details copied.")).toBeInTheDocument();
  expect(writeText).toHaveBeenCalledWith(report);
  expect(onClose).not.toHaveBeenCalled();
});

it("uses the native copy command with the same report when the Clipboard API is unavailable", async () => {
  const command = vi.fn(() => {
    const field = document.activeElement;
    expect(field.value.slice(field.selectionStart, field.selectionEnd)).toBe(report);
    return true;
  });
  setClipboard(undefined, command);
  render(<NotificationModal isOpen copyable title={title} message={message} />);
  fireEvent.click(copyButton());
  expect(await screen.findByText("Error details copied.")).toBeInTheDocument();
  expect(command).toHaveBeenCalledWith("copy");
  expect(copyButton()).toHaveFocus();
});

it("leaves the full report selected for manual copying when the iframe blocks both copy methods", async () => {
  setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("Permission denied")) }, () => false);
  const { rerender } = render(<NotificationModal isOpen copyable title={title} message={message} />);
  fireEvent.click(copyButton());
  const field = await screen.findByRole("textbox", { name: "Error details" });
  expect(field).toHaveFocus();
  expect(field.value.slice(field.selectionStart, field.selectionEnd)).toBe(report);
  expect(screen.getByRole("status")).toHaveTextContent("Copy the selected details");
  expect(screen.queryByText("Error details copied.")).not.toBeInTheDocument();
  rerender(<NotificationModal isOpen title="Submitted" message="Ready for review." />);
  expect(screen.queryByRole("button", { name: "Copy error details" })).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
