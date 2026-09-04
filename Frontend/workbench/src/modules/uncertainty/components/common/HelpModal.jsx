import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { useFloatingWindow } from '../../hooks/useFloatingWindow'; // Import the hook
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBookOpen,
  faChartLine,
  faCheck,
  faChevronLeft,
  faChevronRight,
  faEdit,
  faExchangeAlt,
  faFilePdf,
  faFolderOpen,
  faGripHorizontal,
  faHistory,
  faInfoCircle,
  faList,
  faMicroscope,
  faShieldAlt,
  faStickyNote,
  faTools,
  faPalette,
  faMoon
} from '@fortawesome/free-solid-svg-icons';

// --- Content Definitions (Same as before) ---
const WORKFLOW_STEPS = [
  {
    id: 'session',
    title: '1. Session Configuration',
    icon: faEdit,
    content: (
      <div>
        <h4>Setting up your Analysis</h4>
        <p>Every analysis starts with the <strong>Edit Session</strong> modal.</p>
        <ul>
          <li><strong>Details Tab:</strong> Enter all general information of the analysis session (Analyst Name, Organization, Document ID, etc.). You may also add notes and images here.
            <div className="help-tip">
              <FontAwesomeIcon icon={faCheck} /> Tip: The Analysis Notes here will be automatically updated if you are utlizing the Floating Notepad Tool.
            </div>
          </li>
          <li><strong>Uncertainty Requirements Tab:</strong> Define your risk targets here. Most of these values will not change unless otherwise authorized.
            <ul>
              <li><em>Confidence:</em> Typically 95% (k=2).</li>
              <li><em>Reliability Target:</em> The goal for in-tolerance probability (e.g., 85%).</li>
              <li><em>Calibration Interval:</em> The interval of the calibration standard.</li>
              <li><em>PFA Required:</em> Probability of False Accept limit (e.g., 2%).</li>
            </ul>
          </li>
        </ul>
        <div className="help-tip">
          <FontAwesomeIcon icon={faCheck} /> Tip: These settings drive the Risk Analysis and Guard Band calculations later.
        </div>
      </div>
    )
  },
  {
    id: 'points',
    title: '2. Measurement Points',
    icon: faList,
    content: (
      <div>
        <h4>Adding Measurement Points</h4>
        <p>This is the core of the analysis. You have two types of measurements:</p>
        <h5>Option A: Direct Measurement</h5>
        <p>Use this when the instrument measures the dimension or characteristic of the target directly without calculation (e.g., Using a caliper to measure the length of a UUT; Using a voltmeter to read the voltage of a UUT).</p>

        <h5>Option B: Derived Measurement</h5>
        <p>Use this when the result is calculated via a formula (e.g., Power = Voltage × Current).</p>
        <ul>
          <li><strong>Equation:</strong> Enter the formula (e.g., <code>V * I</code>).</li>
          <li><strong>Mapping:</strong> You must map variables (e.g., "V", "I") to specific TMDEs in the next step.</li>
        </ul>
        <div className="help-note">
          <FontAwesomeIcon icon={faInfoCircle} /> Note:  We add a measurement point before defining the UUT, to ensure if adding UUT from instrument library, tolerances for this given measurement point are automatically populated.
        </div>
      </div>
    )
  },
  {
    id: 'uut',
    title: '3. Define Unit Under Test',
    icon: faMicroscope,
    content: (
      <div>
        <h4>Defining the UUT</h4>
        <p>Click on the add UUT button to set the specifications for the device you are testing.</p>
        <ul>
          <li><strong>Manual Entry:</strong> Type a description and add tolerance components manually (Indicated Value, Floor Value, etc.).</li>
          <li><strong>Library Import:</strong> Click the <FontAwesomeIcon icon={faBookOpen} /> icon to search the database. Selecting an instrument automatically populates the description and tolerance specs.</li>
        </ul>
        <p>If utilizing an instrument from the library import, ensure the imported range tolerance covers your intended measurement points.</p>
        <div className="help-tip">
          <FontAwesomeIcon icon={faCheck} /> Tip: While importing an instrument from the library, you are able to see the tolerance ranges by clicking on the dropdown menu within the function column.
        </div>
      </div>
    )
  },
  {
    id: 'tmde',
    title: '4. Define Test Measurement Equipment Device',
    icon: faTools,
    content: (
      <div>
        <h4>Defining the TMDE</h4>
        <p>For every Test Point, you must add the Equipment (TMDE) used to perform the calibration.</p>
        <ul>
          <li><strong>Standard Assignment:</strong> If using a <em>Direct</em> point, simply add the equipment.</li>
          <li><strong>Variable Mapping:</strong> If using a <em>Derived</em> point, you will see a "Variable Type" dropdown.
            <br /><em>Example:</em> If your equation is <code>V / R</code>, add a Voltmeter and map it to <strong>V</strong>, then add a Resistor and map it to <strong>R</strong>.
          </li>
        </ul>
        <p>Like the UUT, you can import TMDE specs from the Library <FontAwesomeIcon icon={faBookOpen} /> or enter them manually.</p>
        <ul>
          <div className="help-tip">
            <FontAwesomeIcon icon={faCheck} /> Tip: Utilize the "Use TMDEs from previous measurement point" toggle button when adding subsequent measurement points from the initial to automatically set TMDE information. This includes updated tolerances if new measurement point falls within a new tolerance range.
          </div>
        </ul>
      </div>
    )
  },
  {
    id: 'risk',
    title: '5. Budget & Risk Analysis',
    icon: faChartLine,
    content: (
      <div>
        <h4>Reading the Uncertainty Budget</h4>
        <p>The budget table lists every factor contributing to measurement uncertainty.</p>
        <ul>
          <li><strong>Uncertainty Component:</strong> Individual error sources (e.g., TMDE specs, resolution).</li>
          <li><strong>Source / Nominal:</strong> Referenced measurement point.</li>
          <li><strong>Type:</strong> The distribution type, or statistical shape of the error (e.g., Normal, Rectangular).</li>
          <li><strong>Sensitivity Coefficient:</strong> For derived measurements, this shows how much a specific parameter affects the final result.
            <ul><div className="help-tip">
              <FontAwesomeIcon icon={faCheck} /> <strong> Tip:</strong> Click on the calculator icon next to the Derived component to get a detailed breakdown of how the sensitivity coefficients are calculated.
            </div></ul>
          </li>

          <li><strong>Combined Uncertainty:</strong> The uncertainty value before expanded by given k-value.</li>
          <li><strong>Expanded Uncertainty:</strong> The final "plus-or-minus" uncertainty value after expaned with given K-value (e.g. @ 95% Uncertainty Confidence, K=2)</li>
        </ul>

        <h4>Show Contribution Toggle Button</h4>
        <p>Clicking the Show Contribution toggle button will display a bar graph of the indiviual contributions of uncertainty. This is useful for visualizing each uncertainties influence. </p>

        <h4>Show Guardband Toggle Button</h4>
        <p>Clicking the Show Contribution toggle button will display updated risk metrics while utilizing Guard Banding</p>

        <h4>Risk Metrics Dashboard</h4>
        <p>Located at the bottom of the Uncertainty Budget Table, these metrics evaluate the decision risk:</p>
        <div className="def-list">
          <div><strong>PFA (Probability of False Accept):</strong> The likelihood that a bad unit appears good due to measurement error.</div>
          <div><strong>PFR (Probability of False Reject):</strong> The likelihood that a good unit appears bad.</div>
          <div><strong>TUR (Test Uncertainty Ratio):</strong> Ratio of UUT tolerance to Calibration Uncertainty. Aim for 4:1.</div>
          <div><strong>TAR (Test Acceptance Ratio):</strong> Ratio of the UUT's tolerance span to the TMDE's (Standard's) tolerance span.</div>
        </div>

        <div className="help-tip">
          <FontAwesomeIcon icon={faCheck} /> <strong> Tip:</strong> Click any colored risk metric pod (like PFA) in the table  to view detailed breakdown of the calculation.
        </div>

      </div>


    )
  },
  {
    id: 'mitigation',
    title: '6. Risk Mitigation',
    icon: faShieldAlt,
    content: (
      <div>
        <h4>Guard Banding</h4>
        <p>If your PFA is too high (e.g., greater than 2%), use this tab to calculate Guard Bands.</p>
        <ul>
          <li><strong>Guard Banding:</strong> Artificially tightening the acceptance limits to reduce risk.</li>
          <li><strong>Dashboard:</strong> Shows the "GB Limit Low" and "GB Limit High". These are the new limits you should use to guarantee your PFA requirement is met.</li>
        </ul>
      </div>
    )
  }
];

const TOOLS_INFO = [
  {
    icon: faList,
    title: "Instrument Overview",
    desc: "Menu displaying full analysis session overview. Includes UUT/TMDE information for all measurement points, including all risk metrics calculated. "
  },
  {
    icon: faExchangeAlt,
    title: "Unit Converter",
    desc: "Convert between units across categories (Voltage, Pressure, Torque, etc.)."
  },
  {
    icon: faHistory,
    title: "Reverse Traceability",
    desc: "Analyze calibration intervals and instrument drift. Calculates Linear vs. Exponential failure dates based on historical OOT data."
  },
  {
    icon: faTools,
    title: "Instrument Builder",
    desc: "Create and save custom instruments to your local library for quick reuse in future sessions."
  },
  {
    icon: faStickyNote,
    title: "Floating Notepad",
    desc: "A scratchpad for quick notes. Content persists during your current session. You will see that this automatically updates within the notes input of the Edit Session modal and vice versa."
  },
  {
    icon: faFilePdf,
    title: "PDF Export",
    desc: "Generates a formatted compliance report containing all data, risk charts, and guard band recommendations. This contains all necessary meta data for the Import PDF tool to populate session data."
  },
  {
    icon: faFolderOpen,
    title: "Import PDF",
    desc: "Import any PDF generated with the built-in PDF Export Tool to populate session data."
  },
  {
    icon: faPalette,
    title: "Theme Selector",
    desc: "Customize the application appearence with a variety of pre-set themes, including Cyberpunk and Orbital Command."
  },
  {
    icon: faMoon,
    title: "Dark/Light Mode",
    desc: "Toggle between light and dark modes for any selected theme to suit your viewing preference."
  }
];

const HelpModal = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState('workflow'); // 'workflow' or 'tools'
  const [currentStep, setCurrentStep] = useState(0);

  // --- Floating Window Hook ---
  const { position, handleMouseDown } = useFloatingWindow({
    isOpen,
    defaultWidth: 900,
    defaultHeight: 700
  });

  if (!isOpen) return null;

  const handleNext = () => {
    if (currentStep < WORKFLOW_STEPS.length - 1) setCurrentStep(prev => prev + 1);
  };

  const handlePrev = () => {
    if (currentStep > 0) setCurrentStep(prev => prev - 1);
  };

  // Render via Portal to document.body (like other modals)
  return ReactDOM.createPortal(
    <>
      <div
        className="help-modal floating-window-content"
        style={{
          // Position managed by the hook
          position: 'fixed',
          top: position.y,
          left: position.x,
          width: '900px',
          height: '700px',
          maxWidth: '95vw',
          maxHeight: '90vh',
          zIndex: 3000, // Higher than standard modals
          margin: 0
        }}
      >
        {/* Header - Draggable Target */}
        <div
          className="help-header"
          onMouseDown={handleMouseDown}
          style={{ cursor: 'move', userSelect: 'none' }}
        >
          <h3><FontAwesomeIcon icon={faInfoCircle} /> Uncertalytics Guide</h3>
          <button onClick={onClose} className="modal-close-button">&times;</button>
        </div>

        {/* Layout: Sidebar + Content */}
        <div className="help-body">

          {/* Sidebar Navigation */}
          <div className="help-sidebar">
            <button
              className={`sidebar-btn ${activeTab === 'workflow' ? 'active' : ''}`}
              onClick={() => setActiveTab('workflow')}
            >
              <FontAwesomeIcon icon={faList} /> Workflow Guide
            </button>
            <button
              className={`sidebar-btn ${activeTab === 'tools' ? 'active' : ''}`}
              onClick={() => setActiveTab('tools')}
            >
              <FontAwesomeIcon icon={faGripHorizontal} /> Tool Reference
            </button>

            {activeTab === 'workflow' && (
              <div className="step-list">
                {WORKFLOW_STEPS.map((step, index) => (
                  <div
                    key={step.id}
                    className={`step-item ${index === currentStep ? 'active-step' : ''} ${index < currentStep ? 'completed-step' : ''}`}
                    onClick={() => setCurrentStep(index)}
                  >
                    <span className="step-num">{index + 1}</span>
                    <span className="step-title">{step.title.replace(/^\d+\.\s/, '')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Main Content Area */}
          <div className="help-content">

            {activeTab === 'workflow' && (
              <div className="workflow-view">
                <div className="workflow-header">
                  <h2>{WORKFLOW_STEPS[currentStep].title}</h2>
                  <FontAwesomeIcon icon={WORKFLOW_STEPS[currentStep].icon} className="step-big-icon" />
                </div>

                <div className="workflow-text">
                  {WORKFLOW_STEPS[currentStep].content}
                </div>

                <div className="workflow-nav">
                  <button
                    className="nav-btn"
                    disabled={currentStep === 0}
                    onClick={handlePrev}
                  >
                    <FontAwesomeIcon icon={faChevronLeft} /> Previous
                  </button>
                  <div className="step-indicator">
                    Step {currentStep + 1} of {WORKFLOW_STEPS.length}
                  </div>
                  <button
                    className="nav-btn primary"

                    onClick={currentStep === WORKFLOW_STEPS.length - 1 ? onClose : handleNext}
                  >
                    {currentStep === WORKFLOW_STEPS.length - 1 ? (
                      <>Done <FontAwesomeIcon icon={faCheck} /></>
                    ) : (
                      <>Next <FontAwesomeIcon icon={faChevronRight} /></>
                    )}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'tools' && (
              <div className="tools-view">
                <h2>Toolbox Reference</h2>
                <div className="tools-grid">
                  {TOOLS_INFO.map((tool, idx) => (
                    <div key={idx} className="tool-card">
                      <div className="tool-icon">
                        <FontAwesomeIcon icon={tool.icon} />
                      </div>
                      <div className="tool-details">
                        <h5>{tool.title}</h5>
                        <p>{tool.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
};

export default HelpModal;
