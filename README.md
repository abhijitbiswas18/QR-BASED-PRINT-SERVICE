# Scan QR To Print

A self-hosted QR-driven print portal. A printed QR code opens a web page where people can upload documents or images, review the upload, choose an available printer, and submit a print job. Administrators approve, reject, reprint, and download jobs, manage printers and branding, calculate cost, and view financial reports. Everything runs locally; no cloud services are required.

Version `2.0.2`.

## Features

- QR code shown on the portal (`/api/qr`) points to the server LAN URL so phones on the same network can upload directly.
- Document upload for PDF, Word, image, ODF, RTF, and other supported files with a 50 MB limit.
- Dedicated image print page for JPEG/JPG uploads with preview (`/` is for PDF/document flow, `/image.html` is for image flow).
- PDF/image preview in the browser before submission.
- Printer selection with per-printer capabilities:
  - enabled/disabled for users
  - color, monochrome, both
  - duplex / both-side support
  - stock/availability from Windows printers
- Page selection for PDF/Word/ODF documents: all, first, last, odd, even, or a custom page range.
- Image printing with optional N-up layouts (1, 2, 4, 6, or 9 copies per page).
- Print job queue with statuses: pending, approved, printed, failed, and rejected.
- Admin approval flow: review files, change printer per job, approve and print, reject, or reprint.
- SL numbers and status filters in the admin panel.
- Job history, downloadable files, and file-level cleanup.
- Cost and pricing:
  - cost-center rates are admin configurable
  - color prints and monochrome prints have separate per-page rates
  - currency is persisted with the cost center
  - default rates: **color 20.00**, **monochrome 10.00**, currency **INR**
  - cost calculation endpoint for previews
- Financial dashboard:
  - day, month, and year aggregates
  - approved/printed job totals
  - cost breakdown by printer and quality
- Branding is stored in `data/config.json` and injected server-side into the home page.
  - site header text
  - dark/light theme
  - favicon URL
- Per-user upload isolation using an anonymous session id stored in browser `localStorage`.
- Admin token authentication for all management APIs and actions.
- Footer with license/credit text.
- Self-hosted Windows service wrapper runs the Node.js server hidden and starts automatically at boot.

## Stack

- Node.js 22, Express 4, Multer, `pdf-parse`, `qrcode`
- Windows PowerShell / .NET helper:
  - `print-image.ps1` for image printing
  - `make-preview-pdf.ps1` for JPEG/JPG-to-preview-PDF generation
- SumatraPDF 3.6.1 for PDF printing to a chosen Windows printer
- Pure HTML/CSS/JavaScript front end
- Optional C# Windows service wrapper (`PrintServiceHost.exe`)

## Quick start (development)

Download the Latest version Installer and then run it as Administrator.

Then open:

- Home (PDF/document flow): `http://localhost:3000/`
- Image print page: `http://localhost:3000/image.html`
- Admin panel: `http://localhost:3000/admin.html`
- QR code: `http://localhost:3000/api/qr`

Default admin password is:

```text
admin
```

Change it from the Admin panel immediately after installation.

## Windows installer (version 2.0.2)

The installer contains Node.js 22, all `node_modules`, SumatraPDF, PowerShell/.NET helpers, the web application, and the Windows service wrapper.

- Installer name: **Scan QR To Print.exe**
- Install directory: `C:\PrintService\`
- Publisher: **Abhijit Biswas**
- Information URL: `https://github.com/abhijitbiswas18`
- System service name: **BI Print Service**
- Service startup type: **Automatic**
- Requires administrator rights because Windows service registration requires elevated permission. The installer asks for UAC consent and cannot be made truly no-UAC while installing a system service.
- Admin panel remains at `http://localhost:3000/admin.html`.

What the installer does:

1. Installs all files and dependencies into `C:\PrintService\`.
2. Prompts for branding/header text. **Biswas Infotech** is the default.
3. Writes the branding to `C:\PrintService\data\config.json`.
4. Stops and removes any existing BI Print Service (idempotent upgrade).
5. Installs BI Print Service with Startup Type Automatic.
6. Starts the service immediately and at every boot.

At uninstall time, the installer stops and deletes BI Print Service before removing the application files.

### Verify service startup type

```powershell
sc qc BI Print Service
```

Look for `START_TYPE : 2 AUTO_START`.



## Runtime data files

All runtime data is stored under `data/` inside `C:\PrintService`:


## Admin features

- Job queue management: refresh, status filters, SL number, printer change before approval, approve, reject, reprint, and download.
- Uploaded-file management: view all, download, or permanently delete.
- Printer setup: enable/disable printers and set color, monochrome, duplex capabilities.
- Branding: update header text and favicon.
- Theme: dark/light toggle.
- Password change.
- Cost center: rates and currency.
- Financial dashboard: total jobs, cost aggregates, printer and quality breakdowns.

## Branding

During installation the administrator is prompted for the header text. The default is **Biswas Infotech**. You can change branding later:

- from the admin panel,
- 
## QR-based printing flow

1. Open the portal and display/print the QR code.
2. A user scans the code and opens the upload page.
3. The user uploads one or more supported files.
4. The user previews the document/image and selects printer, color/mono, copies/page, and page range.
5. They submit a **print job** (no immediate printing).
6. The UI shows a Job ID.
7. The administrator reviews pending jobs.
8. The administrator approves, rejects, changes printer, or reprints as needed.
9. Jobs, status, cost, and financial reports persist in the local data files.
service, cost center, image printing, and financial dashboard."


## Notes on UAC / installation

Run the Installer as administrator

## License

This project is distributed as a free tool. 

```text
THIS IS A FREE TOOL TO USE.
Developed by : - Abhijit Biswas (https://github.com/abhijitbiswas18)
```
