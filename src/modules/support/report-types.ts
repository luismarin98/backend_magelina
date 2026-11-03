import { workflowError } from '../workflow/rules.js';

export const reportTypes = [
  { value: 'consulta', label: 'Consulta general' },
  { value: 'tecnico', label: 'Problema técnico' },
  { value: 'acceso', label: 'Acceso y permisos' },
  { value: 'usuario', label: 'Reporte de usuario' },
  { value: 'otro', label: 'Otro' },
];
export function reportType(value: unknown) {
  if (value === undefined) return 'consulta';
  if (!reportTypes.some(type => type.value === value)) throw workflowError(400, 'Selecciona un tipo de reporte válido.');
  return value as string;
}
export function supportChannelName(username: string, type: unknown, ticketId: string) {
  const slug = username.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'usuario';
  return `soporte-${slug}-${reportType(type)}-${ticketId.slice(-6)}`;
}
