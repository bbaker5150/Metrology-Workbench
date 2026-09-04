# Metrology Workbench Environment Setup Guide

This guide provides step-by-step instructions for performing a clean offline/manual installation of **Electron** and setting up the local **NPSL Tools** Python package.

---

## Prerequisites

| Requirement | Description |
|---|---|
| **Node.js / npm** | Required for frontend dependencies. |
| **Python 3.x / pip** | Required for backend API and tool installation. |
| **PowerShell** | Recommended shell for executing setup commands on Windows. |

---

## 1. Electron Installation (Offline / Manual Bypass)

Use this process when strict SSL, proxy constraints, or restricted network environments prevent automatic Electron binary downloads.

### Step 1.1: Clean Environment & Configure npm

Run the following commands in PowerShell from the project root:

```powershell
# Remove existing build artifacts and dependency locks
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json

# Clear npm cache and bypass strict SSL if behind a corporate proxy
npm cache clean --force
npm config set strict-ssl false

# Prevent npm from attempting automatic binary download
$env:ELECTRON_SKIP_BINARY_DOWNLOAD = "1"

# Install Node dependencies
npm install

# Replace <YOUR_USERNAME> with your local Windows username
pip install -e "C:\Users\<YOUR_USERNAME>\Desktop\Projects\Metrology-Workbench\Backend\ac_shunt\api\NPSL_Tools"

