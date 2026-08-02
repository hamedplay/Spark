import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, WidthType, HeightRule, ImageRun, PageOrientation,
  convertMillimetersToTwip, VerticalAlign, BorderStyle,
} from 'docx';
import type { MinutesDocumentData, DocInternalPart, DocExternalPart, DocApproval } from '../components/Minutes/MinutesDocumentData';
import {
  DASH, orDash, formatConfidentiality, APPROVAL_STATUS_LABELS,
} from '../components/Minutes/MinutesDocumentData';
import { gregorianToJalaliDate, toPersianDigits } from './minutesDate';

const PRESENT_STATUSES = new Set(['present', 'online', 'late']);

const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

function jalaliDisplay(value: string | null | undefined): string {
  if (!value) return DASH;
  const j = gregorianToJalaliDate(value);
  return j ? toPersianDigits(j) : toPersianDigits(value);
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 120);
}

function buildFilename(title: string | null | undefined, dateIso: string | null | undefined): string {
  const datePart = dateIso
    ? jalaliDisplay(dateIso).replace(/\//g, '-')
    : toPersianDigits(new Date().toLocaleDateString('fa-IR')).replace(/\//g, '-');
  const safeTitle = title ? sanitizeFilename(title) : '';

  let stem: string;
  if (safeTitle) {
    stem = `صورتجلسه-${safeTitle}-${datePart}`;
  } else {
    stem = `صورتجلسه-${datePart}`;
  }
  stem = sanitizeFilename(stem);

  const base = stem || 'صورتجلسه';
  if (WINDOWS_RESERVED.has(base.toUpperCase())) {
    return `صورتجلسه-${datePart}.docx`;
  }
  return `${base}.docx`;
}

function rtlParagraph(children: Parameters<typeof Paragraph>[0]['children'], opts?: { alignment?: typeof AlignmentType.RIGHT | typeof AlignmentType.CENTER, spacingAfter?: number, bold?: boolean, fontSize?: number }): Paragraph {
  return new Paragraph({
    bidirectional: true,
    alignment: opts?.alignment ?? AlignmentType.RIGHT,
    spacing: { after: opts?.spacingAfter ?? 120 },
    children: Array.isArray(children) ? children : [children],
  });
}

function textRun(text: string, opts?: { bold?: boolean, size?: number, font?: string }): TextRun {
  return new TextRun({
    text,
    bold: opts?.bold,
    size: opts?.size,
    font: opts?.font ?? 'B Nazanin',
    rightToLeft: true,
  });
}

async function convertImageToPng(input: ArrayBuffer): Promise<ArrayBuffer | null> {
  try {
    const blob = new Blob([input]);
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const pngBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });
    if (!pngBlob) return null;
    return await pngBlob.arrayBuffer();
  } catch {
    return null;
  }
}

async function fetchLogoBuffer(logoUrl: string | null | undefined): Promise<{ buffer: ArrayBuffer; type: 'png' | 'jpg' } | null> {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    const buf = await res.arrayBuffer();

    if (ct.includes('png')) {
      return { buffer: buf, type: 'png' };
    }
    if (ct.includes('jpeg') || ct.includes('jpg')) {
      return { buffer: buf, type: 'jpg' };
    }

    // SVG, WebP, GIF, or unknown — try converting to PNG
    const pngBuf = await convertImageToPng(buf);
    if (pngBuf) {
      return { buffer: pngBuf, type: 'png' };
    }

    console.warn('MinutesWordExport: unsupported logo type:', ct, '— skipping logo');
    return null;
  } catch {
    console.warn('MinutesWordExport: logo fetch failed, continuing without logo');
    return null;
  }
}

function infoCell(label: string, value: string, widthPct: number): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        children: [
          textRun(label + ': ', { bold: true }),
          textRun(value),
        ],
      }),
    ],
  });
}

function meetingInfoTable(data: MinutesDocumentData, showConfidentiality: boolean): Table {
  const { minute, internalParts, externalParts } = data;

  const presentNames: string[] = [];
  const absentNames: string[] = [];

  for (const p of internalParts) {
    const status = p.attendance_status;
    if (status && PRESENT_STATUSES.has(status)) {
      presentNames.push(p.delegate_name || p.name_snapshot);
    } else if (status === 'absent') {
      absentNames.push(p.name_snapshot);
    }
  }
  for (const p of externalParts) {
    const status = p.attendance_status;
    if (status && PRESENT_STATUSES.has(status)) {
      presentNames.push(p.full_name);
    } else if (status === 'absent') {
      absentNames.push(p.full_name);
    }
  }

  const rows: TableRow[] = [
    new TableRow({
      children: [
        infoCell('عنوان جلسه', orDash(minute.meeting_title_snapshot), 100),
      ],
    }),
    new TableRow({
      children: [
        infoCell('حاضرین جلسه', presentNames.length > 0 ? presentNames.join('، ') : DASH, 50),
        infoCell('غایبین جلسه', absentNames.length > 0 ? absentNames.join('، ') : DASH, 50),
      ],
    }),
    new TableRow({
      children: [
        infoCell('محل جلسه', orDash(minute.meeting_location_snapshot), 33),
        infoCell('دبیر جلسه', orDash(minute.secretary_name_snapshot), 34),
        infoCell('رئیس جلسه', orDash(minute.chair_name_snapshot), 33),
      ],
    }),
  ];

  if (showConfidentiality) {
    rows.push(new TableRow({
      children: [
        infoCell('سطح محرمانگی', formatConfidentiality(minute.confidentiality), 100),
      ],
    }));
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

function agendaSection(data: MinutesDocumentData): Paragraph[] {
  const { agendaItems } = data;
  const paras: Paragraph[] = [
    rtlParagraph(textRun('دستور جلسات', { bold: true, size: 26 }), { spacingAfter: 200 }),
  ];
  if (agendaItems.length === 0) {
    paras.push(rtlParagraph(textRun(DASH)));
  } else {
    for (const item of agendaItems) {
      paras.push(new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        spacing: { after: 80 },
        children: [textRun(`${toPersianDigits(String(item.order))}. ${item.title}`)],
      }));
    }
  }
  return paras;
}

function decisionsSection(data: MinutesDocumentData): Paragraph[] {
  const { decisions } = data;
  const paras: Paragraph[] = [
    rtlParagraph(textRun('مصوبات', { bold: true, size: 26 }), { spacingAfter: 200 }),
  ];
  if (decisions.length === 0) {
    paras.push(rtlParagraph(textRun(DASH)));
  } else {
    decisions.forEach((d, i) => {
      const mainText = d.description || d.title || DASH;
      paras.push(new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        spacing: { after: 60 },
        children: [textRun(`مصوبه ${toPersianDigits(String(i + 1))} ـ ${mainText}`, { bold: true })],
      }));
      paras.push(new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        spacing: { after: 40 },
        children: [
          textRun('واحد مسئول: ', { bold: true }),
          textRun(orDash(d.responsibleUnitName)),
        ],
      }));
      paras.push(new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        spacing: { after: 120 },
        children: [
          textRun('مهلت انجام: ', { bold: true }),
          textRun(d.dueDate ? jalaliDisplay(d.dueDate) : DASH),
        ],
      }));
    });
  }
  return paras;
}

function signaturesSection(data: MinutesDocumentData): Table | null {
  const { internalParts, externalParts } = data;
  const allSigners: Array<{ name: string; sub: string }> = [
    ...internalParts.map((p: DocInternalPart) => ({
      name: p.name_snapshot,
      sub: p.org_unit_name_snapshot || DASH,
    })),
    ...externalParts.map((p: DocExternalPart) => ({
      name: p.full_name,
      sub: p.organization || DASH,
    })),
  ];
  if (allSigners.length === 0) return null;

  const maxCols = 3;
  const cols = Math.min(allSigners.length, maxCols);
  const rows: TableRow[] = [];

  for (let i = 0; i < allSigners.length; i += cols) {
    const chunk = allSigners.slice(i, i + cols);
    const cells = chunk.map(s => new TableCell({
      width: { size: Math.floor(100 / cols), type: WidthType.PERCENTAGE },
      verticalAlign: VerticalAlign.TOP,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1 },
        bottom: { style: BorderStyle.SINGLE, size: 1 },
        left: { style: BorderStyle.SINGLE, size: 1 },
        right: { style: BorderStyle.SINGLE, size: 1 },
      },
      children: [
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.RIGHT,
          children: [textRun(s.name, { bold: true })],
        }),
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.RIGHT,
          children: [textRun(s.sub, { size: 18 })],
        }),
        new Paragraph({ children: [], spacing: { after: 600 } }),
      ],
    }));
    while (cells.length < cols) {
      cells.push(new TableCell({
        width: { size: Math.floor(100 / cols), type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [] })],
      }));
    }
    rows.push(new TableRow({
      cantSplit: true,
      height: { value: 1700, type: HeightRule.ATLEAST },
      children: cells,
    }));
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

function approversSection(data: MinutesDocumentData): Table | null {
  const { approvals } = data;
  if (approvals.length === 0) return null;

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        width: { size: 40, type: WidthType.PERCENTAGE },
        children: [rtlParagraph(textRun('نام تأییدکننده', { bold: true }), { spacingAfter: 40 })],
      }),
      new TableCell({
        width: { size: 30, type: WidthType.PERCENTAGE },
        children: [rtlParagraph(textRun('وضعیت تأیید', { bold: true }), { spacingAfter: 40 })],
      }),
      new TableCell({
        width: { size: 30, type: WidthType.PERCENTAGE },
        children: [rtlParagraph(textRun('تاریخ تأیید', { bold: true }), { spacingAfter: 40 })],
      }),
    ],
  });

  const bodyRows = approvals.map((a: DocApproval) => new TableRow({
    children: [
      new TableCell({
        width: { size: 40, type: WidthType.PERCENTAGE },
        children: [rtlParagraph(textRun(orDash(a.approver_name)), { spacingAfter: 40 })],
      }),
      new TableCell({
        width: { size: 30, type: WidthType.PERCENTAGE },
        children: [rtlParagraph(textRun(APPROVAL_STATUS_LABELS[a.status] || a.status), { spacingAfter: 40 })],
      }),
      new TableCell({
        width: { size: 30, type: WidthType.PERCENTAGE },
        children: [rtlParagraph(textRun(a.approved_at ? jalaliDisplay(a.approved_at) : DASH), { spacingAfter: 40 })],
      }),
    ],
  }));

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...bodyRows],
  });
}

export async function exportMinutesToWord(data: MinutesDocumentData): Promise<void> {
  const { minute, logoUrl, config } = data;
  const cfg = config;
  const headerTitle = cfg?.headerTitle ?? 'صورت‌جلسه';
  const orgName = cfg?.orgName ?? '';
  const subtitle = cfg?.subtitle ?? '';
  const footerText = cfg?.footerText ?? 'پایان صورت‌جلسه';
  const showLogo = cfg?.showLogo ?? true;
  const showParticipants = cfg?.showParticipants ?? true;
  const showApprovers = cfg?.showApprovers ?? true;
  const showConfidentiality = cfg?.showConfidentiality ?? true;
  const showDecisions = cfg?.showDecisions ?? true;

  const logo = showLogo ? await fetchLogoBuffer(logoUrl) : null;

  const headerChildren: (TextRun | ImageRun)[] = [];
  if (logo) {
    headerChildren.push(new ImageRun({
      data: logo.buffer,
      transformation: { width: 100, height: 66 },
      type: logo.type,
    }));
  }
  headerChildren.push(textRun(headerTitle, { bold: true, size: 36 }));

  const headerParas: Paragraph[] = [
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: headerChildren,
    }),
  ];
  if (orgName) {
    headerParas.push(new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [textRun(orgName, { size: 22 })],
    }));
  }
  if (subtitle) {
    headerParas.push(new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [textRun(subtitle, { size: 20 })],
    }));
  }
  headerParas.push(new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [
      textRun('تاریخ: ', { bold: true, size: 20 }),
      textRun(jalaliDisplay(minute.meeting_date_snapshot), { size: 20 }),
    ],
  }));

  const bodyChildren: (Paragraph | Table)[] = [...headerParas];

  // Meeting info
  bodyChildren.push(rtlParagraph(textRun('مشخصات جلسه', { bold: true, size: 26 }), { spacingAfter: 200 }));
  bodyChildren.push(meetingInfoTable(data, showConfidentiality));
  bodyChildren.push(new Paragraph({ children: [], spacing: { after: 200 } }));

  // Agenda
  bodyChildren.push(...agendaSection(data));
  bodyChildren.push(new Paragraph({ children: [], spacing: { after: 200 } }));

  // Decisions
  if (showDecisions) {
    bodyChildren.push(...decisionsSection(data));
    bodyChildren.push(new Paragraph({ children: [], spacing: { after: 200 } }));
  }

  // Signatures
  if (showParticipants) {
    bodyChildren.push(rtlParagraph(textRun('شرکت‌کنندگان و محل امضا', { bold: true, size: 26 }), { spacingAfter: 200 }));
    const sigTable = signaturesSection(data);
    if (sigTable) bodyChildren.push(sigTable);
    bodyChildren.push(new Paragraph({ children: [], spacing: { after: 200 } }));
  }

  // System approvers
  if (showApprovers) {
    const approverTable = approversSection(data);
    if (approverTable) {
      bodyChildren.push(rtlParagraph(textRun('تأییدکنندگان سیستمی', { bold: true, size: 26 }), { spacingAfter: 200 }));
      bodyChildren.push(approverTable);
      bodyChildren.push(new Paragraph({ children: [], spacing: { after: 200 } }));
    }
  }

  // Notes
  if (minute.notes) {
    bodyChildren.push(rtlParagraph(textRun('یادداشت', { bold: true, size: 26 }), { spacingAfter: 200 }));
    for (const line of minute.notes.split('\n')) {
      bodyChildren.push(new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        spacing: { after: 60 },
        children: [textRun(line)],
      }));
    }
    bodyChildren.push(new Paragraph({ children: [], spacing: { after: 200 } }));
  }

  // Footer
  bodyChildren.push(new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.CENTER,
    spacing: { after: 0 },
    children: [textRun(footerText, { size: 20 })],
  }));

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'B Nazanin', size: 22, rightToLeft: true },
          paragraph: { bidirectional: true, alignment: AlignmentType.RIGHT },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { orientation: PageOrientation.PORTRAIT },
          margin: {
            top: convertMillimetersToTwip(18),
            right: convertMillimetersToTwip(16),
            bottom: convertMillimetersToTwip(20),
            left: convertMillimetersToTwip(16),
          },
        },
      },
      children: bodyChildren,
    }],
  });

  const blob = await Packer.toBlob(doc);
  if (!blob || blob.size === 0) {
    throw new Error('WORD_EMPTY_OUTPUT');
  }

  const filename = buildFilename(minute.meeting_title_snapshot, minute.meeting_date_snapshot);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Exported for testing
export { sanitizeFilename, buildFilename };
