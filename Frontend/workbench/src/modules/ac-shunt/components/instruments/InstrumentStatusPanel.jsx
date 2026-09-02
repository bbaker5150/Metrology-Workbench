/**
 * @file InstrumentStatusPanel.js
 * @brief Displays the status of connected hardware instruments and allows role assignment.
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { useInstruments } from '../../contexts/InstrumentContext';
import { FaSave, FaUndo, FaTimes, FaSearch, FaSync, FaEdit, FaCreativeCommonsZero } from 'react-icons/fa';
import { API_BASE_URL } from '../../constants/constants';
import {
    isDiscoveredInstrumentAvailable,
    isSameInstrumentAddress,
} from '../../utils/instrumentStatus';

const ASSIGNABLE_MODELS = ['34420A', '3458A', '5790A', '5790B', '8508A'];
const ACDC_ASSIGNABLE_MODELS = ['5730A'];
const AMPLIFIER_MODELS = ['8100'];
const SUPPORTED_STATUS_MODELS = ['5730', '5790'];
const SWITCH_DRIVER_MODELS = ['11713C'];

const statusBitDescriptions = {
    OPER: "Operating", EXTGARD: "External Guard", EXTSENS: "External Sensing", BOOST: "Boost Active",
    RCOMP: "R-Comp Active", RLOCK: "Range Locked", PSHIFT: "Phase Shift", PLOCK: "Phase Locked",
    OFFSET: "Offset Active", SCALE: "Scaling Active", WBND: "Wideband Active", REMOTE: "Remote",
    SETTLED: "Settled", ZERO_CAL: "Zero Cal Needed", AC_XFER: "AC/DC Transfer", UNUSED_15: "Unused"
};

function InstrumentStatusPanel({ showNotification, isRemoteViewer }) {
    const {
        selectedSessionId, instrumentStatuses, isFetchingStatuses, getInstrumentStatus,
        runZeroCal,
        discoveredInstruments, setDiscoveredInstruments,
        stdInstrumentAddress, setStdInstrumentAddress, stdReaderModel, setStdReaderModel, stdReaderSN, setStdReaderSN,
        stdReaderInput, setStdReaderInput,
        tiInstrumentAddress, setTiInstrumentAddress, tiReaderModel, setTiReaderModel, tiReaderSN, setTiReaderSN,
        tiReaderInput, setTiReaderInput,
        acSourceAddress, setAcSourceAddress, acSourceSN, setAcSourceSN, dcSourceAddress, setDcSourceAddress, dcSourceSN, setDcSourceSN,
        switchDriverAddress, setSwitchDriverAddress, switchDriverModel, setSwitchDriverModel, switchDriverSN, setSwitchDriverSN,
        readerSwitchDriverAddress, setReaderSwitchDriverAddress,
        readerSwitchDriverModel, setReaderSwitchDriverModel,
        readerSwitchDriverSN, setReaderSwitchDriverSN,
        readerSwitchStandardRoute, setReaderSwitchStandardRoute,
        readerSwitchSettlingTime, setReaderSwitchSettlingTime,
        amplifierAddress, setAmplifierAddress, amplifierSN, setAmplifierSN, isCollecting,
        
        // NEW DESTRUCTURES: Exposing the locking mechanism from the context
        claimedWorkstations, myClientId, sendWorkstationClaim, sendWorkstationRelease
    } = useInstruments();

    const [isScanning, setIsScanning] = useState(false);
    const [isInitializing, setIsInitializing] = useState(false);
    const [activeWorkstationIp, setActiveWorkstationIp] = useState('');
    const [localIp, setLocalIp] = useState('');
    const [editingIp, setEditingIp] = useState(null);
    const [editingName, setEditingName] = useState('');
    const scanGenerationRef = useRef(0);

    // Discovery results are intentionally memory-only. The previous global
    // localStorage cache reused one bench topology across every session.
    useEffect(() => {
        localStorage.removeItem('discoveredInstruments');
    }, []);

    // Invalidate any in-flight request when the session changes (or this
    // panel unmounts) so a slow response from the prior session cannot
    // repopulate the new session with stale instruments.
    useEffect(() => {
        scanGenerationRef.current += 1;
        setIsScanning(false);
        setLocalIp('');
        setActiveWorkstationIp('');
        setEditingIp(null);
        setEditingName('');
        return () => {
            scanGenerationRef.current += 1;
        };
    }, [selectedSessionId]);

    useEffect(() => {
        if (isRemoteViewer || isCollecting) return;
        if (discoveredInstruments.length > 0) {
            discoveredInstruments.forEach(inst => {
                const modelMatch = inst.identity.match(/(\d{4}[A-Z]?)/);
                const model = modelMatch ? modelMatch[0] : null;

                if (model && inst.address && SUPPORTED_STATUS_MODELS.some(supported => model.startsWith(supported))) {
                    getInstrumentStatus(model, inst.address);
                }
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [discoveredInstruments, getInstrumentStatus, isRemoteViewer, isCollecting]);

    const workstations = useMemo(() => {
        const wsMap = new Map();
        discoveredInstruments.forEach(inst => {
            const visaMatch = inst.address.match(/visa:\/\/([0-9.]+)(:[0-9]+)?/i);
            const gpibMatch = inst.address.match(/GPIB\d*::\d+::INSTR/i);

            if (visaMatch && visaMatch[1]) {
                const ip = visaMatch[1];
                if (!wsMap.has(ip)) {
                    const customName = localStorage.getItem(`workstationName_${ip}`);
                    const isLocal = ip === localIp;
                    const displayName = customName || (isLocal ? 'Local Workstation' : ip);

                    wsMap.set(ip, {
                        name: displayName,
                        instruments: []
                    });
                }
                wsMap.get(ip).instruments.push(inst);
            } else if (gpibMatch) {
                const localWorkstationKey = 'local';
                if (!wsMap.has(localWorkstationKey)) {
                    const customName = localStorage.getItem(`workstationName_${localWorkstationKey}`);
                    const displayName = customName || 'Local Workstation';
                    wsMap.set(localWorkstationKey, {
                        name: displayName,
                        instruments: []
                    });
                }
                wsMap.get(localWorkstationKey).instruments.push(inst);
            }
        });
        return Array.from(wsMap.entries()).map(([ip, data]) => ({ ip, ...data }));
    }, [discoveredInstruments, localIp]);

    // NEW: Handle claiming/releasing workstations when the user changes views
    useEffect(() => {
        if (isRemoteViewer) return;

        if (activeWorkstationIp) {
            sendWorkstationClaim(activeWorkstationIp);
        }

        // Cleanup: Release the lock if the component unmounts or the user picks a new IP
        return () => {
            if (activeWorkstationIp) {
                sendWorkstationRelease(activeWorkstationIp);
            }
        };
    }, [activeWorkstationIp, isRemoteViewer, sendWorkstationClaim, sendWorkstationRelease]);

    // UPDATE: Intelligent default IP selection that avoids locked workstations
    useEffect(() => {
        if (workstations.length > 0 && !workstations.some(ws => ws.ip === activeWorkstationIp)) {
            // Find the first workstation that is NOT claimed by someone else
            const availableWs = workstations.find(ws => {
                const isClaimedByOther = claimedWorkstations[ws.ip] && claimedWorkstations[ws.ip].client_id !== myClientId;
                return !isClaimedByOther;
            });

            if (availableWs) {
                setActiveWorkstationIp(availableWs.ip);
            } else {
                // If everything is locked, default to the first one (it will show as disabled in the dropdown)
                setActiveWorkstationIp(workstations[0].ip);
            }
        } else if (workstations.length === 0) {
            setActiveWorkstationIp('');
        }
    }, [workstations, activeWorkstationIp, claimedWorkstations, myClientId]);

    const handleInitializeInstruments = async () => {
        if (!selectedSessionId) {
            showNotification("Please select a session first.", "warning");
            return;
        }
        setIsInitializing(true);
        try {
            const response = await axios.post(`${API_BASE_URL}/calibration_sessions/${selectedSessionId}/initialize-instruments/`);
            if (response.data.errors && response.data.errors.length > 0) {
                const errorMessages = response.data.errors.join('\n');
                showNotification(`Initialization completed with errors:\n${errorMessages}`, 'warning');
            } else {
                showNotification(response.data.status, 'success');
            }
        } catch (error) {
            const errorMessage = error.response?.data?.detail || "An unexpected error occurred during initialization.";
            showNotification(`Initialization failed: ${errorMessage}`, 'error');
            console.error("Initialization error:", error);
        } finally {
            setIsInitializing(false);
        }
    };

    const handleScanInstruments = async () => {
        if (!selectedSessionId) {
            showNotification('Please select a session before scanning for instruments.', 'warning');
            return;
        }
        const scanGeneration = ++scanGenerationRef.current;
        setIsScanning(true);
        setDiscoveredInstruments([]);

        try {
            const response = await axios.get(`${API_BASE_URL}/instruments/discover/`);
            if (scanGeneration !== scanGenerationRef.current) return;
            const instruments = Array.isArray(response.data.instruments) ? response.data.instruments : [];

            const serverIp = response.data.server_ip || response.data.local_ip || '';

            setLocalIp(serverIp);
            setDiscoveredInstruments(instruments);

            instruments.forEach(inst => {
                const modelMatch = inst.identity.match(/(\d{4}[A-Z]?)/);
                const model = modelMatch ? modelMatch[0] : null;
                if (model && inst.address && SUPPORTED_STATUS_MODELS.some(supported => model.startsWith(supported))) {
                    getInstrumentStatus(model, inst.address);
                }
            });

            showNotification(`Scan complete. Found ${instruments.length} instrument(s).`, 'success');
        } catch (error) {
            if (scanGeneration === scanGenerationRef.current) {
                showNotification('Failed to scan for instruments.', 'error');
            }
        } finally {
            if (scanGeneration === scanGenerationRef.current) {
                setIsScanning(false);
            }
        }
    };

    const handleEditName = () => {
        const currentWs = workstations.find(ws => ws.ip === activeWorkstationIp);
        if (currentWs) {
            setEditingIp(activeWorkstationIp);
            setEditingName(currentWs.name);
        }
    };

    const handleSaveName = () => {
        if (editingName.trim() === '') return showNotification("Workstation name cannot be empty.", "error");
        localStorage.setItem(`workstationName_${editingIp}`, editingName.trim());
        showNotification(`Workstation name for ${editingIp} saved.`, 'success');
        setEditingIp(null);
        setDiscoveredInstruments([...discoveredInstruments]);
    };

    const handleResetName = () => {
        localStorage.removeItem(`workstationName_${editingIp}`);
        showNotification(`Name for ${editingIp} has been reset.`, 'info');
        setEditingIp(null);
        setDiscoveredInstruments([...discoveredInstruments]);
    };

    const getModelFromIdentity = (identity) => {
        if (!identity) return null;
        const parts = identity.split(',');
        if (parts.length > 1 && parts[1]) {
            const model = parts[1].trim();
            return model.startsWith('8508A') ? '8508A' : model;
        }
        const allKnownModels = [...ASSIGNABLE_MODELS, ...ACDC_ASSIGNABLE_MODELS, ...AMPLIFIER_MODELS];
        for (const model of allKnownModels) if (identity.includes(model)) return model;
        return identity.trim();
    };

    const getSNFromIdentity = (identity) => {
        if (!identity) return null;
        const parts = identity.split(',');
        if (parts.length > 2 && parts[1] && parts[2]) {
            if (parts[1].trim() === "34420A") {
                return "";
            } else {
                return parts[2].trim();
            }
        }
        return identity.trim();
    };

    const handleRoleAssignment = async (payload) => {
        if (!selectedSessionId) {
            showNotification("Please select a session before assigning roles.", "error");
            return;
        }
        try {
            await axios.patch(`${API_BASE_URL}/calibration_sessions/${selectedSessionId}/`, payload);
            showNotification(`Role assignments updated.`, 'success');
        } catch (error) {
            showNotification('Failed to save role assignment.', 'error');
        }
    };

    const handleStdTiRoleChange = (instrument, role, isChecked) => {
        const newAddress = isChecked ? instrument.address : null;
        const newModel = isChecked ? getModelFromIdentity(instrument.identity) : null;
        const newSN = isChecked ? getSNFromIdentity(instrument.identity) : null;
        const is5790 = /^5790[AB]$/.test(newModel || '');
        const sameReader = isSameInstrumentAddress(
            newAddress,
            role === 'standard' ? tiInstrumentAddress : stdInstrumentAddress,
        );
        const externalInstrumentSwitch = Boolean(readerSwitchDriverAddress);
        if (role === 'standard') {
            const input = newModel === '8508A'
                ? (sameReader ? (tiReaderInput === 'FRONT' ? 'REAR' : 'FRONT') : 'FRONT')
                : is5790
                    ? (sameReader
                        ? (externalInstrumentSwitch ? (tiReaderInput || 'INPUT2') : 'INPUT1')
                        : 'INPUT2')
                    : null;
            if (input) setStdReaderInput(input);
            setStdInstrumentAddress(newAddress);
            setStdReaderModel(newModel);
            setStdReaderSN(newSN);
            const payload = {
                standard_reader_address: newAddress,
                standard_reader_model: newModel,
                standard_reader_serial: newSN,
                standard_reader_input: isChecked ? input : null,
            };
            if (isChecked && is5790 && sameReader) {
                const pairedInput = externalInstrumentSwitch ? input : 'INPUT2';
                setTiReaderInput(pairedInput);
                payload.test_reader_input = pairedInput;
            }
            handleRoleAssignment(payload);
        } else if (role === 'test') {
            const input = newModel === '8508A'
                ? (sameReader ? (stdReaderInput === 'FRONT' ? 'REAR' : 'FRONT') : 'REAR')
                : is5790
                    ? (sameReader && externalInstrumentSwitch ? (stdReaderInput || 'INPUT2') : 'INPUT2')
                    : null;
            if (input) setTiReaderInput(input);
            setTiInstrumentAddress(newAddress);
            setTiReaderModel(newModel);
            setTiReaderSN(newSN);
            const payload = {
                test_reader_address: newAddress,
                test_reader_model: newModel,
                test_reader_serial: newSN,
                test_reader_input: isChecked ? input : null,
            };
            if (isChecked && is5790 && sameReader) {
                const pairedInput = externalInstrumentSwitch ? input : 'INPUT1';
                setStdReaderInput(pairedInput);
                payload.standard_reader_input = pairedInput;
            }
            handleRoleAssignment(payload);
        }
    };

    const handleReaderInputChange = (role, input) => {
        const opposite = input.startsWith('INPUT')
            ? (input === 'INPUT1' ? 'INPUT2' : 'INPUT1')
            : (input === 'FRONT' ? 'REAR' : 'FRONT');
        const shared5790 = (
            /^5790[AB]$/.test(stdReaderModel || '')
            && /^5790[AB]$/.test(tiReaderModel || '')
            && isSameInstrumentAddress(stdInstrumentAddress, tiInstrumentAddress)
        );
        const keepSameInput = shared5790 && Boolean(readerSwitchDriverAddress);
        if (role === 'standard') {
            setStdReaderInput(input);
            const payload = { standard_reader_input: input };
            if (keepSameInput) {
                setTiReaderInput(input);
                payload.test_reader_input = input;
            } else if (isSameInstrumentAddress(stdInstrumentAddress, tiInstrumentAddress) && tiReaderInput === input) {
                setTiReaderInput(opposite);
                payload.test_reader_input = opposite;
            }
            handleRoleAssignment(payload);
        } else {
            setTiReaderInput(input);
            const payload = { test_reader_input: input };
            if (keepSameInput) {
                setStdReaderInput(input);
                payload.standard_reader_input = input;
            } else if (isSameInstrumentAddress(tiInstrumentAddress, stdInstrumentAddress) && stdReaderInput === input) {
                setStdReaderInput(opposite);
                payload.standard_reader_input = opposite;
            }
            handleRoleAssignment(payload);
        }
    };

    const handleAmplifierRoleChange = (instrument, isChecked) => {
        const newAddress = isChecked ? instrument.address : null;
        const newSN = isChecked ? getSNFromIdentity(instrument.identity) : null;
        setAmplifierAddress(newAddress);
        setAmplifierSN(newSN);
        handleRoleAssignment({ amplifier_address: newAddress, amplifier_serial: newSN });
    };

    const handleAcDcCheckboxChange = (instrument, role, isChecked) => {
        const newAddress = isChecked ? instrument.address : null;
        const newSN = isChecked ? getSNFromIdentity(instrument.identity) : null;
        if (role === 'ac') {
            setAcSourceAddress(newAddress);
            setAcSourceSN(newSN);
            handleRoleAssignment({ ac_source_address: newAddress, ac_source_serial: newSN });
        } else if (role === 'dc') {
            setDcSourceAddress(newAddress);
            setDcSourceSN(newSN)
            handleRoleAssignment({ dc_source_address: newAddress, dc_source_serial: newSN });
        }
    };

    const handleSourceSwitchRoleChange = (instrument, isChecked) => {
        const newAddress = isChecked ? instrument.address : null;
        const newModel = isChecked ? getModelFromIdentity(instrument.identity) : null;
        const newSN = isChecked ? getSNFromIdentity(instrument.identity) : null;
        setSwitchDriverAddress(newAddress);
        setSwitchDriverModel(newModel);
        setSwitchDriverSN(newSN);
        const payload = { switch_driver_address: newAddress, switch_driver_model: newModel, switch_driver_serial: newSN };
        if (isChecked && isSameInstrumentAddress(readerSwitchDriverAddress, instrument.address)) {
            setReaderSwitchDriverAddress(null);
            setReaderSwitchDriverModel(null);
            setReaderSwitchDriverSN(null);
            Object.assign(payload, {
                reader_switch_driver_address: null,
                reader_switch_driver_model: null,
                reader_switch_driver_serial: null,
            });
            const shared5790 = (
                /^5790[AB]$/.test(stdReaderModel || '')
                && /^5790[AB]$/.test(tiReaderModel || '')
                && isSameInstrumentAddress(stdInstrumentAddress, tiInstrumentAddress)
            );
            if (shared5790) {
                setStdReaderInput('INPUT1');
                setTiReaderInput('INPUT2');
                Object.assign(payload, {
                    standard_reader_input: 'INPUT1',
                    test_reader_input: 'INPUT2',
                });
            }
        }
        handleRoleAssignment(payload);
    };

    const handleReaderSwitchRoleChange = (instrument, isChecked) => {
        const newAddress = isChecked ? instrument.address : null;
        const newModel = isChecked ? getModelFromIdentity(instrument.identity) : null;
        const newSN = isChecked ? getSNFromIdentity(instrument.identity) : null;
        setReaderSwitchDriverAddress(newAddress);
        setReaderSwitchDriverModel(newModel);
        setReaderSwitchDriverSN(newSN);
        const payload = {
            reader_switch_driver_address: newAddress,
            reader_switch_driver_model: newModel,
            reader_switch_driver_serial: newSN,
        };
        const shared5790 = (
            /^5790[AB]$/.test(stdReaderModel || '')
            && /^5790[AB]$/.test(tiReaderModel || '')
            && isSameInstrumentAddress(stdInstrumentAddress, tiInstrumentAddress)
        );
        if (shared5790) {
            if (isChecked) {
                const commonInput = stdReaderInput || tiReaderInput || 'INPUT2';
                setStdReaderInput(commonInput);
                setTiReaderInput(commonInput);
                Object.assign(payload, {
                    standard_reader_input: commonInput,
                    test_reader_input: commonInput,
                });
            } else {
                setStdReaderInput('INPUT1');
                setTiReaderInput('INPUT2');
                Object.assign(payload, {
                    standard_reader_input: 'INPUT1',
                    test_reader_input: 'INPUT2',
                });
            }
        }
        if (isChecked && isSameInstrumentAddress(switchDriverAddress, instrument.address)) {
            setSwitchDriverAddress(null);
            setSwitchDriverModel(null);
            setSwitchDriverSN(null);
            Object.assign(payload, {
                switch_driver_address: null,
                switch_driver_model: null,
                switch_driver_serial: null,
            });
        }
        handleRoleAssignment(payload);
    };

    const updateReaderSwitchOption = (field, value) => {
        if (field === 'reader_switch_standard_route') setReaderSwitchStandardRoute(value);
        if (field === 'reader_switch_settling_time') setReaderSwitchSettlingTime(value);
        handleRoleAssignment({ [field]: value });
    };

    const activeInstruments = workstations.find(ws => ws.ip === activeWorkstationIp)?.instruments || [];
    const hasAssignedInstruments = stdInstrumentAddress || tiInstrumentAddress || acSourceAddress || dcSourceAddress || switchDriverAddress || readerSwitchDriverAddress || amplifierAddress;

    const assignedRoleChips = [
        stdInstrumentAddress && { key: 'std', label: 'Standard DMM', identity: [stdReaderModel, stdReaderSN && `S/N ${stdReaderSN}`].filter(Boolean).join(' '), address: stdInstrumentAddress },
        tiInstrumentAddress && { key: 'ti', label: 'Test Instrument DMM', identity: [tiReaderModel, tiReaderSN && `S/N ${tiReaderSN}`].filter(Boolean).join(' '), address: tiInstrumentAddress },
        acSourceAddress && { key: 'ac', label: 'AC Source', identity: acSourceSN ? `S/N ${acSourceSN}` : '—', address: acSourceAddress },
        dcSourceAddress && { key: 'dc', label: 'DC Source', identity: dcSourceSN ? `S/N ${dcSourceSN}` : '—', address: dcSourceAddress },
        amplifierAddress && { key: 'amp', label: 'Amplifier', identity: amplifierSN ? `S/N ${amplifierSN}` : '—', address: amplifierAddress },
        switchDriverAddress && { key: 'sw-source', label: 'Source Switch', identity: [switchDriverModel, switchDriverSN && `S/N ${switchDriverSN}`].filter(Boolean).join(' '), address: switchDriverAddress },
        readerSwitchDriverAddress && { key: 'sw-reader', label: 'Instrument Switch', identity: [readerSwitchDriverModel, readerSwitchDriverSN && `S/N ${readerSwitchDriverSN}`].filter(Boolean).join(' '), address: readerSwitchDriverAddress },
    ].filter(Boolean);

    return (
        <div className="content-area instrument-status-panel">
            <div className="instrument-status-header">
                <div className="instrument-status-header-heading">
                    <span className="instrument-status-header-eyebrow">Instruments</span>
                    <h2>Status &amp; Role Assignment</h2>
                </div>
                <div className="instrument-status-header-tools">
                    <button
                        type="button"
                        onClick={handleScanInstruments}
                        className="cal-results-excel-icon-btn"
                        disabled={isScanning || !selectedSessionId || isRemoteViewer}
                        title={!selectedSessionId ? "Select a session before scanning" : isScanning ? "Scanning..." : "Scan for Instruments"}
                        aria-label="Scan for instruments"
                    >
                        <FaSearch />
                    </button>
                    <button
                        type="button"
                        onClick={handleInitializeInstruments}
                        className="cal-results-excel-icon-btn"
                        disabled={isInitializing || !selectedSessionId || !hasAssignedInstruments || isRemoteViewer}
                        title={isInitializing ? "Initializing..." : "Initialize assigned instruments"}
                        aria-label="Initialize assigned instruments"
                    >
                        <FaSync />
                    </button>
                </div>
            </div>

            {workstations.length > 0 && (
                <section className="isp-section">
                    <div className="isp-section-heading">
                        <span className="isp-section-eyebrow">Active Workstation</span>
                        <span className="isp-section-subtitle">Choose which discovered workstation to inspect.</span>
                    </div>
                    <div className="isp-workstation-row">
                        <select
                            id="workstation-select"
                            className="isp-workstation-select"
                            value={activeWorkstationIp}
                            onChange={(e) => setActiveWorkstationIp(e.target.value)}
                            disabled={editingIp === activeWorkstationIp || isRemoteViewer}
                            aria-label="Active workstation"
                        >
                            {workstations.map(({ ip, name, instruments }) => {
                                // UPDATE: Block the UI dropdown choice if it belongs to someone else
                                const isClaimedByOther = claimedWorkstations[ip] && claimedWorkstations[ip].client_id !== myClientId;

                                return (
                                    <option 
                                        key={ip} 
                                        value={ip}
                                        disabled={isClaimedByOther}
                                    >
                                        {`${name} (${instruments.length} instruments)`}
                                        {isClaimedByOther ? ' 🔒 (In use by another host)' : ''}
                                    </option>
                                );
                            })}
                        </select>

                        <div className="isp-workstation-editor">
                            {editingIp === activeWorkstationIp ? (
                                <>
                                    <input
                                        type="text"
                                        value={editingName}
                                        onChange={e => setEditingName(e.target.value)}
                                        placeholder="Enter new name..."
                                        aria-label="Workstation name"
                                    />
                                    <button className="cal-results-excel-icon-btn" onClick={handleSaveName} title="Save workstation name" aria-label="Save workstation name">
                                        <FaSave />
                                    </button>
                                    <button className="cal-results-excel-icon-btn" onClick={handleResetName} title="Reset workstation name" aria-label="Reset workstation name">
                                        <FaUndo />
                                    </button>
                                    <button className="cal-results-excel-icon-btn" onClick={() => setEditingIp(null)} title="Cancel" aria-label="Cancel rename">
                                        <FaTimes />
                                    </button>
                                </>
                            ) : (
                                <button className="cal-results-excel-icon-btn" onClick={handleEditName} disabled={!activeWorkstationIp || isRemoteViewer} title="Rename workstation" aria-label="Rename workstation">
                                    <FaEdit />
                                </button>
                            )}
                        </div>
                    </div>
                </section>
            )}

            <section className="isp-section">
                <div className="isp-section-heading">
                    <span className="isp-section-eyebrow">Detected Instruments</span>
                    <span className="isp-section-subtitle">
                        {activeInstruments.length > 0
                            ? `${activeInstruments.length} instrument${activeInstruments.length === 1 ? '' : 's'} on this workstation.`
                            : 'Discover hardware connected to this machine.'}
                    </span>
                </div>

                <div className="status-list">
                    {activeInstruments.length > 0 ? (
                        activeInstruments.map(inst => {
                            const status = instrumentStatuses[inst.address];
                            const isFetching = isFetchingStatuses[inst.address];
                            // A successful discovery already opened the VISA resource and
                            // obtained its identity. ISR/status-register polling is optional
                            // metadata and must not make a live 5730A (or a reader without
                            // ISR support, such as the 34420A) look disconnected or lock its
                            // persisted role assignment after reopening a session.
                            const isConnected = isDiscoveredInstrumentAvailable(inst);
                            const isAssignable = ASSIGNABLE_MODELS.some(m => inst.identity.includes(m));
                            const isAcDcAssignable = ACDC_ASSIGNABLE_MODELS.some(m => inst.identity.includes(m));
                            const isAmplifierAssignable = AMPLIFIER_MODELS.some(m => inst.identity.includes(m));
                            const isStatusSupported = SUPPORTED_STATUS_MODELS.some(m => inst.identity.includes(m));
                            const isSwitchDriverAssignable = SWITCH_DRIVER_MODELS.some(m => inst.identity.includes(m));
                            const hasAnyRoleRow = isAssignable || isAcDcAssignable || isAmplifierAssignable || isSwitchDriverAssignable;

                            const parts = inst.identity.split(',');
                            let model = '';
                            if (parts.length > 1 && parts[1]) {
                                model = parts[1].trim();
                                if (model.startsWith('8508A')) model = '8508A';
                            }
                            const is5730A = model.includes('5730');

                            const isZeroing = instrumentStatuses[inst.address]?.wsConnectionState === "Zeroing in Progress..."
                                || instrumentStatuses[inst.address]?.wsConnectionState?.includes("Zeroing");

                            return (
                                <div key={inst.address} className="status-card">
                                    <div className="status-card-header">
                                        <div className="status-card-identity-wrap">
                                            <p className="instrument-identity">{inst.identity}</p>
                                            <p className="instrument-address">{inst.address}</p>
                                        </div>
                                        <div className="status-card-actions-pill">
                                                <div
                                                    className={`status-badge ${isConnected ? 'connected' : 'disconnected'}${is5730A ? ' has-adjacent-action' : ''}`}
                                                    title={status?.error
                                                        ? `Instrument discovered; status details unavailable: ${status.error}`
                                                        : (isConnected ? 'Instrument identified during the latest discovery scan.' : 'Instrument was not identified during discovery.')}
                                                >
                                                <span className="status-badge-icon">●</span>
                                                {isConnected ? 'Connected' : 'Disconnected'}
                                            </div>
                                            {is5730A && (
                                                <button
                                                    type="button"
                                                    className={`isp-zero-cal-btn--compact${isZeroing ? ' is-zeroing' : ''}`}
                                                    onClick={() => runZeroCal(model, inst.address)}
                                                    disabled={!isConnected || isZeroing || isRemoteViewer}
                                                    title={isZeroing ? 'Zeroing in progress…' : 'Run zero calibration'}
                                                    aria-label={isZeroing ? 'Zeroing in progress' : 'Run zero calibration'}
                                                >
                                                    {isZeroing ? (
                                                        <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                                                    ) : (
                                                        <FaCreativeCommonsZero />
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {hasAnyRoleRow && (
                                        <div className="status-card-roles">
                                            {isAssignable && (
                                                <div className="role-assignment">
                                                    <span className="role-assignment-label">Reader Role</span>
                                                    <div className="checkbox-group">
                                                        <input type="checkbox" id={`std-role-${inst.address}`} checked={isSameInstrumentAddress(stdInstrumentAddress, inst.address)} onChange={(e) => handleStdTiRoleChange(inst, 'standard', e.target.checked)} disabled={!selectedSessionId || !isConnected || isRemoteViewer || isCollecting} />
                                                        <label htmlFor={`std-role-${inst.address}`}>Standard</label>
                                                        {(model === '8508A' || /^5790[AB]$/.test(model)) && isSameInstrumentAddress(stdInstrumentAddress, inst.address) && (
                                                            <select
                                                                className="reader-input-select"
                                                                value={stdReaderInput || (model === '8508A' ? 'FRONT' : 'INPUT2')}
                                                                onChange={(event) => handleReaderInputChange('standard', event.target.value)}
                                                                disabled={isRemoteViewer || isCollecting}
                                                                aria-label={`${model} Standard input`}
                                                            >
                                                                {model === '8508A' ? (<>
                                                                    <option value="FRONT">Front input</option>
                                                                    <option value="REAR">Rear input</option>
                                                                </>) : (<>
                                                                    <option value="INPUT1">Input 1</option>
                                                                    <option value="INPUT2">Input 2</option>
                                                                </>)}
                                                            </select>
                                                        )}
                                                    </div>
                                                    <div className="checkbox-group">
                                                        <input type="checkbox" id={`test-role-${inst.address}`} checked={isSameInstrumentAddress(tiInstrumentAddress, inst.address)} onChange={(e) => handleStdTiRoleChange(inst, 'test', e.target.checked)} disabled={!selectedSessionId || !isConnected || isRemoteViewer || isCollecting} />
                                                        <label htmlFor={`test-role-${inst.address}`}>Test Instrument</label>
                                                        {(model === '8508A' || /^5790[AB]$/.test(model)) && isSameInstrumentAddress(tiInstrumentAddress, inst.address) && (
                                                            <select
                                                                className="reader-input-select"
                                                                value={tiReaderInput || (model === '8508A' ? 'REAR' : 'INPUT2')}
                                                                onChange={(event) => handleReaderInputChange('test', event.target.value)}
                                                                disabled={isRemoteViewer || isCollecting}
                                                                aria-label={`${model} Test Instrument input`}
                                                            >
                                                                {model === '8508A' ? (<>
                                                                    <option value="FRONT">Front input</option>
                                                                    <option value="REAR">Rear input</option>
                                                                </>) : (<>
                                                                    <option value="INPUT1">Input 1</option>
                                                                    <option value="INPUT2">Input 2</option>
                                                                </>)}
                                                            </select>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                            {isAcDcAssignable && (
                                                <div className="role-assignment">
                                                    <span className="role-assignment-label">Source Function</span>
                                                    <div className="checkbox-group">
                                                        <input type="checkbox" id={`ac-role-${inst.address}`} checked={isSameInstrumentAddress(acSourceAddress, inst.address)} onChange={(e) => handleAcDcCheckboxChange(inst, 'ac', e.target.checked)} disabled={!selectedSessionId || !isConnected || isRemoteViewer || isCollecting} />
                                                        <label htmlFor={`ac-role-${inst.address}`}>AC Source</label>
                                                    </div>
                                                    <div className="checkbox-group">
                                                        <input type="checkbox" id={`dc-role-${inst.address}`} checked={isSameInstrumentAddress(dcSourceAddress, inst.address)} onChange={(e) => handleAcDcCheckboxChange(inst, 'dc', e.target.checked)} disabled={!selectedSessionId || !isConnected || isRemoteViewer || isCollecting} />
                                                        <label htmlFor={`dc-role-${inst.address}`}>DC Source</label>
                                                    </div>
                                                </div>
                                            )}
                                            {isAmplifierAssignable && (
                                                <div className="role-assignment">
                                                    <span className="role-assignment-label">Amplifier Role</span>
                                                    <div className="checkbox-group">
                                                        <input type="checkbox" id={`amp-role-${inst.address}`} checked={isSameInstrumentAddress(amplifierAddress, inst.address)} onChange={(e) => handleAmplifierRoleChange(inst, e.target.checked)} disabled={!selectedSessionId || !isConnected || isRemoteViewer || isCollecting} />
                                                        <label htmlFor={`amp-role-${inst.address}`}>Amplifier</label>
                                                    </div>
                                                </div>
                                            )}
                                            {isSwitchDriverAssignable && (
                                                <div className="role-assignment">
                                                    <span className="role-assignment-label">Routing Role</span>
                                                    <div className="checkbox-group">
                                                        <input type="checkbox" id={`source-switch-role-${inst.address}`} checked={isSameInstrumentAddress(switchDriverAddress, inst.address)} onChange={(e) => handleSourceSwitchRoleChange(inst, e.target.checked)} disabled={!selectedSessionId || !isConnected || isRemoteViewer || isCollecting} />
                                                        <label htmlFor={`source-switch-role-${inst.address}`}>Sources</label>
                                                    </div>
                                                    <div className="checkbox-group">
                                                        <input type="checkbox" id={`reader-switch-role-${inst.address}`} checked={isSameInstrumentAddress(readerSwitchDriverAddress, inst.address)} onChange={(e) => handleReaderSwitchRoleChange(inst, e.target.checked)} disabled={!selectedSessionId || !isConnected || isRemoteViewer || isCollecting} />
                                                        <label htmlFor={`reader-switch-role-${inst.address}`}>Instruments</label>
                                                    </div>
                                                    {isSameInstrumentAddress(readerSwitchDriverAddress, inst.address) && (
                                                        <div className="reader-switch-options">
                                                            <label className="reader-switch-option">
                                                                <span>Standard path</span>
                                                                <select
                                                                    className="reader-input-select"
                                                                    value={readerSwitchStandardRoute || 'OPEN'}
                                                                    onChange={(event) => updateReaderSwitchOption('reader_switch_standard_route', event.target.value)}
                                                                    disabled={isRemoteViewer || isCollecting}
                                                                    title="Physical relay route wired to the Standard instrument; the Test instrument uses the opposite route"
                                                                    aria-label="Standard instrument relay route"
                                                                >
                                                                    <option value="OPEN">Open / NC</option>
                                                                    <option value="CLOSED">Closed / NO</option>
                                                                </select>
                                                            </label>
                                                            <label className="reader-switch-option">
                                                                <span>Switch delay</span>
                                                                <span className="reader-switch-delay-control">
                                                                    <input
                                                                        className="reader-input-select"
                                                                        type="number"
                                                                        min="0"
                                                                        max="300"
                                                                        step="0.1"
                                                                        value={readerSwitchSettlingTime ?? 1}
                                                                        onChange={(event) => setReaderSwitchSettlingTime(event.target.value)}
                                                                        onBlur={(event) => updateReaderSwitchOption('reader_switch_settling_time', Number(event.target.value) || 0)}
                                                                        disabled={isRemoteViewer || isCollecting}
                                                                        title="Delay after changing instruments before taking the next reading"
                                                                        aria-label="Instrument switch settling delay in seconds"
                                                                    />
                                                                    <span>s</span>
                                                                </span>
                                                            </label>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {isStatusSupported && (
                                        <div className="status-card-body">
                                            {isZeroing ? (
                                                <div className="isp-zeroing-banner" role="status" aria-live="polite">
                                                    <span className="isp-zeroing-banner-title">Zero Calibration in Progress</span>
                                                    <span className="isp-zeroing-banner-sub">This process may take several minutes. Please wait.</span>
                                                </div>
                                            ) : (
                                                <>
                                                    {isFetching && <p className="status-card-body-note">Fetching status details...</p>}
                                                    {status?.decoded && !status.error && (
                                                        <>
                                                            <h4>Active Status Flags</h4>
                                                            <ul className="status-flags-list">
                                                                {Object.entries(status.decoded).filter(([, value]) => value === true).length > 0 ?
                                                                    Object.entries(status.decoded).filter(([, value]) => value === true).map(([key]) => (
                                                                        <li key={key}><span className="status-flag-icon">●</span>{statusBitDescriptions[key] || key}</li>
                                                                    )) : <li className="status-card-body-note">No active status flags.</li>
                                                                }
                                                            </ul>
                                                        </>
                                                    )}
                                                    {status?.error && <p className="status-card-body-note">Could not retrieve status flags.</p>}
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    ) : (
                        <div className="isp-empty-state">
                            <span className="isp-empty-state-title">
                                {isScanning ? 'Scanning for instruments…' : 'No instruments found'}
                            </span>
                            <span className="isp-empty-state-message">
                                {isScanning
                                    ? 'Please wait while the workstation is probed for connected hardware.'
                                    : 'Use the scan icon in the header to discover instruments on this workstation.'}
                            </span>
                        </div>
                    )}
                </div>
            </section>

            {hasAssignedInstruments && (
                <section className="isp-section">
                    <div className="isp-section-heading">
                        <span className="isp-section-eyebrow">Assigned Roles</span>
                        <span className="isp-section-subtitle">Instruments currently bound to this session.</span>
                    </div>
                    <div className="isp-role-summary-grid">
                        {assignedRoleChips.map(chip => (
                            <div key={chip.key} className="isp-role-chip">
                                <span className="isp-role-chip-label">{chip.label}</span>
                                <span className="isp-role-chip-identity">{chip.identity || '—'}</span>
                                <span className="isp-role-chip-address">{chip.address}</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}

export default InstrumentStatusPanel;
