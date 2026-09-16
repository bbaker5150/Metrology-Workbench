import GrowingNumericInput from "../common/GrowingNumericInput";
import React, { useState, useEffect, useRef, useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { 
  faTimes, 
  faMinus, 
  faHistory, 
  faCalendarAlt, 
  faExclamationTriangle,
  faCheckCircle,
  faChartLine,
  faList,
  faCalculator
} from "@fortawesome/free-solid-svg-icons";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend
} from "recharts";

const ReverseTraceabilityTool = ({ isOpen, onClose }) => {
  // --- Window State ---
  const [position, setPosition] = useState({ x: 50, y: 150 });
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [activeTab, setActiveTab] = useState("results");
  const nodeRef = useRef(null);

  // --- Analysis State ---
  const [initialValue, setInitialValue] = useState("");
  const [limitValue, setLimitValue] = useState("");
  const [ootValue, setOotValue] = useState("");
  
  const [startDate, setStartDate] = useState(""); 
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]); 
  const [stdInterval, setStdInterval] = useState("12"); 
  const [evalMode, setEvalMode] = useState("std");

  const DAYS_PER_MONTH = 365 / 12;

  // --- Drag Logic ---
  const handleMouseDown = (e) => {
    if (e.target.closest('input') || e.target.closest('button') || e.target.closest('.recharts-responsive-container') || e.target.closest('select')) return;
    setIsDragging(true);
    const rect = nodeRef.current.getBoundingClientRect();
    setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isDragging) {
        setPosition({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
      }
    };
    const handleMouseUp = () => setIsDragging(false);
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // --- Calculation Engine ---
  const analysis = useMemo(() => {
    const vInit = parseFloat(initialValue);
    const vLimit = parseFloat(limitValue);
    const vOot = parseFloat(ootValue);
    const vStdIntervalMonths = parseFloat(stdInterval);
    
    if (isNaN(vInit) || isNaN(vOot) || isNaN(vLimit) || !startDate || !endDate) {
      return null;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const totalTimeMs = end - start;
    const totalDays = totalTimeMs / (1000 * 60 * 60 * 24);
    
    if (totalDays <= 0) return { error: "End date must be after start date." };

    const actualMonths = totalDays / DAYS_PER_MONTH;
    const basisMonths = evalMode === 'std' ? vStdIntervalMonths : actualMonths;

    const totalDriftMagnitude = Math.abs(vOot - vInit);
    const allowedDriftMagnitude = Math.abs(vLimit - vInit);
    const isOut = totalDriftMagnitude > allowedDriftMagnitude;

    let linearRatio = 1;
    if (totalDriftMagnitude !== 0) {
        linearRatio = allowedDriftMagnitude / totalDriftMagnitude;
    }
    
    const linearFailMonths = basisMonths * linearRatio;
    const linearFailDays = linearFailMonths * DAYS_PER_MONTH;
    const linearFailTimeMs = linearFailDays * 24 * 60 * 60 * 1000;
    const linearFailDate = new Date(start.getTime() + linearFailTimeMs);

    let expRatio = 1;
    let expFailMonths = 0;

    if (totalDriftMagnitude !== 0) {
        try {
            const numerator = vLimit - vOot;
            const denominator = vInit - vOot;
            const logArg = numerator / denominator;
            
            if (logArg > 0) {
                 const x_fail = -Math.log(logArg); 
                 expRatio = x_fail / 5;
            } else {
                expRatio = isOut ? 0 : 2;
            }
        } catch (e) {
            console.warn("Exponential calculation error", e);
        }
    }
    
    expFailMonths = basisMonths * expRatio;
    const expFailDays = expFailMonths * DAYS_PER_MONTH;
    const expFailTimeMs = expFailDays * 24 * 60 * 60 * 1000;
    const expFailDate = new Date(start.getTime() + expFailTimeMs);

    const chartData = [];
    const steps = 20; 
    for (let i = 0; i <= steps; i++) {
        const timeRatio = i / steps; 
        
        // Convert back to date for X-axis (relative to Start)
        const currentMonths = basisMonths * timeRatio;
        const currentMs = currentMonths * DAYS_PER_MONTH * 24 * 60 * 60 * 1000;
        const currentDate = new Date(start.getTime() + currentMs).toISOString().split('T')[0];
        
        const linearY = vInit + (vOot - vInit) * timeRatio;
        const expY = vInit + (vOot - vInit) * (1 - Math.exp(-5 * timeRatio));

        chartData.push({
            date: currentDate,
            Linear: parseFloat(linearY.toFixed(6)),
            Exponential: parseFloat(expY.toFixed(6)),
            Limit: vLimit
        });
    }

    const conservativeFailMs = Math.min(linearFailTimeMs, expFailTimeMs);
    const stdIntervalMs = vStdIntervalMonths * DAYS_PER_MONTH * 24 * 60 * 60 * 1000;
    const intervalHealth = (conservativeFailMs / stdIntervalMs) * 100;
    
    let recommendation = "Maintain Interval";
    let statusColor = "var(--status-good)";

    if (isOut) {
        if (intervalHealth < 50) {
            recommendation = "CRITICAL: Reduce Interval by 50%+";
            statusColor = "var(--status-bad)";
        } else if (intervalHealth < 85) {
            recommendation = "WARNING: Reduce Interval";
            statusColor = "var(--status-warning)";
        }
    } else {
        recommendation = "Device In Tolerance";
    }

    return {
      linearDate: linearFailDate,
      expDate: expFailDate,
      linMonthsToFail: linearFailMonths.toFixed(2),
      expMonthsToFail: expFailMonths.toFixed(2),
      percentReliable: (linearRatio * 100).toFixed(1),
      intervalHealth: intervalHealth.toFixed(0),
      recommendation,
      statusColor,
      isOut,
      chartData,
      actualMonths: actualMonths.toFixed(2)
    };
  }, [initialValue, ootValue, limitValue, startDate, endDate, stdInterval, evalMode]);


  if (!isOpen) return null;

  // --- Minimized View ---
  if (isMinimized) {
    return (
      <div 
        className="floating-tool-min"
        style={{ left: position.x, top: position.y }}
        onMouseDown={handleMouseDown}
        ref={nodeRef}
      >
        <FontAwesomeIcon icon={faHistory} style={{ color: 'var(--primary-color)' }} />
        <span>Traceability</span>
        <div className="tool-controls">
          <button onClick={() => setIsMinimized(false)}><FontAwesomeIcon icon={faCalendarAlt} /></button>
          <button onClick={onClose}><FontAwesomeIcon icon={faTimes} /></button>
        </div>
      </div>
    );
  }

  // --- Styles ---
  const containerStyle = {
    left: position.x, 
    top: position.y, 
    width: '440px',
    zIndex: 2005,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden', 
    maxHeight: '90vh'
  };

  const contentAreaStyle = {
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
    overflowY: 'auto',
    overflowX: 'hidden'
  };

  const labelStyle = { 
    fontSize: '0.7rem', 
    fontWeight: '700', 
    color: 'var(--text-color-muted)', 
    textTransform: 'uppercase', 
    marginBottom: '4px',
    letterSpacing: '0.5px'
  };

  const inputStyle = { 
    width: '100%', 
    padding: '8px 10px', 
    fontSize: '0.9rem', 
    fontFamily: 'var(--main-font)',
    borderRadius: '6px', 
    border: '1px solid var(--border-color)', 
    backgroundColor: 'var(--input-background)', 
    color: 'var(--text-color)',
    transition: 'border-color 0.2s',
    outline: 'none'
  };

  const tabButtonStyle = (isActive) => ({
    flex: 1, 
    padding: '10px', 
    background: 'transparent', 
    border: 'none', 
    color: isActive ? 'var(--primary-color)' : 'var(--text-color-muted)',
    borderBottom: isActive ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
    fontWeight: '600', 
    fontSize: '0.85rem',
    cursor: 'pointer', 
    transition: 'all 0.2s'
  });

  return (
    <div className="floating-tool" style={containerStyle} ref={nodeRef}>
      {/* Header */}
      <div className="tool-header" onMouseDown={handleMouseDown}>
        <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
            <FontAwesomeIcon icon={faHistory} style={{ color: 'var(--primary-color)' }} />
            <span>Reverse Traceability</span>
        </div>
        <div className="tool-controls">
          <button onClick={() => setIsMinimized(true)}><FontAwesomeIcon icon={faMinus} /></button>
          <button onClick={onClose}><FontAwesomeIcon icon={faTimes} /></button>
        </div>
      </div>

      <div style={contentAreaStyle}>
        
        {/* --- Top Inputs: Value Grid --- */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr 1fr', 
          gap: '12px',
          backgroundColor: 'var(--background-color)',
          padding: '15px',
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}>
            <div>
                <div style={labelStyle}>Initial</div>
                <GrowingNumericInput
                    type="number" step="any" placeholder="0.00"
                    value={initialValue} onChange={e => setInitialValue(e.target.value)}
                    style={inputStyle}
                />
            </div>
            <div>
                <div style={labelStyle}>Limit (Tol)</div>
                <GrowingNumericInput
                    type="number" step="any" placeholder="±"
                    value={limitValue} onChange={e => setLimitValue(e.target.value)}
                    style={inputStyle}
                />
            </div>
            <div>
                <div style={labelStyle}>OOT Value</div>
                <GrowingNumericInput
                    type="number" step="any" placeholder="found"
                    value={ootValue} onChange={e => setOotValue(e.target.value)}
                    style={{ 
                        ...inputStyle, 
                        borderColor: analysis?.isOut ? 'var(--status-bad)' : 'var(--border-color)',
                        color: analysis?.isOut ? 'var(--status-bad)' : 'var(--text-color)' 
                    }}
                />
            </div>
        </div>

        {/* --- Middle Inputs: Time Grid --- */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
                <div style={labelStyle}>Previous Cal</div>
                <input 
                    type="date" 
                    value={startDate} onChange={e => setStartDate(e.target.value)}
                    style={{...inputStyle, fontSize: '0.8rem'}}
                />
            </div>
            <div>
                <div style={labelStyle}>OOT Date</div>
                <input 
                    type="date" 
                    value={endDate} onChange={e => setEndDate(e.target.value)}
                    style={{...inputStyle, fontSize: '0.8rem'}}
                />
            </div>
            <div>
                <div style={labelStyle}>Interval (Mos)</div>
                <GrowingNumericInput
                    type="number" 
                    value={stdInterval} onChange={e => setStdInterval(e.target.value)}
                    placeholder="12"
                    style={inputStyle}
                />
            </div>
            <div>
                <div style={labelStyle}>Basis</div>
                <select 
                    value={evalMode} 
                    onChange={e => setEvalMode(e.target.value)}
                    style={{...inputStyle, cursor: 'pointer', appearance: 'none'}}
                >
                    <option value="std">Standard Interval</option>
                    <option value="actual">Actual Elapsed</option>
                </select>
            </div>
        </div>
        
        {/* --- Navigation Tabs --- */}
        <div style={{display:'flex', marginTop: '5px'}}>
            <button 
                onClick={() => setActiveTab("results")}
                style={tabButtonStyle(activeTab === "results")}
            >
                <FontAwesomeIcon icon={faList} style={{marginRight:'6px'}}/> Analysis
            </button>
            <button 
                onClick={() => setActiveTab("graph")}
                style={tabButtonStyle(activeTab === "graph")}
            >
                <FontAwesomeIcon icon={faChartLine} style={{marginRight:'6px'}}/> Projection
            </button>
        </div>

        {/* --- Tab Content --- */}
        <div style={{ minHeight: '300px' }}>
            
            {/* RESULTS TAB */}
            {activeTab === "results" && (
                <div style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: '12px',
                    marginTop: '15px',
                    animation: 'fadeIn 0.2s ease-in'
                }}>
                    {!analysis ? (
                        <div style={{ 
                            padding: '30px', 
                            textAlign: 'center', 
                            color: 'var(--text-color-muted)', 
                            border: '1px dashed var(--border-color)',
                            borderRadius: '8px',
                            marginTop: '10px'
                        }}>
                            <FontAwesomeIcon icon={faCalculator} style={{fontSize: '1.5rem', marginBottom: '10px', opacity: 0.5}} />
                            <div>Enter values to calculate drift analysis.</div>
                        </div>
                    ) : analysis.error ? (
                        <div style={{ padding: '15px', color: 'var(--status-bad)', textAlign: 'center', backgroundColor: 'var(--status-bad-bg)', borderRadius: '6px' }}>
                            {analysis.error}
                        </div>
                    ) : (
                        <>
                            {/* Summary Card */}
                            <div style={{ 
                                padding: '15px', 
                                borderRadius: '8px', 
                                backgroundColor: 'var(--input-background)',
                                borderLeft: `4px solid ${analysis.statusColor}`,
                                border: '1px solid var(--border-color)',
                                borderLeftWidth: '4px',
                                borderLeftColor: analysis.statusColor
                            }}>
                                <div style={{ 
                                    fontSize: '0.75rem', 
                                    fontWeight: '700', 
                                    color: 'var(--text-color-muted)', 
                                    textTransform: 'uppercase', 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '8px',
                                    marginBottom: '5px'
                                }}>
                                    <FontAwesomeIcon icon={analysis.isOut ? faExclamationTriangle : faCheckCircle} style={{ color: analysis.statusColor }} />
                                    Recommendation
                                </div>
                                <div style={{ fontWeight: '700', fontSize: '1.1rem', color: analysis.statusColor }}>
                                    {analysis.recommendation}
                                </div>
                                {analysis.isOut && (
                                     <div style={{ fontSize: '0.85rem', marginTop: '5px', color: 'var(--text-color)', opacity: 0.8 }}>
                                        Reliability dropped to <strong>{analysis.intervalHealth}%</strong> of interval.
                                     </div>
                                )}
                            </div>

                            {/* Data Points Grid */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <div style={{ 
                                    backgroundColor: 'var(--background-color)', 
                                    padding: '10px', 
                                    borderRadius: '6px',
                                    border: '1px solid var(--seal-background-color-derived)' 
                                }}>
                                    <span style={{display: 'block', fontSize: '0.7rem', color: 'var(--seal-background-color-derived)', fontWeight: '700', marginBottom: '4px'}}>LINEAR FAIL</span>
                                    <div style={{fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-color)'}}>
                                        {analysis.linearDate?.toISOString().split('T')[0]}
                                    </div>
                                    <div style={{fontSize: '0.75rem', color: 'var(--text-color-muted)'}}>
                                        {analysis.linMonthsToFail} months
                                    </div>
                                </div>
                                
                                <div style={{ 
                                    backgroundColor: 'var(--background-color)', 
                                    padding: '10px', 
                                    borderRadius: '6px',
                                    border: '1px solid #f59e0b',
                                    position: 'relative',
                                    overflow: 'hidden'
                                }}>
                                    <div style={{position:'absolute', top:0, right:0, width:'0', height:'0', borderStyle:'solid', borderWidth:'0 25px 25px 0', borderColor: 'transparent #f59e0b transparent transparent', opacity: 0.2}}></div>
                                    <span style={{display: 'block', fontSize: '0.7rem', color: '#f59e0b', fontWeight: '700', marginBottom: '4px'}}>EXPONENTIAL FAIL</span>
                                    <div style={{fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-color)'}}>
                                        {analysis.expDate?.toISOString().split('T')[0]}
                                    </div>
                                    <div style={{fontSize: '0.75rem', color: '#f59e0b'}}>
                                        {analysis.expMonthsToFail} months
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* GRAPH TAB */}
            {activeTab === "graph" && (
                 <div style={{ 
                    height: '280px', 
                    width: '100%', 
                    marginTop: '15px',
                    fontSize: '0.75rem',
                    backgroundColor: 'var(--background-color)',
                    borderRadius: '8px',
                    padding: '10px',
                    border: '1px solid var(--border-color)',
                    boxSizing: 'border-box'
                }}>
                    {!analysis ? (
                        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-color-muted)' }}>
                            Enter data to view graph.
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={analysis.chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                                <XAxis dataKey="date" hide={true} />
                                <YAxis domain={['auto', 'auto']} style={{ fontSize: '0.7rem' }} tick={{fill: 'var(--text-color-muted)'}} stroke="var(--border-color)" />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: 'var(--content-background)', borderColor: 'var(--border-color)', color: 'var(--text-color)', borderRadius: '6px', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}
                                    itemStyle={{ fontSize: '0.8rem', padding: 0 }}
                                    labelStyle={{ fontSize: '0.7rem', color: 'var(--text-color-muted)', marginBottom: '4px' }}
                                />
                                <Legend wrapperStyle={{ fontSize: '0.7rem', paddingTop: '10px' }}/>
                                
                                {/* Linear: Purple (Derived/Standard Calculation) */}
                                <Line 
                                    type="monotone" 
                                    name="Linear Fail" 
                                    dataKey="Linear" 
                                    stroke="var(--seal-background-color-derived)" 
                                    strokeWidth={2} 
                                    dot={false} 
                                    isAnimationActive={false} 
                                />
                                {/* Exponential: Orange (Caution/Accelerated) */}
                                <Line 
                                    type="monotone" 
                                    name="Exponential Fail" 
                                    dataKey="Exponential" 
                                    stroke="#f59e0b" 
                                    strokeWidth={2} 
                                    dot={false} 
                                    isAnimationActive={false} 
                                />
                                <ReferenceLine y={analysis.chartData[0]?.Limit} label={{ value: 'Tol', fill: 'var(--status-bad)', fontSize: '0.7rem' }} stroke="var(--status-bad)" strokeDasharray="3 3" />
                            </LineChart>
                        </ResponsiveContainer>
                    )}
                </div>
            )}
        </div>

      </div>
    </div>
  );
};

export default ReverseTraceabilityTool;