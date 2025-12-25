/*
  Genera un PDF simple a partir de docs/portal-empleado-instrucciones.md
  Salida: docs/portal-empleado-instrucciones.pdf

  Uso:
    node scripts/generate-portal-empleado-pdf.js
*/

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const projectRoot = path.resolve(__dirname, '..');
const inputPath = path.join(projectRoot, 'docs', 'portal-empleado-instrucciones.md');
const outputPath = path.join(projectRoot, 'docs', 'portal-empleado-instrucciones.pdf');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function parseMarkdownLines(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];

  let currentParagraph = [];
  function flushParagraph() {
    if (currentParagraph.length) {
      blocks.push({ type: 'p', text: currentParagraph.join(' ').trim() });
      currentParagraph = [];
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // Separador
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      blocks.push({
        type: 'h',
        level: headingMatch[1].length,
        text: headingMatch[2].trim()
      });
      continue;
    }

    // Bullet (simple)
    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      flushParagraph();
      blocks.push({ type: 'li', text: bulletMatch[1].trim() });
      continue;
    }

    // Ordered list
    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      blocks.push({ type: 'li', text: orderedMatch[1].trim(), ordered: true });
      continue;
    }

    // Continuación de párrafo
    currentParagraph.push(line.trim());
  }

  flushParagraph();
  return blocks;
}

function stripInlineMarkdown(text) {
  return String(text)
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1 ($2)');
}

function generatePdf(blocks) {
  ensureDir(path.dirname(outputPath));

  const doc = new PDFDocument({
    size: 'A4',
    margin: 54,
    info: {
      Title: 'Portal del Empleado — Instrucciones',
      Author: 'Employee Management System'
    }
  });

  doc.pipe(fs.createWriteStream(outputPath));

  const styles = {
    h1: { size: 20, gap: 10 },
    h2: { size: 15, gap: 8 },
    h3: { size: 12, gap: 6 },
    p: { size: 10.5, gap: 6 },
    li: { size: 10.5, gap: 4 }
  };

  function addSpacer(points) {
    doc.moveDown(points / 10);
  }

  function addHeading(level, text) {
    const clean = stripInlineMarkdown(text);
    const key = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
    doc.font('Helvetica-Bold').fontSize(styles[key].size).fillColor('#111111').text(clean, { align: 'left' });
    addSpacer(styles[key].gap);
  }

  function addParagraph(text) {
    const clean = stripInlineMarkdown(text);
    doc.font('Helvetica').fontSize(styles.p.size).fillColor('#222222').text(clean, {
      align: 'left',
      lineGap: 2
    });
    addSpacer(styles.p.gap);
  }

  function addListItem(text, index = null) {
    const clean = stripInlineMarkdown(text);
    const bullet = index != null ? `${index}.` : '•';
    const x = doc.x;
    const y = doc.y;

    // Bullet
    doc.font('Helvetica-Bold').fontSize(styles.li.size).fillColor('#222222').text(bullet, x, y, { continued: true });
    doc.font('Helvetica').fontSize(styles.li.size).fillColor('#222222').text(` ${clean}`, { lineGap: 2 });
    addSpacer(styles.li.gap);
  }

  // Render
  let orderedCounter = 0;
  for (const block of blocks) {
    if (block.type === 'h') {
      orderedCounter = 0;
      addHeading(block.level, block.text);
      continue;
    }

    if (block.type === 'p') {
      orderedCounter = 0;
      addParagraph(block.text);
      continue;
    }

    if (block.type === 'li') {
      if (block.ordered) {
        orderedCounter += 1;
        addListItem(block.text, orderedCounter);
      } else {
        orderedCounter = 0;
        addListItem(block.text);
      }
      continue;
    }
  }

  // Pie
  doc.moveDown(1);
  doc.font('Helvetica').fontSize(8).fillColor('#666666').text(
    `Generado automáticamente el ${new Date().toLocaleDateString('es-ES')} — Employee Management System`,
    { align: 'center' }
  );

  doc.end();
}

function main() {
  if (!fs.existsSync(inputPath)) {
    console.error(`No existe el fichero de entrada: ${inputPath}`);
    process.exit(1);
  }

  const md = fs.readFileSync(inputPath, 'utf8');
  const blocks = parseMarkdownLines(md);
  generatePdf(blocks);

  console.log(`PDF generado: ${outputPath}`);
}

main();
