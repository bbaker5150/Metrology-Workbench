import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './AcShuntApp';
import { ThemeProvider } from '../../shared/ThemeContext';
import { NotificationProvider } from '../../shared/NotificationContext';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(async () => ({ data: [] })),
    post: vi.fn(async () => ({ data: {} })),
  },
}));

describe('AcShuntApp', () => {
  test('renders the main application header', () => {
    // AcShuntApp is mounted beneath these workbench-level providers in
    // production. Keep the smoke test faithful to that real application tree.
    render(
      <ThemeProvider>
        <NotificationProvider>
          <App />
        </NotificationProvider>
      </ThemeProvider>,
    );
    const headingElement = screen.getByText(/Calibration Platform/i);
    expect(headingElement).toBeInTheDocument();
  });
});
