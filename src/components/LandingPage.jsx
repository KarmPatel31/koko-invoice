import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ArrowRight, Check, ScanLine, FileText, Store, ShieldCheck, Barcode, Printer, Plus, Play, RotateCcw, ChevronRight, CheckCircle2 } from 'lucide-react';

export const faqs = [
  ['What is an AI invoice scanner for retail?', 'An AI invoice scanner turns supplier invoice PDFs and photos into structured line items. Koko Invoice helps retailers review product descriptions, UPCs, quantities, unit costs and suggested retail prices without retyping each line. Always review extracted information before saving.'],
  ['Can Koko match invoices to my store price book?', 'Yes. Import a CSV price book, choose a store and compare extracted UPCs against its products. Review matched products, potential matches, new items and differences between invoice suggested retail prices and your current retail prices.'],
  ['Does Koko connect directly to my POS or update inventory?', 'Koko currently uses CSV price-book imports. It does not automatically update your POS or stock quantities. Review the invoice in Koko and apply approved changes through your existing store workflow.'],
  ['Which invoice files can I upload?', 'Signed-in customers can upload PDF, PNG, JPEG or WEBP files. A scan supports up to five files, 20 MB combined and ten total pages. Clear, well-lit images make invoice text easier to extract.'],
  ['Can multiple staff members use the same workspace?', 'Yes. Invited staff share a company workspace with separate store price books. Editing roles can manage business records; viewers have read-only access. Accounts and role changes are managed by the Koko operator.'],
  ['Is the interactive demo using real customer data?', 'No. The landing-page walkthrough uses sample products and simulated scanning. The full demo uses sample records too. Real invoice scanning requires an invited account, and customer records are isolated by company.'],
  ['How do I get access to Koko Invoice?', 'Koko is currently invite-only. You can explore the sample workspace without an account. For a live workspace, obtain an invitation from your Koko contact; existing customers can use Sign in.']
];
const products = [
  { name: 'Coca-Cola 20 oz', category: 'Beverages', upc: '049000050103', cost: 1.85, srp: 2.49, prices: [2.49, 2.69] },
  { name: 'Classic potato chips', category: 'Snacks', upc: '028400090896', cost: 1.95, srp: 2.69, prices: [2.49, 2.69] },
  { name: 'Lemon iced tea', category: 'Beverages', upc: '012000001017', cost: 1.39, srp: 1.99, prices: [1.99, 1.89] },
  { name: 'Milk chocolate bar', category: 'Candy', upc: '034000004400', cost: 1.15, srp: 1.69, prices: [1.49, 1.69] }
];
const dollars = value => `$${value.toFixed(2)}`;
export default function MarketingLanding({ onStartDemo = () => {}, onSignIn = () => {} }) {
  const [store, setStore] = useState(0);
  const [filter, setFilter] = useState('All items');
  const [step, setStep] = useState(0);
  const timer = useRef(null);
  const [invoices, setInvoices] = useState(40);
  const [minutes, setMinutes] = useState(12);
  const [review, setReview] = useState(4);
  useEffect(() => () => clearInterval(timer.current), []);
  const scan = () => {
    clearInterval(timer.current); setStep(1);
    let next = 1;
    timer.current = setInterval(() => { next++; setStep(next); if (next === 4) clearInterval(timer.current); }, 650);
  };
  const differences = products.filter(p => p.srp !== p.prices[store]);
  const visible = filter === 'Price differences' ? differences : products;
  const savings = Math.max(0, invoices * (minutes - review) / 60);
  return <div className="koko-landing" id="top">
    <a className="kl-skip" href="#main-content">Skip to content</a>
    <header className="kl-nav kl-wrap">
      <a className="kl-brand" href="#top" aria-label="Koko Invoice home"><img src="/logo.png" alt="" width="38" height="38" /><span>koko<span className="kl-brand-light">invoice</span><i /></span></a>
      <nav aria-label="Main navigation"><a href="#interactive-demo">How it works</a><a href="#features">For your store</a><a href="#time-calculator">Time calculator</a><a href="#faq">FAQs</a></nav>
      <div className="kl-nav-actions"><button className="kl-text-btn" onClick={onSignIn}>Sign In</button><button className="kl-button kl-small" onClick={onStartDemo}>Try Koko Demo <ArrowUpRight size={16} /></button></div>
    </header>
    <main id="main-content">
      <section className="kl-hero kl-wrap">
        <div className="kl-hero-copy"><div className="kl-eyebrow"><span className="kl-live-dot" /> BUILT FOR THE EVERYDAY RETAILER</div>
          <h1>AI invoice scanning.<br />Less paperwork.<br /><em>More store time.</em></h1>
          <p>Turn supplier PDFs and photos into organized line items. Match UPCs to your store’s price book, spot retail price differences, and get back to your customers.</p>
          <div className="kl-actions"><a className="kl-button" href="#interactive-demo">See it in action <ArrowRight size={18} /></a><button className="kl-outline" onClick={onStartDemo}>Explore the workspace</button></div>
          <div className="kl-hero-note"><CheckCircle2 size={15} /> Sample demo. No account or credit card needed.</div>
        </div>
        <div className="kl-hero-art" aria-label="Sample invoice transformed into a price-book match">
          <div className="kl-orbit" /><div className="kl-art-label"><span /> A LITTLE LESS BUSYWORK</div>
          <div className="kl-receipt"><div className="kl-receipt-top"><Store size={23} /><span>MAIN STREET<br /><b>WHOLESALE</b></span></div><div className="kl-receipt-rule" /><p>SUPPLIER INVOICE <span>#1048</span></p><small>SAMPLE • SEPTEMBER 2026</small><div className="kl-receipt-row"><span>Cola / 20 oz</span><b>$44.40</b></div><div className="kl-receipt-row"><span>Classic chips</span><b>$23.40</b></div><div className="kl-receipt-row"><span>Lemon iced tea</span><b>$16.68</b></div><div className="kl-receipt-row"><span>Chocolate bar</span><b>$13.80</b></div><div className="kl-receipt-total">TOTAL <strong>$98.28</strong></div><div className="kl-barcode" /><span className="kl-receipt-foot">FROM PAPER TO A CLEARER PICTURE</span></div>
          <div className="kl-match-card"><div className="kl-match-icon"><ScanLine size={20} /></div><div><small>INVOICE → PRICE BOOK</small><strong>Found your products.</strong></div><span className="kl-check"><Check size={16} /></span><div className="kl-match-product"><span>Classic potato chips<small>UPC 028400090896</small></span><b>$2.49 <ArrowRight size={13} /> $2.69</b></div><div className="kl-match-bottom"><span className="kl-amber-dot" /> $0.20 retail difference to review</div></div>
          <div className="kl-paper-tag"><CheckCircle2 size={16} /> You’re still in control.</div>
        </div>
      </section>
      <div className="kl-audience"><div className="kl-wrap"><span>MADE FOR YOUR KIND OF STORE</span><b>Convenience stores</b><i>✳</i><b>Independent grocers</b><i>✳</i><b>Liquor stores</b><i>✳</i><b>Multi-store retailers</b></div></div>
      <section id="interactive-demo" className="kl-section kl-wrap">
        <div className="kl-section-heading"><div><span className="kl-eyebrow">01 / LESS TYPING. MORE CLARITY.</span><h2>Your next invoice.<br />A much simpler routine.</h2></div><p>Try the sample walkthrough. Switch stores and filter price differences to see how invoice OCR and UPC matching fit your day.</p></div>
        <div className="kl-demo"><aside><div className="kl-demo-label"><ScanLine size={17} /> THE INVOICE LAB <span>DEMO</span></div><h3>Paper in.<br />Useful details out.</h3><p>A sample supplier invoice, four products, and your store’s price book.</p><div className="kl-file"><FileText size={30} /><div><b>supplier-invoice.pdf</b><small>Sample document · 4 line items</small></div><CheckCircle2 size={17} /></div><button className="kl-button kl-demo-run" onClick={scan} disabled={step > 0 && step < 4}>{step === 4 ? <RotateCcw size={16} /> : <Play size={16} />}{step === 4 ? 'Run sample again' : step > 0 ? 'Reading the sample…' : 'Scan sample invoice'}</button><small className="kl-simulation-note">Simulated walkthrough. No upload or AI charges.</small><ol className="kl-steps" aria-label="Sample scanning progress">{['Read invoice details', 'Match product UPCs', 'Compare store prices'].map((label, i) => <li key={label} className={step > i + 1 ? 'complete' : ''}><span>{step > i + 1 ? <Check size={12} /> : `0${i + 1}`}</span>{label}</li>)}</ol></aside>
          <div className="kl-demo-results"><div className="kl-results-top"><div><small>YOUR PRICE BOOK</small><h3>Every store has its own prices.</h3></div><label className="kl-store-select"><Store size={15} /><select aria-label="Demo store" value={store} onChange={e => setStore(Number(e.target.value))}><option value={0}>Main Street</option><option value={1}>Downtown</option></select></label></div>
          <div className="kl-result-summary"><div><strong>04</strong><span>sample products</span></div><div><strong>04</strong><span>UPC matches</span></div><div><strong>{String(differences.length).padStart(2, '0')}</strong><span>price differences</span></div><span className="kl-ready" role="status">{step === 0 ? 'Sample preview' : step === 4 ? 'Ready for review' : ['','Reading invoice…','Matching UPCs…','Comparing prices…'][step]}</span></div>
          <div className="kl-filter" aria-label="Demo product filters">{['All items','Price differences'].map(name => <button key={name} aria-pressed={filter === name} onClick={() => setFilter(name)}>{name}{name === 'Price differences' && <span>{differences.length}</span>}</button>)}</div>
          <div className="kl-table-scroll"><table className="kl-demo-table"><caption className="kl-sr-only">Sample invoice suggested retail prices compared with the selected store’s current retail prices</caption><thead><tr><th>Product / UPC</th><th>Store retail</th><th>Invoice SRP</th><th>Difference</th></tr></thead><tbody>{visible.map(p => { const delta=p.srp-p.prices[store];return <tr key={p.upc}><td><b>{p.name}</b><small>{p.upc}</small></td><td>{dollars(p.prices[store])}</td><td>{dollars(p.srp)}</td><td><span className={delta ? 'kl-difference' : 'kl-matched'}>{delta ? `${delta > 0 ? '+' : '−'}${dollars(Math.abs(delta))}` : <><Check size={12} /> Same price</>}</span></td></tr>;})}</tbody></table></div><div className="kl-demo-footer"><ShieldCheck size={16} /><span>Review first. Save when you’re ready.</span><button onClick={onStartDemo}>Open full demo <ArrowUpRight size={15} /></button></div>
          </div>
        </div>
      </section>
      <section id="features" className="kl-section kl-wrap"><div className="kl-section-heading"><div><span className="kl-eyebrow">02 / BUILT AROUND YOUR BACK OFFICE</span><h2>From the delivery counter<br />to the shelf.</h2></div><p>Retail invoice processing tools that work together, whether you manage one neighborhood shop or several locations.</p></div>
      <div className="kl-features">{[
        [ScanLine,'Invoice data extraction','Read supplier PDFs and invoice photos','Extract vendor details, quantities, UPCs, unit costs and suggested retail prices into a reviewable invoice.','PDF · PNG · JPEG · WEBP'],
        [Barcode,'Price-book matching','Find the product. Check the price.','Compare extracted UPCs with your CSV price book. See retail price differences and identify products that need a closer look.','CSV imports · UPC matching'],
        [Printer,'Shelf-ready output','Finish with a clearer printout','Keep invoice records together and print readable invoice summaries and product price cards for your store workflow.','Invoice PDFs · Price cards']
      ].map(([Icon,label,title,body,foot]) => <article key={label}><div className="kl-feature-icon"><Icon size={24} /></div><small>{label}</small><h3>{title}</h3><p>{body}</p><div className="kl-feature-foot">{foot}<ArrowUpRight size={17} /></div></article>)}</div>
      <div className="kl-team"><div className="kl-team-visual"><div><span>MS</span><b>Main Street Market</b><small>Company workspace</small></div><div className="kl-role"><span>AL</span><b>Alex</b><small>Admin</small></div><div className="kl-role"><span>JM</span><b>Jamie</b><small>Staff</small></div><div className="kl-role"><span>SR</span><b>Sam</b><small>Viewer</small></div></div><div><span className="kl-eyebrow">SAME TEAM. ONE WORKSPACE.</span><h3>Multiple stores.<br />A shared way to work.</h3><p>Invite-only company workspaces keep your team’s invoices and store price books together. Staff can manage records, while viewers can check the details without changing them.</p><span className="kl-team-note"><ShieldCheck size={16} /> Separate company data. Role-based access.</span></div></div>
      </section>
      <section id="time-calculator" className="kl-calculator-section"><div className="kl-wrap kl-calculator"><div><span className="kl-eyebrow">03 / MAKE ROOM IN YOUR DAY</span><h2>What could less<br />invoice typing mean?</h2><p>Put your own numbers in. Compare manual entry time with your estimated review time after scanning.</p><small>A planning estimate, not a measured result or guaranteed saving.</small></div><div className="kl-calculator-card">{[["Invoices per month", invoices,setInvoices,1,300,''],['Manual entry per invoice',minutes,setMinutes,1,30,' min'],['Estimated review per invoice',review,setReview,1,30,' min']].map(([label,value,setValue,min,max,suffix]) => <label key={label}><span>{label}<output>{value}{suffix}</output></span><input type="range" aria-label={label} min={min} max={max} value={value} onChange={e=>setValue(Number(e.target.value))} /></label>)}<div className="kl-calculated" aria-live="polite"><strong>{savings.toFixed(1)}<span> hours</span></strong><div>potential time back<br />each month</div></div><p>{invoices} invoices × {Math.max(0, minutes-review)} minutes less per invoice ÷ 60.</p></div></div></section>
      <section id="faq" className="kl-section kl-wrap kl-faq"><div><span className="kl-eyebrow">A FEW GOOD QUESTIONS</span><h2>Before you<br />scan that stack.</h2><p>What to know about Koko’s retail invoice scanner, price-book workflow and early access.</p></div><div>{faqs.map(([q,a])=><details key={q}><summary>{q}<Plus size={18} /></summary><p>{a}</p></details>)}</div></section>
      <section className="kl-final kl-wrap"><div><span className="kl-eyebrow">YOUR STORE DESERVES YOUR TIME.</span><h2>Give the paperwork<br />a shorter shift.</h2><p>Explore Koko Invoice with sample data. Live workspaces are currently available by invitation.</p></div><div><button className="kl-button" onClick={onStartDemo}>Try the interactive workspace <ArrowUpRight size={18} /></button><button className="kl-text-btn" onClick={onSignIn}>Already invited? Sign in <ArrowRight size={16} /></button></div></section>
    </main>
    <footer className="kl-footer kl-wrap"><a className="kl-brand" href="#top"><img src="/logo.png" alt="" width="30" height="30" /><span>koko<span className="kl-brand-light">invoice</span></span></a><p>AI invoice scanning for independent retail.</p><a href="#faq">Questions & access</a><small>© {new Date().getFullYear()} Koko Invoice</small></footer>
  </div>;
}
