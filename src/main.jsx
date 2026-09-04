import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Papa from "papaparse";
import {
  LayoutDashboard, Store, ReceiptText, FileText, CheckSquare, UploadCloud,
  Search, Plus, Trash2, Download, Printer, ChevronDown, Sparkles, X,
  ArrowUpRight, ArrowDownRight, PackageSearch, CircleDollarSign, Building2,
  MoreHorizontal, CheckCircle2, Clock3, CircleDashed
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line
} from "recharts";
import "./styles.css";

const uid = () => Math.random().toString(36).slice(2, 10);
const money = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n || 0));

const seed = {
  stores: [
    { id: "s101", name: "Store #101", location: "Main Street", products: [
      { upc: "049000050103", name: "Coca-Cola 20oz", department: "Beverages", retail: 2.49 },
      { upc: "028400090896", name: "Lay's Classic 2.65oz", department: "Candy & Snacks", retail: 2.69 },
      { upc: "012000001017", name: "Pepsi 20oz", department: "Beverages", retail: 2.49 }
    ]},
    { id: "s102", name: "Store #102", location: "Lake Avenue", products: [] }
  ],
  invoices: [
    { id: "INV-1048", vendor: "Core-Mark", date: "2026-09-01", total: 1847.23, status: "Pending", storeId: "s101", items: 46 },
    { id: "INV-1047", vendor: "McLane", date: "2026-08-30", total: 963.55, status: "Paid", storeId: "s101", items: 31 },
    { id: "INV-1046", vendor: "Great Lakes Beverage", date: "2026-08-28", total: 2211.08, status: "Paid", storeId: "s102", items: 18 }
  ],
  quotes: [
    { id: "Q-204", client: "Store #101", vendor: "ABC Fixtures", amount: 1250, status: "Open", date: "2026-09-02" }
  ],
  tasks: [
    { id: uid(), title: "Review Core-Mark price increases", tag: "Invoice", done: false },
    { id: uid(), title: "Upload September Store #102 price book", tag: "PriceBook", done: false },
    { id: uid(), title: "Approve cooler quote", tag: "Quote", done: true }
  ]
};

function loadData() {
  try {
    const raw = localStorage.getItem("koko-invoice-data");
    return raw ? { ...seed, ...JSON.parse(raw) } : seed;
  } catch {
    return seed;
  }
}

function App() {
  const [data, setData] = useState(loadData);
  const [page, setPage] = useState("Dashboard");
  const [activeStoreId, setActiveStoreId] = useState(() => loadData().stores?.[0]?.id || "");
  const [toast, setToast] = useState("");
  const [preview, setPreview] = useState(null);

  const save = (next) => {
    setData(next);
    localStorage.setItem("koko-invoice-data", JSON.stringify(next));
  };
  const notify = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2300); };

  const activeStore = data.stores.find(s => s.id === activeStoreId) || data.stores[0];

  const nav = [
    ["Dashboard", LayoutDashboard],
    ["AI Parser", Sparkles],
    ["Price Books", Store],
    ["Invoices", ReceiptText],
    ["Quotes", FileText],
    ["Tasks", CheckSquare]
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">K</div>
          <div><b>Koko Invoice</b><span>Retail Intelligence</span></div>
        </div>

        <nav>
          {nav.map(([label, Icon]) => (
            <button key={label} className={page === label ? "nav-item active" : "nav-item"} onClick={() => setPage(label)}>
              <Icon size={18}/><span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="mini-card">
            <Sparkles size={18}/>
            <div><strong>Gemini Ready</strong><span>Server-side AI parser</span></div>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <h1>{page}</h1>
            <p>Manage pricing, invoices and vendor operations in one place.</p>
          </div>
          <div className="top-actions">
            <select value={activeStore?.id || ""} onChange={e => setActiveStoreId(e.target.value)}>
              {data.stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="primary" onClick={() => setPage("AI Parser")}><UploadCloud size={17}/> Scan invoice</button>
          </div>
        </header>

        <section className="content">
          {page === "Dashboard" && <Dashboard data={data} activeStore={activeStore} save={save} setPage={setPage}/>}
          {page === "AI Parser" && <AIParser data={data} save={save} activeStore={activeStore} notify={notify} setPreview={setPreview}/>}
          {page === "Price Books" && <PriceBooks data={data} save={save} activeStore={activeStore} activeStoreId={activeStoreId} setActiveStoreId={setActiveStoreId} notify={notify}/>}
          {page === "Invoices" && <Invoices data={data} save={save} setPreview={setPreview}/>}
          {page === "Quotes" && <Quotes data={data} save={save}/>}
          {page === "Tasks" && <Tasks data={data} save={save}/>}
        </section>
      </main>

      {toast && <div className="toast">{toast}</div>}
      {preview && <InvoicePreview invoice={preview} onClose={() => setPreview(null)}/>}
    </div>
  );
}

function Dashboard({data, activeStore, save, setPage}) {
  const products = activeStore?.products?.length || 0;
  const invoiceTotal = data.invoices.reduce((a,b) => a + Number(b.total || 0), 0);
  const pending = data.invoices.filter(x => x.status === "Pending").length;
  const done = data.tasks.filter(t => t.done).length;
  const progress = data.tasks.length ? Math.round(done / data.tasks.length * 100) : 0;
  const chart = [
    {m:"Apr", revenue: 36200, invoices: 22},
    {m:"May", revenue: 41400, invoices: 25},
    {m:"Jun", revenue: 38900, invoices: 24},
    {m:"Jul", revenue: 46800, invoices: 29},
    {m:"Aug", revenue: 50100, invoices: 31},
    {m:"Sep", revenue: 53200, invoices: 34}
  ];

  const toggleTask = (id) => save({...data, tasks: data.tasks.map(t => t.id === id ? {...t, done: !t.done} : t)});

  return <>
    <div className="stats-grid">
      <Stat icon={PackageSearch} label="Active SKUs" value={products.toLocaleString()} note={`${activeStore?.name || "Store"} price book`} />
      <Stat icon={CircleDollarSign} label="Invoice Volume" value={money(invoiceTotal)} note={`${data.invoices.length} invoices tracked`} />
      <Stat icon={ReceiptText} label="Pending Review" value={pending} note="Invoices needing attention" />
      <Stat icon={CheckSquare} label="Tasks Complete" value={`${progress}%`} note={`${done} of ${data.tasks.length} completed`} />
    </div>

    <div className="dashboard-grid">
      <div className="panel chart-panel">
        <div className="panel-title"><div><h3>Revenue overview</h3><p>Monthly business activity</p></div><button className="ghost">Last 6 months <ChevronDown size={15}/></button></div>
        <div style={{height: 300}}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#22293a"/>
              <XAxis dataKey="m" stroke="#7d879f" axisLine={false} tickLine={false}/>
              <YAxis stroke="#7d879f" axisLine={false} tickLine={false} tickFormatter={v => `$${v/1000}k`}/>
              <Tooltip contentStyle={{background:"#141927", border:"1px solid #293047", borderRadius:12}} formatter={v => money(v)}/>
              <Bar dataKey="revenue" fill="#8b5cf6" radius={[7,7,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title"><div><h3>Tasks</h3><p>{progress}% complete</p></div><button className="icon-btn" onClick={()=>setPage("Tasks")}><ArrowUpRight size={18}/></button></div>
        <div className="progress"><span style={{width:`${progress}%`}}/></div>
        <div className="task-list">
          {data.tasks.slice(0,5).map(t => (
            <label className="task-row" key={t.id}>
              <input type="checkbox" checked={t.done} onChange={()=>toggleTask(t.id)}/>
              <div><strong className={t.done ? "strike":""}>{t.title}</strong><span className={`tag ${t.tag.toLowerCase()}`}>{t.tag}</span></div>
            </label>
          ))}
        </div>
      </div>
    </div>

    <div className="panel">
      <div className="panel-title"><div><h3>Recent invoices</h3><p>Latest vendor documents</p></div><button className="ghost" onClick={()=>setPage("Invoices")}>View all</button></div>
      <InvoiceTable invoices={data.invoices.slice(0,5)} compact/>
    </div>
  </>;
}

function Stat({icon:Icon,label,value,note}) {
  return <div className="stat-card">
    <div className="stat-icon"><Icon size={20}/></div>
    <span>{label}</span><strong>{value}</strong><small>{note}</small>
  </div>;
}

function AIParser({data, save, activeStore, notify, setPreview}) {
  const [files, setFiles] = useState([]);
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);
  const [parsed, setParsed] = useState(null);
  const inputRef = useRef();

  const handleAddFiles = (incoming) => {
    const arr = Array.from(incoming || []);
    if (!arr.length) return;
    setFiles(prev => {
      const existingNames = new Set(prev.map(f => `${f.name}-${f.size}`));
      const newFiles = arr.filter(f => !existingNames.has(`${f.name}-${f.size}`));
      return [...prev, ...newFiles];
    });
  };

  const removeFile = (index, e) => {
    e.stopPropagation();
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const parse = async () => {
    if (!files.length) return notify("Choose one or more invoice images or PDFs first.");
    setLoading(true);
    try {
      const form = new FormData();
      for (const f of files) {
        form.append("invoices", f);
      }
      form.append("storeProducts", JSON.stringify(activeStore?.products || []));
      const r = await fetch("/api/parse-invoice", {method:"POST", body:form});
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Parser failed");
      setParsed(body);
      notify(`Invoice parsed (${files.length} page${files.length > 1 ? "s" : ""}).`);
    } catch (e) {
      notify(e.message);
    } finally { setLoading(false); }
  };

  const saveInvoice = () => {
    if (!parsed) return;
    const inv = {
      id: parsed.invoiceNumber || `INV-${Date.now().toString().slice(-5)}`,
      vendor: parsed.vendor || "Unknown Vendor",
      date: parsed.invoiceDate || new Date().toISOString().slice(0,10),
      total: Number(parsed.total || 0),
      status: "Pending",
      storeId: activeStore?.id,
      items: parsed.items?.length || 0,
      detail: parsed
    };
    save({...data, invoices:[inv, ...data.invoices]});
    notify("Invoice saved to ledger.");
    setPreview(inv);
  };

  return <div className="parser-layout">
    <div className="panel upload-panel">
      <div className="panel-title"><div><h3>AI Invoice Scanner</h3><p>Upload multi-page invoice photos or PDFs for Gemini multi-image extraction.</p></div><div className="ai-badge"><Sparkles size={15}/> Gemini</div></div>
      <div
        className={`dropzone ${drag ? "drag":""}`}
        onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)}
        onDrop={e=>{e.preventDefault();setDrag(false);handleAddFiles(e.dataTransfer.files)}}
        onClick={()=>inputRef.current?.click()}
      >
        <UploadCloud size={38}/>
        {!files.length ? (
          <>
            <h3>Drop invoice page(s) or photos here</h3>
            <p>PDF, PNG, JPG or WEBP (multiple files allowed)</p>
            <button className="secondary" type="button">Browse files</button>
          </>
        ) : (
          <>
            <h3>{files.length} invoice page{files.length > 1 ? "s" : ""} selected</h3>
            <div className="files-preview-list">
              {files.map((f, i) => (
                <div key={i} className="file-chip">
                  <span>{f.name}</span>
                  <button type="button" onClick={(e) => removeFile(i, e)}><X size={13}/></button>
                </div>
              ))}
            </div>
            <button className="secondary" type="button" onClick={(e)=>{e.stopPropagation();inputRef.current?.click();}}>+ Add more pages</button>
          </>
        )}
        <input ref={inputRef} type="file" accept=".pdf,image/*" multiple hidden onChange={e=>{handleAddFiles(e.target.files); e.target.value="";}}/>
      </div>
      <div className="parser-actions">
        <div><Building2 size={17}/><span>Compare against <b>{activeStore?.name}</b></span></div>
        <button className="primary" onClick={parse} disabled={loading || !files.length}>{loading ? `Scanning ${files.length} page(s)…` : `Scan ${files.length ? files.length : ""} Page(s) with Gemini`}</button>
      </div>
    </div>

    <div className="panel result-panel">
      {!parsed ? <div className="empty"><Sparkles size={34}/><h3>AI results appear here</h3><p>Koko will extract vendor details, line items across all pages, UPCs, cost, SRP and price differences.</p></div> :
      <>
        <div className="panel-title">
          <div><h3>{parsed.vendor || "Parsed Invoice"}</h3><p>{parsed.invoiceNumber || "No invoice number"} · {parsed.invoiceDate || "Date unavailable"}</p></div>
          <div className="result-total"><span>Total</span><strong>{money(parsed.total)}</strong></div>
        </div>
        <div className="table-wrap result-table">
          <table>
            <thead><tr><th>UPC</th><th>Description</th><th>Category</th><th>Cost</th><th>POS</th><th>Diff</th></tr></thead>
            <tbody>{(parsed.items||[]).map((item,i) => {
              const diff = Number(item.priceDifference || 0);
              return <tr key={i}>
                <td className="mono">{item.upc || "—"}</td><td><b>{item.description || "Unknown"}</b></td><td>{item.category || "Misc"}</td>
                <td>{money(item.unitPrice)}</td><td>{item.matchedRetail == null ? "—" : money(item.matchedRetail)}</td>
                <td className={diff > 0 ? "negative" : diff < 0 ? "positive" : ""}>{diff === 0 ? "—" : `${diff > 0 ? "+" : ""}${money(diff)}`}</td>
              </tr>
            })}</tbody>
          </table>
        </div>
        <div className="save-bar"><span>{parsed.items?.length || 0} line items extracted</span><button className="primary" onClick={saveInvoice}>Save invoice</button></div>
      </>}
    </div>
  </div>;
}

function PriceBooks({data, save, activeStore, activeStoreId, setActiveStoreId, notify}) {
  const [query, setQuery] = useState("");
  const fileRef = useRef();

  const importCsv = (file) => {
    Papa.parse(file, {
      header:true, skipEmptyLines:true,
      complete: ({data:rows}) => {
        const products = rows.map(r => ({
          upc: String(r.UPC ?? r["UPC/PLU"] ?? r.upc ?? r.PLU ?? "").trim(),
          name: r.Name ?? r.Product ?? r.Description ?? r.name ?? "Unnamed item",
          department: r.Department ?? r.Category ?? r.department ?? "Miscellaneous",
          retail: Number(r.Price ?? r.Retail ?? r.SRP ?? r.retail ?? 0)
        })).filter(x => x.upc || x.name);
        const stores = data.stores.map(s => s.id === activeStoreId ? {...s, products} : s);
        save({...data, stores});
        notify(`Imported ${products.length} products.`);
      }
    });
  };

  const addStore = () => {
    const n = data.stores.length + 1;
    const s = {id:uid(), name:`Store #${100+n}`, location:"New location", products:[]};
    save({...data, stores:[...data.stores,s]}); setActiveStoreId(s.id);
  };

  const clear = () => {
    if (!activeStore) return;
    save({...data, stores:data.stores.map(s=>s.id===activeStore.id?{...s,products:[]}:s)});
    notify("Price book cleared.");
  };

  const downloadSample = () => {
    const csv = "UPC,Name,Department,Price\n049000050103,Coca-Cola 20oz,Beverages,2.49\n";
    const blob = new Blob([csv], {type:"text/csv"});
    const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="koko-pricebook-template.csv"; a.click(); URL.revokeObjectURL(a.href);
  };

  const products = (activeStore?.products || []).filter(p => `${p.upc} ${p.name} ${p.department}`.toLowerCase().includes(query.toLowerCase()));

  return <>
    <div className="panel store-switcher">
      <div className="store-tabs">
        {data.stores.map(s=><button className={s.id===activeStoreId?"store-tab active":"store-tab"} key={s.id} onClick={()=>setActiveStoreId(s.id)}><Store size={16}/>{s.name}<small>{s.products.length} SKUs</small></button>)}
        <button className="store-tab add" onClick={addStore}><Plus size={17}/> Add store</button>
      </div>
    </div>

    <div className="panel">
      <div className="panel-title">
        <div><h3>{activeStore?.name} Price Book</h3><p>{activeStore?.location} · {activeStore?.products?.length || 0} products</p></div>
        <div className="inline-actions">
          <button className="ghost" onClick={downloadSample}><Download size={16}/> Sample CSV</button>
          <button className="secondary" onClick={()=>fileRef.current?.click()}><UploadCloud size={16}/> Import CSV</button>
          <input ref={fileRef} type="file" accept=".csv" hidden onChange={e=>e.target.files[0] && importCsv(e.target.files[0])}/>
          <button className="danger-btn" onClick={clear}><Trash2 size={16}/></button>
        </div>
      </div>
      <div className="searchbar"><Search size={17}/><input placeholder="Search UPC, product or department…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
      <div className="table-wrap">
        <table><thead><tr><th>UPC / PLU</th><th>Product</th><th>Department</th><th>Retail</th></tr></thead>
        <tbody>{products.map((p,i)=><tr key={`${p.upc}-${i}`}><td className="mono">{p.upc || "—"}</td><td><b>{p.name}</b></td><td>{p.department}</td><td><b>{money(p.retail)}</b></td></tr>)}
        {!products.length && <tr><td colSpan="4"><div className="empty small">No products found. Import a CSV price book.</div></td></tr>}
        </tbody></table>
      </div>
    </div>
  </>;
}

function Invoices({data, save, setPreview}) {
  const [filter,setFilter] = useState("All");
  const rows = filter==="All"?data.invoices:data.invoices.filter(i=>i.status===filter);
  const setStatus = (id,status)=>save({...data,invoices:data.invoices.map(i=>i.id===id?{...i,status}:i)});

  return <div className="panel">
    <div className="panel-title"><div><h3>Invoice Ledger</h3><p>Track vendor invoices and review payment status.</p></div>
      <div className="segmented">{["All","Paid","Pending","Draft"].map(x=><button className={filter===x?"active":""} onClick={()=>setFilter(x)} key={x}>{x}</button>)}</div>
    </div>
    <InvoiceTable invoices={rows} onOpen={setPreview} onStatus={setStatus}/>
  </div>;
}

function InvoiceTable({invoices, compact, onOpen, onStatus}) {
  return <div className="table-wrap"><table>
    <thead><tr><th>Invoice</th><th>Vendor</th><th>Date</th><th>Items</th><th>Status</th><th>Total</th>{!compact&&<th/>}</tr></thead>
    <tbody>{invoices.map(inv=><tr key={inv.id}>
      <td><b className="purple">{inv.id}</b></td><td><b>{inv.vendor}</b></td><td>{inv.date}</td><td>{inv.items || 0}</td>
      <td>{onStatus ? <select className={`status ${inv.status.toLowerCase()}`} value={inv.status} onChange={e=>onStatus(inv.id,e.target.value)}><option>Paid</option><option>Pending</option><option>Draft</option></select> : <span className={`status ${inv.status.toLowerCase()}`}>{inv.status}</span>}</td>
      <td><b>{money(inv.total)}</b></td>
      {!compact&&<td><button className="icon-btn" onClick={()=>onOpen(inv)}><MoreHorizontal size={18}/></button></td>}
    </tr>)}</tbody>
  </table></div>;
}

function Quotes({data, save}) {
  const [show,setShow] = useState(false);
  const [form,setForm] = useState({client:"",vendor:"",amount:"",date:new Date().toISOString().slice(0,10)});
  const add=()=>{ if(!form.vendor) return; save({...data,quotes:[{id:`Q-${Date.now().toString().slice(-4)}`,status:"Open",...form,amount:Number(form.amount||0)},...data.quotes]}); setShow(false); };
  return <>
    <div className="panel">
      <div className="panel-title"><div><h3>Quotes</h3><p>Track vendor and client pricing proposals.</p></div><button className="primary" onClick={()=>setShow(true)}><Plus size={16}/> New quote</button></div>
      <div className="table-wrap"><table><thead><tr><th>Quote</th><th>Client / Store</th><th>Vendor</th><th>Date</th><th>Status</th><th>Amount</th></tr></thead>
        <tbody>{data.quotes.map(q=><tr key={q.id}><td><b className="purple">{q.id}</b></td><td>{q.client}</td><td><b>{q.vendor}</b></td><td>{q.date}</td><td><span className="status pending">{q.status}</span></td><td><b>{money(q.amount)}</b></td></tr>)}</tbody>
      </table></div>
    </div>
    {show && <Modal title="New quote" onClose={()=>setShow(false)}><div className="form-grid">
      <Field label="Client / Store"><input value={form.client} onChange={e=>setForm({...form,client:e.target.value})}/></Field>
      <Field label="Vendor"><input value={form.vendor} onChange={e=>setForm({...form,vendor:e.target.value})}/></Field>
      <Field label="Amount"><input type="number" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></Field>
      <Field label="Date"><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></Field>
      <button className="primary span2" onClick={add}>Create quote</button>
    </div></Modal>}
  </>;
}

function Tasks({data, save}) {
  const [title,setTitle]=useState("");
  const [tag,setTag]=useState("Invoice");
  const add=()=>{if(!title.trim())return;save({...data,tasks:[{id:uid(),title:title.trim(),tag,done:false},...data.tasks]});setTitle("")};
  const toggle=id=>save({...data,tasks:data.tasks.map(t=>t.id===id?{...t,done:!t.done}:t)});
  const del=id=>save({...data,tasks:data.tasks.filter(t=>t.id!==id)});
  return <div className="tasks-page">
    <div className="panel">
      <div className="panel-title"><div><h3>Task Manager</h3><p>Keep invoice, quote and price-book work moving.</p></div></div>
      <div className="new-task"><input placeholder="Add a task…" value={title} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()}/><select value={tag} onChange={e=>setTag(e.target.value)}><option>Invoice</option><option>PriceBook</option><option>Quote</option><option>Client</option></select><button className="primary" onClick={add}><Plus size={16}/> Add</button></div>
      <div className="full-task-list">{data.tasks.map(t=><div className="full-task" key={t.id}><button className="check" onClick={()=>toggle(t.id)}>{t.done?<CheckCircle2 size={21}/>:<CircleDashed size={21}/>}</button><div><b className={t.done?"strike":""}>{t.title}</b><span className={`tag ${t.tag.toLowerCase()}`}>{t.tag}</span></div><button className="icon-btn" onClick={()=>del(t.id)}><Trash2 size={17}/></button></div>)}</div>
    </div>
  </div>;
}

const CODE128_PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","411112","411211","122141",
  "114212","124112","124211","411221","421121","421211","212141","214121","412121","111143",
  "111341","131141","114113","114311","411113","411311","113141","114131","311141","411131",
  "211412","211214","211232","211133","211331","211431","2331112"
];

function BarcodeGtin14({ upc }) {
  const digits = String(upc || "").replace(/\D/g, "").padStart(14, "0").slice(-14);
  const codes = [105];
  for (let i = 0; i < digits.length; i += 2) {
    codes.push(parseInt(digits.slice(i, i + 2), 10));
  }
  let checksum = codes[0];
  for (let i = 1; i < codes.length; i++) {
    checksum += i * codes[i];
  }
  codes.push(checksum % 103);
  codes.push(106);

  const bars = [];
  let x = 10;
  for (const code of codes) {
    const pat = CODE128_PATTERNS[code] || "211232";
    let isBar = true;
    for (let c = 0; c < pat.length; c++) {
      const width = parseInt(pat[c], 10);
      if (isBar) {
        bars.push(<rect key={`${x}-${c}`} x={x} y={0} width={width * 1.3} height={26} fill="black" />);
      }
      x += width * 1.3;
      isBar = !isBar;
    }
  }
  const totalWidth = x + 10;
  return (
    <div className="gtin-barcode">
      <svg viewBox={`0 0 ${totalWidth} 40`} width="100%" height="38" xmlns="http://www.w3.org/2000/svg">
        {bars}
        <text x={totalWidth / 2} y={38} fontSize="9.5" fontFamily="monospace" textAnchor="middle" fill="#111827">
          GTIN-14: {digits}
        </text>
      </svg>
    </div>
  );
}

function InvoicePreview({invoice,onClose}) {
  const detail=invoice.detail || {};
  return <div className="modal-backdrop">
    <div className="preview-modal">
      <div className="preview-toolbar"><div><b>Koko Invoice Preview</b><span>{invoice.id}</span></div><div><button className="ghost" onClick={()=>window.print()}><Printer size={16}/> Print / PDF</button><button className="icon-btn" onClick={onClose}><X size={18}/></button></div></div>
      <div className="print-sheet">
        <div className="invoice-head"><div><div className="brand-mark large">K</div><h2>Koko Invoice</h2></div><div><span>INVOICE</span><strong>{invoice.id}</strong></div></div>
        <div className="invoice-meta"><div><small>VENDOR</small><b>{invoice.vendor}</b></div><div><small>DATE</small><b>{invoice.date}</b></div><div><small>STATUS</small><b>{invoice.status}</b></div><div><small>TOTAL</small><b>{money(invoice.total)}</b></div></div>
        {detail.items?.length ? <table className="print-table"><thead><tr><th>UPC</th><th>Description</th><th>Qty</th><th>SRP</th><th>POS</th><th>L/P</th></tr></thead><tbody>{detail.items.map((it,i)=>{
          const srpVal = Number(it.srp || (it.unitPrice ? (it.unitPrice / 0.8) : 0));
          const posVal = it.matchedRetail != null ? Number(it.matchedRetail) : null;
          const lpVal = posVal == null ? null : Number((posVal - srpVal).toFixed(2));
          let lpColor = "#000000";
          if (lpVal !== null && lpVal !== 0) {
            if (lpVal < 0) lpColor = "#dc2626";
            else if (lpVal > 0) lpColor = "#16a34a";
          }
          return <tr key={i}>
            <td>{it.upc||"—"}</td>
            <td>{it.description}</td>
            <td>{it.quantity||1}</td>
            <td>{money(srpVal)}</td>
            <td>{posVal==null?"—":money(posVal)}</td>
            <td style={{color: lpColor, fontWeight: lpVal !== 0 ? 600 : 400}}>{lpVal==null ? "—" : money(lpVal)}</td>
          </tr>;
        })}</tbody></table> : <div className="empty small">Detailed line items were not stored for this sample invoice.</div>}
        <div className="invoice-total"><span>Invoice Total</span><strong>{money(invoice.total)}</strong></div>
      </div>

      {detail.items?.length ? (
        <div className="print-sheet page-break">
          <div className="tags-header">
            <div>
              <h2>Price Cards</h2>
              <span>Generated from Invoice {invoice.id} ({detail.items.length} items)</span>
            </div>
            <div className="brand-mark">K</div>
          </div>
          <div className="tags-grid">
            {detail.items.map((it, i) => {
              const srpVal = Number(it.srp || (it.unitPrice ? (it.unitPrice / 0.8) : 0));
              const posVal = it.matchedRetail != null ? Number(it.matchedRetail) : null;
              const lpVal = posVal == null ? null : Number((posVal - srpVal).toFixed(2));
              let lpColor = "#000000";
              if (lpVal !== null && lpVal !== 0) {
                if (lpVal < 0) lpColor = "#dc2626";
                else if (lpVal > 0) lpColor = "#16a34a";
              }
              return (
                <div className="shelf-tag" key={i}>
                  <div className="tag-header">
                    <span className="tag-brand">KOKO RETAIL</span>
                    <span className="tag-cat">{it.category || "General"}</span>
                  </div>
                  <div className="tag-title">{it.description || "Unnamed Item"}</div>
                  <BarcodeGtin14 upc={it.upc} />
                  <div className="tag-prices">
                    <div className="tag-price-block">
                      <small>POS</small>
                      <strong>{posVal == null ? "—" : money(posVal)}</strong>
                    </div>
                    <div className="tag-price-block">
                      <small>SRP</small>
                      <span>{money(srpVal)}</span>
                    </div>
                    <div className="tag-price-block">
                      <small>L/P</small>
                      <span style={{ color: lpColor, fontWeight: 700 }}>
                        {lpVal == null ? "—" : money(lpVal)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  </div>;
}

function Modal({title,onClose,children}) {
  return <div className="modal-backdrop"><div className="modal"><div className="modal-title"><h3>{title}</h3><button className="icon-btn" onClick={onClose}><X size={18}/></button></div>{children}</div></div>;
}
function Field({label,children}) { return <label className="field"><span>{label}</span>{children}</label> }

createRoot(document.getElementById("root")).render(<App />);
