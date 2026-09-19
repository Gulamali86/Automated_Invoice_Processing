const express = require('express');
const multer = require('multer');
const axios = require('axios');
const PDFDocument = require('pdfkit');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 1. MAIN PAGE ROUTE
app.get('/', (req, res) => {
const defaultInvoice = {
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
res.render('index', { invoice: defaultInvoice, calculated, targetCurrency: 'USD' });
});

// 2. FILE UPLOAD ROUTE
app.post('/upload', upload.single('invoiceFile'), (req, res) => {
const extractedInvoice = {
party1: { name: 'Extracted Vendor Co', address: '789 OCR Boulevard', email: 'support@ocrvendor.com', taxId: 'VAT-445566' },
party2: { name: 'Extracted Client Inc', address: '101 Data Way', email: 'finance@ocrclient.com', taxId: 'TAX-778899' },
currency: 'USD',
taxRate: 18,
taxType: 'exclusive',
globalDiscount: 0,
items: [
{ description: 'Software License', qty: 2, rate: 150, discount: 5 },
{ description: 'Technical Support', qty: 5, rate: 40, discount: 0 }
 ]
};

const calculated = calculateInvoiceData(extractedInvoice.items, extractedInvoice.taxRate, extractedInvoice.taxType, extractedInvoice.globalDiscount, 1);
res.render('index', { invoice: extractedInvoice, calculated, targetCurrency: 'USD' });
});

// 3. RECALCULATE, CONVERT & PDF ROUTE
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
const response = await axios.get(https://open.er-api.com/v6/latest/${sourceCurr}`);
exchangeRate = response.data.rates[targetCurr] || 1;
} catch (err) {
console.error('Error fetching conversion rate, keeping 1:1:', err.message);
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

if (action === 'download_pdf') {
return generatePDFResponse(res, invoice, calculated, targetCurr);
}

res.render('index', { invoice, calculated, targetCurrency: targetCurr });
});

// 4. COMMERCIAL FINANCIAL ENGINE
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

// 5. PDF GENERATION ENGINE
function generatePDFResponse(res, invoice, calculated, curr) {
const doc = new PDFDocument({ margin: 40 });

res.setHeader('Content-Type', 'application/pdf');
res.setHeader('Content-Disposition', 'attachment; filename=invoice.pdf');

doc.pipe(res);

doc.fontSize(20).text('COMMERCIAL INVOICE', { align: 'center' });
doc.moveDown();

doc.fontSize(12).text(FROM:${invoice.party1.name}); doc.fontSize(10).text(Address: 

{invoice.party1.email}); doc.text(Tax ID: ${invoice.party1.taxId});
doc.moveDown();

doc.fontSize(12).text(TO:${invoice.party2.name}); doc.fontSize(10).text(Address: 

{invoice.party2.email}); doc.text(Tax ID: ${invoice.party2.taxId});
doc.moveDown();

doc.fontSize(12).text('ITEMS SUMMARY:');
doc.fontSize(10);
calculated.items.forEach((item, index) => {
doc.text(``${index + 1}. 

{item.qty} x 

{item.discount}%) = 

{curr}`);
});

doc.moveDown();
doc.fontSize(11);
doc.text(Subtotal: ${calculated.subtotalRaw.toFixed(2)} ${curr});
doc.text(Item Discounts: -${calculated.itemDiscountsTotal.toFixed(2)} ${curr});
doc.text(Global Discount: -${calculated.globalDiscountValue.toFixed(2)} ${curr});
doc.text(Tax Amount: ${calculated.taxAmount.toFixed(2)} ${curr});
doc.fontSize(13).text(Grand Total: ${calculated.grandTotal.toFixed(2)} ${curr});

doc.end();
}

app.listen(3000, () => console.log('Invoice App live at http://localhost:3000'));