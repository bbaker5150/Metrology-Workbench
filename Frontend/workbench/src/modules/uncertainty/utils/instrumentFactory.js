/**
 * src/utils/instrumentFactory.js
 * * Standardizes the creation of Instrument Instances and Specifications.
 * * SINGLE SOURCE OF TRUTH:
 * - createInstanceFromDefinition: For TMDEs (Standards) -> Returns full Instance
 * - standardizeRangeSpecs: For UUTs (Ranges) -> Returns flattened Specs
 */

import { v4 as uuidv4 } from 'uuid';
import {
    flattenRangeSpecs,
    resolveInstrumentSelection,
} from './instrumentFunctionSelection';

/**
 * Creates a standardized Instrument Instance (for TMDEs).
 * Used when adding a TMDE to the session or budget.
 */
export const createInstanceFromDefinition = (masterDef, options = {}) => {
    const {
        existingId = null,      // Preserve ID if editing
        quantity = 1,
        assetId = "",
        userFunctionId = "",
        userFunctionName = "",  // The function name user selected
        userRangeId = "",
        userRangeIndex = 0,     // The range index user selected
        userMeasurement = null, // Preserved reading { value, unit }
        userVariable = ""       // Preserved variable mapping
    } = options;

    const selection = resolveInstrumentSelection(masterDef, {
        userFunctionId,
        userFunctionName,
        userRangeId,
        userRangeIndex,
    });
    const { instrument, functionId, functionName, functionUnit, rangeId, rangeIndex } = selection;
    const flattenedSpecs = selection.specs;

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
        functionId: functionId,
        functionName: functionName,      
        functionUnit: functionUnit,
        rangeId: rangeId,
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
    return flattenRangeSpecs(range, functionUnit, {
        functionId: range.functionId,
        functionName: functionName || range.functionName,
        functionUnit: functionUnit || range.functionUnit,
        rangeIndex: range._index,
    });
};
