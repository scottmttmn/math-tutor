// Builds a small text-only PDF (Helvetica, US Letter) for the Shelf browser test, one page per
// array of lines, so the test needs no binary fixture. Optionally with bookmarks (`outline`: title,
// 1-based page, children) and printed page numbers (`pageLabels`: from a 0-based page index, a
// style, `r` roman or `D` decimal, and the number it starts at).
export function makePdf(pages, { outline = [], pageLabels = [] } = {}) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add(null);
  const pageTree = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const escape = (text) => text.replace(/[\\()]/g, (char) => `\\${char}`);
  const kids = pages.map((lines) => {
    const stream = `BT /F1 16 Tf 72 720 Td 22 TL ${lines.map((line) => `(${escape(line)}) Tj T*`).join(' ')} ET`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    return add(`<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`);
  });
  const addOutline = (items, parent) => {
    const ids = items.map(() => add(null));
    items.forEach((item, index) => {
      const children = item.children?.length ? addOutline(item.children, ids[index]) : null;
      objects[ids[index] - 1] = `<< /Title (${escape(item.title)}) /Parent ${parent} 0 R /Dest [${kids[item.page - 1]} 0 R /Fit]`
        + (index > 0 ? ` /Prev ${ids[index - 1]} 0 R` : '') + (index < ids.length - 1 ? ` /Next ${ids[index + 1]} 0 R` : '')
        + (children ? ` /First ${children[0]} 0 R /Last ${children.at(-1)} 0 R /Count ${children.length}` : '') + ' >>';
    });
    return ids;
  };
  let extra = '';
  if (outline.length) {
    const root = add(null);
    const top = addOutline(outline, root);
    objects[root - 1] = `<< /Type /Outlines /First ${top[0]} 0 R /Last ${top.at(-1)} 0 R /Count ${top.length} >>`;
    extra += ` /Outlines ${root} 0 R`;
  }
  if (pageLabels.length) {
    extra += ` /PageLabels << /Nums [${pageLabels.map(({ from, style, start = 1 }) => `${from} << /S /${style} /St ${start} >>`).join(' ')}] >>`;
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pageTree} 0 R${extra} >>`;
  objects[pageTree - 1] = `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
