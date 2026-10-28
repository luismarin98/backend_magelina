import { object, text, id, date, version } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';
export function followupInput(body: unknown) {
  const input = object(body, ['version', 'state', 'assessment', 'reviewAt', 'note', 'claim']);
  if (!['report','review','followup','closed'].includes(String(input.state)) || !['unconfirmed','confirmed','dismissed','revoked'].includes(String(input.assessment)) || typeof input.claim !== 'boolean') throw workflowError(400, 'Estado de seguimiento no valido.');
  const note = text(input.note, 1000);
  if (note.length < 10) throw workflowError(400, 'Explica la revision con al menos 10 caracteres.');
  const reviewAt = date(input.reviewAt);
  if (input.state !== 'closed' && (!reviewAt || reviewAt.getTime() <= Date.now())) throw workflowError(400, 'Selecciona una fecha futura de revision.');
  if (['dismissed','revoked'].includes(String(input.assessment)) && input.state !== 'closed') throw workflowError(400, 'Los reportes descartados y las medidas revocadas deben cerrar el seguimiento.');
  return { version: version(input.version), state: String(input.state), assessment: String(input.assessment), reviewAt: input.state === 'closed' ? null : reviewAt, note, claim: input.claim };
}
export function newFollowupInput(body: unknown) {
  const input = object(body, ['requestId','targetId','summary','caseId','reviewAt']);
  if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.requestId)) throw workflowError(400, 'Identificador de solicitud no valido.');
  const summary = text(input.summary,1000);
  if (summary.length < 10) throw workflowError(400, 'Describe el contexto con al menos 10 caracteres.');
  const reviewAt = date(input.reviewAt);
  if (!reviewAt || reviewAt.getTime() <= Date.now()) throw workflowError(400, 'Selecciona una fecha futura de revision.');
  return { requestId: input.requestId, targetId: id(input.targetId,true), summary, caseId: input.caseId ? id(input.caseId) : null, reviewAt };
}
