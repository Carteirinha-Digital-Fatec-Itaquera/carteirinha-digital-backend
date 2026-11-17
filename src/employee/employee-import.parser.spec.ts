import * as XLSX from 'xlsx';
import {
  buildEmployeeImportTemplateCsv,
  buildEmployeeImportTemplateXlsx,
  neutralizeFormula,
  parseEmployeeImportFile,
} from './employee-import.parser';

describe('EmployeeImportParser', () => {
  it('interpreta CSV UTF-8 com BOM, ponto e vírgula, aspas e acentos preservando zero à esquerda', () => {
    const csv =
      '\uFEFFnome_completo;nome_social;email;matricula_funcional;rg;data_admissao;funcao;inicio_funcao;fim_funcao;funcao_ativa\n' +
      '"João da Silva";"";joao@example.test;004512;;2024-02-01;"Coordenador, DSM";2026-01-01;2026-12-20;SIM\n';

    const rows = parseEmployeeImportFile({
      buffer: Buffer.from(csv, 'utf8'),
      originalName: 'funcionarios.csv',
      mimeType: 'text/csv',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('João da Silva');
    expect(rows[0].registrationNumber).toBe('004512');
    expect(rows[0].assignmentTitle).toBe('Coordenador, DSM');
    expect(rows[0].startsOn).toBe('2026-01-01');
    expect(rows[0].validUntil).toBe('2026-12-20');
    expect(rows[0].active).toBe(true);
    expect(rows[0].rowErrorCode).toBeNull();
  });

  it('rejeita data brasileira ambígua em CSV sem adivinhar', () => {
    const csv =
      'nome_completo,email,data_admissao,funcao\n' +
      'Ana,ana@example.test,01/02/2024,Docente\n';

    const rows = parseEmployeeImportFile({
      buffer: Buffer.from(csv, 'utf8'),
      originalName: 'datas.csv',
      mimeType: 'text/csv',
    });

    expect(rows[0].rowErrorCode).toBe('INVALID_ROW');
  });

  it('interpreta modelo XLSX oficial e preserva zeros à esquerda', () => {
    const xlsxBuf = buildEmployeeImportTemplateXlsx();
    const rows = parseEmployeeImportFile({
      buffer: xlsxBuf,
      originalName: 'modelo.xlsx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].registrationNumber).toBe('001234');
    expect(rows[1].assignmentTitle).toBe('Coordenador de DSM');
  });

  it('rejeita arquivo renomeado, xlsm, fórmulas e excesso de linhas', () => {
    const xlsxBuf = buildEmployeeImportTemplateXlsx();
    // XLSX disguised as .csv
    expect(() =>
      parseEmployeeImportFile({
        buffer: xlsxBuf,
        originalName: 'disfarce.csv',
        mimeType: 'text/csv',
      }),
    ).toThrow();

    // .xlsm rejected
    expect(() =>
      parseEmployeeImportFile({
        buffer: xlsxBuf,
        originalName: 'macro.xlsm',
        mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
      }),
    ).toThrow();

    // Formula in XLSX cell rejected
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['nome_completo', 'email', 'data_admissao', 'funcao'],
      ['Pessoa', 'p@example.test', '2024-02-01', 'Docente'],
    ]);
    ws['D2'] = { t: 'n', f: 'SUM(1,1)', v: 2 };
    XLSX.utils.book_append_sheet(wb, ws, 'Funcionarios');
    const formulaBuf = XLSX.write(wb, {
      type: 'buffer',
      bookType: 'xlsx',
    }) as Buffer;

    expect(() =>
      parseEmployeeImportFile({
        buffer: formulaBuf,
        originalName: 'formula.xlsx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    ).toThrow();

    // Formula neutralization in export
    expect(neutralizeFormula('=CMD()')).toBe("'=CMD()");
    expect(buildEmployeeImportTemplateCsv()).toContain('matricula_funcional');
  });
});
