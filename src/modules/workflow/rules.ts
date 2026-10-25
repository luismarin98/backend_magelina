import type { WorkStatus, WorkChange } from '../../types/contracts.js';

export const transitions: Record<WorkStatus, WorkStatus[]> = {
  submitted: ['accepted', 'rejected'],
  accepted: ['in_progress'],
  in_progress: ['completed'],
  completed: [],
  rejected: [],
};

export function workflowError(status: number, message: string) {
  return Object.assign(new Error(message), { status, publicMessage: message });
}

export function validateChange(input: unknown): WorkChange {
  const body = input as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((key) => !['status', 'version', 'assigneeId'].includes(key))) {
    throw workflowError(400, 'Cambio no valido.');
  }
  if (typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 0 || typeof body.status !== 'string' || !Object.hasOwn(transitions, body.status)) {
    throw workflowError(400, 'Estado o version no validos.');
  }
  if (body.status === 'accepted' && (typeof body.assigneeId !== 'string' || !/^\d{17,20}$/.test(body.assigneeId))) {
    throw workflowError(400, 'Selecciona un responsable mediante su ID de Discord.');
  }
  if (body.status !== 'accepted' && body.assigneeId !== undefined) {
    throw workflowError(400, 'El responsable solo se asigna al aceptar la solicitud.');
  }
  return body as WorkChange;
}
