import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { useInstruments } from '../../contexts/InstrumentContext';
import InstrumentStatusPanel from './InstrumentStatusPanel';

vi.mock('axios', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(),
    },
}));

vi.mock('../../contexts/InstrumentContext', () => ({
    useInstruments: vi.fn(),
}));

const createInstrumentContext = (overrides = {}) => ({
    selectedSessionId: 1,
    instrumentStatuses: {},
    isFetchingStatuses: {},
    getInstrumentStatus: vi.fn(),
    runZeroCal: vi.fn(),
    discoveredInstruments: [],
    setDiscoveredInstruments: vi.fn(),
    isCollecting: false,
    claimedWorkstations: {},
    myClientId: 'test-client',
    sendWorkstationClaim: vi.fn(),
    sendWorkstationRelease: vi.fn(),
    ...overrides,
});

describe('InstrumentStatusPanel session-scoped discovery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('does not restore globally cached discovery results', () => {
        localStorage.setItem('discoveredInstruments', JSON.stringify([
            { address: 'GPIB0::1::INSTR', identity: 'STALE,5790B,1' },
        ]));
        useInstruments.mockReturnValue(createInstrumentContext());

        render(<InstrumentStatusPanel showNotification={vi.fn()} isRemoteViewer={false} />);

        expect(screen.getByText('No instruments found')).toBeInTheDocument();
        expect(screen.queryByText(/STALE,5790B,1/)).not.toBeInTheDocument();
        expect(localStorage.getItem('discoveredInstruments')).toBeNull();
    });

    it('requires a selected session before the scan control is enabled', () => {
        useInstruments.mockReturnValue(createInstrumentContext({ selectedSessionId: null }));

        render(<InstrumentStatusPanel showNotification={vi.fn()} isRemoteViewer={false} />);

        expect(screen.getByRole('button', { name: 'Scan for instruments' })).toBeDisabled();
    });

    it('discards a scan response that completes after the user changes sessions', async () => {
        let resolveScan;
        const scanPromise = new Promise((resolve) => {
            resolveScan = resolve;
        });
        axios.get.mockReturnValue(scanPromise);

        const setDiscoveredInstruments = vi.fn();
        let context = createInstrumentContext({ selectedSessionId: 1, setDiscoveredInstruments });
        useInstruments.mockImplementation(() => context);

        const { rerender } = render(
            <InstrumentStatusPanel showNotification={vi.fn()} isRemoteViewer={false} />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Scan for instruments' }));
        expect(setDiscoveredInstruments).toHaveBeenCalledOnce();
        expect(setDiscoveredInstruments).toHaveBeenCalledWith([]);

        context = createInstrumentContext({ selectedSessionId: 2, setDiscoveredInstruments });
        rerender(<InstrumentStatusPanel showNotification={vi.fn()} isRemoteViewer={false} />);

        await act(async () => {
            resolveScan({
                data: {
                    instruments: [{ address: 'GPIB0::14::INSTR', identity: 'FLUKE,5790B,123' }],
                    local_ip: '127.0.0.1',
                },
            });
            await scanPromise;
        });

        await waitFor(() => expect(axios.get).toHaveBeenCalledOnce());
        expect(setDiscoveredInstruments).toHaveBeenCalledOnce();
    });
});
