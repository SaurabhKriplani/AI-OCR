import { useState, useRef } from "react";
import "./App.css";

// Formatted metadata for entity types
const ENTITY_CONFIG = {
  product_name: {
    label: "Product Name",
    icon: "📦",
    category: "Identity"
  },
  manufacturer: {
    label: "Manufacturer",
    icon: "🏭",
    category: "Company"
  },
  address: {
    label: "Registered Address",
    icon: "📍",
    category: "Company"
  },
  net_quantity: {
    label: "Net Quantity",
    icon: "⚖️",
    category: "Specification"
  },
  mrp: {
    label: "Maximum Retail Price (MRP)",
    icon: "🏷️",
    category: "Commercial"
  },
  manufacturing_date: {
    label: "Mfg. Date",
    icon: "📅",
    category: "Lifecycle"
  },
  best_before: {
    label: "Best Before / Expiry",
    icon: "⏳",
    category: "Lifecycle"
  },
  customer_care: {
    label: "Customer Support",
    icon: "📞",
    category: "Compliance"
  },
  country_of_origin: {
    label: "Country of Origin",
    icon: "🌐",
    category: "Compliance"
  }
};

// Sample demo preset for testing UI visualization
const SAMPLE_PRESET = {
  filename: "sample_packaged_label.jpg",
  raw_text: `MAGGI 2-MINUTE NOODLES\nMFD BY: NESTLE INDIA LIMITED\nREGD. OFFICE: 100/101 WORLD TRADE CENTRE, BARAKHAMBA LANE, NEW DELHI 110001\nNET QTY: 70g\nMRP Rs. 14.00 (INCL OF ALL TAXES)\nMFD: 10/2024\nBEST BEFORE 9 MONTHS FROM MANUFACTURE\nCUSTOMER CARE: 1800 103 1947\nwecare@in.nestle.com\nCOUNTRY OF ORIGIN: INDIA`,
  cleaned_text: `MAGGI 2-MINUTE NOODLES\nMFD BY: NESTLE INDIA LIMITED\nREGD. OFFICE: 100/101 WORLD TRADE CENTRE, BARAKHAMBA LANE, NEW DELHI 110001\nNET QTY: 70 g\nMRP INR 14.00 (INCL OF ALL TAXES)\nMFD: 10/2024\nBEST BEFORE 9 MONTHS FROM MANUFACTURE\nCUSTOMER CARE: 1800 103 1947 wecare@in.nestle.com\nCOUNTRY OF ORIGIN: INDIA`,
  entities: {
    product_name: { status: "PRESENT", value: "MAGGI 2-Minute Noodles" },
    manufacturer: { status: "PRESENT", value: "Nestle India Limited" },
    address: { status: "PRESENT", value: "100/101 World Trade Centre, Barakhamba Lane, New Delhi 110001" },
    net_quantity: { status: "PRESENT", value: "70", unit: "g" },
    mrp: { status: "PRESENT", value: "14.00", currency: "INR" },
    manufacturing_date: { status: "PRESENT", value: "10/2024" },
    best_before: { status: "PRESENT", value: "9 Months from manufacture" },
    customer_care: { status: "PRESENT", value: "1800 103 1947 / wecare@in.nestle.com" },
    country_of_origin: { status: "PRESENT", value: "India" }
  }
};

function App() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [extractedData, setExtractedData] = useState(null);
  const [activeTab, setActiveTab] = useState("entities"); // "entities" | "cleaned" | "raw" | "json"
  const [isDragActive, setIsDragActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [theme, setTheme] = useState("dark"); // "dark" | "light"

  const fileInputRef = useRef(null);

  // Trigger temporary toast notification
  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage("");
    }, 2400);
  };

  // Copy text helper
  const handleCopy = (content, label = "Content") => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    showToast(`✓ Copied ${label}`);
  };

  // File selection
  const processSelectedFile = (selectedFile) => {
    if (!selectedFile) return;

    if (!selectedFile.type.startsWith("image/")) {
      setError("Please choose a valid image file (PNG, JPG, WEBP).");
      return;
    }

    setFile(selectedFile);
    setError("");
    setExtractedData(null);
    const imageURL = URL.createObjectURL(selectedFile);
    setPreview(imageURL);
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files?.[0];
    processSelectedFile(selectedFile);
  };

  // Drag & Drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragActive(false);
    const droppedFile = e.dataTransfer.files?.[0];
    processSelectedFile(droppedFile);
  };

  // Clear / Reset
  const handleReset = () => {
    setFile(null);
    setPreview(null);
    setExtractedData(null);
    setError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Quick load demo preset
  const handleLoadSample = () => {
    handleReset();
    // Use an inline high-tech SVG placeholder as preview
    const svgSample = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect width="600" height="400" fill="%23111827"/><rect x="20" y="20" width="560" height="360" rx="12" fill="%231f2937" stroke="%23374151" stroke-width="2"/><text x="40" y="70" fill="%23f3f4f6" font-family="sans-serif" font-size="20" font-weight="bold">MAGGI 2-MINUTE NOODLES</text><text x="40" y="110" fill="%239ca3af" font-family="sans-serif" font-size="14">MFD BY: NESTLE INDIA LIMITED</text><text x="40" y="140" fill="%239ca3af" font-family="sans-serif" font-size="14">REGD OFFICE: NEW DELHI 110001</text><text x="40" y="180" fill="%2338bdf8" font-family="sans-serif" font-size="14">NET QTY: 70g  |  MRP: Rs. 14.00</text><text x="40" y="220" fill="%239ca3af" font-family="sans-serif" font-size="14">MFD: 10/2024  |  BEST BEFORE: 9 MONTHS</text><text x="40" y="260" fill="%239ca3af" font-family="sans-serif" font-size="14">CUSTOMER CARE: 1800 103 1947</text><text x="40" y="300" fill="%2310b981" font-family="sans-serif" font-size="14">COUNTRY OF ORIGIN: INDIA</text></svg>`;
    setPreview(svgSample);
    setFile({ name: SAMPLE_PRESET.filename, size: 48200 });
    setExtractedData(SAMPLE_PRESET);
    showToast("Loaded sample commodity dataset");
  };

  // Extract Text API Call
  const handleExtractText = async () => {
    if (!file) {
      setError("Please select or drop an image first.");
      return;
    }

    setLoading(true);
    setError("");
    setExtractedData(null);

    try {
      const formData = new FormData();
      formData.append("image", file);

      const response = await fetch("https://ai-ocr-rqtv.onrender.com/api/extract-text", {
        method: "POST",
        body: formData
      });

      const data = await response.json();

      if (!response.ok || data.success === false) {
        throw new Error(data.error || "Failed to process image through OCR pipeline.");
      }

      setExtractedData({
        filename: data.filename || file.name,
        raw_text: data.raw_text || "",
        cleaned_text: data.cleaned_text || data.text || "",
        entities: data.entities || {}
      });

      showToast("✓ Extraction completed successfully!");
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to connect to OCR service. Ensure Node and Python servers are running.");
    } finally {
      setLoading(false);
    }
  };

  // Download JSON export
  const handleDownloadJSON = () => {
    if (!extractedData) return;
    const blob = new Blob([JSON.stringify(extractedData, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${extractedData.filename || "ocr_result"}_analysis.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Downloaded JSON report");
  };

  // Calculate entity stats
  const entityKeys = extractedData?.entities ? Object.keys(extractedData.entities) : [];
  const presentEntitiesCount = entityKeys.filter(
    (k) => extractedData.entities[k]?.status === "PRESENT"
  ).length;

  return (
    <div className={`app-root ${theme === "light" ? "app-theme-light" : ""}`}>
      {/* Top Navigation Header */}
      <header className="navbar">
        <div className="brand-wrap">
          <div className="brand-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M4 7V4h3M20 7V4h-3M4 17v3h3M20 17v3h-3" />
              <circle cx="12" cy="12" r="3" />
              <line x1="8" y1="12" x2="6" y2="12" />
              <line x1="18" y1="12" x2="16" y2="12" />
            </svg>
          </div>
          <div className="brand-titles">
            <div className="brand-name">
              CogniScan AI
              <span className="brand-tag">v2.4 Studio</span>
            </div>
            <div className="brand-sub">PaddleOCR & Qwen Multimodal Intelligence</div>
          </div>
        </div>

        <div className="nav-actions">
          <div className="engine-badge">
            <span className="pulse-dot" />
            <span>Dual Pipeline Active</span>
          </div>

          <button
            className="btn-icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title={`Switch to ${theme === "dark" ? "Light" : "Dark"} mode`}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* Hero Intro */}
      <section className="hero-banner">
        <div className="hero-badge">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L15 8.5L22 9.5L17 14.5L18.5 21.5L12 18L5.5 21.5L7 14.5L2 9.5L9 8.5L12 2Z" />
          </svg>
          Enterprise Document Perception
        </div>
        <h1 className="hero-title">Intelligent OCR & Commodity Label Parsing</h1>
        <p className="hero-description">
          Seamlessly extract, clean, and structure packaged commodity declarations, invoices, and product data using state-of-the-art vision models and large language models.
        </p>
      </section>

      {/* Main Studio Workspace Grid */}
      <main className="studio-grid">
        {/* Left Column: Intake & Preview */}
        <section className="card intake-pane">
          <div className="pane-header">
            <div>
              <div className="pane-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Document Intake
              </div>
              <div className="pane-subtitle">Upload label, receipt, or commodity imagery</div>
            </div>
            {preview && (
              <button className="btn-remove" onClick={handleReset}>
                Reset
              </button>
            )}
          </div>

          {/* Upload Dropzone */}
          <div
            className={`dropzone ${isDragActive ? "drag-active" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="file-input-hidden"
              onChange={handleFileChange}
            />

            <div className="dropzone-icon">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>

            <div className="dropzone-prompt">
              {isDragActive ? "Drop your image right here" : "Click to browse or drag & drop"}
            </div>
            <div className="dropzone-hint">High resolution images yields maximum recognition accuracy</div>

            <div className="format-tags">
              <span className="format-tag">PNG</span>
              <span className="format-tag">JPG</span>
              <span className="format-tag">WEBP</span>
              <span className="format-tag">Auto-Clean</span>
            </div>
          </div>

          {/* Preset Helper Bar */}
          <div className="sample-bar">
            <span className="sample-text">Want to test right now?</span>
            <button className="btn-sample" type="button" onClick={handleLoadSample}>
              Load Sample Label →
            </button>
          </div>

          {/* Image Preview & Laser Scan Animation */}
          {preview && (
            <div className="preview-container">
              <div className="preview-media-box">
                <img src={preview} alt="Document Preview" />
                {loading && <div className="scan-overlay" />}
              </div>

              <div className="preview-meta-bar">
                <div className="meta-file-info">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                    <polyline points="13 2 13 9 20 9" />
                  </svg>
                  <span className="meta-name">{file?.name || "Uploaded Document"}</span>
                  {file?.size && <span>• {(file.size / 1024).toFixed(1)} KB</span>}
                </div>
                <button className="btn-remove" onClick={handleReset}>
                  Remove
                </button>
              </div>
            </div>
          )}

          {/* Primary Action Button */}
          <button
            className="btn-primary-action"
            onClick={handleExtractText}
            disabled={loading || !file}
          >
            {loading ? (
              <>
                <div className="spinner" />
                <span>Running OCR & Reasoning...</span>
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <span>Extract & Analyze Document</span>
              </>
            )}
          </button>

          {/* Error Banner */}
          {error && (
            <div className="error-banner">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}
        </section>

        {/* Right Column: Intelligence Output Inspector */}
        <section className="card output-pane">
          {loading ? (
            /* Loading State */
            <div className="processing-inspector">
              <div className="processing-radar">
                <div className="radar-ring" />
                <div className="radar-ring" />
                <div className="radar-ring" />
              </div>
              <div className="processing-title">Extracting Document Intelligence</div>
              <div className="processing-subtitle">
                PaddleOCR is detecting spatial bounding boxes, followed by Qwen LLM normalization & structured schema extraction.
              </div>
            </div>
          ) : !extractedData ? (
            /* Empty State */
            <div className="empty-inspector">
              <div className="empty-icon-wrap">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
              </div>
              <div className="empty-title">Awaiting Document Input</div>
              <div className="empty-desc">
                Select or drop a packaged commodity label or document on the left to extract structured attributes and OCR streams.
              </div>

              <div className="workflow-steps">
                <div className="workflow-step">
                  <div className="step-num">Phase 01</div>
                  <div className="step-title">PaddleOCR Vision</div>
                  <div className="step-desc">Extracts multi-line text geometry with spatial line grouping</div>
                </div>
                <div className="workflow-step">
                  <div className="step-num">Phase 02</div>
                  <div className="step-title">Normalization</div>
                  <div className="step-desc">Cleans artifacts, currency symbols, and space fragmentations</div>
                </div>
                <div className="workflow-step">
                  <div className="step-num">Phase 03</div>
                  <div className="step-title">Qwen Semantic Parsing</div>
                  <div className="step-desc">Extracts 9 mandatory commodity fields into compliant JSON</div>
                </div>
              </div>
            </div>
          ) : (
            /* Results View */
            <div>
              {/* Header & Controls */}
              <div className="results-header">
                <div className="results-title-group">
                  <h2 className="results-heading">Intelligence Inspector</h2>
                  <span className="badge-success">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {presentEntitiesCount} of {entityKeys.length || 9} Attributes Found
                  </span>
                </div>

                <div className="results-toolbar">
                  <button
                    className="btn-secondary"
                    onClick={() => handleCopy(extractedData.cleaned_text, "Cleaned Text")}
                    title="Copy Cleaned Text"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copy Text
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={handleDownloadJSON}
                    title="Export structured data as JSON"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Export JSON
                  </button>
                </div>
              </div>

              {/* Segmented Tabs */}
              <div className="tabs-nav">
                <button
                  className={`tab-btn ${activeTab === "entities" ? "active" : ""}`}
                  onClick={() => setActiveTab("entities")}
                >
                  <span>🏷️</span>
                  <span>Structured Entities</span>
                </button>
                <button
                  className={`tab-btn ${activeTab === "cleaned" ? "active" : ""}`}
                  onClick={() => setActiveTab("cleaned")}
                >
                  <span>📄</span>
                  <span>Cleaned Text</span>
                </button>
                <button
                  className={`tab-btn ${activeTab === "raw" ? "active" : ""}`}
                  onClick={() => setActiveTab("raw")}
                >
                  <span>⚡</span>
                  <span>Raw OCR Stream</span>
                </button>
                <button
                  className={`tab-btn ${activeTab === "json" ? "active" : ""}`}
                  onClick={() => setActiveTab("json")}
                >
                  <span>🔍</span>
                  <span>JSON Payload</span>
                </button>
              </div>

              {/* Tab 1: Structured Entities */}
              {activeTab === "entities" && (
                <div className="entities-grid">
                  {Object.entries(ENTITY_CONFIG).map(([key, config]) => {
                    const item = extractedData.entities?.[key] || {
                      status: "MISSING",
                      value: null
                    };

                    const isPresent = item.status === "PRESENT";
                    const isValueMissing = item.status === "VALUE_MISSING";

                    let statusClass = "status-missing";
                    let statusLabel = "Missing";

                    if (isPresent) {
                      statusClass = "status-present";
                      statusLabel = "Detected";
                    } else if (isValueMissing) {
                      statusClass = "status-value-missing";
                      statusLabel = "Value Absent";
                    }

                    return (
                      <div className="entity-card" key={key}>
                        <div className="entity-card-header">
                          <div className="entity-label-group">
                            <span className="entity-icon">{config.icon}</span>
                            <span className="entity-title">{config.label}</span>
                          </div>
                          <span className={`status-pill ${statusClass}`}>{statusLabel}</span>
                        </div>

                        <div className="entity-value-wrap">
                          <div className={`entity-value ${!item.value ? "empty-val" : ""}`}>
                            {item.value ? (
                              <>
                                {key === "mrp" && item.currency && <span>{item.currency} </span>}
                                <span>{item.value}</span>
                                {item.unit && <span className="entity-unit-badge"> {item.unit}</span>}
                              </>
                            ) : (
                              <span>Not declared on label</span>
                            )}
                          </div>

                          {item.value && (
                            <button
                              className="btn-copy-mini"
                              onClick={() => handleCopy(item.value, config.label)}
                              title={`Copy ${config.label}`}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Tab 2: Cleaned Text */}
              {activeTab === "cleaned" && (
                <div className="text-view-container">
                  <div className="text-meta-strip">
                    <span>Cleaned & normalized multi-line string</span>
                    <span>{extractedData.cleaned_text ? extractedData.cleaned_text.length : 0} characters</span>
                  </div>
                  <div className="text-viewer">
                    {extractedData.cleaned_text || "No cleaned text available."}
                  </div>
                </div>
              )}

              {/* Tab 3: Raw OCR Stream */}
              {activeTab === "raw" && (
                <div className="text-view-container">
                  <div className="text-meta-strip">
                    <span>Direct text detections from PaddleOCR</span>
                    <span>Spatial lines</span>
                  </div>
                  <pre className="raw-terminal">
                    {extractedData.raw_text || "No raw text detected."}
                  </pre>
                </div>
              )}

              {/* Tab 4: JSON Payload */}
              {activeTab === "json" && (
                <div className="text-view-container">
                  <div className="text-meta-strip">
                    <span>Structured JSON response from pipeline</span>
                    <button
                      className="btn-sample"
                      onClick={() => handleCopy(JSON.stringify(extractedData, null, 2), "Full JSON")}
                    >
                      Copy Raw JSON
                    </button>
                  </div>
                  <pre className="json-viewer">
                    {JSON.stringify(extractedData, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="toast-feedback">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Footer */}
      <footer className="app-footer">
        CogniScan AI Document Perception Studio • Enterprise Multimodal Extraction Engine
      </footer>
    </div>
  );
}

export default App;