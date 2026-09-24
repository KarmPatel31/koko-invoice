export async function createInvoicePdf(element, filename = 'invoice.pdf') {
  if (!element) throw new Error('Invoice preview is not ready');
  await document.fonts.ready;
  await Promise.all([...element.querySelectorAll('img')].map(img => img.decode().catch(() => {})));
  const { default: html2pdf } = await import('html2pdf.js');
  return html2pdf().set({
    margin: [8, 8, 8, 8], filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false, windowWidth: 1000, scrollX: 0, scrollY: 0 },
    pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.tags-row', '.invoice-total', '.invoice-head'] },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  }).from(element).toCanvas().then(function () {
    // Align canvas slicing with the integer CSS-pixel height used by html2pdf's
    // page-break plugin. Independent rounding otherwise clips card borders.
    this.prop.pageSize.inner.ratio = this.prop.pageSize.inner.px.height * 2 / this.prop.canvas.width;
  }).output('blob');
}
