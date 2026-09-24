import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
  // Forged legacy storage must not unlock the workspace.
  await page.evaluate(() => localStorage.setItem('koko-auth-user', JSON.stringify({ uid: 'forged' })));
  await page.reload();
  await page.getByRole('button', { name: 'Try Koko Demo', exact: true }).waitFor();
  assert.equal(await page.locator('.app-shell').count(), 0);
  await page.getByRole('button', { name: 'Try Koko Demo', exact: true }).click();
  await page.locator('nav').getByRole('button', { name: 'Invoices', exact: true }).click();
  await page.locator('tr').filter({ hasText: 'INV-DEMO-2026' }).locator('button').click();
  await page.locator('.print-table tbody tr').first().waitFor();
  // Exercise the actual invoice layout with pathological real-world widths and pagination.
  await page.evaluate(() => {
    document.querySelector('.invoice-head strong').textContent = 'VENDOR-INVOICE-' + '1234567890'.repeat(8);
    document.querySelector('.invoice-meta b').textContent = 'Wholesale Distributor With A Very Long Company Name And Regional Division';
    const body = document.querySelector('.print-table tbody');
    body.rows[0].cells[1].textContent = 'LongProductWithoutAnySpaces'.repeat(8);
    body.rows[0].cells[0].textContent = '123456789012345678901234567890';
    for (let i = 0; i < 40; i++) body.append(body.rows[i % 26].cloneNode(true));
    document.querySelector('.tag-title').textContent = 'LongProductWithoutAnySpaces'.repeat(3);
  });
  await page.emulateMedia({ media: 'print' });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.locator('.print-sheet').evaluateAll(sheets => sheets.flatMap(sheet => {
      const bounds = sheet.getBoundingClientRect();
      return [...sheet.querySelectorAll('td, th, .shelf-tag, .invoice-head, .invoice-meta')].filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || el.scrollWidth > el.clientWidth + 1;
      }).map(el => el.tagName + ':' + el.className);
    }));
    assert.deepEqual(overflow, [], `overflow at viewport ${width}`);
  }
  await mkdir('tmp/pdfs', { recursive: true });
  await page.pdf({ path: 'tmp/pdfs/invoice-print-regression.pdf', preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 390, height: 844 });
  // Exercise html2pdf directly on the same DOM used by WhatsApp export without sending anything.
  const bytes = await page.evaluate(async () => {
    const { createInvoicePdf } = await import('/src/services/pdfExport.js');
    const blob = await createInvoicePdf(document.querySelector('.invoice-document'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  const { writeFile } = await import('node:fs/promises');
  await writeFile('tmp/pdfs/invoice-export-regression.pdf', Buffer.from(bytes));
  assert.deepEqual(errors, []);
  console.log('PDF layout, long-text, mobile-width, and forged-session checks passed.');
} finally { await browser.close(); }
