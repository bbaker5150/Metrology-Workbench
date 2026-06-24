/**
 * src/utils/instrumentFactory.js
 * * Standardizes the creation of Instrument Instances and Specifications.
 * * SINGLE SOURCE OF TRUTH:
 * - createInstanceFromDefinition: For TMDEs (Standards) -> Returns full Instance
 * - standardizeRangeSpecs: For UUTs (Ranges) -> Returns flattened Specs
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Core Helper: Flattens specifications from nested objects to root level.
 * Handles: { tolerances: { reading: x } } -> { reading: x }
 * This ensures the Math Engine always sees a consistent "Flat" structure.
 */
const flattenSpecs = (range, unitFn) => {
    // 1. Identify where specs are hiding (Legacy vs Modern)
    const rawSpecs = range.tolerances || range.tolerance || {};

    // 2. Construct the flat object
    return {
        // Core Range Props
        min: range.min,
        max: range.max,
        unit: unitFn || range.unit || "",

        // Resolution can be at root (legacy) or inside specs (modern). Carry the
        // unit and the budget opt-in flag too, so the uncertainty budget can
        // include the measuring-resolution component for this instance (the
        // budget readers fall back across `resolution`/`measuringResolution`).
        resolution: range.resolution ?? rawSpecs.resolution,
        resolutionUnit: range.resolutionUnit ?? rawSpecs.resolutionUnit,
        includeResolutionInBudget:
            range.includeResolutionInBudget ?? rawSpecs.includeResolutionInBudget,
        measuringResolution: range.measuringResolution ?? rawSpecs.measuringResolution,
        measuringResolutionUnit:
            range.measuringResolutionUnit ?? rawSpecs.measuringResolutionUnit,
        measuringResolutionDistribution:
            range.measuringResolutionDistribution ??
            rawSpecs.measuringResolutionDistribution,

        // Single-value (point) range: preserve the flag/value so a point-style
        // range (e.g. a 30 kg weight) round-trips through the instance.
        ...(range.isSingleValue
            ? { isSingleValue: true, value: range.value }
            : {}),

        // Spread the nested specs (reading, floor, range, etc.) to the root
        ...rawSpecs
    };
};

/**
 * Creates a standardized Instrument Instance (for TMDEs).
 * Used when adding a TMDE to the session or budget.
 */
export const createInstanceFromDefinition = (masterDef, options = {}) => {
    const {
        existingId = null,      // Preserve ID if editing
        quantity = 1,
        assetId = "",
        userFunctionName = "",  // The function name user selected
        userRangeIndex = 0,     // The range index user selected
        userMeasurement = null, // Preserved reading { value, unit }
        userVariable = ""       // Preserved variable mapping
    } = options;

    // Handle wrapped vs raw definitions
    const instrument = masterDef.instrument || masterDef;

    // 1. Resolve Active Function
    let activeFunction = null;
    let functionName = "";

    if (instrument.functions && instrument.functions.length > 0) {
        // Try to match by name
        if (userFunctionName) {
            activeFunction = instrument.functions.find(f => f.name === userFunctionName);
        }
        // Fallback to first function
        if (!activeFunction) {
            activeFunction = instrument.functions[0];
        }
        functionName = activeFunction.name;
    }

    // 2. Resolve Active Range
    let rangeIndex = userRangeIndex;
    const ranges = activeFunction ? (activeFunction.ranges || []) : (instrument.ranges || []);
    
    // Safety: Bounds check
    if (!ranges[rangeIndex]) {
        rangeIndex = 0;
    }
    const activeRange = ranges[rangeIndex] || {};

    // 3. FLATTEN SPECS (The Core Fix)
    const unitFn = activeFunction?.unit;
    const flattenedSpecs = flattenSpecs(activeRange, unitFn);

    // 4. Construct Final Instance
    return {
        // --- IDENTITY ---
        id: existingId || uuidv4(),      
        definitionId: masterDef.id,      
        sourceId: masterDef.id,          
        
        // --- META DATA ---
        name: masterDef.name || masterDef.description || instrument.description,
        assetId: assetId || masterDef.assetId || "",
        
        // --- CONFIGURATION ---
        quantity: quantity,
        variableType: userVariable,
        functionName: functionName,      
        _index: rangeIndex,              
        
        // --- MEASUREMENT ---
        measurementPoint: userMeasurement || { 
            value: "", 
            unit: flattenedSpecs.unit 
        },
        
        // --- SPECS (FLATTENED) ---
        ...flattenedSpecs,

        // --- REFERENCE ---
        instrument: instrument 
    };
};

/**
 * Standardizes a raw Range object (for UUTs).
 * Used when clicking a Sidebar Item or changing a Dropdown.
 * Ensures UUT specs are flattened before saving to the Test Point.
 */
export const standardizeRangeSpecs = (range, functionName = null, functionUnit = null) => {
    if (!range) return {};
    
    // Flatten the specs using the same logic as TMDEs
    const flattened = flattenSpecs(range, functionUnit);
    
    // Attach function context if provided (crucial for UUT identification)
    if (functionName) {
        flattened.functionName = functionName;
    }
    
    return flattened;
};