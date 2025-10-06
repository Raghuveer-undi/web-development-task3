// server.js
// Backend-only REST API for dashboard data (in-memory demo data)
// Run: node server.js  (or npm run dev if using nodemon)

const express = require('express');
const morgan = require('morgan');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// =====================
// Sample data generator
// =====================
// Each record: { id, date: 'YYYY-MM-DD', region, product, sales, profit }
const SAMPLE_DAYS = 120;
const regions = ['North', 'South', 'East', 'West'];
const products = ['Gadget', 'Widget', 'Doohickey', 'Apparel'];

function generateSampleData() {
  const arr = [];
  const start = new Date();
  start.setDate(start.getDate() - (SAMPLE_DAYS - 1)); // earliest date
  let id = 1;
  for (let i = 0; i < SAMPLE_DAYS; i++) {
    const dt = new Date(start);
    dt.setDate(start.getDate() + i);
    const iso = dt.toISOString().slice(0, 10);
    // generate several records per day
    const recordsPerDay = 4 + Math.floor(Math.random() * 6); // 4..9
    for (let j = 0; j < recordsPerDay; j++) {
      const region = regions[Math.floor(Math.random() * regions.length)];
      const product = products[Math.floor(Math.random() * products.length)];
      const sales = Math.round((200 + Math.random() * 1500) * (1 + Math.random() * 0.5));
      const profit = Math.round(sales * (0.08 + Math.random() * 0.3));
      arr.push({ id: id++, date: iso, region, product, sales, profit });
    }
  }
  return arr;
}

let DATA = generateSampleData();

// ================
// Helper functions
// ================
function parseDateSafe(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function dateDiffDays(a, b) {
  return Math.round((new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24));
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function aggregateKPIs(records, fullData, start, end) {
  const totalSales = records.reduce((s, r) => s + r.sales, 0);
  const totalProfit = records.reduce((s, r) => s + r.profit, 0);
  const orders = records.length;

  // growth vs previous period
  let growth = 0;
  if (start && end) {
    const days = dateDiffDays(start, end);
    const prevStart = addDays(start, -(days + 1));
    const prevEnd = addDays(start, -1);
    const prevRecords = fullData.filter(r => r.date >= prevStart && r.date <= prevEnd);
    const prevSales = prevRecords.reduce((s, r) => s + r.sales, 0);
    growth = prevSales === 0 ? (totalSales === 0 ? 0 : 1) : (totalSales - prevSales) / prevSales;
  }

  return { totalSales, totalProfit, orders, growth };
}

// ====================
// API Endpoints
// ====================

// Health check
app.get('/', (req, res) => res.json({ success: true, message: 'Dashboard backend running' }));

// GET /api/filters
// Returns available regions and products (for slicers)
app.get('/api/filters', (req, res) => {
  const uniqueRegions = Array.from(new Set(DATA.map(d => d.region))).sort();
  const uniqueProducts = Array.from(new Set(DATA.map(d => d.product))).sort();
  res.json({ success: true, data: { regions: uniqueRegions, products: uniqueProducts } });
});

// GET /api/records
// Query params:
//   start (YYYY-MM-DD), end (YYYY-MM-DD), region, product
//   page (1-based), limit (per page), sort (date|sales|profit), order (asc|desc)
// Example: /api/records?start=2025-09-01&end=2025-09-30&region=North&page=1&limit=10
app.get('/api/records', (req, res) => {
  try {
    const { start, end, region, product, page = 1, limit = 20, sort = 'date', order = 'asc' } = req.query;

    const startDate = parseDateSafe(start);
    const endDate = parseDateSafe(end);

    let arr = DATA.slice();

    if (startDate) arr = arr.filter(r => r.date >= startDate);
    if (endDate) arr = arr.filter(r => r.date <= endDate);
    if (region && region !== 'All') arr = arr.filter(r => r.region === region);
    if (product && product !== 'All') arr = arr.filter(r => r.product === product);

    // sorting
    const validSort = ['date', 'sales', 'profit'];
    const s = validSort.includes(sort) ? sort : 'date';
    const multiplier = order === 'desc' ? -1 : 1;
    arr.sort((a, b) => {
      if (s === 'date') return multiplier * (a.date.localeCompare(b.date));
      return multiplier * (a[s] - b[s]);
    });

    const total = arr.length;
    const pg = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.max(1, parseInt(limit, 10) || 20);
    const startIdx = (pg - 1) * lim;
    const paginated = arr.slice(startIdx, startIdx + lim);

    res.json({
      success: true,
      meta: { total, page: pg, limit: lim },
      data: paginated
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/kpis
// Returns aggregated KPIs for current filter (and growth vs prev period)
app.get('/api/kpis', (req, res) => {
  try {
    const { start, end, region, product } = req.query;
    const startDate = parseDateSafe(start);
    const endDate = parseDateSafe(end);

    let arr = DATA.slice();
    if (startDate) arr = arr.filter(r => r.date >= startDate);
    if (endDate) arr = arr.filter(r => r.date <= endDate);
    if (region && region !== 'All') arr = arr.filter(r => r.region === region);
    if (product && product !== 'All') arr = arr.filter(r => r.product === product);

    const kpis = aggregateKPIs(arr, DATA, startDate, endDate);
    res.json({ success: true, data: kpis });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/insights
// Returns top region/product and average order value for current filter
app.get('/api/insights', (req, res) => {
  try {
    const { start, end, region, product } = req.query;
    const startDate = parseDateSafe(start);
    const endDate = parseDateSafe(end);

    let arr = DATA.slice();
    if (startDate) arr = arr.filter(r => r.date >= startDate);
    if (endDate) arr = arr.filter(r => r.date <= endDate);
    if (region && region !== 'All') arr = arr.filter(r => r.region === region);
    if (product && product !== 'All') arr = arr.filter(r => r.product === product);

    const regionAgg = {};
    const productAgg = {};
    for (const r of arr) {
      regionAgg[r.region] = (regionAgg[r.region] || 0) + r.sales;
      productAgg[r.product] = (productAgg[r.product] || 0) + r.sales;
    }
    const topRegion = Object.entries(regionAgg).sort((a, b) => b[1] - a[1])[0] || null;
    const topProduct = Object.entries(productAgg).sort((a, b) => b[1] - a[1])[0] || null;
    const avgOrder = arr.length ? arr.reduce((s, r) => s + r.sales, 0) / arr.length : 0;

    res.json({
      success: true,
      data: {
        topRegion: topRegion ? { region: topRegion[0], sales: topRegion[1] } : null,
        topProduct: topProduct ? { product: topProduct[0], sales: topProduct[1] } : null,
        avgOrder
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// (Optional) Endpoint to reload sample data in runtime for testing
app.post('/api/reload-sample', (req, res) => {
  DATA = generateSampleData();
  res.json({ success: true, message: 'Sample data reloaded', total: DATA.length });
});

// Fallback 404
app.use((req, res) => res.status(404).json({ success: false, message: 'Endpoint not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  res.status(500).json({ success: false, message: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Dashboard backend running at http://localhost:${PORT}`);
});
