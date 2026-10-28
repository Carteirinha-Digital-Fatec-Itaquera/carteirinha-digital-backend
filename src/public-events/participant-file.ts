import { BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
export const normalizeParticipantName = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
export function assertParticipantFileEvent(
  file: Express.Multer.File,
  event: { id: string; title: string; startsAt: Date },
) {
  if (!file.originalname.toLowerCase().endsWith('.json')) return;
  const data = JSON.parse(
    file.buffer.toString('utf8').replace(/^\uFEFF/, ''),
  ) as {
    evento?: {
      id_evento_banco?: string;
      titulo?: string;
      data?: string;
      horario_inicio?: string;
    };
  };
  const meta = data.evento;
  if (!meta) return;
  if (
    typeof meta !== 'object' ||
    Array.isArray(meta) ||
    [meta.id_evento_banco, meta.titulo, meta.data, meta.horario_inicio].some(
      (value) =>
        value !== null && value !== undefined && typeof value !== 'string',
    )
  )
    throw new BadRequestException(
      'Metadados inválidos. Baixe o modelo JSON deste evento.',
    );
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(event.startsAt);
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(event.startsAt);
  if (
    (meta.id_evento_banco && meta.id_evento_banco !== event.id) ||
    (meta.titulo &&
      normalizeParticipantName(meta.titulo) !==
        normalizeParticipantName(event.title)) ||
    (meta.data && meta.data !== date) ||
    (meta.horario_inicio && meta.horario_inicio !== time)
  )
    throw new BadRequestException(
      'O evento do arquivo não corresponde ao título, data ou horário deste evento.',
    );
}
export function parseParticipantFile(
  file: Express.Multer.File,
): { name: string; review: boolean }[] {
  if (!file || file.size > 2 * 1024 * 1024)
    throw new BadRequestException('Envie JSON ou CSV de até 2 MB.');
  try {
    const text = new TextDecoder('utf-8', { fatal: true })
      .decode(file.buffer)
      .replace(/^\uFEFF/, '');
    let rows: unknown;
    if (file.originalname.toLowerCase().endsWith('.json')) {
      const data: unknown = JSON.parse(text);
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const version = (data as Record<string, unknown>).versao_formato;
        if (version !== undefined && version !== '1.0')
          throw new BadRequestException(
            'Versão de arquivo desconhecida. Baixe o modelo atualizado.',
          );
      }
      rows = Array.isArray(data)
        ? data
        : data && typeof data === 'object'
          ? (data as Record<string, unknown>).participantes
          : null;
    } else if (file.originalname.toLowerCase().endsWith('.csv')) {
      rows = parse(text, {
        columns: (headers: string[]) => {
          if (new Set(headers).size !== headers.length)
            throw new BadRequestException(
              'Cabeçalho CSV duplicado. Mantenha nome_transcrito apenas uma vez.',
            );
          return headers;
        },
        bom: true,
        skip_empty_lines: true,
        delimiter: text.split(/\r?\n/)[0].includes(';') ? ';' : ',',
      });
    } else throw new Error();
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 1000)
      throw new Error();
    return rows.map((row: unknown, index: number) => {
      const data =
        typeof row === 'string'
          ? { nome: row }
          : (row as Record<string, unknown>);
      if (!data || typeof data !== 'object') throw new Error();
      const aliases = [data.nome_transcrito, data.nome, data.name].filter(
        (value) => value !== undefined,
      );
      if (
        aliases.length > 1 &&
        new Set(
          aliases.map((value) =>
            typeof value === 'string' ? normalizeParticipantName(value) : value,
          ),
        ).size > 1
      )
        throw new BadRequestException(
          `Linha ${index + 1}: campos de nome conflitantes. Utilize somente nome_transcrito.`,
        );
      const name = data.nome_transcrito ?? data.nome ?? data.name;
      if (
        typeof name !== 'string' ||
        name.trim().length < 3 ||
        name.length > 160 ||
        Array.from(name).some((character) => character.charCodeAt(0) < 32)
      )
        throw new BadRequestException(
          `Linha ${index + 1}: informe nome_transcrito com 3 a 160 caracteres, sem quebras de linha.`,
        );
      const review =
        data.revisao_identidade_pendente === 'SIM' ||
        data.precisa_revisao_grafia === 'SIM' ||
        ['professor', 'rasurado', 'revisar'].includes(String(data.status)) ||
        data.confianca === 'baixa' ||
        data.confianca_leitura === 'baixa';
      return { name: name.trim(), review };
    });
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(
      'Arquivo inválido. Use JSON com participantes ou CSV com coluna nome_transcrito, nome ou name, de 1 a 1.000 nomes.',
    );
  }
}
