const express = require('express');
const multer = require('multer');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const mongoose = require('mongoose');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Database Connection
const MONGO_URI = process.env.MONGO_URI || "YOUR_MONGODB_CONNECTION_STRING_HERE";
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB Cloud Database'))
  .catch(err => console.error('Database error:', err));

// Database Schema with Soft Delete (Recycle Bin) Support
const invoiceSchema = new mongoose.Schema({
  party1: Object,
  party2: Object,
  currency: String,
  taxRate: Number,
  taxType: String,
  globalDiscount: Number,
  items: Array,
  grandTotal: Number,
  isDeleted: { type: Boolean, default: false }, // Soft Delete Flag
  deletedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

const Invoice = mongoose.model('Invoice', invoiceSchema);

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 1. MAIN PAGE - Displays Active Invoices & Main Form
app.get('/', async (req, res) => {
  try {
    const activeInvoices = await Invoice.find({ isDeleted: false }).sort({ createdAt: -1 });
    
    const defaultInvoice = activeInvoices[0] || {
      party1: { name: 'Acme Corp Vendor', address: '123 Business Rd', email: 'billing@acme.com', taxId: 'VAT-998877' },
      party2: { name: 'Global Client LLC', address: '456 Client St', email: 'ap@globalclient.com', taxId: 'TAX-112233' },
      currency: 'USD',
      taxRate: 10,
      taxType: 'exclusive',
      globalDiscount: 5,
      items: [
        { description: 'Web Development Services', qty: 10, rate: 50, discount: 0 },
        { description: 'Cloud Setup & Configuration', qty: 1, rate: 200, discount: 10 }
      ]
    };

    const calculated = calculateInvoiceData(defaultInvoice.items, defaultInvoice.taxRate, defaultInvoice.taxType, defaultInvoice.globalDiscount, 1);
    
    res.render('index', { 
      invoice: defaultInvoice, 
      calculated, 
      targetCurrency: defaultInvoice.currency || 'USD',
      activeInvoices,
      viewMode: 'active'
    });
  } catch (err) {
    res.status(500).send('Database Error');
  }
});

// 2. RECYCLE BIN PAGE - Displays Soft-Deleted Invoices
app.get('/recycle-bin', async (req, res) => {
  try {
    const deletedInvoices = await Invoice.find({ isDeleted: true }).sort({ deletedAt: -1 });
    res.render('recycle-bin', { deletedInvoices });
  } catch (err) {
    res.status(500).send('Error fetching recycle bin');
  }
});

// 3. SAVE & RECALCULATE ROUTE
app.post('/recalculate', async (req, res) => {
  const {
    party1_name, party1_address, party1_email, party1_taxId,
    party2_name, party2_address, party2_email, party2_taxId,
    currency, targetCurrency, taxRate, taxType, globalDiscount,
    item_desc, item_qty, item_rate, item_discount, action
  } = req.body;

  const descriptions = Array.isArray(item_desc) ? item_desc : [item_desc];
  const quantities = Array.isArray(item_qty) ? item_qty : [item_qty];
  const rates = Array.isArray(item_rate) ? item_rate : [item_rate];
  const discounts = Array.isArray(item_discount) ? item_discount : [item_discount];

  const items = descriptions.map((desc, idx) => ({
    description: desc || 'Item',
    qty: parseFloat(quantities[idx]) || 0,
    rate: parseFloat(rates[idx]) || 0,
    discount: parseFloat(discounts[idx]) || 0
  }));

  let exchangeRate = 1;
  const sourceCurr = currency || 'USD';
  const targetCurr = targetCurrency || sourceCurr;

  if (sourceCurr !== targetCurr) {
    try {
      const response = await axios.get(`https://open.er-api.com/v6/latest/${sourceCurr}`);
      exchangeRate = response.data.rates[targetCurr] || 1;
    } catch (err) {
      console.error('Exchange rate error:', err.message);
    }
  }

  const invoice = {
    party1: { name: party1_name, address: party1_address, email: party1_email, taxId: party1_taxId },
    party2: { name: party2_name, address: party2_address, email: party2_email, taxId: party2_taxId },
    currency: sourceCurr,
    taxRate: parseFloat(taxRate) || 0,
    taxType: taxType || 'exclusive',
    globalDiscount: parseFloat(globalDiscount) || 0,
    items
  };

  const calculated = calculateInvoiceData(items, invoice.taxRate, invoice.taxType, invoice.globalDiscount, exchangeRate);

  // Permanently save to database when user clicks "Save Invoice"
  if (action === 'save_database') {
    await Invoice.create({
      ...invoice,
      grandTotal: calculated.grandTotal
    });
    return res.redirect('/');
  }

  // Export PDF
  if (action === 'download_pdf') {
    return generatePDFResponse(res, invoice, calculated, targetCurr);
  }

  const activeInvoices = await Invoice.find({ isDeleted: false }).sort({ createdAt: -1 });
  res.render('index', { invoice, calculated, targetCurrency: targetCurr, activeInvoices });
});

// 4. SOFT DELETE ROUTE (Move to Recycle Bin)
app.post('/delete/:id', async (req, res) => {
  await Invoice.findByIdAndUpdate(req.params.id, {
    isDeleted: true,
    deletedAt: new Date()
  });
  res.redirect('/');
});

// 5. RESTORE ROUTE (Move out of Recycle Bin)
app.post('/restore/:id', async (req, res) => {
  await Invoice.findByIdAndUpdate(req.params.id, {
    isDeleted: false,
    deletedAt: null
  });
  res.redirect('/recycle-bin');
});

// 6. PERMANENT DELETE ROUTE
app.post('/permanent-delete/:id', async (req, res) => {
  await Invoice.findByIdAndDelete(req.params.id);
  res.redirect('/recycle-bin');
});

// Financial Calculations Function
function calculateInvoiceData(items, taxRate, taxType, globalDiscountRate, exchangeRate) {
  let subtotalBeforeDiscount = 0;
  let totalItemDiscounts = 0;

  const processedItems = items.map(item => {
    const rawLineTotal = item.qty * item.rate;
    const itemDiscountVal = rawLineTotal * (item.discount / 100);
    const lineAfterDiscount = rawLineTotal - itemDiscountVal;
    const convertedAmount = lineAfterDiscount * exchangeRate;

    subtotalBeforeDiscount += rawLineTotal * exchangeRate;
    totalItemDiscounts += itemDiscountVal * exchangeRate;

    return { ...item, convertedAmount };
  });

  const subtotalAfterItemDiscounts = subtotalBeforeDiscount - totalItemDiscounts;
  const globalDiscountValue = subtotalAfterItemDiscounts * (globalDiscountRate / 100);
  const netTaxableAmount = subtotalAfterItemDiscounts - globalDiscountValue;

  let taxAmount = 0;
  let grandTotal = 0;

  if (taxType === 'inclusive') {
    grandTotal = netTaxableAmount;
    taxAmount = netTaxableAmount - (netTaxableAmount / (1 + (taxRate / 100)));
  } else {
    taxAmount = netTaxableAmount * (taxRate / 100);
    grandTotal = netTaxableAmount + taxAmount;
  }

  return {
    items: processedItems,
    subtotalRaw: subtotalBeforeDiscount,
    itemDiscountsTotal: totalItemDiscounts,
    globalDiscountValue,
    netTaxableAmount,
    taxAmount,
    grandTotal
  };
}

// PDF Generation Function
function generatePDFResponse(res, invoice, calculated, curr) {
  const doc = new PDFDocument({ margin: 40 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=invoice.pdf');

  doc.pipe(res);
  doc.fontSize(20).text('COMMERCIAL INVOICE', { align: 'center' });
  doc.moveDown();

  doc.fontSize(12).text(`FROM: ${invoice.party1.name}`);
  doc.fontSize(10).text(`Address: ${invoice.party1.address}`);
  doc.text(`Email: ${invoice.party1.email}`);
  doc.text(`Tax ID: ${invoice.party1.taxId}`);
  doc.moveDown();

  doc.fontSize(12).text(`TO: ${invoice.party2.name}`);
  doc.fontSize(10).text(`Address: ${invoice.party2.address}`);
  doc.text(`Email: ${invoice.party2.email}`);
  doc.text(`Tax ID: ${invoice.party2.taxId}`);
  doc.moveDown();

  doc.fontSize(12).text('ITEMS SUMMARY:');
  doc.fontSize(10);
  calculated.items.forEach((item, index) => {
    doc.text(`${index + 1}. ${item.description} - Qty: ${item.qty} x ${item.rate} (Disc: ${item.discount}%) = ${item.convertedAmount.toFixed(2)} ${curr}`);
  });

  doc.moveDown();
  doc.fontSize(11);
  doc.text(`Subtotal: ${calculated.subtotalRaw.toFixed(2)} ${curr}`);
  doc.text(`Item Discounts: -${calculated.itemDiscountsTotal.toFixed(2)} ${curr}`);
  doc.text(`Global Discount: -${calculated.globalDiscountValue.toFixed(2)} ${curr}`);
  doc.text(`Tax Amount: ${calculated.taxAmount.toFixed(2)} ${curr}`);
  doc.fontSize(13).text(`Grand Total: ${calculated.grandTotal.toFixed(2)} ${curr}`);

  doc.end();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server live on http://localhost:${PORT}`));
