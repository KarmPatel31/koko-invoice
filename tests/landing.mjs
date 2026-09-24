import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const errors=[];page.on('pageerror', e=>errors.push(e.message));
try {
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
  await page.getByRole('heading',{level:1}).waitFor();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    await page.screenshot({path:`tmp/landing-${width}.png`,fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await page.getByRole('button',{name:'Scan sample invoice',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Ready for review'}).waitFor();
  await page.getByRole('button',{name:'Price differences'}).click();
  assert.equal(await page.locator('.kl-demo-table tbody tr').count(),2);
  await page.getByLabel('Demo store').selectOption('1');
  assert.equal(await page.locator('.kl-demo-table tbody tr').count(),2);
  assert.match(await page.locator('.kl-demo-table tbody').innerText(),/Coca-Cola/);
  await page.getByLabel('Invoices per month',{exact:true}).fill('100');
  assert.match(await page.locator('.kl-calculated').innerText(),/13.3/);
  await page.getByText('Does Koko connect directly to my POS or update inventory?',{exact:true}).click();
  assert.equal(await page.locator('details[open]').count(),1);
  assert.deepEqual(errors,[]);
  await page.setViewportSize({width:1200,height:630});
  await page.locator('.kl-hero').scrollIntoViewIfNeeded();
  await page.screenshot({path:'public/social-preview.png'});
  console.log('Landing interactions, mobile overflow, calculator and FAQ checks passed.');
} finally { await browser.close(); }
