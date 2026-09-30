export interface CertificateSnapshot {
  studentName: string;
  studentRa: string;
  course: string;
  eventTitle: string;
  eventDate: string;
  workload: string;
  speaker: string;
  institution: string;
}

export const INSTITUTION_NAME = 'FATEC Itaquera - Centro Paula Souza';

export function formatCertificateWorkload(minutes: number): string {
  if (minutes <= 0) return '0 minutos';
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0 && remainingMinutes > 0) {
    const hourLabel = hours === 1 ? '1 hora' : `${hours} horas`;
    const minLabel =
      remainingMinutes === 1 ? '1 minuto' : `${remainingMinutes} minutos`;
    return `${hourLabel} e ${minLabel}`;
  }

  if (hours > 0) {
    return hours === 1 ? '1 hora' : `${hours} horas`;
  }

  return remainingMinutes === 1 ? '1 minuto' : `${remainingMinutes} minutos`;
}

export function formatCertificateDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  // YYYY-MM-DD em fuso America/Sao_Paulo
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function buildCertificateSnapshot(
  attendance: {
    studentName: string;
    studentRa: string;
    studentCourse: string;
  },
  event: {
    title: string;
    startsAt: Date | string;
    workloadMinutes: number;
    speaker: string;
  },
): CertificateSnapshot {
  return {
    studentName: attendance.studentName,
    studentRa: attendance.studentRa,
    course: attendance.studentCourse,
    eventTitle: event.title,
    eventDate: formatCertificateDate(event.startsAt),
    workload: formatCertificateWorkload(event.workloadMinutes),
    speaker: event.speaker,
    institution: INSTITUTION_NAME,
  };
}
