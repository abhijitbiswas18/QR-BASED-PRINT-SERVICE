# BI Print Service (original build)

A small self-hosted service: a QR code links to a web page where people can upload a PDF/image, review it, choose a printer installed on this machine, and print in **Color** or **Black & White**. Built from scratch (not a clone of any third-party product).

## Stack (all local, no cloud)
- Node.js 22 + Express, Multer (uploads), QRCode
- Windows PowerShell / .NET for printing images (color toggle via `PrintDocument.Color`)
- SumatraPDF (portable) for printing PDFs to a chosen printer with color/monochrome + page selection
- Pure HTML/CSS/JS front-end (no framework)

## Run
```
extract the files and cd to extraced folder "/QR-BASED-PRINT-SERVICE-main/"
npm install
node server.js
```
OR

You can Run the Installer "Scan QR To Print" <br>
It install the service for you in C:\PrintService\<br>
Creates data/, uploads/, and converted/ folders.<br>
Prompts during setup for Branding (site header text) and writes data/config.json with it.<br>
Compiles/installs a Windows service wrapper (PrintServiceHost.exe)<br> that runs the Node server hidden and starts it automatically <br>(also available as PrintServiceHost.exe /install / /uninstall).
Registers and starts the “BI Print Service” Windows service.

Then open `http://localhost:3000/` on this machine, or scan the QR (printed on the page) from a phone on the same Wi-Fi. Admin panel: `http://localhost:3000/admin.html` (default password `admin`, change via `ADMIN_PASSWORD` env).

## Print flow (queued + admin approval)
- User uploads -> reviews -> submits a **print job**. The UI shows a **Job ID** (no immediate printing).
- Admin opens `/admin.html` and:
  - manages **uploaded files** (view all, download, permanently delete from disk),
  - views all jobs (status: pending / approved / printed / failed / rejected),
  - can change the printer per job before approval,
  - **Approve** (prints using the job settings + selected printer) or **Reject**.
- Jobs persist to `data/jobs.json`.

## Endpoints
- `GET /`                 - web UI
- `GET /admin.html`       - admin panel
- `POST /api/upload`      - multipart `files[]`
- `GET /api/files`        - list uploaded files
- `DELETE /api/files/:id` - remove an uploaded file
- `GET /api/printers`     - installed printers (via `Get-Printer`)
- `POST /api/print`       - creates a queued job: `{ fileId, printer, color, copiesPerPage?, pages? }`
  - `pages`: page selection for PDF/DOC/DOCX/ODF, e.g. `all` (default), `2`, `1-5`, `1,3,5-7`, `odd`, `even`, `last`.
- `POST /api/admin/login` - `{ password }` -> `{ ok, token }`
- `GET /api/admin/jobs`   - list jobs (header `x-admin-token`)
- `POST /api/admin/jobs/:id/approve` - `{ printer? }` approve + print
- `POST /api/admin/jobs/:id/reject`  - reject
- `GET /api/qr`           - QR (data URL) pointing at this machine's LAN URL

## Printer setup (admin)
- Admin has a **Printer setup** section listing every system printer with toggles for:
  - **Enabled for users** (hide/show from user dropdown)
  - **Color**, **Monochrome**, **Both-side (duplex)** capability
- At least one of Color/Monochrome stays on. Capabilities drive the user page: disabled radio buttons + duplex checkbox visibility.
- Config persisted to `data/printer-config.json`; user printer list and `/api/printer-capabilities` reflect it.
- Set `PORT` (default 3000) and `HOST_URL` env if you want a specific public URL in the QR. Set `ADMIN_PASSWORD` to change the admin password. Set `LIBREOFFICE_PATH` if LibreOffice is installed elsewhere.
- Image printing uses System.Drawing (GDI+) - works for JPG/PNG/GIF/BMP/WEBP/TIFF.
- For images you can choose **Copies per page** (1/2/4/6/9) in an N-up layout; a **Print preview** button renders the page on a canvas before submitting.
- Pages option for documents is a dropdown (All / First / Last / Odd / Even / Custom range). Custom range reveals a text field.
- PDF printing uses SumatraPDF 3.6.1 .
- Color/B&W for PDF is passed via Sumatra's `-print-settings color|monochrome`. For a real printer make sure the driver honours it; virtual "Print to PDF" writers may save a prompt.
- Multer 1.x is used (deprecation warning only); bump to 2.x if you want the patched line.
