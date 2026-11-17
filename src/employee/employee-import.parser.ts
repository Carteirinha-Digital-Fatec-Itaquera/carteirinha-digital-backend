import { HttpStatus } from '@nestjs/common';
import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import {
  assertValidDateRange,
  normalizeDisplayText,
  normalizeEmail,
  normalizeOptionalCode,
  normalizeOptionalText,
  parseIsoDateOnly,
  throwEmployeeError,
} from './employee.errors';

export const EMPLOYEE_IMPORT_SCHEMA_VERSION = '1.0';
export const EMPLOYEE_IMPORT_SHEET_NAME = 'Funcionarios';
export const EMPLOYEE_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB
export const EMPLOYEE_IMPORT_MAX_ROWS = 1000;
export const EMPLOYEE_IMPORT_MAX_COLS = 30;

export const EMPLOYEE_IMPORT_COLUMNS = [
  'funcionario_id',
  'funcao_id',
  'nome_completo',
  'nome_social',
  'email',
  'matricula_funcional',
  'rg',
  'data_admissao',
  'funcao',
  'inicio_funcao',
  'fim_funcao',
  'funcao_ativa',
] as const;

export interface ParsedEmployeeImportRow {
  rowNumber: number;
  funcionarioId: string | null;
  funcaoId: string | null;
  name: string | null;
  socialName: string | null;
  email: string | null;
  registrationNumber: string | null;
  rg: string | null;
  admissionDate: string | null;
  assignmentTitle: string | null;
  startsOn: string | null;
  validUntil: string | null;
  active: boolean | null;
  activeDefaulted: boolean;
  rowErrorCode: string | null;
  rowErrorMessage: string | null;
}

export function neutralizeFormula(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function isZipBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)
  );
}

function detectDelimiter(headerLine: string): ',' | ';' {
  const commaCount = (headerLine.match(/,/g) ?? []).length;
  const semiCount = (headerLine.match(/;/g) ?? []).length;
  return semiCount > commaCount ? ';' : ',';
}

function cellToString(val: unknown): string {
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (val instanceof Date) return val.toISOString();
  return '';
}

function parseCellDateValue(raw: unknown, fieldName: string): string | null {
  if (raw === undefined || raw === null) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, '0');
    const d = String(raw.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (!parsed || !parsed.y || !parsed.m || !parsed.d) {
      throw new Error(`Data inválida em ${fieldName}`);
    }
    return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const str = String(raw).trim();
  if (!str) return null;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    throw new Error(
      `Data ambígua em ${fieldName}: "${str}". Use o formato ISO YYYY-MM-DD.`,
    );
  }
  const parsed = parseIsoDateOnly(str, fieldName);
  return parsed.toISOString().slice(0, 10);
}

function parseActiveFlag(raw: unknown): {
  value: boolean | null;
  defaulted: boolean;
} {
  if (raw === undefined || raw === null)
    return { value: null, defaulted: false };
  const text = String(raw).trim().toUpperCase();
  if (!text) return { value: null, defaulted: false };
  if (text === 'SIM' || text === 'TRUE' || text === '1') {
    return { value: true, defaulted: false };
  }
  if (text === 'NAO' || text === 'NÃO' || text === 'FALSE' || text === '0') {
    return { value: false, defaulted: false };
  }
  throw new Error(
    `Valor inválido para funcao_ativa: "${text}". Use SIM ou NAO.`,
  );
}

function validateHeaders(headers: string[]): void {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  const required = ['nome_completo', 'email', 'data_admissao', 'funcao'];
  const hasAny = required.some((col) => normalized.includes(col));
  if (!hasAny || normalized.length > EMPLOYEE_IMPORT_MAX_COLS) {
    throwEmployeeError(
      HttpStatus.BAD_REQUEST,
      'IMPORT_SCHEMA_INVALID',
      'Cabeçalho da planilha incompatível com o modelo 1.0.',
    );
  }
  const allowed = new Set<string>(EMPLOYEE_IMPORT_COLUMNS);
  for (const col of normalized) {
    if (col && !allowed.has(col)) {
      throwEmployeeError(
        HttpStatus.BAD_REQUEST,
        'IMPORT_SCHEMA_INVALID',
        `Coluna desconhecida no modelo 1.0: "${col}".`,
      );
    }
  }
}

function normalizeRecord(
  rowNumber: number,
  rawMap: Record<string, unknown>,
): ParsedEmployeeImportRow {
  const readStr = (key: string): string | null => {
    const val = rawMap[key];
    if (val === undefined || val === null) return null;
    const s = cellToString(val).trim();
    return s.length > 0 ? s : null;
  };

  for (const [key, val] of Object.entries(rawMap)) {
    if (typeof val === 'string' && /^[=]/.test(val.trim())) {
      return {
        rowNumber,
        funcionarioId: null,
        funcaoId: null,
        name: null,
        socialName: null,
        email: null,
        registrationNumber: null,
        rg: null,
        admissionDate: null,
        assignmentTitle: null,
        startsOn: null,
        validUntil: null,
        active: null,
        activeDefaulted: false,
        rowErrorCode: 'FORMULA_NOT_ALLOWED',
        rowErrorMessage: `Fórmula não permitida na coluna ${key}.`,
      };
    }
  }

  try {
    const funcionarioId = readStr('funcionario_id');
    const funcaoId = readStr('funcao_id');
    const rawName = readStr('nome_completo');
    const rawSocial = readStr('nome_social');
    const rawEmail = readStr('email');
    const rawReg = readStr('matricula_funcional');
    const rawRg = readStr('rg');
    const admissionDate = parseCellDateValue(
      rawMap['data_admissao'],
      'data_admissao',
    );
    const rawTitle = readStr('funcao');
    const startsOn = parseCellDateValue(
      rawMap['inicio_funcao'],
      'inicio_funcao',
    );
    const validUntil = parseCellDateValue(rawMap['fim_funcao'], 'fim_funcao');

    if (startsOn && validUntil) {
      assertValidDateRange(
        parseIsoDateOnly(startsOn, 'inicio_funcao'),
        parseIsoDateOnly(validUntil, 'fim_funcao'),
      );
    }

    const activeParsed = parseActiveFlag(rawMap['funcao_ativa']);

    const email = rawEmail ? normalizeEmail(rawEmail) : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`E-mail inválido: "${email}"`);
    }

    return {
      rowNumber,
      funcionarioId,
      funcaoId,
      name: rawName ? normalizeDisplayText(rawName) : null,
      socialName: rawSocial ? normalizeOptionalText(rawSocial) : null,
      email,
      registrationNumber: rawReg ? normalizeOptionalCode(rawReg) : null,
      rg: rawRg ? normalizeOptionalCode(rawRg) : null,
      admissionDate,
      assignmentTitle: rawTitle ? normalizeDisplayText(rawTitle) : null,
      startsOn,
      validUntil,
      active: activeParsed.value,
      activeDefaulted: activeParsed.defaulted,
      rowErrorCode: null,
      rowErrorMessage: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Linha inválida';
    return {
      rowNumber,
      funcionarioId: readStr('funcionario_id'),
      funcaoId: readStr('funcao_id'),
      name: null,
      socialName: null,
      email: readStr('email')
        ? normalizeEmail(readStr('email') as string)
        : null,
      registrationNumber: readStr('matricula_funcional'),
      rg: null,
      admissionDate: null,
      assignmentTitle: null,
      startsOn: null,
      validUntil: null,
      active: null,
      activeDefaulted: false,
      rowErrorCode: 'INVALID_ROW',
      rowErrorMessage: msg,
    };
  }
}

export function parseEmployeeImportFile(params: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
}): ParsedEmployeeImportRow[] {
  const { buffer, originalName } = params;
  if (!buffer || buffer.length === 0) {
    throwEmployeeError(
      HttpStatus.BAD_REQUEST,
      'IMPORT_SCHEMA_INVALID',
      'Arquivo vazio.',
    );
  }
  if (buffer.length > EMPLOYEE_IMPORT_MAX_FILE_BYTES) {
    throwEmployeeError(
      HttpStatus.PAYLOAD_TOO_LARGE,
      'FILE_TOO_LARGE',
      'Arquivo excede o limite de 2 MB.',
    );
  }

  const lowerName = originalName.toLowerCase();
  if (lowerName.endsWith('.xlsm') || lowerName.endsWith('.xlsb')) {
    throwEmployeeError(
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      'FILE_TYPE_NOT_ALLOWED',
      'Arquivos com macro (.xlsm/.xlsb) não são permitidos.',
    );
  }

  const isZip = isZipBuffer(buffer);
  if (lowerName.endsWith('.xlsx')) {
    if (!isZip) {
      throwEmployeeError(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'FILE_TYPE_NOT_ALLOWED',
        'Arquivo .xlsx inválido ou renomeado.',
      );
    }
    return parseXlsxImport(buffer);
  }

  if (lowerName.endsWith('.csv')) {
    if (isZip) {
      throwEmployeeError(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'FILE_TYPE_NOT_ALLOWED',
        'Arquivo ZIP/XLSX renomeado para .csv não é permitido.',
      );
    }
    return parseCsvImport(buffer);
  }

  throwEmployeeError(
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    'FILE_TYPE_NOT_ALLOWED',
    'Formato não suportado. Envie .csv ou .xlsx.',
  );
}

function parseCsvImport(buffer: Buffer): ParsedEmployeeImportRow[] {
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = detectDelimiter(firstLine);

  let records: Array<Record<string, string>>;
  try {
    records = parseCsv(text, {
      columns: (headers: string[]) => {
        validateHeaders(headers);
        return headers.map((h) => h.trim().toLowerCase());
      },
      delimiter,
      skip_empty_lines: true,
      trim: true,
      to: EMPLOYEE_IMPORT_MAX_ROWS + 1,
    });
  } catch (err) {
    if (err instanceof Error && 'getStatus' in err) throw err;
    throwEmployeeError(
      HttpStatus.BAD_REQUEST,
      'IMPORT_SCHEMA_INVALID',
      'Falha ao ler CSV. Verifique codificação UTF-8 e delimitadores.',
    );
  }

  if (records.length === 0) {
    throwEmployeeError(
      HttpStatus.BAD_REQUEST,
      'IMPORT_SCHEMA_INVALID',
      'Planilha não contém linhas de dados.',
    );
  }
  if (records.length > EMPLOYEE_IMPORT_MAX_ROWS) {
    throwEmployeeError(
      HttpStatus.BAD_REQUEST,
      'IMPORT_SCHEMA_INVALID',
      `Limite máximo de ${EMPLOYEE_IMPORT_MAX_ROWS} linhas excedido.`,
    );
  }

  return records.map((rec, idx) => normalizeRecord(idx + 2, rec));
}

function parseXlsxImport(buffer: Buffer): ParsedEmployeeImportRow[] {
  const start = Date.now();
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellFormula: true,
    cellDates: true,
    sheetRows: EMPLOYEE_IMPORT_MAX_ROWS + 2,
  });

  if (Date.now() - start > 5000) {
    throwEmployeeError(
      HttpStatus.BAD_REQUEST,
      'IMPORT_SCHEMA_INVALID',
      'Tempo limite de leitura da planilha excedido.',
    );
  }

  if (workbook.vbaraw) {
    throwEmployeeError(
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      'FILE_TYPE_NOT_ALLOWED',
      'Planilhas com macros não são permitidas.',
    );
  }

  const sheet = workbook.Sheets[EMPLOYEE_IMPORT_SHEET_NAME];
  if (!sheet) {
    throwEmployeeError(
      HttpStatus.BAD_REQUEST,
      'IMPORT_SCHEMA_INVALID',
      `Aba obrigatória "${EMPLOYEE_IMPORT_SHEET_NAME}" não encontrada.`,
    );
  }

  const ref = sheet['!ref'];
  if (!ref) {
    throwEmployeeError(
      HttpStatus.BAD_REQUEST,
      'IMPORT_SCHEMA_INVALID',
      'Aba Funcionarios está vazia.',
    );
  }

  const range = XLSX.utils.decode_range(ref);
  if (range.e.c - range.s.c + 1 > EMPLOYEE_IMPORT_MAX_COLS) {
    throwEmployeeError(
      HttpStatus.BAD_REQUEST,
      'IMPORT_SCHEMA_INVALID',
      'Quantidade de colunas excede o limite do modelo.',
    );
  }
  if (range.e.r - range.s.r > EMPLOYEE_IMPORT_MAX_ROWS) {
    throwEmployeeError(
      HttpStatus.BAD_REQUEST,
      'IMPORT_SCHEMA_INVALID',
      `Limite máximo de ${EMPLOYEE_IMPORT_MAX_ROWS} linhas excedido.`,
    );
  }

  // Reject formulas or external links anywhere in the sheet range
  for (const addr of Object.keys(sheet)) {
    if (addr.startsWith('!')) continue;
    const cell = sheet[addr] as XLSX.CellObject;
    if (cell.f || cell.l) {
      throwEmployeeError(
        HttpStatus.BAD_REQUEST,
        'IMPORT_SCHEMA_INVALID',
        `Fórmulas ou links externos não são permitidos (célula ${addr}).`,
      );
    }
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  if (rows.length < 2) {
    throwEmployeeError(
      HttpStatus.BAD_REQUEST,
      'IMPORT_SCHEMA_INVALID',
      'Planilha não contém linhas de dados.',
    );
  }

  const headers = (rows[0] ?? []).map((h) =>
    String(h ?? '')
      .trim()
      .toLowerCase(),
  );
  validateHeaders(headers);

  const parsed: ParsedEmployeeImportRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const rowArr = rows[i] ?? [];
    const isEmpty = rowArr.every(
      (v) => v === null || v === undefined || String(v).trim() === '',
    );
    if (isEmpty) continue;
    if (parsed.length >= EMPLOYEE_IMPORT_MAX_ROWS) {
      throwEmployeeError(
        HttpStatus.BAD_REQUEST,
        'IMPORT_SCHEMA_INVALID',
        `Limite máximo de ${EMPLOYEE_IMPORT_MAX_ROWS} linhas excedido.`,
      );
    }

    const obj: Record<string, unknown> = {};
    headers.forEach((h, colIdx) => {
      if (h) obj[h] = rowArr[colIdx] ?? null;
    });
    parsed.push(normalizeRecord(i + 1, obj));
  }

  if (parsed.length === 0) {
    throwEmployeeError(
      HttpStatus.BAD_REQUEST,
      'IMPORT_SCHEMA_INVALID',
      'Planilha não contém linhas de dados.',
    );
  }

  return parsed;
}

export function buildEmployeeImportTemplateCsv(): string {
  const header = EMPLOYEE_IMPORT_COLUMNS.join(',');
  const example1 = [
    '',
    '',
    'Pessoa de Demonstração',
    '',
    'pessoa@example.test',
    '001234',
    '',
    '2024-02-01',
    'Docente',
    '',
    '',
    'SIM',
  ].join(',');
  const example2 = [
    '',
    '',
    'Pessoa de Demonstração',
    '',
    'pessoa@example.test',
    '001234',
    '',
    '2024-02-01',
    'Coordenador de DSM',
    '2026-01-01',
    '2026-12-20',
    'SIM',
  ].join(',');
  return `\uFEFF${header}\n${example1}\n${example2}\n`;
}

export function buildEmployeeImportTemplateXlsx(): Buffer {
  const wb = XLSX.utils.book_new();
  const data = [
    [...EMPLOYEE_IMPORT_COLUMNS],
    [
      '',
      '',
      'Pessoa de Demonstração',
      '',
      'pessoa@example.test',
      '001234',
      '',
      '2024-02-01',
      'Docente',
      '',
      '',
      'SIM',
    ],
    [
      '',
      '',
      'Pessoa de Demonstração',
      '',
      'pessoa@example.test',
      '001234',
      '',
      '2024-02-01',
      'Coordenador de DSM',
      '2026-01-01',
      '2026-12-20',
      'SIM',
    ],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  // Force matricula_funcional column (F) as text to preserve leading zeros
  for (const addr of ['F2', 'F3']) {
    if (ws[addr]) {
      ws[addr].t = 's';
      ws[addr].z = '@';
    }
  }
  XLSX.utils.book_append_sheet(wb, ws, EMPLOYEE_IMPORT_SHEET_NAME);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
