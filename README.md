# Koko Invoice

Koko Invoice is a modern retail/wholesale dashboard for:

- AI invoice scanning with Google Gemini
- Multi-store price books
- CSV catalog import
- UPC-based price matching
- Vendor invoice ledger
- Quotes
- Task management
- Printable/PDF invoice review sheets
- Browser persistence for app data

## Tech stack

- React + Vite
- Express
- Google Gen AI SDK (`@google/genai`)
- Papa Parse
- Recharts
- Lucide icons

## Security choice

The Gemini API key is **not** stored in browser `localStorage`.
It stays in the server `.env` file and the browser talks to `/api/parse-invoice`.

## Setup

1. Install Node.js 20+.
2. Open this folder in a terminal.
3. Run:

```bash
npm install
```

4. Copy `.env.example` to `.env`.
5. Add your Google AI Studio API key:

```env
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.6-flash
PORT=8787
```

6. Start the app:

```bash
npm run dev
```

7. Open:

```text
http://localhost:5173
```

## Price book CSV

Accepted column names are flexible. A recommended CSV is:

```csv
UPC,Name,Department,Price
049000050103,Coca-Cola 20oz,Beverages,2.49
028400090896,Lay's Classic 2.65oz,Candy & Snacks,2.69
```

The importer also recognizes common variants such as `UPC/PLU`, `Product`, `Description`, `Category`, `Retail`, and `SRP`.

## Gemini parsing

The API accepts:

- PDF
- PNG
- JPG/JPEG
- WEBP

The server requests structured JSON with:

- vendor
- invoice number/date
- subtotal/tax/total
- description
- UPC
- category
- quantity
- unit cost
- SRP
- line total

After extraction, the server matches UPCs against the selected store price book and calculates the price difference.

## Notes for production

This starter intentionally uses `localStorage` for store data so it runs without a database.
For a deployed multi-user version, the next recommended upgrade is PostgreSQL + authentication + cloud object storage for invoice PDFs/images.
