import React, { useState, useMemo } from 'react';

const calculateStats = (data) => {
    if (!data || data.length === 0) {
        return { mean: null, stdDev: null, stdDevPpm: null, count: 0 };
    }
    const stableData = data.filter(p => p.is_stable !== false);
    const stableCount = stableData.length;
    if (stableCount < 2) {
        const mean = stableCount > 0 ? stableData[0].y : null;
        return { mean, stdDev: null, stdDevPpm: null, count: stableCount };
    }
    const values = stableData.map(p => p.y);
    
    // Welford's Algorithm
    let mean = 0;
    let M2 = 0;
    values.forEach((val, index) => {
        const delta = val - mean;
        mean += delta / (index + 1);
        M2 += delta * (val - mean);
    });
    const variance = M2 / (values.length - 1);
    const stdDev = Math.sqrt(variance);
    const stdDevPpm = mean === 0 ? 0 : (stdDev / Math.abs(mean)) * 1e6;
    return { mean, stdDev, stdDevPpm, count: stableCount };
};

const CALIBRATION_TYPES = [
    { key: 'ac_open', label: 'AC Open' },
    { key: 'dc_pos', label: 'DC+' },
    { key: 'dc_neg', label: 'DC-' },
    { key: 'ac_close', label: 'AC Close' }
];

const CHARACTERIZATION_TYPES = [
    { key: 'char_plus1', label: 'Nominal +500ppm' },
    { key: 'char_minus', label: 'Nominal -500ppm' },
    { key: 'char_plus2', label: 'Nominal +500ppm (x2)' }
];

const StatCard = ({ title, stats, unit, isActive }) => (
    <div className={`stat-card ${isActive ? 'active' : ''}`}>
        <h6>{title}</h6>
        <div className="stat-details">
            <div>
                <strong>Count:</strong>
                <span>{stats.count}</span>
            </div>
            {unit === 'V' ? (
                <>
                    <div>
                        <strong>Mean:</strong>
                        <span>{stats.mean !== null ? `${stats.mean.toPrecision(8)} V` : '---'}</span>
                    </div>
                    <div>
                        <strong>Std Dev:</strong>
                        <span>{stats.stdDev !== null ? `${stats.stdDev.toPrecision(4)} V` : '---'}</span>
                    </div>
                </>
            ) : (
                <>
                    <div>
                        <strong>Std Dev:</strong>
                        <span className="stat-value-ppm">{stats.stdDevPpm !== null ? `${stats.stdDevPpm.toFixed(2)} PPM` : '---'}</span>
                    </div>
                    <div>
                        <strong className="reference-mean">Ref Mean:</strong>
                        <span>{stats.mean !== null ? `${stats.mean.toPrecision(8)} V` : '---'}</span>
                    </div>
                </>
            )}
        </div>
    </div>
);

function LiveStabilityTracker({ 
    title, 
    readings, 
    activeStage, 
    activeCycle = null, 
    activeChartView = 'calibration',
    isCollecting = false,
    stabilityWindow = 30,
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [unit, setUnit] = useState('PPM');

    const currentReadingTypes = useMemo(() => {
        return activeChartView === 'characterization' 
            ? CHARACTERIZATION_TYPES 
            : CALIBRATION_TYPES;
    }, [activeChartView]);

    const cycleReadings = useMemo(() => {
        const filtered = {};
        Object.entries(readings || {}).forEach(([stageKey, list]) => {
            if (activeCycle == null) {
                filtered[stageKey] = [];
                return;
            }
            filtered[stageKey] = (list || []).filter((p) => {
                const c = Number.isFinite(p?.cycle) ? Number(p.cycle) : 1;
                return c === activeCycle;
            });
        });
        return filtered;
    }, [readings, activeCycle]);

    const stats = useMemo(() => {
        const calculated = {};
        currentReadingTypes.forEach(({ key }) => {
            const stageReadings = cycleReadings[key] || [];
            const displayedReadings = isCollecting && activeStage === key
                ? stageReadings.slice(-Math.max(2, Number(stabilityWindow) || 30))
                : stageReadings;
            calculated[key] = calculateStats(displayedReadings);
        });
        return calculated;
    }, [
        cycleReadings,
        currentReadingTypes,
        activeStage,
        isCollecting,
        stabilityWindow,
    ]);

    const availableStats = useMemo(() => {
        return currentReadingTypes.filter(({ key }) => stats[key]?.count > 0);
    }, [currentReadingTypes, stats]);

    if (availableStats.length === 0) {
        return null;
    }

    return (
        <div className="accordion-card" style={{ marginTop: '20px' }}>
            <div 
                className="accordion-header" 
                onClick={() => setIsOpen(!isOpen)}
                style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    gap: '16px', 
                    flexWrap: 'nowrap', // Strictly block wrapping below
                    width: '100%'
                }}
            >
                <h4 
                    style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px', 
                        margin: 0, 
                        minWidth: 0, // Essential for allowing flex children to truncate
                        flex: '1 1 auto'
                    }}
                >
                    <span 
                        style={{ 
                            textOverflow: 'ellipsis', 
                            overflow: 'hidden', 
                            whiteSpace: 'nowrap',
                            flexShrink: 1, // Only the title text collapses when squished
                            minWidth: '60px'
                        }} 
                        title={title}
                    >
                        {title}
                    </span>
                    <span 
                        className="accordion-header-cycle"
                        style={{ 
                            whiteSpace: 'nowrap', 
                            flexShrink: 0, // Never shrink the cycle pill
                            display: 'inline-flex',
                            alignItems: 'center'
                        }}
                    >
                        {activeCycle != null ? `Cycle ${activeCycle}` : "No cycle"}
                    </span>
                </h4>
                <div 
                    className="header-controls" 
                    style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '12px', 
                        flexShrink: 0 // Keep controls fully aligned on the right line
                    }}
                >
                    <div className="unit-toggle" onClick={(e) => e.stopPropagation()}>
                        <button title="Show Absolute Units (Volts)" className={unit === 'V' ? 'active' : ''} onClick={() => setUnit('V')}>V</button>
                        <button title="Show Relative Deviation (PPM)" className={unit === 'PPM' ? 'active' : ''} onClick={() => setUnit('PPM')}>PPM</button>
                    </div>
                    <span className={`accordion-icon ${isOpen ? 'open' : ''}`}>▼</span>
                </div>
            </div>
            {isOpen && (
                <div className="accordion-content">
                    <div className="stats-grid">
                        {availableStats.map(({ key, label }) => (
                            <StatCard
                                key={key}
                                title={label}
                                stats={stats[key]}
                                isActive={activeStage === key}
                                unit={unit}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default LiveStabilityTracker;
