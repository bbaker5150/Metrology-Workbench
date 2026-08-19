import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StorageGate from './StorageGate';

const readyStore = (overrides = {}) => ({
  prefix: 'Uncertainty',
  currentUser: vi.fn().mockResolvedValue({ id: 41, title: 'Analyst One' }),
  listExists: vi.fn().mockResolvedValue(true),
  provision: vi.fn(),
  ...overrides,
});

describe('SharePoint storage gate authentication', () => {
  it('resolves the signed-in SharePoint user before mounting session data', async () => {
    const store = readyStore();
    render(
      <StorageGate store={store}>
        <div>Private workspace</div>
      </StorageGate>,
    );

    await screen.findByText('Private workspace');
    expect(store.currentUser).toHaveBeenCalledOnce();
    expect(store.currentUser.mock.invocationCallOrder[0]).toBeLessThan(
      store.listExists.mock.invocationCallOrder[0],
    );
  });

  it('does not render an empty workspace when SharePoint sign-in cannot be resolved', async () => {
    const store = readyStore({
      currentUser: vi.fn().mockRejectedValue(new Error('Sign in again')),
    });
    render(
      <StorageGate store={store}>
        <div>Private workspace</div>
      </StorageGate>,
    );

    await waitFor(() => expect(screen.getByText('Sign in again')).toBeInTheDocument());
    expect(screen.queryByText('Private workspace')).not.toBeInTheDocument();
    expect(store.listExists).not.toHaveBeenCalled();
  });
});
