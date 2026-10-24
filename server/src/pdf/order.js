import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { itDate } from '../lib/util.js';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const C = { teal: '#1C505E', blue: '#71B1BD', jet: '#01212C', silk: '#FFFAE3', grey: '#5B6B70', line: '#C9D9DC', light: '#EEF4F5' };
const MM = 2.8346;
const PAGE = { w: 595.28, h: 841.89 };
const M = { left: 18 * MM, right: 18 * MM, top: 12 * MM, bottom: 14 * MM };
const W = PAGE.w - M.left - M.right;
const TOP = 40 * MM;
const BOTTOM = PAGE.h - 30 * MM;
const fullDT = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

const STATUS = { BOZZA: 'Bozza', INVIATO: 'Inviato a Toscana Diagnostica', APPROVATO: 'Approvato, in attesa del magazzino', PRESO_IN_CARICO: 'Preso in carico dal magazzino', SPEDITO: 'Spedito', CONSEGNATO: 'Consegnato', IMMAGAZZINATO: 'Caricato nel magazzino interno', CHIUSO: 'Chiuso', ANNULLATO: 'Annullato' };

function letterhead(doc, company, order) {
  const top = M.top;
  if (company.logo) { try { doc.image(company.logo, M.left, top + 2, { fit: [66 * MM, 20 * MM] }); } catch { /* */ } }
  const contacts = [company.email, company.pec, company.website].filter(Boolean);
  let y = top + 3;
  doc.font('R').fontSize(8).fillColor(C.teal);
  for (const [i, txt] of contacts.entries()) {
    const tw = doc.widthOfString(txt);
    const x = PAGE.w - M.right - tw;
    try { doc.image(path.join(ASSETS, i < 2 ? 'icon-mail.png' : 'icon-web.png'), x - 11, y + 0.5, { width: 8 }); } catch { /* */ }
    doc.text(txt, x, y, { lineBreak: false });
    y += 13;
  }
  doc.font('B').fontSize(8.5).fillColor(C.teal).text(`TD-SGI-MOD252_00 · Rev. 00 · Richiesta di Approvvigionamento Materiale · Ordine ${order.number}`, M.left, TOP - 14, { width: W });
  doc.moveTo(M.left, TOP - 3).lineTo(PAGE.w - M.right, TOP - 3).lineWidth(.6).strokeColor(C.blue).stroke();
  const fy = PAGE.h - M.bottom - 20;
  doc.font('B').fontSize(8).fillColor(C.teal).text(company.name, M.left, fy, { width: W, align: 'center' });
  doc.font('R').fontSize(7.5).fillColor(C.teal).text(company.letterhead_footer || '', M.left, fy + 10, { width: W, align: 'center', lineGap: 1 });
}

function section(doc, y, title) {
  doc.rect(M.left, y, W, 14).fill(C.teal);
  doc.font('B').fontSize(9).fillColor('#fff').text(title, M.left + 6, y + 3, { width: W - 12 });
  return y + 18;
}

function kv(doc, x, y, w, label, value) {
  doc.font('R').fontSize(7).fillColor(C.grey).text(label, x, y, { width: w });
  doc.font('B').fontSize(9).fillColor(C.jet).text(value || '–', x, y + 9, { width: w - 6, height: 22, ellipsis: true });
}

async function barcode(text) {
  try { return await bwipjs.toBuffer({ bcid: 'code128', text, scale: 2, height: 9, includetext: false, backgroundcolor: 'FFFFFF' }); } catch { return null; }
}

/** PDF dell'ordine: Sezione A dati struttura, B righe (richiesto, produzione, approvato, ricevuto, lotti), D presa in carico TD. */
export async function buildOrderPdf({ order, struttura, lines, company, packages = [], events = [] }) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, bufferPages: true, info: { Title: `Ordine ${order.number}`, Author: company.name, Subject: 'Ordine di materiale', Creator: 'TD Orders Management' } });
  doc.registerFont('R', path.join(ASSETS, 'LiberationSans-Regular.ttf'));
  doc.registerFont('B', path.join(ASSETS, 'LiberationSans-Bold.ttf'));
  const chunks = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const bc = await barcode(order.number);
  const newPage = () => { doc.addPage(); letterhead(doc, company, order); return TOP + 2; };
  let y = newPage();

  // Testata
  doc.font('B').fontSize(16).fillColor(C.jet).text(`Ordine ${order.number}`, M.left, y);
  doc.font('R').fontSize(9).fillColor(C.grey).text(`${order.kind === 'CLIENTE' ? 'Cliente Service' : order.kind === 'SEDE' ? 'Sede del network' : 'Laboratorio TD'} · ${STATUS[order.status] || order.status}${order.urgent ? ' · URGENTE' : ''}`, M.left, y + 20);
  if (bc) doc.image(bc, PAGE.w - M.right - 150, y, { width: 150, height: 28 });
  doc.font('R').fontSize(7.5).fillColor(C.grey).text(order.number, PAGE.w - M.right - 150, y + 30, { width: 150, align: 'center' });
  y += 44;

  y = section(doc, y, 'Sezione A · Struttura richiedente e punto di consegna');
  const cw = W / 3;
  kv(doc, M.left, y, cw * 1.5, 'Ragione sociale', struttura.name); kv(doc, M.left + cw * 1.5, y, cw * 0.75, 'Codice', struttura.code); kv(doc, M.left + cw * 2.25, y, cw * 0.75, 'Codice StudioLab', struttura.studiolab_code);
  y += 24;
  kv(doc, M.left, y, cw * 1.5, 'Indirizzo di consegna', [struttura.address, [struttura.zip, struttura.city, struttura.province && `(${struttura.province})`].filter(Boolean).join(' ')].filter(Boolean).join(', '));
  kv(doc, M.left + cw * 1.5, y, cw * 0.75, 'Referente', struttura.referente); kv(doc, M.left + cw * 2.25, y, cw * 0.75, 'Telefono', struttura.referente_phone || struttura.phone);
  y += 24;
  kv(doc, M.left, y, cw * 0.75, 'Data richiesta', itDate(order.submitted_at || order.created_at)); kv(doc, M.left + cw * 0.75, y, cw * 0.75, 'Rif. cliente', order.client_ref);
  kv(doc, M.left + cw * 1.5, y, cw * 0.75, 'Tipo', order.urgent ? 'Urgente' : 'Ordinaria'); kv(doc, M.left + cw * 2.25, y, cw * 0.75, 'Consegna', struttura.delivery_mode === 'RITIRO' ? 'Ritiro presso TD' : 'Giro logistico TD');
  y += 24;
  if (order.notes || order.urgent_reason) { kv(doc, M.left, y, W, 'Note', [order.urgent_reason && `Urgenza: ${order.urgent_reason}`, order.notes].filter(Boolean).join(' · ')); y += 24; }

  // Sezione B
  y = section(doc, y, 'Sezione B · Materiale richiesto (quantità in confezioni; tra parentesi l\'unità del modulo)');
  const cols = [
    { k: 'art', t: 'Articolo', w: W - 345, al: 'left' },
    { k: 'req', t: 'Richiesto', w: 48, al: 'right' },
    { k: 'prod', t: 'Produz. media', w: 62, al: 'right' },
    { k: 'delta', t: 'Δ %', w: 40, al: 'right' },
    { k: 'app', t: 'Approvato TD', w: 60, al: 'right' },
    { k: 'ric', t: 'Ricevuto', w: 45, al: 'right' },
    { k: 'lot', t: 'Lotti / scad.', w: 90, al: 'left' },
  ];
  const header = () => {
    let x = M.left;
    doc.rect(M.left, y, W, 13).fill(C.light);
    doc.font('B').fontSize(7).fillColor(C.teal);
    for (const c of cols) { doc.text(c.t, x + 3, y + 3.5, { width: c.w - 6, align: c.al, lineBreak: false }); x += c.w; }
    y += 15;
  };
  header();
  const byLine = new Map();
  for (const p of packages) if (p.lot || p.expiry) byLine.set(p.line_id, [...(byLine.get(p.line_id) || []), p]);
  let lastCat = null;
  for (const l of lines) {
    if (l.category_code !== lastCat) {
      if (y > BOTTOM - 40) { y = newPage(); header(); }
      doc.font('B').fontSize(7.5).fillColor(C.teal).text(l.category_name || l.category_code, M.left + 3, y + 2); y += 12; lastCat = l.category_code;
    }
    const lots = [...new Set((byLine.get(l.id) || []).map((p) => `${p.lot || ''}${p.expiry ? ' ' + itDate(p.expiry) : ''}`.trim()))].join('; ');
    const artTxt = `${l.article_name} (${l.unit}) · ${l.pack_label}`;
    doc.font('R').fontSize(8);
    const artLines = Math.ceil(doc.widthOfString(artTxt) / (cols[0].w - 6));
    const rowH = Math.max(14, artLines * 10 + 5, lots.length > 22 ? 24 : 14);
    if (y + rowH > BOTTOM - 10) { y = newPage(); header(); }
    let x = M.left;
    const vals = {
      art: `${l.article_name} (${l.unit}) · ${l.pack_label}`,
      req: String(l.qty_requested), prod: l.prod_packs_avg != null ? `${Number(l.prod_packs_avg).toLocaleString('it-IT', { maximumFractionDigits: 1 })}` : '–',
      delta: l.delta_pct != null ? `${Number(l.delta_pct) > 0 ? '+' : ''}${Number(l.delta_pct).toLocaleString('it-IT', { maximumFractionDigits: 0 })}%` : '–',
      app: l.qty_approved != null ? String(l.qty_approved) : '–', ric: l.packs_received != null ? String(l.packs_received) : '–', lot: lots,
    };
    doc.font('R').fontSize(8).fillColor(C.jet);
    for (const c of cols) {
      const bold = c.k === 'app';
      doc.font(bold ? 'B' : 'R').fontSize(c.k === 'lot' ? 6.5 : 8).text(vals[c.k], x + 3, y + 3, { width: c.w - 6, align: c.al, lineBreak: ['lot', 'art'].includes(c.k), height: rowH - 2, ellipsis: c.k === 'lot' });
      x += c.w;
    }
    doc.moveTo(M.left, y + rowH).lineTo(PAGE.w - M.right, y + rowH).lineWidth(.3).strokeColor(C.line).stroke();
    y += rowH;
  }
  y += 8;

  // Sezione D
  if (y > BOTTOM - 110) y = newPage();
  y = section(doc, y, 'Sezione D · Riservata a Toscana Diagnostica: presa in carico ed evasione');
  kv(doc, M.left, y, cw, 'Ricezione richiesta', fullDT(order.submitted_at)); kv(doc, M.left + cw, y, cw, 'Approvazione Area Operations', `${order.approved_by_name || ''} ${fullDT(order.approved_at)}`.trim());
  kv(doc, M.left + cw * 2, y, cw, 'Presa in carico magazzino', order.picked_at ? fullDT(order.picked_at) : '–');
  y += 30;
  if (order.silva_reference) { kv(doc, M.left + cw * 2, y, cw, 'Riferimento fornitore', order.silva_reference); }
  kv(doc, M.left, y, cw, 'Consegna', order.delivered_at ? `${fullDT(order.delivered_at)}${order.ddt_number ? ' · DDT ' + order.ddt_number : ''}` : '–'); kv(doc, M.left + cw, y, cw, 'Chiusura', `${order.closed_by_name || ''} ${fullDT(order.closed_at)}`.trim());
  y += 30;
  if (order.ops_notes) { kv(doc, M.left, y, W, 'Note Operations', order.ops_notes); y += 30; }
  y += 4;
  if (events.length) {
    doc.font('B').fontSize(7.5).fillColor(C.teal).text('Cronologia', M.left, y); y += 10;
    doc.font('R').fontSize(7.5).fillColor(C.grey);
    for (const e of events.slice(-12)) {
      if (y > BOTTOM - 8) y = newPage();
      doc.text(`${fullDT(e.at)} · ${e.event}${e.full_name ? ' · ' + e.full_name : ''}`, M.left, y, { width: W }); y += 10;
    }
  }
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('R').fontSize(7.5).fillColor(C.grey).text(`Pagina ${i + 1} di ${range.count}`, M.left, PAGE.h - M.bottom - 32, { width: W, align: 'right' });
  }
  doc.end();
  return done;
}
