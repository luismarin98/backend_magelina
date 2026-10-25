import type { ArticleChange, WorkChange, GlobalRole } from '../src/types/contracts.js';

// Se verifican con tsc; no son pruebas de ejecucion.
const accept: WorkChange = { status: 'accepted', version: 0, assigneeId: '100000000000000001' };
// @ts-expect-error Aceptar una tarea requiere un responsable.
const missingAssignee: WorkChange = { status: 'accepted', version: 0 };
// @ts-expect-error Completar una tarea no permite reasignarla.
const unexpectedAssignee: WorkChange = { status: 'completed', version: 1, assigneeId: '100000000000000001' };
// @ts-expect-error Actualizar una solucion requiere su contenido completo.
const missingContent: ArticleChange = { action: 'updated', version: 0 };
// @ts-expect-error No existe un rol global llamado admin.
const invalidRole: GlobalRole = 'admin';
void [accept, missingAssignee, unexpectedAssignee, missingContent, invalidRole];
