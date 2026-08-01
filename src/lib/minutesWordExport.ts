import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, WidthType, HeightRule, ImageRun, PageOrientation,
  convertMillimetersToTwip, ShadingType, VerticalAlign, BorderStyle,
} from 'docx';
import type { MinutesDocumentData, DocInternalPart, DocExternalPart } from '../components/Minutes/MinutesDocumentData';
import {
  DASH, orDash, formatConfidentiality,
} from '../components/Minutes/MinutesDocumentData';
import { gregorianToJalaliDate, toPersianDigits } from './minutesDate';

const PRESENT_STATUSES = new Set(['present', 'online', 'late']);

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
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

function buildFilename(title: string | null | undefined, dateIso: string | null | undefined): string {
  const datePart = dateIso ? jalaliDisplay(dateIso).replace(/\//g, '-') : toPersianDigits(new Date().toLocaleDateString('fa-IR')).replace(/\//g, '-');
  const safeTitle = title ? sanitizeFilename(title) : '';
  const base = safeTitle || 'صورتجلسه';
  return `${base}-${datePart}.docx`;
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

async function fetchLogoBuffer(logoUrl: string | null | undefined): Promise<{ buffer: ArrayBuffer; type: string } | null> {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || 'image/png';
    const buf = await res.arrayBuffer();
    const ext = ct.includes('jpeg') || ct.includes('jpg') ? 'jpg' : 'png';
    return { buffer: buf, type: ext };
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

function meetingInfoTable(data: MinutesDocumentData): Table {
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
    new TableRow({
      children: [
        infoCell('سطح محرمانگی', formatConfidentiality(minute.confidentiality), 100),
      ],
    }),
  ];

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

export async function exportMinutesToWord(data: MinutesDocumentData): Promise<void> {
  const { minute, logoUrl, config } = data;
  const cfg = config;
  const headerTitle = cfg?.headerTitle ?? 'صورت‌جلسه';
  const orgName = cfg?.orgName ?? '';
  const subtitle = cfg?.subtitle ?? '';
  const footerText = cfg?.footerText ?? 'پایان صورت‌جلسه';
  const showLogo = cfg?.showLogo ?? true;

  const logo = showLogo ? await fetchLogoBuffer(logoUrl) : null;

  const headerChildren: (TextRun | ImageRun)[] = [];
  if (logo) {
    headerChildren.push(new ImageRun({
      data: logo.buffer,
      transformation: { width: 100, height: 66 },
      type: logo.type as 'png' | 'jpg',
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
  bodyChildren.push(meetingInfoTable(data));
  bodyChildren.push(new Paragraph({ children: [], spacing: { after: 200 } }));

  // Agenda
  bodyChildren.push(...agendaSection(data));
  bodyChildren.push(new Paragraph({ children: [], spacing: { after: 200 } }));

  // Decisions
  bodyChildren.push(...decisionsSection(data));
  bodyChildren.push(new Paragraph({ children: [], spacing: { after: 200 } }));

  // Signatures
  if (cfg?.showParticipants ?? true) {
    bodyChildren.push(rtlParagraph(textRun('شرکت‌کنندگان و امضاها', { bold: true, size: 26 }), { spacingAfter: 200 }));
    const sigTable = signaturesSection(data);
    if (sigTable) bodyChildren.push(sigTable);
    bodyChildren.push(new Paragraph({ children: [], spacing: { after: 200 } }));
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
  const filename = buildFilename(minute.meeting_title_snapshot, minute.meeting_date_snapshot);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
